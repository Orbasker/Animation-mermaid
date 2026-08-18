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
import type { ProjectDocument } from "@/domain/project-document";
import { ProjectRepository } from "@/persistence";
import type { StoryProposal } from "@/workflows/design-review-story";

import { CopilotSurface } from "./ai-copilot/copilot-surface";
import {
  createHttpCopilotTransport,
  type CopilotTransport,
} from "./ai-copilot/copilot-transport";

const SURFACES = ["Source", "Story", "Compare", "Layers", "Inspector", "Copilot"] as const;
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
      item.id === snapshot.id || (index === 0 && !project.snapshots.some((s) => s.id === snapshot.id))
        ? snapshot
        : item,
    ),
  };
}

function positionFor(snapshot: GraphSnapshot, node: NodeEntity, index: number): LayoutHint {
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

function clampZoom(value: number): number {
  return Math.min(1.8, Math.max(0.35, Math.round(value * 100) / 100));
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
    () => copilotTransport ?? createHttpCopilotTransport(),
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
  const ownsRepository = useRef(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let openedRepository: ProjectRepository | undefined;

    async function loadProject() {
      try {
        const activeRepository =
          suppliedRepository ??
          (typeof indexedDB === "undefined" ? undefined : await ProjectRepository.open());
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
          if (first) document = (await activeRepository.get(first.id))?.document;
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
          setLoadError(error instanceof Error ? error.message : "The project could not be opened.");
        }
      }
    }

    void loadProject();
    return () => {
      cancelled = true;
      if (ownsRepository.current) openedRepository?.close();
    };
  }, [initialProject, suppliedRepository]);

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
          setSaveState(error instanceof Error ? `Save failed: ${error.message}` : "Save failed");
        });
    }, autosaveDelayMs);
    return () => window.clearTimeout(timer);
  }, [autosaveDelayMs, history, project, repository, stressPreview]);

  const snapshot = history?.present;
  const nodes = useMemo(
    () => snapshot?.entities.filter((entity): entity is NodeEntity => entity.kind === "node") ?? [],
    [snapshot],
  );
  const edges = useMemo(
    () => snapshot?.entities.filter((entity): entity is EdgeEntity => entity.kind === "edge") ?? [],
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
    nodes.forEach((node, index) => map.set(node.id, positionFor(snapshot!, node, index)));
    return map;
  }, [nodes, snapshot]);

  const markDirty = useCallback(() => {
    if (repository && !stressPreview) setSaveState("Saving…");
  }, [repository, stressPreview]);

  const transact = useCallback(
    (transaction: EditorTransaction, message: string) => {
      markDirty();
      setHistory((current) => (current ? commitEditorTransaction(current, transaction) : current));
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
          error instanceof Error ? error.message : "The proposal could not be applied.",
        );
        return;
      }
      // Applying is one transaction: keep the before/after pair so it reverts byte-for-byte.
      setApplyRecord({ before: project, after: next, undone: false });
      if (next !== project) {
        setProject(next);
        setAnnouncement(`Applied "${proposal.story.title}" as a new story.`);
      } else {
        setAnnouncement(`"${proposal.story.title}" is already in this project.`);
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

  function selectNode(id: EntityId, append: boolean) {
    if (!append) {
      const annotation = snapshot?.view?.annotations.find((item) => item.entityId === id);
      setAnnotationDraft(annotation?.text ?? "");
    }
    setSelectedIds((current) => {
      if (!append) return [id];
      return current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    });
  }

  function moveNode(id: EntityId, x: number, y: number) {
    transact({ type: "move", entityId: id, x, y }, `Moved ${id} to ${x}, ${y}.`);
  }

  function handleNodeKeyDown(event: KeyboardEvent<HTMLButtonElement>, node: NodeEntity) {
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
      moveNode(node.id, position.x + delta[event.key].x, position.y + delta[event.key].y);
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
    setSaveState("Reimporting…");
    try {
      const [{ importMermaidFlowchart }, { layoutFlowchart }] = await Promise.all([
        import("@/domain/mermaid/import"),
        import("@/domain/mermaid/layout"),
      ]);
      const result = importMermaidFlowchart({
        text: snapshot.source.text,
        snapshotId: snapshot.id,
        importedAt: new Date().toISOString(),
      });
      if (!result.snapshot) {
        setSaveState("Reimport failed");
        return;
      }
      const computedLayout = await layoutFlowchart(result.snapshot);
      const reconciled = reconcileImportedSnapshot(snapshot, {
        ...result.snapshot,
        layout: computedLayout,
      });
      setHistory((current) =>
        current
          ? { past: [...current.past, current.present], present: reconciled, future: [] }
          : current,
      );
      setStressPreview(false);
      setAnnouncement("Reimported Mermaid source and restored compatible visual edits.");
    } catch (error) {
      setSaveState(error instanceof Error ? `Reimport failed: ${error.message}` : "Reimport failed");
    }
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    setZoom((current) => clampZoom(current - event.deltaY * 0.001));
  }

  const nodeCount = nodes.length;
  const visibleNodeIds = new Set(nodes.filter((node) => !hiddenIds.has(node.id)).map((node) => node.id));
  const graphWidth = Math.max(900, ...[...positions.values()].map((position) => position.x + 240));
  const graphHeight = Math.max(620, ...[...positions.values()].map((position) => position.y + 160));

  return (
    <div className="editorWorkspace">
      <div className="editorStatusRow">
        <span className="documentBadge">{nodeCount} components</span>
        <span aria-live="polite" className="saveStatus">
          {saveState}
        </span>
      </div>

      <nav aria-label="Workspace surfaces" className="surfaceTabs" role="tablist">
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
        <div aria-label="Loading architecture workspace" className="editorLoading" role="status">
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
              />
            ) : null}
            {/* Kept mounted across tab switches so a run in flight is never torn down. */}
            <div className="copilotMount" hidden={surface !== "Copilot"}>
              <CopilotSurface
                applyControls={
                  applyRecord && applyRecord.before !== applyRecord.after
                    ? { undone: applyRecord.undone, onUndo: undoApply, onRedo: redoApply }
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

          <section aria-label="Architecture graph editor" className="canvasColumn">
            <div aria-label="Graph actions" className="editorToolbar" role="toolbar">
              <button aria-label="Undo" disabled={history.past.length === 0} onClick={undo} type="button">
                ↶ <span>Undo</span>
              </button>
              <button aria-label="Redo" disabled={history.future.length === 0} onClick={redo} type="button">
                ↷ <span>Redo</span>
              </button>
              <span className="toolbarDivider" />
              <button disabled={selectedIds.length < 2} onClick={groupSelection} type="button">
                Group selection
              </button>
              <button disabled={selectedIds.length === 0} onClick={hideSelection} type="button">
                Hide selected
              </button>
              <button disabled={!selectedId} onClick={() => focusSelection()} type="button">
                Focus selected
              </button>
              <span className="toolbarDivider" />
              <button aria-label="Zoom out" onClick={() => setZoom((value) => clampZoom(value - 0.1))} type="button">
                −
              </button>
              <output aria-label="Zoom level">{Math.round(zoom * 100)}%</output>
              <button aria-label="Zoom in" onClick={() => setZoom((value) => clampZoom(value + 0.1))} type="button">
                +
              </button>
              <button aria-label="Pan left" onClick={() => setPan((value) => ({ ...value, x: value.x - 80 }))} type="button">
                ←
              </button>
              <button aria-label="Pan up" onClick={() => setPan((value) => ({ ...value, y: value.y - 80 }))} type="button">
                ↑
              </button>
              <button aria-label="Pan down" onClick={() => setPan((value) => ({ ...value, y: value.y + 80 }))} type="button">
                ↓
              </button>
              <button aria-label="Pan right" onClick={() => setPan((value) => ({ ...value, x: value.x + 80 }))} type="button">
                →
              </button>
              <button onClick={() => void reimport()} type="button">
                Reimport source
              </button>
              <button onClick={loadStressFixture} type="button">
                Load 200-node stress fixture
              </button>
            </div>

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
                <svg aria-hidden="true" className="graphEdges" height={graphHeight} width={graphWidth}>
                  <defs>
                    <marker id="arrow" markerHeight="7" markerWidth="9" orient="auto" refX="8" refY="3.5">
                      <path d="M0,0 L9,3.5 L0,7 Z" />
                    </marker>
                  </defs>
                  {edges.map((edge) => {
                    const start = positions.get(edge.source);
                    const end = positions.get(edge.target);
                    if (!start || !end || !visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) {
                      return null;
                    }
                    const x1 = start.x + (start.width ?? 160) / 2;
                    const y1 = start.y + (start.height ?? 58) / 2;
                    const x2 = end.x + (end.width ?? 160) / 2;
                    const y2 = end.y + (end.height ?? 58) / 2;
                    return <line key={edge.id} markerEnd="url(#arrow)" x1={x1} x2={x2} y1={y1} y2={y2} />;
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
                  if (hiddenIds.has(node.id)) return null;
                  const storedPosition = positions.get(node.id) ?? positionFor(snapshot, node, index);
                  const position = drag?.entityId === node.id ? drag : storedPosition;
                  const annotation = snapshot.view?.annotations.find(
                    (item) => item.entityId === node.id,
                  );
                  return (
                    <div
                      className="graphNodeWrap"
                      key={node.id}
                      style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
                    >
                      <button
                        aria-label={`${node.label}. Position ${position.x}, ${position.y}.`}
                        aria-pressed={selectedIds.includes(node.id)}
                        className="graphNode"
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
                      {annotation ? <span className="graphAnnotation">{annotation.text}</span> : null}
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

interface SurfacePanelProps {
  readonly surface: Surface;
  readonly project: ProjectDocument;
  readonly snapshot: GraphSnapshot;
  readonly selectedEntity?: NodeEntity;
  readonly selectedIds: readonly EntityId[];
  readonly hiddenIds: ReadonlySet<EntityId>;
  readonly annotationDraft: string;
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
  onAnnotationChange,
  onSaveAnnotation,
  onSelect,
  onShow,
}: SurfacePanelProps) {
  const nodes = snapshot.entities.filter((entity): entity is NodeEntity => entity.kind === "node");

  if (surface === "Source") {
    return (
      <div>
        <PanelHeading eyebrow="Read only" title="Mermaid source" />
        <pre className="sourceCode">{snapshot.source.text}</pre>
        <p className="panelNote">Visual changes never rewrite this source.</p>
      </div>
    );
  }

  if (surface === "Story") {
    return (
      <div>
        <PanelHeading eyebrow={`${project.stories.length} saved`} title="Stories" />
        {project.stories.map((story) => (
          <article className="surfaceCard" key={story.id}>
            <strong>{story.title}</strong>
            <span>{story.scenes.length} scenes</span>
          </article>
        ))}
      </div>
    );
  }

  if (surface === "Compare") {
    return (
      <div>
        <PanelHeading eyebrow={`${project.comparisons.length} comparison`} title="Current vs proposed" />
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
        <PanelHeading eyebrow={`${selectedIds.length} selected`} title="Inspector" />
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
              <label htmlFor="annotation-text">Annotation for {selectedEntity.label}</label>
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
          <p className="panelEmpty">Select a component to inspect and annotate it.</p>
        )}
      </div>
    );
  }

  return (
    <div>
      <PanelHeading eyebrow={`${nodes.length} components`} title="Layers" />
      {snapshot.view?.groups.map((group) => (
        <div className="surfaceCard visualGroupCard" key={group.id}>
          <strong>{group.label} · {group.memberIds.length} components</strong>
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
              <button aria-label={`Show ${node.label}`} onClick={() => onShow(node.id)} type="button">
                Show
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PanelHeading({ eyebrow, title }: { readonly eyebrow: string; readonly title: string }) {
  return (
    <header className="panelHeading">
      <span>{eyebrow}</span>
      <h2>{title}</h2>
    </header>
  );
}
