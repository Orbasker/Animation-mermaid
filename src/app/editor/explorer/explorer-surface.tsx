"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from "react";

import type { EntityId, GraphSnapshot } from "@/domain/graph";
import {
  breadcrumbTrail,
  buildExplorerGraph,
  collapseAll,
  deriveVisibleGraph,
  drillInto,
  drillTo,
  expandAll,
  initialExplorerState,
  maxContainerDepth,
  revealEntity,
  searchEntities,
  setCollapseLevel,
  toggleCollapse,
  type ExplorerState,
} from "@/explorer/explorer-model";
import { layoutVisibleGraph } from "@/explorer/explorer-layout";

export interface ExplorerSurfaceProps {
  readonly snapshot: GraphSnapshot;
  /** Test seam: forces the reduced-motion branch without a matchMedia stub. */
  readonly reducedMotion?: boolean;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

function clampZoom(value: number): number {
  return Math.min(2, Math.max(0.2, Math.round(value * 100) / 100));
}

/**
 * The in-app interactive explorer. Everything drawn is derived from the pure explorer model:
 * collapse/expand and level-of-detail fold containers into counted summaries, drill-down replaces
 * the view with a container's sub-diagram (with a breadcrumb back out), and search reveals hits by
 * expanding their ancestors. Pan/zoom/fit and rendering live here; the geometry is a pure function
 * of state, so a toggle never needs a layout worker. Honours `prefers-reduced-motion`.
 */
export function ExplorerSurface({
  snapshot,
  reducedMotion: forcedReducedMotion,
}: ExplorerSurfaceProps) {
  const graph = useMemo(() => buildExplorerGraph(snapshot), [snapshot]);
  const maxDepth = useMemo(() => maxContainerDepth(graph), [graph]);

  const [state, setState] = useState<ExplorerState>(initialExplorerState);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 32, y: 32 });
  const [drag, setDrag] = useState<{
    readonly pointerX: number;
    readonly pointerY: number;
    readonly panX: number;
    readonly panY: number;
  }>();
  const [announcement, setAnnouncement] = useState("");

  const canvasRef = useRef<HTMLDivElement>(null);

  const [detectedReducedMotion, setDetectedReducedMotion] = useState(false);
  useEffect(() => {
    if (forcedReducedMotion !== undefined) return;
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setDetectedReducedMotion(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, [forcedReducedMotion]);
  const reducedMotion = forcedReducedMotion ?? detectedReducedMotion;

  // Re-derive the whole view/layout whenever the graph or interaction state changes; both passes
  // are pure and cheap enough to run synchronously per toggle.
  const view = useMemo(() => deriveVisibleGraph(graph, state), [graph, state]);
  const laid = useMemo(() => layoutVisibleGraph(view), [view]);
  const breadcrumbs = useMemo(
    () => breadcrumbTrail(state, graph),
    [state, graph],
  );

  const fit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || laid.width === 0 || laid.height === 0) return;
    const margin = 48;
    const scale = clampZoom(
      Math.min(
        (canvas.clientWidth - margin) / laid.width,
        (canvas.clientHeight - margin) / laid.height,
      ),
    );
    setZoom(scale);
    setPan({
      x: (canvas.clientWidth - laid.width * scale) / 2,
      y: (canvas.clientHeight - laid.height * scale) / 2,
    });
  }, [laid.width, laid.height]);

  const centreOn = useCallback(
    (id: EntityId) => {
      const canvas = canvasRef.current;
      const rect =
        laid.leaves.find((n) => n.id === id)?.rect ??
        laid.containers.find((n) => n.id === id)?.rect;
      if (!canvas || !rect) return;
      setPan({
        x: canvas.clientWidth / 2 - (rect.x + rect.width / 2) * zoom,
        y: canvas.clientHeight / 2 - (rect.y + rect.height / 2) * zoom,
      });
    },
    [laid, zoom],
  );

  const hits = useMemo(
    () => searchEntities(graph, state.query),
    [graph, state.query],
  );
  const matches = useMemo(() => new Set(hits), [hits]);
  const cycleRef = useRef(0);

  const revealNextHit = useCallback(() => {
    if (hits.length === 0) return;
    const index = cycleRef.current % hits.length;
    cycleRef.current += 1;
    const target = hits[index];
    setState((current) => revealEntity(current, graph, target));
    // Centre after the reveal-driven re-layout has been committed.
    requestAnimationFrame(() => centreOn(target));
    setAnnouncement(
      `Revealed ${target} (${index + 1} of ${hits.length} matches).`,
    );
  }, [hits, graph, centreOn]);

  const handleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setZoom((current) => clampZoom(current - event.deltaY * 0.001));
  }, []);

  const beginPan = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      if ((event.target as HTMLElement).closest("[data-explorer-node]")) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setDrag({
        pointerX: event.clientX,
        pointerY: event.clientY,
        panX: pan.x,
        panY: pan.y,
      });
    },
    [pan],
  );

  const continuePan = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!drag) return;
      setPan({
        x: drag.panX + (event.clientX - drag.pointerX),
        y: drag.panY + (event.clientY - drag.pointerY),
      });
    },
    [drag],
  );

  const endPan = useCallback(() => setDrag(undefined), []);

  const onToggle = useCallback((id: EntityId) => {
    setState((current) => toggleCollapse(current, id));
  }, []);

  const onDrill = useCallback(
    (id: EntityId) => {
      setState((current) => drillInto(current, graph, id));
      setAnnouncement(`Drilled into ${id}.`);
    },
    [graph],
  );

  const collapsedIds = state.collapsed;

  return (
    <section
      aria-label="Interactive structure explorer"
      className={`explorer${reducedMotion ? " explorer-reducedMotion" : ""}`}
    >
      <div
        className="explorerToolbar"
        role="toolbar"
        aria-label="Explorer actions"
      >
        <button onClick={() => setState((c) => expandAll(c))} type="button">
          Expand all
        </button>
        <button
          onClick={() => setState((c) => collapseAll(c, graph))}
          type="button"
        >
          Collapse all
        </button>
        <label className="explorerLevel">
          <span>Detail</span>
          <input
            aria-label="Level of detail"
            disabled={maxDepth < 0}
            max={Math.max(0, maxDepth + 1)}
            min={0}
            onChange={(event) =>
              setState((c) =>
                setCollapseLevel(c, graph, Number(event.target.value)),
              )
            }
            type="range"
          />
        </label>
        <span className="explorerToolbarDivider" />
        <button
          aria-label="Zoom out"
          onClick={() => setZoom((v) => clampZoom(v - 0.1))}
          type="button"
        >
          −
        </button>
        <output aria-label="Zoom level">{Math.round(zoom * 100)}%</output>
        <button
          aria-label="Zoom in"
          onClick={() => setZoom((v) => clampZoom(v + 0.1))}
          type="button"
        >
          +
        </button>
        <button onClick={fit} type="button">
          Fit
        </button>
        <span className="explorerToolbarDivider" />
        <label className="explorerSearch">
          <span className="srOnly">Search components</span>
          <input
            onChange={(event) =>
              setState((c) => ({ ...c, query: event.target.value }))
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                revealNextHit();
              }
            }}
            placeholder="Search…"
            type="search"
            value={state.query}
          />
          {state.query ? (
            <span className="explorerSearchCount" aria-live="polite">
              {hits.length} match{hits.length === 1 ? "" : "es"}
            </span>
          ) : null}
        </label>
      </div>

      <nav aria-label="Drill-down breadcrumb" className="explorerBreadcrumb">
        {breadcrumbs.map((crumb, index) => {
          const isCurrent = index === breadcrumbs.length - 1;
          return (
            <span key={crumb.id ?? "__root__"}>
              {index > 0 ? (
                <span aria-hidden="true" className="explorerCrumbSep">
                  ›
                </span>
              ) : null}
              <button
                aria-current={isCurrent ? "page" : undefined}
                className="explorerCrumb"
                disabled={isCurrent}
                onClick={() => setState((c) => drillTo(c, crumb.id))}
                type="button"
              >
                {crumb.label}
              </button>
            </span>
          );
        })}
      </nav>

      <div
        className="explorerCanvas"
        onPointerDown={beginPan}
        onPointerMove={continuePan}
        onPointerCancel={endPan}
        onPointerUp={endPan}
        onWheel={handleWheel}
        ref={canvasRef}
      >
        <div
          className="explorerStage"
          style={{
            height: laid.height,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            width: laid.width,
          }}
        >
          <svg
            aria-hidden="true"
            className="explorerEdges"
            height={laid.height}
            width={laid.width}
          >
            <defs>
              <marker
                id="explorerArrow"
                markerHeight="7"
                markerWidth="9"
                orient="auto"
                refX="8"
                refY="3.5"
              >
                <path d="M0,0 L9,3.5 L0,7 Z" />
              </marker>
            </defs>
            {laid.edges.map((edge) => (
              <line
                className={
                  edge.aggregated ? "explorerEdge isAggregated" : "explorerEdge"
                }
                key={edge.id}
                markerEnd="url(#explorerArrow)"
                x1={edge.from.x}
                x2={edge.to.x}
                y1={edge.from.y}
                y2={edge.to.y}
              />
            ))}
          </svg>

          {laid.containers.map((container) => {
            const model = view.containers.find((c) => c.id === container.id)!;
            return (
              <div
                className={`explorerContainer${matches.has(container.id) ? " isMatch" : ""}`}
                data-explorer-node
                key={container.id}
                style={{
                  height: container.rect.height,
                  transform: `translate(${container.rect.x}px, ${container.rect.y}px)`,
                  width: container.rect.width,
                }}
              >
                <div className="explorerContainerHeader">
                  <button
                    aria-expanded={!collapsedIds.has(container.id)}
                    aria-label={`Collapse ${model.label}`}
                    className="explorerToggle"
                    onClick={() => onToggle(container.id)}
                    type="button"
                  >
                    ▾
                  </button>
                  <span className="explorerContainerLabel">{model.label}</span>
                  <button
                    aria-label={`Drill into ${model.label}`}
                    className="explorerDrill"
                    onClick={() => onDrill(container.id)}
                    title={`Drill into ${model.label}`}
                    type="button"
                  >
                    ⤢
                  </button>
                </div>
              </div>
            );
          })}

          {laid.leaves.map((leaf) => {
            const model = view.nodes.find((n) => n.id === leaf.id)!;
            const isSummary = model.kind === "summary";
            const className = [
              "explorerNode",
              isSummary ? "isSummary" : "",
              matches.has(leaf.id) ? "isMatch" : "",
              state.focusId === leaf.id ? "isFocused" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                className={className}
                data-explorer-node
                key={leaf.id}
                onClick={() => (isSummary ? onToggle(leaf.id) : undefined)}
                style={{
                  height: leaf.rect.height,
                  transform: `translate(${leaf.rect.x}px, ${leaf.rect.y}px)`,
                  width: leaf.rect.width,
                }}
                type="button"
              >
                <span className="explorerNodeLabel">{model.label}</span>
                {isSummary ? (
                  <small className="explorerNodeCount">
                    ▸ {model.aggregatedLeafCount} inside
                  </small>
                ) : (
                  <small className="explorerNodeId">{leaf.id}</small>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <p className="explorerHint">
        Drag to pan · scroll to zoom · ▾ collapses a container · ⤢ drills in ·
        click a summary to expand
      </p>
      <span aria-live="polite" className="srOnly">
        {announcement}
      </span>
    </section>
  );
}
