/**
 * The read-only player shipped inside every exported HTML file. The runtime is authored here
 * as plain-JavaScript source strings rather than compiled from the domain modules: an export
 * must be a single file with no build step and no imports, so the code that runs in a
 * reviewer's browser is exactly the text embedded in the document.
 *
 * {@link RENDER_FUNCTION_SOURCE} is a deliberate, line-for-line port of the visual math in
 * `@/domain/story-engine` (scene sampling, action application, interpolation, camera). Keeping
 * it a separate, self-contained string lets a test evaluate this exact source and assert its
 * output matches {@link renderStoryAt} at sampled timestamps — the guarantee behind "playback
 * matches the editor". Change the engine and that test fails until this string is updated.
 */

export const RENDER_FUNCTION_SOURCE = String.raw`
function __identityTransform() {
  return { translateX: 0, translateY: 0, scale: 1, rotateDeg: 0 };
}

function __sampleScene(scenes, timestampMs) {
  if (scenes.length === 0) return null;
  var startedAtMs = 0;
  for (var index = 0; index < scenes.length; index += 1) {
    var scene = scenes[index];
    var endsAtMs = startedAtMs + scene.durationMs;
    var isLast = index === scenes.length - 1;
    if (timestampMs < endsAtMs || isLast) {
      var progress =
        scene.durationMs === 0
          ? 1
          : Math.min(1, Math.max(0, (timestampMs - startedAtMs) / scene.durationMs));
      return { scene: scene, index: index, startedAtMs: startedAtMs, progress: progress };
    }
    startedAtMs = endsAtMs;
  }
  return null;
}

function __interpolateNumber(from, to, progress) {
  if (progress <= 0) return from;
  if (progress >= 1) return to;
  var crossesZero = (from < 0 && to >= 0) || (from >= 0 && to < 0);
  var value = crossesZero
    ? from * (1 - progress) + to * progress
    : from + (to - from) * progress;
  if (!Number.isFinite(value)) {
    throw new RangeError("Transform interpolation produced a non-finite value.");
  }
  return value;
}

function __interpolateTransform(from, to, progress) {
  return {
    translateX: __interpolateNumber(from.translateX, to.translateX, progress),
    translateY: __interpolateNumber(from.translateY, to.translateY, progress),
    scale: __interpolateNumber(from.scale, to.scale, progress),
    rotateDeg: __interpolateNumber(from.rotateDeg, to.rotateDeg, progress),
  };
}

function __applyEntityAction(states, action, progress) {
  if (action.type === "camera") return;
  if (action.type === "focus") {
    var focused = states.get(action.target);
    if (focused) focused.focusProgress = Math.max(focused.focusProgress, progress);
    return;
  }
  var state = states.get(action.target);
  if (!state) return;
  switch (action.type) {
    case "reveal":
      state.opacity += (1 - state.opacity) * progress;
      state.visible = state.opacity > 0;
      break;
    case "hide":
      state.opacity *= 1 - progress;
      state.visible = state.opacity > 0;
      break;
    case "trace":
      state.traceProgress = Math.max(state.traceProgress, progress);
      break;
    case "transform":
      state.transform = __interpolateTransform(state.transform, action.to, progress);
      break;
    case "compare":
      if (progress > 0) state.comparison = action.change;
      break;
    case "highlight":
      if (progress > 0) state.highlightStyle = action.style;
      break;
    case "annotate":
      if (progress > 0) state.annotation = action.text;
      break;
  }
}

function __isPersistentAction(action) {
  return action.type === "reveal" || action.type === "hide" || action.type === "transform";
}

function __sameFocus(left, right) {
  return (
    left.length === right.length &&
    left.every(function (entityId, index) {
      return entityId === right[index];
    })
  );
}

function renderExportedStoryAt(payload, rawTimestampMs, mode) {
  if (!Number.isFinite(rawTimestampMs)) {
    throw new RangeError("timestampMs must be finite.");
  }
  var scenes = payload.story.scenes;
  var entities = payload.snapshot.entities;
  var durationMs = scenes.reduce(function (total, scene) {
    return total + scene.durationMs;
  }, 0);
  var timestampMs = Math.min(durationMs, Math.max(0, rawTimestampMs));
  var sample = __sampleScene(scenes, timestampMs);
  var transitionProgress = sample ? (mode === "full" ? sample.progress : 1) : 1;

  var states = new Map();
  entities.forEach(function (entity) {
    states.set(entity.id, {
      id: entity.id,
      kind: entity.kind,
      visible: false,
      opacity: 0,
      focusProgress: 0,
      traceProgress: 0,
      transform: __identityTransform(),
    });
  });

  var cameraFocus = [];
  var priorScenes = sample ? sample.index : 0;
  for (var i = 0; i < priorScenes; i += 1) {
    scenes[i].actions.forEach(function (action) {
      if (action.type === "camera") {
        cameraFocus = action.focus.slice();
      } else if (__isPersistentAction(action)) {
        __applyEntityAction(states, action, 1);
      }
    });
  }

  var cameraFrom = cameraFocus;
  var cameraTo = cameraFocus;
  if (sample) {
    sample.scene.actions.forEach(function (action) {
      if (action.type === "camera") {
        cameraTo = action.focus.slice();
      } else {
        __applyEntityAction(states, action, transitionProgress);
      }
    });
  }

  var cameraProgress = __sameFocus(cameraFrom, cameraTo) ? 1 : transitionProgress;
  var renderedCameraFocus = mode === "full" ? cameraFrom : cameraTo;

  var entityStates = [];
  states.forEach(function (state) {
    entityStates.push(state);
  });

  return {
    timestampMs: timestampMs,
    durationMs: durationMs,
    motionMode: mode,
    transitionProgress: transitionProgress,
    activeScene: sample
      ? {
          id: sample.scene.id,
          title: sample.scene.title,
          index: sample.index,
          startedAtMs: sample.startedAtMs,
          durationMs: sample.scene.durationMs,
          progress: sample.progress,
        }
      : null,
    entities: entityStates,
    camera: {
      from: renderedCameraFocus.slice(),
      to: cameraTo.slice(),
      progress: cameraProgress,
    },
  };
}
`;

/**
 * The DOM layer: it reads the sanitized payload from the page, lays out the diagram from the
 * embedded layout hints (falling back to the same grid the editor uses), and drives playback
 * with {@link RENDER_FUNCTION_SOURCE}. Every string that originates in project data — labels,
 * annotations, scene and diagram titles — is written with `textContent`, never `innerHTML`,
 * so a hostile label or link is inert text. Reduced-motion preference is honoured on load and
 * a static-view toggle exposes the fully-composed final frame.
 */
export const PLAYER_APP_SOURCE = String.raw`
(function () {
  var dataNode = document.getElementById("story-data");
  if (!dataNode) return;
  var payload = JSON.parse(dataNode.textContent);

  var DEFAULT_WIDTH = 160;
  var DEFAULT_HEIGHT = 58;

  var reduceQuery =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;

  var state = {
    timestampMs: 0,
    playing: false,
    staticView: false,
    lastFrame: null,
  };

  function currentMode() {
    if (state.staticView) return "static";
    if (reduceQuery && reduceQuery.matches) return "reduced";
    return "full";
  }

  var layoutById = {};
  payload.snapshot.layout.forEach(function (hint) {
    layoutById[hint.entityId] = hint;
  });

  var nodes = [];
  var edges = [];
  payload.snapshot.entities.forEach(function (entity) {
    if (entity.kind === "node") nodes.push(entity);
    else if (entity.kind === "edge") edges.push(entity);
  });

  function positionFor(entity, index) {
    var hint = layoutById[entity.id];
    if (hint) {
      return {
        x: hint.x,
        y: hint.y,
        width: hint.width != null ? hint.width : DEFAULT_WIDTH,
        height: hint.height != null ? hint.height : DEFAULT_HEIGHT,
      };
    }
    return {
      x: (index % 5) * 210 + 40,
      y: Math.floor(index / 5) * 130 + 40,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
    };
  }

  var positions = {};
  nodes.forEach(function (node, index) {
    positions[node.id] = positionFor(node, index);
  });

  var durationMs = payload.story.scenes.reduce(function (total, scene) {
    return total + scene.durationMs;
  }, 0);

  var stageWidth = 900;
  var stageHeight = 620;
  nodes.forEach(function (node) {
    var pos = positions[node.id];
    stageWidth = Math.max(stageWidth, pos.x + 240);
    stageHeight = Math.max(stageHeight, pos.y + 160);
  });

  var root = document.getElementById("app");
  root.textContent = "";

  var header = document.createElement("header");
  header.className = "exportHeader";
  var title = document.createElement("h1");
  title.textContent = payload.story.title;
  var subtitle = document.createElement("p");
  subtitle.className = "exportAttribution";
  subtitle.textContent =
    payload.meta.projectName +
    " · " +
    payload.meta.diagramType +
    " imported by " +
    payload.meta.importer +
    " " +
    payload.meta.importerVersion;
  header.appendChild(title);
  header.appendChild(subtitle);
  root.appendChild(header);

  var banner = document.createElement("div");
  banner.className = "sceneBanner";
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-live", "polite");
  root.appendChild(banner);

  var stageViewport = document.createElement("div");
  stageViewport.className = "stageViewport";
  stageViewport.tabIndex = 0;
  stageViewport.setAttribute("role", "group");
  stageViewport.setAttribute("aria-label", "Diagram");
  var stage = document.createElement("div");
  stage.className = "stage";
  stage.style.width = stageWidth + "px";
  stage.style.height = stageHeight + "px";
  stageViewport.appendChild(stage);
  root.appendChild(stageViewport);

  var svgNS = "http://www.w3.org/2000/svg";
  var svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("class", "edges");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", String(stageWidth));
  svg.setAttribute("height", String(stageHeight));
  var defs = document.createElementNS(svgNS, "defs");
  var marker = document.createElementNS(svgNS, "marker");
  marker.setAttribute("id", "arrow");
  marker.setAttribute("markerWidth", "9");
  marker.setAttribute("markerHeight", "7");
  marker.setAttribute("refX", "8");
  marker.setAttribute("refY", "3.5");
  marker.setAttribute("orient", "auto");
  var markerPath = document.createElementNS(svgNS, "path");
  markerPath.setAttribute("d", "M0,0 L9,3.5 L0,7 Z");
  marker.appendChild(markerPath);
  defs.appendChild(marker);
  svg.appendChild(defs);
  stage.appendChild(svg);

  var edgeLines = {};
  edges.forEach(function (edge) {
    var line = document.createElementNS(svgNS, "line");
    line.setAttribute("marker-end", "url(#arrow)");
    svg.appendChild(line);
    edgeLines[edge.id] = line;
  });

  var nodeEls = {};
  nodes.forEach(function (node) {
    var pos = positions[node.id];
    var wrap = document.createElement("div");
    wrap.className = "nodeWrap";
    wrap.style.transform = "translate(" + pos.x + "px, " + pos.y + "px)";
    var box = document.createElement("div");
    box.className = "node";
    var label = document.createElement("span");
    label.className = "nodeLabel";
    label.textContent = node.label;
    var meta = document.createElement("small");
    meta.textContent = node.id;
    box.appendChild(label);
    box.appendChild(meta);
    var annotation = document.createElement("span");
    annotation.className = "nodeAnnotation";
    wrap.appendChild(box);
    wrap.appendChild(annotation);
    stage.appendChild(wrap);
    nodeEls[node.id] = { wrap: wrap, box: box, annotation: annotation };
  });

  var controls = document.createElement("div");
  controls.className = "controls";

  var playButton = document.createElement("button");
  playButton.type = "button";
  playButton.className = "playButton";

  var scrubber = document.createElement("input");
  scrubber.type = "range";
  scrubber.min = "0";
  scrubber.max = String(durationMs);
  scrubber.step = "1";
  scrubber.value = "0";
  scrubber.className = "scrubber";
  scrubber.setAttribute("aria-label", "Seek");

  var timeLabel = document.createElement("span");
  timeLabel.className = "timeLabel";

  var prevButton = document.createElement("button");
  prevButton.type = "button";
  prevButton.textContent = "◀ Scene";
  prevButton.setAttribute("aria-label", "Previous scene");

  var nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.textContent = "Scene ▶";
  nextButton.setAttribute("aria-label", "Next scene");

  var staticToggle = document.createElement("button");
  staticToggle.type = "button";
  staticToggle.className = "staticToggle";

  controls.appendChild(prevButton);
  controls.appendChild(playButton);
  controls.appendChild(nextButton);
  controls.appendChild(scrubber);
  controls.appendChild(timeLabel);
  controls.appendChild(staticToggle);
  root.appendChild(controls);

  var outlineWrap = document.createElement("nav");
  outlineWrap.className = "outline";
  outlineWrap.setAttribute("aria-label", "Scenes");
  var outlineButtons = [];
  var sceneStarts = [];
  var runningStart = 0;
  payload.story.scenes.forEach(function (scene, index) {
    sceneStarts.push(runningStart);
    runningStart += scene.durationMs;
    var item = document.createElement("button");
    item.type = "button";
    item.className = "outlineItem";
    var heading = document.createElement("strong");
    heading.textContent = index + 1 + ". " + scene.title;
    item.appendChild(heading);
    var descList = payload.outline[index] ? payload.outline[index].descriptions : [];
    descList.forEach(function (text) {
      var line = document.createElement("span");
      line.textContent = text;
      item.appendChild(line);
    });
    item.addEventListener("click", function () {
      seekTo(sceneStarts[index]);
    });
    outlineWrap.appendChild(item);
    outlineButtons.push(item);
  });
  root.appendChild(outlineWrap);

  var live = document.createElement("span");
  live.className = "srOnly";
  live.setAttribute("aria-live", "assertive");
  root.appendChild(live);

  function center(entityId) {
    var pos = positions[entityId];
    if (!pos) return null;
    return { x: pos.x + pos.width / 2, y: pos.y + pos.height / 2 };
  }

  function render() {
    var mode = currentMode();
    var frame = renderExportedStoryAt(payload, state.timestampMs, mode);
    state.lastFrame = frame;

    var byId = {};
    frame.entities.forEach(function (entity) {
      byId[entity.id] = entity;
    });

    nodes.forEach(function (node) {
      var els = nodeEls[node.id];
      var entity = byId[node.id];
      var visible = entity ? entity.visible : true;
      els.wrap.style.display = visible ? "" : "none";
      els.wrap.style.opacity = entity ? String(entity.opacity) : "1";
      var focused = entity && entity.focusProgress > 0;
      var highlighted = entity && entity.highlightStyle;
      els.box.className =
        "node" + (focused ? " isFocused" : "") + (highlighted ? " isHighlighted" : "");
      var annotationText = entity && entity.annotation ? entity.annotation : "";
      els.annotation.textContent = annotationText;
      els.annotation.style.display = annotationText ? "" : "none";
    });

    edges.forEach(function (edge) {
      var line = edgeLines[edge.id];
      var sourceVisible = byId[edge.source] ? byId[edge.source].visible : true;
      var targetVisible = byId[edge.target] ? byId[edge.target].visible : true;
      var start = center(edge.source);
      var end = center(edge.target);
      if (!start || !end || !sourceVisible || !targetVisible) {
        line.style.display = "none";
        return;
      }
      line.style.display = "";
      line.setAttribute("x1", String(start.x));
      line.setAttribute("y1", String(start.y));
      line.setAttribute("x2", String(end.x));
      line.setAttribute("y2", String(end.y));
    });

    scrubber.value = String(Math.round(frame.timestampMs));
    timeLabel.textContent = Math.round(frame.timestampMs) + " / " + durationMs + " ms";

    banner.textContent = "";
    if (frame.activeScene) {
      var strong = document.createElement("strong");
      strong.textContent =
        "Scene " + (frame.activeScene.index + 1) + ": " + frame.activeScene.title;
      banner.appendChild(strong);
    }

    outlineButtons.forEach(function (button, index) {
      var active = frame.activeScene ? frame.activeScene.index === index : false;
      button.setAttribute("aria-current", active ? "true" : "false");
    });

    playButton.textContent = state.playing ? "Pause" : "Play";
    playButton.setAttribute("aria-pressed", state.playing ? "true" : "false");
    staticToggle.textContent = state.staticView ? "Animated view" : "Static view";
    staticToggle.setAttribute("aria-pressed", state.staticView ? "true" : "false");
  }

  function announceScene() {
    if (state.lastFrame && state.lastFrame.activeScene) {
      live.textContent =
        "Scene " +
        (state.lastFrame.activeScene.index + 1) +
        ": " +
        state.lastFrame.activeScene.title;
    }
  }

  function seekTo(ms) {
    state.timestampMs = Math.min(durationMs, Math.max(0, ms));
    render();
    announceScene();
  }

  var rafHandle = null;
  var lastTick = null;

  function stop() {
    state.playing = false;
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
    lastTick = null;
    render();
  }

  function tick(now) {
    if (lastTick !== null) {
      state.timestampMs += now - lastTick;
      if (state.timestampMs >= durationMs) {
        state.timestampMs = durationMs;
        render();
        stop();
        return;
      }
    }
    lastTick = now;
    render();
    rafHandle = requestAnimationFrame(tick);
  }

  function play() {
    if (state.playing) return;
    if (state.timestampMs >= durationMs) state.timestampMs = 0;
    state.playing = true;
    lastTick = null;
    render();
    rafHandle = requestAnimationFrame(tick);
  }

  function togglePlay() {
    if (state.playing) stop();
    else play();
  }

  function activeSceneIndex() {
    var frame = state.lastFrame;
    return frame && frame.activeScene ? frame.activeScene.index : 0;
  }

  function goToScene(delta) {
    stop();
    var target = Math.min(
      sceneStarts.length - 1,
      Math.max(0, activeSceneIndex() + delta),
    );
    seekTo(sceneStarts[target]);
  }

  playButton.addEventListener("click", togglePlay);
  staticToggle.addEventListener("click", function () {
    state.staticView = !state.staticView;
    stop();
  });
  prevButton.addEventListener("click", function () {
    goToScene(-1);
  });
  nextButton.addEventListener("click", function () {
    goToScene(1);
  });
  scrubber.addEventListener("input", function () {
    stop();
    seekTo(Number(scrubber.value));
  });

  if (reduceQuery && typeof reduceQuery.addEventListener === "function") {
    reduceQuery.addEventListener("change", function () {
      render();
    });
  }

  document.addEventListener("keydown", function (event) {
    var tag = event.target && event.target.tagName ? event.target.tagName : "";
    if (tag === "INPUT" && event.key !== " ") return;
    switch (event.key) {
      case " ":
        event.preventDefault();
        togglePlay();
        break;
      case "ArrowRight":
        event.preventDefault();
        stop();
        seekTo(state.timestampMs + 200);
        break;
      case "ArrowLeft":
        event.preventDefault();
        stop();
        seekTo(state.timestampMs - 200);
        break;
      case "ArrowUp":
      case "]":
      case ".":
        event.preventDefault();
        goToScene(1);
        break;
      case "ArrowDown":
      case "[":
      case ",":
        event.preventDefault();
        goToScene(-1);
        break;
      case "Home":
        event.preventDefault();
        stop();
        seekTo(0);
        break;
      case "End":
        event.preventDefault();
        stop();
        seekTo(durationMs);
        break;
      default:
        break;
    }
  });

  seekTo(0);
})();
`;

/**
 * The exact executable script embedded in every export, in the order it appears in the
 * document. Concatenated here so the export can advertise a Content Security Policy hash over
 * this precise text: a reviewer's browser will run the player only if the inline script matches
 * the hash, and no injected script can substitute for it.
 */
export const PLAYER_SCRIPT_SOURCE = `${RENDER_FUNCTION_SOURCE}\n${PLAYER_APP_SOURCE}`;

/** Styles for the exported player. Honours reduced motion and provides a static view. */
export const PLAYER_STYLES = String.raw`
:root {
  color-scheme: light dark;
  --bg: #0f172a;
  --surface: #1e293b;
  --node: #f8fafc;
  --node-text: #0f172a;
  --accent: #38bdf8;
  --edge: #94a3b8;
  --muted: #94a3b8;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  background: var(--bg);
  color: #e2e8f0;
}
#app { max-width: 1100px; margin: 0 auto; padding: 24px 16px 48px; }
.exportHeader h1 { margin: 0 0 4px; font-size: 1.4rem; }
.exportAttribution { margin: 0; color: var(--muted); font-size: 0.85rem; }
.sceneBanner {
  min-height: 1.5rem;
  margin: 16px 0 8px;
  font-size: 1rem;
}
.stageViewport {
  position: relative;
  overflow: auto;
  border: 1px solid var(--surface);
  border-radius: 12px;
  background: var(--surface);
  max-height: 62vh;
}
.stage { position: relative; }
.edges { position: absolute; inset: 0; pointer-events: none; }
.edges line { stroke: var(--edge); stroke-width: 1.6; transition: opacity 200ms ease; }
.edges #arrow path { fill: var(--edge); }
.nodeWrap {
  position: absolute;
  top: 0;
  left: 0;
  transition: opacity 200ms ease, transform 200ms ease;
}
.node {
  width: 160px;
  min-height: 58px;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--node);
  color: var(--node-text);
  border: 2px solid transparent;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}
.node.isFocused { border-color: var(--accent); }
.node.isHighlighted { box-shadow: 0 0 0 3px var(--accent); }
.nodeLabel { font-weight: 600; font-size: 0.9rem; }
.node small { color: #64748b; font-size: 0.7rem; }
.nodeAnnotation {
  display: block;
  margin-top: 4px;
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(56, 189, 248, 0.18);
  color: #e2e8f0;
  font-size: 0.75rem;
  max-width: 200px;
}
.controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 16px 0;
}
.controls button {
  background: var(--surface);
  color: #e2e8f0;
  border: 1px solid #334155;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 0.85rem;
  cursor: pointer;
}
.controls button:hover { border-color: var(--accent); }
.controls button:focus-visible,
.outlineItem:focus-visible,
.scrubber:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.scrubber { flex: 1; min-width: 160px; }
.timeLabel { color: var(--muted); font-size: 0.8rem; font-variant-numeric: tabular-nums; }
.outline {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
}
.outlineItem {
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: left;
  background: var(--surface);
  color: #e2e8f0;
  border: 1px solid #334155;
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
  font: inherit;
}
.outlineItem[aria-current="true"] { border-color: var(--accent); }
.outlineItem strong { font-size: 0.9rem; }
.outlineItem span { color: var(--muted); font-size: 0.78rem; }
.staticFallback { border: 1px solid var(--surface); border-radius: 12px; padding: 16px; }
.staticFallback ol { margin: 8px 0 0; padding-left: 20px; }
.srOnly {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
@media (prefers-reduced-motion: reduce) {
  .nodeWrap,
  .edges line { transition: none !important; }
}
`;
