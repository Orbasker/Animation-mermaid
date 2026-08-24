"use client";

import { useMemo, type ChangeEvent } from "react";

import { planStoryApplication } from "@/domain/apply-proposal";
import type { ProjectDocument } from "@/domain/project-document";

import type { CopilotController } from "./use-copilot";

const RUNNING_PHASES = new Set(["starting", "running", "deciding"]);

/**
 * Undo/redo for the single transaction an approved proposal creates when it is applied. The
 * apply and its reversal are a byte-for-byte pair, surfaced here so the reviewer can revert
 * immediately after applying.
 */
export interface ApplyControls {
  readonly undone: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
}

export interface CopilotPanelProps {
  readonly controller: CopilotController;
  /** The local project the proposal is diffed against and applied to. */
  readonly project: ProjectDocument;
  /** Present once a proposal has been applied, to undo/redo that single transaction. */
  readonly applyControls?: ApplyControls;
  /**
   * Whether the hosted AI copilot can be reached. When false the panel degrades: composing stays
   * available so a draft is not lost, but starting a run is paused until connectivity returns.
   */
  readonly aiAvailable?: boolean;
}

/**
 * The AI copilot surface: compose an intent, confirm exactly what is sent, watch the durable
 * run, review the proposed scenes against the local project, and apply or discard them.
 *
 * The panel renders one section per client phase and never starts a request until the reviewer
 * has confirmed the context preview — the "Generate" control does not exist before then.
 */
export function CopilotPanel({
  controller,
  project,
  applyControls,
  aiAvailable = true,
}: CopilotPanelProps) {
  const { state } = controller;

  const plan = useMemo(
    () =>
      state.proposal
        ? planStoryApplication(project, state.proposal.story)
        : undefined,
    [project, state.proposal],
  );

  return (
    <div className="copilotPanel">
      <header className="panelHeading">
        <span>AI copilot</span>
        <h2>Design-review scenes</h2>
      </header>

      {!aiAvailable ? (
        <div className="copilotDegraded" role="status">
          <strong>AI copilot paused — you’re offline</strong>
          <p>
            Editing, previewing, and exporting all keep working locally. The
            copilot resumes automatically when your connection returns.
          </p>
        </div>
      ) : null}

      {state.phase === "composing" || state.phase === "previewing" ? (
        <ComposeSection aiAvailable={aiAvailable} controller={controller} />
      ) : null}

      {RUNNING_PHASES.has(state.phase) ? (
        <ProgressSection controller={controller} />
      ) : null}

      {state.phase === "reviewing" || state.phase === "deciding" ? (
        state.proposal ? (
          <ReviewSection controller={controller} plan={plan} />
        ) : null
      ) : null}

      {state.phase === "applied" ? (
        <div className="copilotTerminal" data-tone="ok" role="status">
          <strong>
            {applyControls?.undone ? "Apply undone" : "Applied to your project"}
          </strong>
          <p>
            {applyControls?.undone
              ? "The story was removed and your project restored, byte for byte."
              : "The proposed story was added as a single undoable transaction."}
          </p>
          <div className="copilotActions">
            {applyControls ? (
              applyControls.undone ? (
                <button onClick={applyControls.onRedo} type="button">
                  Redo apply
                </button>
              ) : (
                <button onClick={applyControls.onUndo} type="button">
                  Undo apply
                </button>
              )
            ) : null}
            <button onClick={controller.reset} type="button">
              Start another
            </button>
          </div>
        </div>
      ) : null}

      {state.phase === "rejected" ? (
        <TerminalSection
          controller={controller}
          tone="neutral"
          title="Discarded"
          detail="Nothing was applied. Your local project is unchanged, byte for byte."
        />
      ) : null}

      {state.phase === "cancelled" ? (
        <TerminalSection
          controller={controller}
          tone="neutral"
          title="Run cancelled"
          detail="The run was cancelled before it settled. Your local project is unchanged."
        />
      ) : null}

      {state.phase === "failed" && state.error ? (
        <div className="copilotError" role="alert">
          <strong>The run could not finish</strong>
          <p className="copilotErrorReason">{state.error.message}</p>
          <p className="copilotErrorAction">{state.error.nextAction}</p>
          <button onClick={controller.reset} type="button">
            Start over
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ComposeSection({
  controller,
  aiAvailable,
}: {
  readonly controller: CopilotController;
  readonly aiAvailable: boolean;
}) {
  const { state, context, redactedContext } = controller;
  const previewing = state.phase === "previewing";
  const includedCount = redactedContext.graph.entities.length;
  const totalCount = context.graph.entities.length;

  function onSceneCount(event: ChangeEvent<HTMLInputElement>) {
    const value = Number.parseInt(event.target.value, 10);
    controller.setSceneCount(Number.isNaN(value) ? 1 : value);
  }

  return (
    <div className="copilotCompose">
      <form
        className="copilotForm"
        onSubmit={(event) => {
          event.preventDefault();
          if (controller.canPreview) controller.preview();
        }}
      >
        <label htmlFor="copilot-title">Story title</label>
        <input
          id="copilot-title"
          onChange={(event) => controller.setTitle(event.target.value)}
          type="text"
          value={state.title}
          disabled={previewing}
        />

        <label htmlFor="copilot-intent">
          What should the animation explain?
        </label>
        <textarea
          id="copilot-intent"
          onChange={(event) => controller.setIntent(event.target.value)}
          placeholder="e.g. Walk a reviewer through how a request reaches the database."
          rows={3}
          value={state.intent}
          disabled={previewing}
        />

        <label htmlFor="copilot-scenes">Target scenes</label>
        <input
          id="copilot-scenes"
          max={24}
          min={1}
          onChange={onSceneCount}
          type="number"
          value={state.sceneCount}
          disabled={previewing}
        />

        {!previewing ? (
          <button
            disabled={!controller.canPreview || !aiAvailable}
            type="submit"
          >
            Preview request
          </button>
        ) : null}
      </form>

      <fieldset className="copilotEntities" disabled={previewing}>
        <legend>
          Context sent to AI · {includedCount} of {totalCount}
        </legend>
        <p className="panelNote">
          Only checked components are sent. Everything else is absent from the
          request.
        </p>
        <ul>
          {context.graph.entities.map((entity) => {
            const checked = !state.excludedIds.has(entity.id);
            const label = "label" in entity ? entity.label : entity.id;
            return (
              <li key={entity.id}>
                <label>
                  <input
                    checked={checked}
                    onChange={() => controller.toggleEntity(entity.id)}
                    type="checkbox"
                  />
                  <span>{label}</span>
                  <small>
                    {entity.kind} · {entity.id}
                  </small>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      {previewing ? (
        <div
          className="copilotPreview"
          role="group"
          aria-label="Request preview"
        >
          <h3>Confirm the request</h3>
          <dl>
            <div>
              <dt>Intent</dt>
              <dd>{redactedContext.intent}</dd>
            </div>
            <div>
              <dt>Components</dt>
              <dd>{includedCount} sent</dd>
            </div>
            <div>
              <dt>Target scenes</dt>
              <dd>{state.sceneCount}</dd>
            </div>
          </dl>
          <pre className="copilotFixture" aria-label="Request context fixture">
            {JSON.stringify(redactedContext, null, 2)}
          </pre>
          {state.actionError ? (
            <p className="copilotErrorReason" role="alert">
              {state.actionError}
            </p>
          ) : null}
          <div className="copilotActions">
            <button onClick={controller.backToCompose} type="button">
              Back
            </button>
            <button
              className="copilotPrimary"
              disabled={!controller.canStart || !aiAvailable}
              onClick={controller.confirmAndStart}
              type="button"
            >
              Confirm &amp; generate
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ProgressSection({
  controller,
}: {
  readonly controller: CopilotController;
}) {
  const { state } = controller;
  return (
    <div className="copilotProgress">
      <ol aria-label="Run progress" aria-live="polite">
        {state.progress.map((event, index) => (
          <li key={`${event.phase}-${index}`} data-phase={event.phase}>
            <strong>{event.phase.replace(/-/g, " ")}</strong>
            <span>{event.message}</span>
          </li>
        ))}
      </ol>
      {state.phase !== "deciding" ? (
        <button onClick={controller.cancel} type="button">
          Cancel run
        </button>
      ) : (
        <p className="panelNote" role="status">
          Submitting your decision…
        </p>
      )}
    </div>
  );
}

function ReviewSection({
  controller,
  plan,
}: {
  readonly controller: CopilotController;
  readonly plan: ReturnType<typeof planStoryApplication> | undefined;
}) {
  const { state } = controller;
  const proposal = state.proposal!;
  const deciding = state.phase === "deciding";
  const applicable = plan?.applicable ?? false;

  return (
    <div className="copilotReview">
      <section className="copilotAnalysis">
        <h3>{proposal.story.title}</h3>
        <p className="copilotThesis">{proposal.analysis.thesis}</p>
        <p className="panelNote">For {proposal.analysis.audience}</p>
      </section>

      <section
        className="copilotCritique"
        data-verdict={proposal.critique.verdict}
      >
        <strong>
          Agent review · {proposal.critique.verdict.replace(/_/g, " ")}
        </strong>
        <p>{proposal.critique.summary}</p>
        {proposal.critique.notes.length > 0 ? (
          <ul>
            {proposal.critique.notes.map((note, index) => (
              <li key={index}>
                {note.sceneTitle ? <em>{note.sceneTitle}: </em> : null}
                {note.note}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="copilotDiff">
        <h4>
          {plan?.scenes.length ?? proposal.story.scenes.length} scenes ·{" "}
          {Math.round(
            (plan?.totalDurationMs ?? proposal.totalDurationMs) / 100,
          ) / 10}
          s
        </h4>
        <ol>
          {(plan?.scenes ?? []).map((scene, index) => (
            <li key={index}>
              <strong>{scene.title}</strong>
              <span>
                {scene.actionCount} action{scene.actionCount === 1 ? "" : "s"} ·{" "}
                {scene.durationMs} ms
              </span>
              <small>{scene.targets.join(", ")}</small>
            </li>
          ))}
        </ol>
        {plan && plan.siblingStoryIds.length > 0 ? (
          <p className="panelNote">
            Adds to {plan.siblingStoryIds.length} existing stor
            {plan.siblingStoryIds.length === 1 ? "y" : "ies"} on this diagram.
          </p>
        ) : null}
        {plan && !applicable ? (
          <p className="copilotErrorReason" role="alert">
            This proposal cannot be applied to your project:{" "}
            {plan.errors[0]?.message}
          </p>
        ) : null}
      </section>

      {state.actionError ? (
        <p className="copilotErrorReason" role="alert">
          {state.actionError}
        </p>
      ) : null}

      <div className="copilotActions">
        <button disabled={deciding} onClick={controller.reject} type="button">
          Discard
        </button>
        <button
          className="copilotPrimary"
          disabled={deciding || !applicable}
          onClick={controller.approve}
          type="button"
        >
          Apply to project
        </button>
      </div>
    </div>
  );
}

function TerminalSection({
  controller,
  tone,
  title,
  detail,
}: {
  readonly controller: CopilotController;
  readonly tone: "ok" | "neutral";
  readonly title: string;
  readonly detail: string;
}) {
  return (
    <div className="copilotTerminal" data-tone={tone} role="status">
      <strong>{title}</strong>
      <p>{detail}</p>
      <button onClick={controller.reset} type="button">
        Start another
      </button>
    </div>
  );
}
