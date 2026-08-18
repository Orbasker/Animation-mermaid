"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";

import {
  commitEditorTransaction,
  createEditorHistory,
  createStressSnapshot,
  reconcileImportedSnapshot,
  redoEditorHistory,
  undoEditorHistory,
  type EditorHistory,
  type EditorTransaction,
} from "@/domain/editor";
import { sampleProjectDocument } from "@/domain/fixtures";
import {
  type EdgeEntity,
  type EntityId,
  type GraphSnapshot,
  type LayoutHint,
  type NodeEntity,
} from "@/domain/graph";
import { applyStoryProposal } from "@/domain/apply-proposal";
import { IMPORTER_CAPABILITIES } from "@/domain/import/capabilities";
import type { ImporterCapabilities } from "@/domain/import/contract";
import { FLOWCHART_DIAGRAM_TYPE } from "@/domain/mermaid/capabilities";
import type {
  JobError,
  JobProgress,
  MermaidImportRunner,
} from "@/domain/mermaid/worker";
import {
  actionChannel,
  storyDurationMs,
  validateStory,
  type Action,
  type ActionChannel,
  type SceneId,
  type Story,
  type StoryId,
} from "@/domain/story";
import { renderStoryAt, type EntityRenderState } from "@/domain/story-engine";
import {
  allocateSceneId,
  applyTimelineOperation,
  collectSceneReferenceWarnings,
  repairSceneReferences,
  type SceneReferenceWarning,
  type TimelineOperation,
} from "@/domain/timeline";
import type { ProjectDocument } from "@/domain/project-document";
import { buildExportHtml, buildExportPayload, ExportError } from "@/export";
import { ProjectRepository } from "@/persistence";
import type { StoryProposal } from "@/workflows/design-review-story";

import { CopilotSurface } from "./ai-copilot/copilot-surface";
import {
  createHttpCopilotTransport,
  type CopilotTransport,
} from "./ai-copilot/copilot-transport";
import { e2eCopilotTransportFromWindow } from "./ai-copilot/e2e-transport";

const SURFACES = [
  "Source",
  "Story",
  "Compare",
  "Layers",
  "Inspector",
  "Copilot",
] as const;
type Surface = (typeof SURFACES)[number];

/** The before/after pair of applying one proposal, so the apply is a reversible transaction. */
interface ApplyRecord {
  readonly before: ProjectDocument;
  readonly after: ProjectDocument;
  readonly undone: boolean;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface DragState extends Point {
  readonly entityId: EntityId;
  readonly pointerX: number;
  readonly pointerY: number;
  readonly originX: number;
  readonly originY: number;
}

export interface EditorWorkspaceProps {
  readonly repository?: ProjectRepository;
  readonly initialProject?: ProjectDocument;
  readonly autosaveDelayMs?: number;
  /** The AI copilot transport; defaults to the HTTP transport against this app's API. */
  readonly copilotTransport?: CopilotTransport;
}

function replaceSnapshot(
  project: ProjectDocument,
  snapshot: GraphSnapshot,
): ProjectDocument {
  return {
    ...project,
    snapshots: project.snapshots.map((item, index) =>
      item.id === snapshot.id ||
      (index === 0 && !project.snapshots.some((s) => s.id === snapshot.id))
        ? snapshot
        : item,
    ),
  };
}

function positionFor(
  snapshot: GraphSnapshot,
  node: NodeEntity,
  index: number,
): LayoutHint {
  return (
    snapshot.layout?.find((hint) => hint.entityId === node.id) ?? {
      entityId: node.id,
      x: (index % 5) * 210 + 40,
      y: Math.floor(index / 5) * 130 + 40,
      width: 160,
      height: 58,
    }
  );
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "design-review";
}

function clampZoom(value: number): number {
  return Math.min(1.8, Math.max(0.35, Math.round(value * 100) / 100));
}

function isPreviewVisible(
  states: ReadonlyMap<EntityId, EntityRenderState>,
  id: EntityId,
): boolean {
  const state = states.get(id);
  return state ? state.visible : true;
}

function summarizeAction(action: Action): string {
  switch (action.type) {
    case "reveal":
      return `Reveal ${action.target}`;
    case "hide":
      return `Hide ${action.target}`;
    case "focus":
      return `Focus ${action.target}`;
    case "trace":
      return `Trace ${action.target}`;
    case "transform":
      return `Transform ${action.target}`;
    case "compare":
      return `Compare ${action.target} (${action.change})`;
    case "highlight":
      return `Highlight ${action.target}`;
    case "annotate":
      return `Annotate ${action.target}: ${action.text}`;
    case "camera":
      return action.focus.length > 0
        ? `Frame ${action.focus.join(", ")}`
        : "Fit whole diagram";
  }
}

function actionTarget(action: Action): EntityId | undefined {
  return action.type === "camera" ? undefined : action.target;
}

/**
 * Reads the structured {@link JobError} off a rejected import without importing the worker
 * module's error class, so the editor's initial bundle stays free of the layout engine.
 */
function jobErrorOf(error: unknown): JobError | null {
  if (error && typeof error === "object" && "error" in error) {
    const candidate = (error as { error?: unknown }).error;
    if (
      candidate &&
      typeof candidate === "object" &&
      "code" in candidate &&
      "message" in candidate
    ) {
      return candidate as JobError;
    }
  }
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The import failed.";
}

export function EditorWorkspace({
  repository: suppliedRepository,
  initialProject,
  autosaveDelayMs = 220,
  copilotTransport,
}: EditorWorkspaceProps) {
  const [repository, setRepository] = useState(suppliedRepository);
  const [project, setProject] = useState<ProjectDocument>();
  const [history, setHistory] = useState<EditorHistory>();
  const [surface, setSurface] = useState<Surface>("Layers");
  const [initialRunId, setInitialRunId] = useState<string>();
  const [applyRecord, setApplyRecord] = useState<ApplyRecord>();
  const transport = useMemo(
    () =>
      copilotTransport ??
      e2eCopilotTransportFromWindow() ??
      createHttpCopilotTransport(),
    [copilotTransport],
  );
  const [selectedIds, setSelectedIds] = useState<readonly EntityId[]>([]);
  const [annotationDraft, setAnnotationDraft] = useState("");
  const [loadError, setLoadError] = useState<string>();
  const [saveState, setSaveState] = useState("Loading project…");
  const [announcement, setAnnouncement] = useState("");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 32, y: 32 });
  const [drag, setDrag] = useState<DragState>();
  const [stressPreview, setStressPreview] = useState(false);
  const [activeStoryId, setActiveStoryId] = useState<StoryId>();
  const [selectedSceneId, setSelectedSceneId] = useState<SceneId>();
  const [playheadMs, setPlayheadMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const ownsRepository = useRef(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const importRunnerRef = useRef<MermaidImportRunner | null>(null);

  useEffect(() => {
    let cancelled = false;
    let openedRepository: ProjectRepository | undefined;

    async function loadProject() {
      try {
        const activeRepository =
          suppliedRepository ??
          (typeof indexedDB === "undefined"
            ? undefined
            : await ProjectRepository.open());
        if (!suppliedRepository && activeRepository) {
          openedRepository = activeRepository;
          ownsRepository.current = true;
        }
        if (cancelled) {
          openedRepository?.close();
          return;
        }
        setRepository(activeRepository);

        let document = initialProject;
        if (!document && activeRepository) {
          const [first] = await activeRepository.list();
          if (first)
            document = (await activeRepository.get(first.id))?.document;
        }
        document ??= sampleProjectDocument();
        if (document.snapshots.length === 0) {
          const seed = sampleProjectDocument();
          document = {
            ...document,
            snapshots: seed.snapshots,
            stories: seed.stories,
            comparisons: seed.comparisons,
          };
        }
        setProject(document);
        setHistory(createEditorHistory(document.snapshots[0]));
        setActiveStoryId(document.stories[0]?.id);
        setSelectedSceneId(document.stories[0]?.scenes[0]?.id);
        setSaveState(activeRepository ? "Ready to save" : "Preview mode");

        // Reconnect to the most recently linked run, if any — a reload rejoins an active run
        // rather than starting a second one.
        if (activeRepository) {
          const runs = await activeRepository.aiRuns(document.id);
          if (!cancelled && runs.length > 0) {
            setInitialRunId(runs[runs.length - 1].runId);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "The project could not be opened.",
          );
        }
      }
    }

    void loadProject();
    return () => {
      cancelled = true;
      if (ownsRepository.current) openedRepository?.close();
    };
  }, [initialProject, suppliedRepository]);

  useEffect(
    () => () => {
      importRunnerRef.current?.dispose();
      importRunnerRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!history || !project || !repository || stressPreview) return;
    const nextProject = replaceSnapshot(project, history.present);
    const timer = window.setTimeout(() => {
      setSaveState("Saving…");
      void repository
        .save(nextProject)
        .then(() => {
          setSaveState("Saved locally");
        })
        .catch((error: unknown) => {
          setSaveState(
            error instanceof Error
              ? `Save failed: ${error.message}`
              : "Save failed",
          );
        });
    }, autosaveDelayMs);
    return () => window.clearTimeout(timer);
  }, [autosaveDelayMs, history, project, repository, stressPreview]);

  const snapshot = history?.present;
  const nodes = useMemo(
    () =>
      snapshot?.entities.filter(
        (entity): entity is NodeEntity => entity.kind === "node",
      ) ?? [],
    [snapshot],
  );
  const edges = useMemo(
    () =>
      snapshot?.entities.filter(
        (entity): entity is EdgeEntity => entity.kind === "edge",
      ) ?? [],
    [snapshot],
  );
  const hiddenIds = useMemo(
    () => new Set(snapshot?.view?.hiddenEntityIds ?? []),
    [snapshot],
  );
  const selectedId = selectedIds[0];
  const selectedEntity = nodes.find((node) => node.id === selectedId);
  const positions = useMemo(() => {
    const map = new Map<EntityId, LayoutHint>();
    nodes.forEach((node, index) =>
      map.set(node.id, positionFor(snapshot!, node, index)),
    );
    return map;
  }, [nodes, snapshot]);

  const markDirty = useCallback(() => {
    if (repository && !stressPreview) setSaveState("Saving…");
  }, [repository, stressPreview]);

  const transact = useCallback(
    (transaction: EditorTransaction, message: string) => {
      markDirty();
      setHistory((current) =>
        current ? commitEditorTransaction(current, transaction) : current,
      );
      setAnnouncement(message);
    },
    [markDirty],
  );

  const handleRunStarted = useCallback(
    (runId: string) => {
      if (!repository || !project) return;
      void (async () => {
        try {
          // Ensure the project row exists before linking the run to it, then record the run id
          // in the separate store the repository keeps for hosted runs.
          await repository.save(project);
          await repository.linkAiRun(project.id, {
            runId,
            provider: "vercel-workflow",
            createdAt: new Date().toISOString(),
          });
        } catch {
          // Linking is best-effort local bookkeeping; a failure must not break the run.
        }
      })();
    },
    [repository, project],
  );

  const applyProposal = useCallback(
    (proposal: StoryProposal) => {
      if (!project) return;
      let next: ProjectDocument;
      try {
        next = applyStoryProposal(project, proposal.story);
      } catch (error) {
        setAnnouncement(
          error instanceof Error
            ? error.message
            : "The proposal could not be applied.",
        );
        return;
      }
      // Applying is one transaction: keep the before/after pair so it reverts byte-for-byte.
      setApplyRecord({ before: project, after: next, undone: false });
      if (next !== project) {
        setProject(next);
        setAnnouncement(`Applied "${proposal.story.title}" as a new story.`);
      } else {
        setAnnouncement(
          `"${proposal.story.title}" is already in this project.`,
        );
      }
    },
    [project],
  );

  const undoApply = useCallback(() => {
    if (!applyRecord || applyRecord.undone) return;
    setProject(applyRecord.before);
    setApplyRecord({ ...applyRecord, undone: true });
    setAnnouncement("Reverted the applied story.");
  }, [applyRecord]);

  const redoApply = useCallback(() => {
    if (!applyRecord || !applyRecord.undone) return;
    setProject(applyRecord.after);
    setApplyRecord({ ...applyRecord, undone: false });
    setAnnouncement("Reapplied the story.");
  }, [applyRecord]);

  const stories = useMemo(() => project?.stories ?? [], [project]);
  const activeStory = useMemo(
    () => stories.find((story) => story.id === activeStoryId) ?? stories[0],
    [stories, activeStoryId],
  );

  const storyWarnings = useMemo(
    () =>
      activeStory && snapshot
        ? collectSceneReferenceWarnings(activeStory, snapshot)
        : [],
    [activeStory, snapshot],
  );

  const storyValid = useMemo(
    () =>
      Boolean(activeStory && snapshot) &&
      activeStory!.scenes.length > 0 &&
      validateStory(activeStory!, snapshot!).length === 0,
    [activeStory, snapshot],
  );

  const storyDuration = useMemo(() => {
    if (!activeStory) return 0;
    try {
      return storyDurationMs(activeStory);
    } catch {
      return 0;
    }
  }, [activeStory]);

  const previewState = useMemo(() => {
    if (!previewMode || !storyValid || !snapshot || !activeStory) return null;
    try {
      return renderStoryAt({
        snapshot,
        story: activeStory,
        timestampMs: playheadMs,
      });
    } catch {
      return null;
    }
  }, [previewMode, storyValid, snapshot, activeStory, playheadMs]);

  const previewEntities = useMemo(() => {
    if (!previewState) return null;
    return new Map<EntityId, EntityRenderState>(
      previewState.entities.map((entity) => [entity.id, entity]),
    );
  }, [previewState]);

  const exportStoryHtml = useCallback(() => {
    if (!project || !snapshot || !activeStory) return;
    try {
      const withCurrentSnapshot = replaceSnapshot(project, snapshot);
      const payload = buildExportPayload(withCurrentSnapshot, activeStory.id);
      const html = buildExportHtml(payload);
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${slugify(activeStory.title)}.html`;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setAnnouncement(
        `Exported "${activeStory.title}" as a self-contained HTML file.`,
      );
    } catch (error) {
      const message =
        error instanceof ExportError
          ? error.message
          : "The story could not be exported.";
      setAnnouncement(message);
    }
  }, [project, snapshot, activeStory]);

  useEffect(() => {
    if (!isPlaying || storyDuration <= 0) return;
    let frame = 0;
    let last: number | null = null;
    const step = (now: number) => {
      if (last !== null) {
        const delta = now - last;
        setPlayheadMs((current) => {
          const next = current + delta;
          if (next >= storyDuration) {
            setIsPlaying(false);
            return storyDuration;
          }
          return next;
        });
      }
      last = now;
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, storyDuration]);

  const dispatchTimeline = useCallback(
    (operation: TimelineOperation, message: string) => {
      const targetId = activeStoryId ?? stories[0]?.id;
      if (!targetId) return;
      markDirty();
      setProject((current) =>
        current
          ? {
              ...current,
              stories: current.stories.map((story) =>
                story.id === targetId
                  ? applyTimelineOperation(story, operation)
                  : story,
              ),
            }
          : current,
      );
      setAnnouncement(message);
    },
    [activeStoryId, markDirty, stories],
  );

  function addScene() {
    if (!activeStory) return;
    const id = allocateSceneId(activeStory);
    dispatchTimeline(
      {
        type: "add-scene",
        id,
        title: `Scene ${activeStory.scenes.length + 1}`,
        durationMs: 1200,
        afterSceneId: selectedSceneId,
      },
      `Added ${id}.`,
    );
    setSelectedSceneId(id);
  }

  function duplicateScene(id: SceneId) {
    if (!activeStory) return;
    const newId = allocateSceneId(activeStory);
    dispatchTimeline(
      { type: "duplicate-scene", sceneId: id, id: newId },
      `Duplicated ${id}.`,
    );
    setSelectedSceneId(newId);
  }

  function removeScene(id: SceneId) {
    dispatchTimeline({ type: "remove-scene", sceneId: id }, `Deleted ${id}.`);
    if (selectedSceneId === id) setSelectedSceneId(undefined);
  }

  function moveScene(id: SceneId, toIndex: number) {
    dispatchTimeline(
      { type: "move-scene", sceneId: id, toIndex },
      `Reordered ${id}.`,
    );
  }

  function repairScenes() {
    const targetId = activeStoryId ?? stories[0]?.id;
    if (!targetId || !snapshot) return;
    markDirty();
    setProject((current) =>
      current
        ? {
            ...current,
            stories: current.stories.map((story) =>
              story.id === targetId
                ? repairSceneReferences(story, snapshot)
                : story,
            ),
          }
        : current,
    );
    setAnnouncement("Repaired scene references against the current graph.");
  }

  function togglePreview() {
    setPreviewMode((current) => {
      const next = !current;
      setIsPlaying(false);
      if (next) setPlayheadMs(0);
      setAnnouncement(
        next ? "Entered timeline preview." : "Exited timeline preview.",
      );
      return next;
    });
  }

  function scrub(ms: number) {
    setIsPlaying(false);
    setPlayheadMs(Math.min(storyDuration, Math.max(0, ms)));
  }

  function handleTimelineKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (storyDuration <= 0) return;
    const step = event.shiftKey ? 1000 : 100;
    switch (event.key) {
      case " ":
      case "Spacebar":
        event.preventDefault();
        setIsPlaying((playing) => !playing);
        break;
      case "ArrowLeft":
        event.preventDefault();
        scrub(playheadMs - step);
        break;
      case "ArrowRight":
        event.preventDefault();
        scrub(playheadMs + step);
        break;
      case "Home":
        event.preventDefault();
        scrub(0);
        break;
      case "End":
        event.preventDefault();
        scrub(storyDuration);
        break;
    }
  }

  function selectNode(id: EntityId, append: boolean) {
    if (!append) {
      const annotation = snapshot?.view?.annotations.find(
        (item) => item.entityId === id,
      );
      setAnnotationDraft(annotation?.text ?? "");
    }
    setSelectedIds((current) => {
      if (!append) return [id];
      return current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id];
    });
  }

  function moveNode(id: EntityId, x: number, y: number) {
    transact(
      { type: "move", entityId: id, x, y },
      `Moved ${id} to ${x}, ${y}.`,
    );
  }

  function handleNodeKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    node: NodeEntity,
  ) {
    const position = positions.get(node.id);
    if (!position) return;
    const step = event.shiftKey ? 50 : 10;
    const delta: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    if (delta[event.key]) {
      event.preventDefault();
      moveNode(
        node.id,
        position.x + delta[event.key].x,
        position.y + delta[event.key].y,
      );
    } else if (event.key.toLowerCase() === "h") {
      event.preventDefault();
      transact(
        { type: "set-hidden", entityIds: [node.id], hidden: true },
        `Hidden ${node.label}.`,
      );
    } else if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      focusSelection(node.id);
    }
  }

  function focusSelection(id = selectedId) {
    if (!id) return;
    const position = positions.get(id);
    const canvas = canvasRef.current;
    if (!position || !canvas) return;
    setPan({
      x: canvas.clientWidth / 2 - position.x * zoom - 80,
      y: canvas.clientHeight / 2 - position.y * zoom - 30,
    });
    setAnnouncement(`Focused ${id}.`);
  }

  function beginDrag(event: PointerEvent<HTMLButtonElement>, node: NodeEntity) {
    if (event.button !== 0) return;
    const position = positions.get(node.id);
    if (!position) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrag({
      entityId: node.id,
      pointerX: event.clientX,
      pointerY: event.clientY,
      originX: position.x,
      originY: position.y,
      x: position.x,
      y: position.y,
    });
  }

  function continueDrag(event: PointerEvent<HTMLButtonElement>) {
    if (!drag) return;
    setDrag({
      ...drag,
      x: Math.round(drag.originX + (event.clientX - drag.pointerX) / zoom),
      y: Math.round(drag.originY + (event.clientY - drag.pointerY) / zoom),
    });
  }

  function finishDrag() {
    if (!drag) return;
    if (drag.x !== drag.originX || drag.y !== drag.originY) {
      moveNode(drag.entityId, drag.x, drag.y);
    }
    setDrag(undefined);
  }

  function hideSelection() {
    if (selectedIds.length === 0) return;
    transact(
      { type: "set-hidden", entityIds: selectedIds, hidden: true },
      `Hidden ${selectedIds.length} selected component${selectedIds.length === 1 ? "" : "s"}.`,
    );
  }

  function groupSelection() {
    if (selectedIds.length < 2 || !snapshot) return;
    const groupNumber = (snapshot.view?.groups.length ?? 0) + 1;
    transact(
      {
        type: "group",
        id: `visual-group-${groupNumber}`,
        label: `Group ${groupNumber}`,
        memberIds: selectedIds,
      },
      `Created Group ${groupNumber} with ${selectedIds.length} components.`,
    );
  }

  function saveAnnotation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEntity) return;
    transact(
      {
        type: "annotate",
        id: `annotation-${selectedEntity.id}`,
        entityId: selectedEntity.id,
        text: annotationDraft.trim(),
      },
      annotationDraft.trim()
        ? `Annotated ${selectedEntity.label}.`
        : `Removed annotation from ${selectedEntity.label}.`,
    );
  }

  function undo() {
    markDirty();
    if (stressPreview) {
      setStressPreview(false);
      setSaveState(repository ? "Saving…" : "Preview mode");
    }
    setHistory((current) => (current ? undoEditorHistory(current) : current));
    setAnnouncement("Undid the last graph change.");
  }

  function redo() {
    markDirty();
    setHistory((current) => (current ? redoEditorHistory(current) : current));
    setAnnouncement("Redid the graph change.");
  }

  function loadStressFixture() {
    if (!history) return;
    const stress = createStressSnapshot(200);
    setHistory({
      past: [...history.past, history.present],
      present: stress,
      future: [],
    });
    setSelectedIds([]);
    setStressPreview(true);
    setSaveState("Stress preview · not autosaved");
    setZoom(0.5);
    setPan({ x: 28, y: 28 });
    setAnnouncement("Loaded the 200 component stress fixture.");
  }

  async function reimport() {
    if (!snapshot) return;
    // Capture the source and id up front: the reimport runs off the UI thread and must never
    // rewrite the source text, and a worker failure leaves this snapshot exactly as it was.
    const source = snapshot.source.text;
    const snapshotId = snapshot.id;
    const previous = snapshot;
    setSaveState("Reimporting…");
    try {
      const { importerByDiagramType, detectImporter } = await import(
        "@/domain/import/registry"
      );
      const importer =
        importerByDiagramType(previous.source.diagramType) ??
        detectImporter(source);
      if (!importer) {
        setSaveState("Reimport failed: unsupported diagram type");
        setAnnouncement(
          "Reimport failed: unsupported diagram type. The source is unchanged.",
        );
        return;
      }

      // The flowchart importer's ELK layout is expensive, so it runs in the cancellable
      // worker with bounded progress and resource limits. Lighter grammars (e.g. sequence)
      // lay out deterministically without ELK, so they run inline off the hot path.
      let reconciled;
      if (importer.capabilities.diagramType === FLOWCHART_DIAGRAM_TYPE) {
        const runner = await getImportRunner();
        const handle = runner.run(
          { text: source, snapshotId, importedAt: new Date().toISOString() },
          (progress: JobProgress) =>
            setSaveState(
              `${progress.message} ${Math.round(progress.ratio * 100)}%`,
            ),
        );
        const result = await handle.promise;
        reconciled = reconcileImportedSnapshot(previous, result.snapshot);
      } else {
        const result = importer.import({
          text: source,
          snapshotId,
          importedAt: new Date().toISOString(),
        });
        if (!result.snapshot) {
          const fatal = result.diagnostics.find((d) => d.severity === "error");
          setSaveState(
            `Reimport failed: ${fatal?.message ?? "unsupported source"}`,
          );
          setAnnouncement("Reimport failed. The source is unchanged.");
          return;
        }
        const computedLayout = await importer.layout(result.snapshot);
        reconciled = reconcileImportedSnapshot(previous, {
          ...result.snapshot,
          layout: [...computedLayout],
        });
      }
      setHistory((current) =>
        current
          ? {
              past: [...current.past, current.present],
              present: reconciled,
              future: [],
            }
          : current,
      );
      setStressPreview(false);
      setAnnouncement(
        "Reimported Mermaid source and restored compatible visual edits.",
      );
    } catch (error) {
      const jobError = jobErrorOf(error);
      // A superseded or cancelled run is expected — the newer run owns the outcome, and the
      // source text and current graph are untouched.
      if (jobError?.code === "cancelled") return;
      const detail = jobError?.message ?? errorMessage(error);
      setSaveState(`Reimport failed: ${detail}`);
      setAnnouncement(`Reimport failed: ${detail} The source is unchanged.`);
    }
  }

  async function getImportRunner(): Promise<MermaidImportRunner> {
    if (!importRunnerRef.current) {
      const { MermaidImportRunner } = await import("@/domain/mermaid/worker");
      importRunnerRef.current = new MermaidImportRunner();
    }
    return importRunnerRef.current;
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    setZoom((current) => clampZoom(current - event.deltaY * 0.001));
  }

  const nodeCount = nodes.length;
  const visibleNodeIds = new Set(
    nodes.filter((node) => !hiddenIds.has(node.id)).map((node) => node.id),
  );
  const graphWidth = Math.max(
    900,
    ...[...positions.values()].map((position) => position.x + 240),
  );
  const graphHeight = Math.max(
    620,
    ...[...positions.values()].map((position) => position.y + 160),
  );

  return (
    <div className="editorWorkspace">
      <div className="editorStatusRow">
        <span className="documentBadge">{nodeCount} components</span>
        <span aria-live="polite" className="saveStatus">
          {saveState}
        </span>
      </div>

      <nav
        aria-label="Workspace surfaces"
        className="surfaceTabs"
        role="tablist"
      >
        {SURFACES.map((label) => (
          <button
            aria-selected={surface === label}
            className={surface === label ? "isActive" : undefined}
            key={label}
            onClick={() => setSurface(label)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>

      {loadError ? (
        <div className="editorError" role="alert">
          <strong>Project unavailable</strong>
          <span>{loadError}</span>
        </div>
      ) : !snapshot || !project ? (
        <div
          aria-label="Loading architecture workspace"
          className="editorLoading"
          role="status"
        >
          <span />
          <span />
          <span />
        </div>
      ) : (
        <div className="workspaceGrid">
          <aside className="workspacePanel" role="tabpanel">
            {surface !== "Copilot" ? (
              <SurfacePanel
                annotationDraft={annotationDraft}
                hiddenIds={hiddenIds}
                onAnnotationChange={setAnnotationDraft}
                onSaveAnnotation={saveAnnotation}
                onSelect={(id) => selectNode(id, false)}
                onShow={(id) =>
                  transact(
                    { type: "set-hidden", entityIds: [id], hidden: false },
                    `Shown ${id}.`,
                  )
                }
                project={project}
                selectedEntity={selectedEntity}
                selectedIds={selectedIds}
                snapshot={snapshot}
                surface={surface}
                timeline={{
                  stories,
                  story: activeStory,
                  selectedSceneId,
                  selectedIds,
                  warnings: storyWarnings,
                  playheadMs,
                  durationMs: storyDuration,
                  isPlaying,
                  previewMode,
                  storyValid,
                  activeSceneId: previewState?.activeScene?.id,
                  onSelectStory: setActiveStoryId,
                  onSelectScene: setSelectedSceneId,
                  onAddScene: addScene,
                  onDuplicateScene: duplicateScene,
                  onRemoveScene: removeScene,
                  onRenameScene: (id, title) =>
                    dispatchTimeline(
                      { type: "rename-scene", sceneId: id, title },
                      `Renamed ${id}.`,
                    ),
                  onSetDuration: (id, durationMs) =>
                    dispatchTimeline(
                      { type: "set-duration", sceneId: id, durationMs },
                      `Set ${id} duration to ${durationMs} ms.`,
                    ),
                  onMoveScene: moveScene,
                  onSetAction: (id, action) =>
                    dispatchTimeline(
                      { type: "set-action", sceneId: id, action },
                      `Updated ${action.type} in ${id}.`,
                    ),
                  onRemoveAction: (id, channel, target) =>
                    dispatchTimeline(
                      { type: "remove-action", sceneId: id, channel, target },
                      `Removed ${channel} from ${id}.`,
                    ),
                  onRepair: repairScenes,
                  onTogglePreview: togglePreview,
                  onPlayToggle: () => setIsPlaying((playing) => !playing),
                  onScrub: scrub,
                  onTimelineKeyDown: handleTimelineKeyDown,
                }}
              />
            ) : null}
            {/* Kept mounted across tab switches so a run in flight is never torn down. */}
            <div className="copilotMount" hidden={surface !== "Copilot"}>
              <CopilotSurface
                applyControls={
                  applyRecord && applyRecord.before !== applyRecord.after
                    ? {
                        undone: applyRecord.undone,
                        onUndo: undoApply,
                        onRedo: redoApply,
                      }
                    : undefined
                }
                defaultTitle={`${project.name} review`}
                initialRunId={initialRunId}
                onApplied={applyProposal}
                onRunStarted={handleRunStarted}
                project={project}
                snapshot={snapshot}
                transport={transport}
              />
            </div>
          </aside>

          <section
            aria-label="Architecture graph editor"
            className="canvasColumn"
          >
            <div
              aria-label="Graph actions"
              className="editorToolbar"
              role="toolbar"
            >
              <button
                aria-label="Undo"
                disabled={history.past.length === 0}
                onClick={undo}
                type="button"
              >
                ↶ <span>Undo</span>
              </button>
              <button
                aria-label="Redo"
                disabled={history.future.length === 0}
                onClick={redo}
                type="button"
              >
                ↷ <span>Redo</span>
              </button>
              <span className="toolbarDivider" />
              <button
                disabled={selectedIds.length < 2}
                onClick={groupSelection}
                type="button"
              >
                Group selection
              </button>
              <button
                disabled={selectedIds.length === 0}
                onClick={hideSelection}
                type="button"
              >
                Hide selected
              </button>
              <button
                disabled={!selectedId}
                onClick={() => focusSelection()}
                type="button"
              >
                Focus selected
              </button>
              <span className="toolbarDivider" />
              <button
                aria-label="Zoom out"
                onClick={() => setZoom((value) => clampZoom(value - 0.1))}
                type="button"
              >
                −
              </button>
              <output aria-label="Zoom level">{Math.round(zoom * 100)}%</output>
              <button
                aria-label="Zoom in"
                onClick={() => setZoom((value) => clampZoom(value + 0.1))}
                type="button"
              >
                +
              </button>
              <button
                aria-label="Pan left"
                onClick={() =>
                  setPan((value) => ({ ...value, x: value.x - 80 }))
                }
                type="button"
              >
                ←
              </button>
              <button
                aria-label="Pan up"
                onClick={() =>
                  setPan((value) => ({ ...value, y: value.y - 80 }))
                }
                type="button"
              >
                ↑
              </button>
              <button
                aria-label="Pan down"
                onClick={() =>
                  setPan((value) => ({ ...value, y: value.y + 80 }))
                }
                type="button"
              >
                ↓
              </button>
              <button
                aria-label="Pan right"
                onClick={() =>
                  setPan((value) => ({ ...value, x: value.x + 80 }))
                }
                type="button"
              >
                →
              </button>
              <button onClick={() => void reimport()} type="button">
                Reimport source
              </button>
              <button onClick={loadStressFixture} type="button">
                Load 200-node stress fixture
              </button>
              <button
                disabled={!storyValid}
                onClick={exportStoryHtml}
                title={
                  storyValid
                    ? "Download a self-contained animated review"
                    : "Fix the scene warnings to export this story"
                }
                type="button"
              >
                Export HTML
              </button>
            </div>

            {previewMode ? (
              <div aria-live="polite" className="previewBanner" role="status">
                {previewState?.activeScene ? (
                  <>
                    <strong>
                      Scene {previewState.activeScene.index + 1}:{" "}
                      {previewState.activeScene.title}
                    </strong>
                    <span>
                      {Math.round(playheadMs)} / {storyDuration} ms
                    </span>
                  </>
                ) : (
                  <span>
                    {storyValid
                      ? "Scrub the timeline to preview the story."
                      : "Fix the scene warnings to preview this story."}
                  </span>
                )}
              </div>
            ) : null}

            <div
              className="graphCanvas"
              onWheel={handleWheel}
              ref={canvasRef}
              tabIndex={0}
            >
              <div
                className="graphStage"
                style={{
                  height: graphHeight,
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  width: graphWidth,
                }}
              >
                <svg
                  aria-hidden="true"
                  className="graphEdges"
                  height={graphHeight}
                  width={graphWidth}
                >
                  <defs>
                    <marker
                      id="arrow"
                      markerHeight="7"
                      markerWidth="9"
                      orient="auto"
                      refX="8"
                      refY="3.5"
                    >
                      <path d="M0,0 L9,3.5 L0,7 Z" />
                    </marker>
                  </defs>
                  {edges.map((edge) => {
                    const start = positions.get(edge.source);
                    const end = positions.get(edge.target);
                    const endpointsVisible = previewEntities
                      ? isPreviewVisible(previewEntities, edge.source) &&
                        isPreviewVisible(previewEntities, edge.target)
                      : visibleNodeIds.has(edge.source) &&
                        visibleNodeIds.has(edge.target);
                    if (!start || !end || !endpointsVisible) {
                      return null;
                    }
                    const x1 = start.x + (start.width ?? 160) / 2;
                    const y1 = start.y + (start.height ?? 58) / 2;
                    const x2 = end.x + (end.width ?? 160) / 2;
                    const y2 = end.y + (end.height ?? 58) / 2;
                    return (
                      <line
                        key={edge.id}
                        markerEnd="url(#arrow)"
                        x1={x1}
                        x2={x2}
                        y1={y1}
                        y2={y2}
                      />
                    );
                  })}
                </svg>

                {snapshot.view?.groups.map((group, index) => (
                  <div
                    className="visualGroupLabel"
                    key={group.id}
                    style={{ top: 12 + index * 38 }}
                  >
                    {group.label} · {group.memberIds.length} components
                  </div>
                ))}

                {nodes.map((node, index) => {
                  const renderState = previewEntities?.get(node.id);
                  if (previewEntities) {
                    if (renderState && !renderState.visible) return null;
                  } else if (hiddenIds.has(node.id)) {
                    return null;
                  }
                  const storedPosition =
                    positions.get(node.id) ??
                    positionFor(snapshot, node, index);
                  const position =
                    drag?.entityId === node.id ? drag : storedPosition;
                  const storedAnnotation = snapshot.view?.annotations.find(
                    (item) => item.entityId === node.id,
                  )?.text;
                  const annotation =
                    renderState?.annotation ?? storedAnnotation;
                  const nodeClassName = [
                    "graphNode",
                    renderState && renderState.focusProgress > 0
                      ? "isFocused"
                      : "",
                    renderState?.highlightStyle ? "isHighlighted" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <div
                      className="graphNodeWrap"
                      key={node.id}
                      style={{
                        opacity: renderState ? renderState.opacity : 1,
                        transform: `translate(${position.x}px, ${position.y}px)`,
                      }}
                    >
                      <button
                        aria-label={`${node.label}. Position ${position.x}, ${position.y}.`}
                        aria-pressed={selectedIds.includes(node.id)}
                        className={nodeClassName}
                        disabled={previewMode}
                        onClick={(event) => selectNode(node.id, event.shiftKey)}
                        onDoubleClick={() => focusSelection(node.id)}
                        onKeyDown={(event) => handleNodeKeyDown(event, node)}
                        onPointerDown={(event) => beginDrag(event, node)}
                        onPointerMove={continueDrag}
                        onPointerCancel={() => setDrag(undefined)}
                        onPointerUp={finishDrag}
                        type="button"
                      >
                        <span>{node.label}</span>
                        <small>{node.id}</small>
                      </button>
                      {annotation ? (
                        <span className="graphAnnotation">{annotation}</span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="canvasHint">
              Arrow keys move · Shift + click selects many · H hides · F focuses
            </p>
          </section>
        </div>
      )}
      <span aria-live="assertive" className="srOnly">
        {announcement}
      </span>
    </div>
  );
}

interface TimelineViewModel {
  readonly stories: readonly Story[];
  readonly story?: Story;
  readonly selectedSceneId?: SceneId;
  readonly selectedIds: readonly EntityId[];
  readonly warnings: readonly SceneReferenceWarning[];
  readonly playheadMs: number;
  readonly durationMs: number;
  readonly isPlaying: boolean;
  readonly previewMode: boolean;
  readonly storyValid: boolean;
  readonly activeSceneId?: SceneId;
  readonly onSelectStory: (id: StoryId) => void;
  readonly onSelectScene: (id: SceneId) => void;
  readonly onAddScene: () => void;
  readonly onDuplicateScene: (id: SceneId) => void;
  readonly onRemoveScene: (id: SceneId) => void;
  readonly onRenameScene: (id: SceneId, title: string) => void;
  readonly onSetDuration: (id: SceneId, durationMs: number) => void;
  readonly onMoveScene: (id: SceneId, toIndex: number) => void;
  readonly onSetAction: (id: SceneId, action: Action) => void;
  readonly onRemoveAction: (
    id: SceneId,
    channel: ActionChannel,
    target?: EntityId,
  ) => void;
  readonly onRepair: () => void;
  readonly onTogglePreview: () => void;
  readonly onPlayToggle: () => void;
  readonly onScrub: (ms: number) => void;
  readonly onTimelineKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

interface SurfacePanelProps {
  readonly surface: Surface;
  readonly project: ProjectDocument;
  readonly snapshot: GraphSnapshot;
  readonly selectedEntity?: NodeEntity;
  readonly selectedIds: readonly EntityId[];
  readonly hiddenIds: ReadonlySet<EntityId>;
  readonly annotationDraft: string;
  readonly timeline: TimelineViewModel;
  readonly onAnnotationChange: (value: string) => void;
  readonly onSaveAnnotation: (event: FormEvent<HTMLFormElement>) => void;
  readonly onSelect: (id: EntityId) => void;
  readonly onShow: (id: EntityId) => void;
}

function SurfacePanel({
  surface,
  project,
  snapshot,
  selectedEntity,
  selectedIds,
  hiddenIds,
  annotationDraft,
  timeline,
  onAnnotationChange,
  onSaveAnnotation,
  onSelect,
  onShow,
}: SurfacePanelProps) {
  const nodes = snapshot.entities.filter(
    (entity): entity is NodeEntity => entity.kind === "node",
  );

  if (surface === "Source") {
    const activeImporterId = snapshot.source.importer.importer;
    return (
      <div>
        <PanelHeading eyebrow="Read only" title="Mermaid source" />
        <p className="panelNote">
          Imported by <strong>{snapshot.source.diagramType}</strong> ·{" "}
          {activeImporterId}@{snapshot.source.importer.importerVersion}
        </p>
        <pre className="sourceCode">{snapshot.source.text}</pre>
        <p className="panelNote">Visual changes never rewrite this source.</p>
        <ImporterCapabilityReport activeImporterId={activeImporterId} />
      </div>
    );
  }

  if (surface === "Story") {
    return <TimelineSurface {...timeline} />;
  }

  if (surface === "Compare") {
    return (
      <div>
        <PanelHeading
          eyebrow={`${project.comparisons.length} comparison`}
          title="Current vs proposed"
        />
        {project.comparisons.map((comparison) => (
          <article className="surfaceCard" key={comparison.id}>
            <strong>{comparison.changes.length} semantic changes</strong>
            <span>Identity-based diff</span>
          </article>
        ))}
      </div>
    );
  }

  if (surface === "Inspector") {
    return (
      <div>
        <PanelHeading
          eyebrow={`${selectedIds.length} selected`}
          title="Inspector"
        />
        {selectedEntity ? (
          <>
            <dl className="inspectorDetails">
              <div>
                <dt>Component</dt>
                <dd>{selectedEntity.label}</dd>
              </div>
              <div>
                <dt>Semantic ID</dt>
                <dd>{selectedEntity.id}</dd>
              </div>
            </dl>
            <form className="annotationForm" onSubmit={onSaveAnnotation}>
              <label htmlFor="annotation-text">
                Annotation for {selectedEntity.label}
              </label>
              <textarea
                id="annotation-text"
                onChange={(event) => onAnnotationChange(event.target.value)}
                placeholder="Add context for reviewers"
                rows={4}
                value={annotationDraft}
              />
              <button type="submit">Save annotation</button>
            </form>
          </>
        ) : (
          <p className="panelEmpty">
            Select a component to inspect and annotate it.
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <PanelHeading eyebrow={`${nodes.length} components`} title="Layers" />
      {snapshot.view?.groups.map((group) => (
        <div className="surfaceCard visualGroupCard" key={group.id}>
          <strong>
            {group.label} · {group.memberIds.length} components
          </strong>
          <span>Visual group</span>
        </div>
      ))}
      <ul className="layerList">
        {nodes.map((node) => (
          <li key={node.id}>
            <button
              aria-pressed={selectedIds.includes(node.id)}
              onClick={() => onSelect(node.id)}
              type="button"
            >
              <span>{node.label}</span>
              <small>{node.id}</small>
            </button>
            {hiddenIds.has(node.id) ? (
              <button
                aria-label={`Show ${node.label}`}
                onClick={() => onShow(node.id)}
                type="button"
              >
                Show
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

const ENTITY_ACTIONS = [
  { type: "reveal", label: "Reveal" },
  { type: "hide", label: "Hide" },
  { type: "focus", label: "Focus" },
  { type: "trace", label: "Trace" },
  { type: "highlight", label: "Highlight" },
] as const;

function TimelineSurface({
  stories,
  story,
  selectedSceneId,
  selectedIds,
  warnings,
  playheadMs,
  durationMs,
  isPlaying,
  previewMode,
  storyValid,
  activeSceneId,
  onSelectStory,
  onSelectScene,
  onAddScene,
  onDuplicateScene,
  onRemoveScene,
  onRenameScene,
  onSetDuration,
  onMoveScene,
  onSetAction,
  onRemoveAction,
  onRepair,
  onTogglePreview,
  onPlayToggle,
  onScrub,
  onTimelineKeyDown,
}: TimelineViewModel) {
  const [annotationText, setAnnotationText] = useState("");

  if (!story) {
    return (
      <div>
        <PanelHeading eyebrow="Timeline" title="Scenes" />
        <p className="panelEmpty">This project has no story to animate yet.</p>
      </div>
    );
  }

  const selectedScene = story.scenes.find(
    (scene) => scene.id === selectedSceneId,
  );
  const target = selectedIds[0];
  const warningSceneIds = new Set(warnings.map((warning) => warning.sceneId));

  return (
    <div className="timelineSurface">
      <PanelHeading
        eyebrow={`${story.scenes.length} scenes`}
        title="Scene timeline"
      />

      {stories.length > 1 ? (
        <label className="timelineStoryPicker">
          <span>Story</span>
          <select
            onChange={(event) => onSelectStory(event.target.value as StoryId)}
            value={story.id}
          >
            {stories.map((option) => (
              <option key={option.id} value={option.id}>
                {option.title}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="panelNote">{story.title}</p>
      )}

      <div className="timelineActions">
        <button onClick={onAddScene} type="button">
          Add scene
        </button>
        <button disabled={!storyValid} onClick={onTogglePreview} type="button">
          {previewMode ? "Exit preview" : "Enter preview"}
        </button>
      </div>

      {warnings.length > 0 ? (
        <div className="timelineWarnings" role="alert">
          <strong>
            {warnings.length} scene warning{warnings.length === 1 ? "" : "s"}
          </strong>
          <ul>
            {warnings.map((warning) => (
              <li key={warning.sceneId}>{warning.message}</li>
            ))}
          </ul>
          <button onClick={onRepair} type="button">
            Repair scenes
          </button>
        </div>
      ) : null}

      {previewMode ? (
        <div
          aria-label="Timeline playback"
          className="timelinePlayback"
          onKeyDown={onTimelineKeyDown}
          role="group"
          tabIndex={0}
        >
          <div className="timelineTransport">
            <button onClick={onPlayToggle} type="button">
              {isPlaying ? "Pause" : "Play"}
            </button>
            <output aria-label="Playhead position">
              {Math.round(playheadMs)} / {durationMs} ms
            </output>
          </div>
          <input
            aria-label="Scrubber"
            max={durationMs}
            min={0}
            onChange={(event) => onScrub(Number(event.target.value))}
            step={10}
            type="range"
            value={Math.min(playheadMs, durationMs)}
          />
          <p className="panelNote">Space plays · ← → scrub · Home/End jump</p>
        </div>
      ) : null}

      <ol className="sceneList">
        {story.scenes.map((scene, index) => {
          const isActive = previewMode && scene.id === activeSceneId;
          const isSelected = scene.id === selectedSceneId;
          return (
            <li
              className={[
                "sceneCard",
                isSelected ? "isSelected" : "",
                isActive ? "isActive" : "",
                warningSceneIds.has(scene.id) ? "hasWarning" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={scene.id}
            >
              <button
                aria-pressed={isSelected}
                className="sceneSelect"
                onClick={() => onSelectScene(scene.id)}
                type="button"
              >
                Scene {index + 1}
              </button>
              <label className="srOnly" htmlFor={`scene-title-${scene.id}`}>
                Scene {index + 1} title
              </label>
              <input
                id={`scene-title-${scene.id}`}
                onChange={(event) =>
                  onRenameScene(scene.id, event.target.value)
                }
                value={scene.title}
              />
              <div className="sceneMeta">
                <label htmlFor={`scene-duration-${scene.id}`}>
                  Duration (ms)
                </label>
                <input
                  id={`scene-duration-${scene.id}`}
                  min={1}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (Number.isFinite(next)) onSetDuration(scene.id, next);
                  }}
                  step={100}
                  type="number"
                  value={scene.durationMs}
                />
              </div>
              <div className="sceneControls">
                <button
                  aria-label={`Move scene ${index + 1} earlier`}
                  disabled={index === 0}
                  onClick={() => onMoveScene(scene.id, index - 1)}
                  type="button"
                >
                  ↑
                </button>
                <button
                  aria-label={`Move scene ${index + 1} later`}
                  disabled={index === story.scenes.length - 1}
                  onClick={() => onMoveScene(scene.id, index + 1)}
                  type="button"
                >
                  ↓
                </button>
                <button
                  onClick={() => onDuplicateScene(scene.id)}
                  type="button"
                >
                  Duplicate
                </button>
                <button onClick={() => onRemoveScene(scene.id)} type="button">
                  Delete
                </button>
              </div>
              {scene.actions.length > 0 ? (
                <ul className="sceneActionList">
                  {scene.actions.map((action) => (
                    <li
                      key={`${action.type}:${actionTarget(action) ?? "camera"}`}
                    >
                      <span>{summarizeAction(action)}</span>
                      <button
                        aria-label={`Remove ${action.type} from scene ${index + 1}`}
                        onClick={() =>
                          onRemoveAction(
                            scene.id,
                            actionChannel(action),
                            actionTarget(action),
                          )
                        }
                        type="button"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="panelNote">No actions yet.</p>
              )}
            </li>
          );
        })}
      </ol>

      {selectedScene ? (
        <div className="sceneAuthoring">
          <PanelHeading eyebrow={selectedScene.title} title="Add actions" />
          <p className="panelNote">
            {target
              ? `Applies to ${target}. Select a component to retarget.`
              : "Select a component on the canvas to add entity actions."}
          </p>
          <div className="authoringButtons">
            {ENTITY_ACTIONS.map((entityAction) => (
              <button
                disabled={!target}
                key={entityAction.type}
                onClick={() =>
                  target &&
                  onSetAction(selectedScene.id, {
                    type: entityAction.type,
                    target,
                  } as Action)
                }
                type="button"
              >
                {entityAction.label}
              </button>
            ))}
            <button
              disabled={selectedIds.length === 0}
              onClick={() =>
                onSetAction(selectedScene.id, {
                  type: "camera",
                  focus: [...selectedIds],
                })
              }
              type="button"
            >
              Frame selection
            </button>
            <button
              onClick={() =>
                onSetAction(selectedScene.id, { type: "camera", focus: [] })
              }
              type="button"
            >
              Fit whole diagram
            </button>
          </div>
          <div className="authoringAnnotate">
            <label htmlFor="scene-annotation">Annotation</label>
            <input
              id="scene-annotation"
              onChange={(event) => setAnnotationText(event.target.value)}
              placeholder="Caption for the framed component"
              value={annotationText}
            />
            <button
              disabled={!target || !annotationText.trim()}
              onClick={() => {
                if (!target || !annotationText.trim()) return;
                onSetAction(selectedScene.id, {
                  type: "annotate",
                  target,
                  text: annotationText.trim(),
                });
                setAnnotationText("");
              }}
              type="button"
            >
              Annotate
            </button>
          </div>
        </div>
      ) : (
        <p className="panelEmpty">
          Select a scene to add camera, visibility, and focus actions.
        </p>
      )}
    </div>
  );
}

function PanelHeading({
  eyebrow,
  title,
}: {
  readonly eyebrow: string;
  readonly title: string;
}) {
  return (
    <header className="panelHeading">
      <span>{eyebrow}</span>
      <h2>{title}</h2>
    </header>
  );
}

const FEATURE_SUPPORT_LABEL: Readonly<
  Record<ImporterCapabilities["features"][number]["support"], string>
> = {
  full: "Supported",
  partial: "Partial",
  none: "Not imported",
};

/**
 * Reports which diagram grammars can be imported and what each one supports, so a user knows
 * before pasting what will survive the import. The importer that produced the current snapshot
 * is marked as active.
 */
function ImporterCapabilityReport({
  activeImporterId,
}: {
  readonly activeImporterId: string;
}) {
  return (
    <section
      aria-labelledby="importer-capabilities"
      className="capabilityReport"
    >
      <h3 id="importer-capabilities">Supported diagram formats</h3>
      <ul className="capabilityList">
        {IMPORTER_CAPABILITIES.map((capability) => {
          const isActive = capability.importer === activeImporterId;
          return (
            <li className="capabilityCard" key={capability.importer}>
              <div className="capabilityCardHead">
                <strong>{capability.label}</strong>
                {isActive ? (
                  <span className="capabilityActive">Active</span>
                ) : null}
              </div>
              <p className="capabilitySummary">{capability.summary}</p>
              <ul className="capabilityFeatures">
                {capability.features.map((feature) => (
                  <li
                    className={`capabilityFeature support-${feature.support}`}
                    key={feature.name}
                  >
                    <span className="capabilityFeatureName">
                      {feature.name}
                    </span>
                    <span className="capabilityFeatureSupport">
                      {FEATURE_SUPPORT_LABEL[feature.support]}
                    </span>
                    {feature.detail ? (
                      <span className="capabilityFeatureDetail">
                        {feature.detail}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
