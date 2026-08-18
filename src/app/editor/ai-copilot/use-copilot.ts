"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import {
  buildAgentContextPackage,
  redactAgentContext,
  type AgentContextPackage,
  type AgentEntity,
} from "@/domain/agent-context";
import type { Comparison } from "@/domain/comparison";
import type { EntityId, GraphSnapshot } from "@/domain/graph";
import type {
  ProgressEvent,
  StoryOutcome,
  StoryPhase,
  StoryProposal,
  StoryRequest,
} from "@/workflows/design-review-story";

import type { CopilotError, CopilotTransport, RunSnapshot } from "./copilot-transport";

/**
 * The phase the copilot UI is in. Distinct from the workflow's own {@link StoryPhase}: this is
 * the *client's* lifecycle, which adds the pre-run composing/preview gate and the post-run
 * applied/rejected states the workflow never sees.
 */
export type CopilotPhase =
  | "composing"
  | "previewing"
  | "starting"
  | "running"
  | "reviewing"
  | "deciding"
  | "applied"
  | "rejected"
  | "cancelled"
  | "failed";

export interface CopilotState {
  readonly phase: CopilotPhase;
  readonly intent: string;
  readonly title: string;
  readonly sceneCount: number;
  /** Entities the reviewer has deselected; excluded from the request. */
  readonly excludedIds: ReadonlySet<EntityId>;
  readonly runId?: string;
  readonly progress: readonly ProgressEvent[];
  readonly workflowPhase?: StoryPhase;
  readonly proposal?: StoryProposal;
  readonly outcome?: StoryOutcome;
  readonly error?: CopilotError;
  /** A transient failure of a user action (start/decide/cancel), cleared on the next attempt. */
  readonly actionError?: string;
}

type CopilotAction =
  | { readonly type: "set-intent"; readonly value: string }
  | { readonly type: "set-title"; readonly value: string }
  | { readonly type: "set-scene-count"; readonly value: number }
  | { readonly type: "toggle-entity"; readonly id: EntityId }
  | { readonly type: "preview" }
  | { readonly type: "back-to-compose" }
  | { readonly type: "starting" }
  | { readonly type: "start-failed"; readonly message: string }
  | { readonly type: "started"; readonly runId: string }
  | { readonly type: "reconnect"; readonly runId: string }
  | { readonly type: "progress"; readonly event: ProgressEvent }
  | { readonly type: "reviewing"; readonly proposal: StoryProposal }
  | { readonly type: "deciding" }
  | { readonly type: "decide-failed"; readonly message: string }
  | { readonly type: "settled"; readonly snapshot: RunSnapshot }
  | { readonly type: "failed"; readonly error: CopilotError }
  | { readonly type: "cancelled" }
  | { readonly type: "reset" };

function reducer(state: CopilotState, action: CopilotAction): CopilotState {
  switch (action.type) {
    case "set-intent":
      return { ...state, intent: action.value };
    case "set-title":
      return { ...state, title: action.value };
    case "set-scene-count":
      return { ...state, sceneCount: action.value };
    case "toggle-entity": {
      const excludedIds = new Set(state.excludedIds);
      if (excludedIds.has(action.id)) excludedIds.delete(action.id);
      else excludedIds.add(action.id);
      return { ...state, excludedIds };
    }
    case "preview":
      return { ...state, phase: "previewing", actionError: undefined };
    case "back-to-compose":
      return { ...state, phase: "composing" };
    case "starting":
      return { ...state, phase: "starting", actionError: undefined };
    case "start-failed":
      return { ...state, phase: "previewing", actionError: action.message };
    case "started":
    case "reconnect":
      return {
        ...state,
        phase: "running",
        runId: action.runId,
        progress: [],
        proposal: undefined,
        outcome: undefined,
        error: undefined,
        actionError: undefined,
      };
    case "progress":
      return {
        ...state,
        progress: [...state.progress, action.event],
        workflowPhase: action.event.phase,
      };
    case "reviewing":
      return {
        ...state,
        phase: "reviewing",
        proposal: action.proposal,
        workflowPhase: "awaiting-approval",
      };
    case "deciding":
      return { ...state, phase: "deciding", actionError: undefined };
    case "decide-failed":
      return { ...state, phase: "reviewing", actionError: action.message };
    case "settled": {
      const outcome = action.snapshot.outcome;
      if (outcome?.status === "approved") {
        return { ...state, phase: "applied", outcome, proposal: outcome.proposal };
      }
      return { ...state, phase: "rejected", outcome };
    }
    case "failed":
      return { ...state, phase: "failed", error: action.error };
    case "cancelled":
      return { ...state, phase: "cancelled" };
    case "reset":
      return {
        ...state,
        phase: "composing",
        runId: undefined,
        progress: [],
        workflowPhase: undefined,
        proposal: undefined,
        outcome: undefined,
        error: undefined,
        actionError: undefined,
      };
  }
}

export interface UseCopilotOptions {
  readonly transport: CopilotTransport;
  readonly snapshot: GraphSnapshot;
  readonly comparison?: Comparison;
  readonly defaultTitle: string;
  readonly defaultIntent?: string;
  /** A run id to reconnect to on mount — the AC's "reload reconnects to an active run". */
  readonly initialRunId?: string;
  readonly onRunStarted?: (runId: string) => void;
  readonly onRunSettled?: (runId: string) => void;
  /** Applies an approved proposal to the local project as one undoable transaction. */
  readonly onApplied?: (proposal: StoryProposal) => void;
}

export interface CopilotController {
  readonly state: CopilotState;
  /** The full, semantic-only context the request is projected from. */
  readonly context: AgentContextPackage;
  /** The exact package that will be sent, after redaction. */
  readonly redactedContext: AgentContextPackage;
  readonly includedEntities: readonly AgentEntity[];
  readonly canPreview: boolean;
  readonly canStart: boolean;
  readonly setIntent: (value: string) => void;
  readonly setTitle: (value: string) => void;
  readonly setSceneCount: (value: number) => void;
  readonly toggleEntity: (id: EntityId) => void;
  readonly preview: () => void;
  readonly backToCompose: () => void;
  readonly confirmAndStart: () => void;
  readonly approve: () => void;
  readonly reject: () => void;
  readonly cancel: () => void;
  readonly reset: () => void;
}

function classifyTerminal(snapshot: RunSnapshot): CopilotAction {
  if (snapshot.status === "failed") {
    return {
      type: "failed",
      error:
        snapshot.error ??
        {
          kind: "unknown",
          message: "The run failed.",
          nextAction: "Your local project is unchanged — start a new run to try again.",
        },
    };
  }
  if (snapshot.status === "cancelled") return { type: "cancelled" };
  return { type: "settled", snapshot };
}

/**
 * Drives the durable design-review run from the editor.
 *
 * The hook owns the client lifecycle and the single reader loop that watches a run: it starts
 * or reconnects a run, streams progress, fetches the proposal at the approval gate, submits the
 * decision, and reports the terminal outcome. Everything with a side effect goes through the
 * injected {@link CopilotTransport}, so the whole flow is drivable by a scripted transport in a
 * test with no workflow runtime.
 */
export function useCopilot(options: UseCopilotOptions): CopilotController {
  const {
    transport,
    snapshot,
    comparison,
    defaultTitle,
    defaultIntent,
    initialRunId,
    onRunStarted,
    onRunSettled,
    onApplied,
  } = options;

  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    phase: "composing" as const,
    intent: defaultIntent ?? "",
    title: defaultTitle,
    sceneCount: 6,
    excludedIds: new Set<EntityId>(),
    progress: [],
  }));

  // Latest callbacks/values the async watch loop reads, without re-subscribing the effect.
  const latest = useRef({ transport, onRunStarted, onRunSettled, onApplied });
  useEffect(() => {
    latest.current = { transport, onRunStarted, onRunSettled, onApplied };
  });

  const context = useMemo(
    () => buildAgentContextPackage({ intent: state.intent, snapshot, comparison }),
    [state.intent, snapshot, comparison],
  );

  const includedIds = useMemo(
    () => context.graph.entities.map((entity) => entity.id).filter((id) => !state.excludedIds.has(id)),
    [context, state.excludedIds],
  );

  const redactedContext = useMemo(
    () => redactAgentContext(context, includedIds),
    [context, includedIds],
  );

  const includedEntities = redactedContext.graph.entities;

  /**
   * Watches a run to its terminal state. Idempotent per run id via the abort ref: a second
   * watch for the same run aborts the first, so React StrictMode's double-effect never runs two
   * concurrent readers.
   */
  const watchRef = useRef<AbortController | undefined>(undefined);
  const watch = useCallback(
    async (runId: string, fromIndex: number) => {
      watchRef.current?.abort();
      const controller = new AbortController();
      watchRef.current = controller;
      const { signal } = controller;
      const t = latest.current.transport;

      try {
        const initial = await t.status(runId, signal);
        if (signal.aborted) return;
        if (initial.status === "completed" || initial.status === "failed" || initial.status === "cancelled") {
          const terminal = classifyTerminal(initial);
          dispatch(terminal);
          if (terminal.type === "settled" && initial.outcome?.status === "approved") {
            latest.current.onApplied?.(initial.outcome.proposal);
          }
          latest.current.onRunSettled?.(runId);
          return;
        }

        for await (const event of t.streamProgress(runId, { startIndex: fromIndex, signal })) {
          if (signal.aborted) return;
          dispatch({ type: "progress", event });
          if (event.phase === "awaiting-approval") {
            const proposal = await t.proposal(runId, signal);
            if (signal.aborted) return;
            if (proposal) dispatch({ type: "reviewing", proposal });
          }
        }
        if (signal.aborted) return;

        const terminal = await t.status(runId, signal);
        if (signal.aborted) return;
        const action = classifyTerminal(terminal);
        dispatch(action);
        if (action.type === "settled" && terminal.outcome?.status === "approved") {
          latest.current.onApplied?.(terminal.outcome.proposal);
        }
        latest.current.onRunSettled?.(runId);
      } catch (error) {
        if (signal.aborted) return;
        dispatch({
          type: "failed",
          error: {
            kind: "network",
            message: error instanceof Error ? error.message : String(error),
            nextAction: "Could not reach the workflow service. Check your connection, then try again.",
          },
        });
      }
    },
    [],
  );

  // Reconnect to an active run on mount.
  useEffect(() => {
    if (!initialRunId) return;
    dispatch({ type: "reconnect", runId: initialRunId });
    void watch(initialRunId, 0);
    return () => watchRef.current?.abort();
    // Runs once for the mounted run id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRunId]);

  useEffect(() => () => watchRef.current?.abort(), []);

  const canPreview = state.intent.trim().length > 0 && includedIds.length > 0;
  const canStart = state.phase === "previewing" && canPreview;

  const confirmAndStart = useCallback(() => {
    // The AC gate: a run only starts from the confirmed preview, never from composing.
    if (state.phase !== "previewing") return;
    if (state.intent.trim().length === 0 || includedIds.length === 0) return;

    const request: StoryRequest = {
      title: state.title.trim() || defaultTitle,
      context: redactedContext,
      sceneCount: state.sceneCount,
    };

    dispatch({ type: "starting" });
    void (async () => {
      try {
        const { runId } = await latest.current.transport.start(request);
        latest.current.onRunStarted?.(runId);
        dispatch({ type: "started", runId });
        void watch(runId, 0);
      } catch (error) {
        dispatch({
          type: "start-failed",
          message: error instanceof Error ? error.message : "Could not start the run.",
        });
      }
    })();
  }, [state.phase, state.intent, state.title, state.sceneCount, includedIds.length, redactedContext, defaultTitle, watch]);

  const decide = useCallback(
    (decision: "approve" | "reject") => {
      const runId = state.runId;
      if (!runId || state.phase !== "reviewing") return;
      dispatch({ type: "deciding" });
      void (async () => {
        try {
          await latest.current.transport.decide(runId, { decision });
        } catch (error) {
          dispatch({
            type: "decide-failed",
            message: error instanceof Error ? error.message : "Could not submit the decision.",
          });
        }
      })();
    },
    [state.runId, state.phase],
  );

  const cancel = useCallback(() => {
    const runId = state.runId;
    if (!runId) return;
    watchRef.current?.abort();
    dispatch({ type: "cancelled" });
    void (async () => {
      try {
        await latest.current.transport.cancel(runId);
      } finally {
        latest.current.onRunSettled?.(runId);
      }
    })();
  }, [state.runId]);

  return {
    state,
    context,
    redactedContext,
    includedEntities,
    canPreview,
    canStart,
    setIntent: useCallback((value: string) => dispatch({ type: "set-intent", value }), []),
    setTitle: useCallback((value: string) => dispatch({ type: "set-title", value }), []),
    setSceneCount: useCallback((value: number) => dispatch({ type: "set-scene-count", value }), []),
    toggleEntity: useCallback((id: EntityId) => dispatch({ type: "toggle-entity", id }), []),
    preview: useCallback(() => dispatch({ type: "preview" }), []),
    backToCompose: useCallback(() => dispatch({ type: "back-to-compose" }), []),
    confirmAndStart,
    approve: useCallback(() => decide("approve"), [decide]),
    reject: useCallback(() => decide("reject"), [decide]),
    cancel,
    reset: useCallback(() => dispatch({ type: "reset" }), []),
  };
}
