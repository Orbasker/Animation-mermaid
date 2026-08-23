/**
 * The interactive structure explorer shipped inside every exported HTML file. Like the story
 * player in `@/export/player-runtime`, this runtime is authored as plain-JavaScript source
 * strings, not compiled from the domain modules: an export must be a single self-contained file
 * that opens offline, so the code a reader runs is exactly the text embedded in the document.
 *
 * The runtime reads the per-diagram {@link import("./structure-model").StructureDiagram} models
 * from `window.__EXPLORER__`, lays each out with the inlined ELK bundle (the same layered
 * algorithm the editor uses), and draws an SVG the reader can pan, zoom, and — the point of the
 * tool — collapse and expand subgraphs on. Collapsing a subgraph re-runs layout with that group
 * turned into a single leaf and its crossing edges rerouted to it, so a dense diagram stays
 * legible while a reader drills into one module at a time.
 */

export const EXPLORER_STYLES = String.raw`
:root {
  color-scheme: light dark;
  --bg: #f6f7f9;
  --panel: #ffffff;
  --ink: #1b1f24;
  --muted: #5b6672;
  --border: #d3d9e0;
  --accent: #2f6feb;
  --group: rgba(47, 111, 235, 0.06);
  --group-border: #9db4e6;
  --edge: #6b7684;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0e1116;
    --panel: #161b22;
    --ink: #e6edf3;
    --muted: #9aa7b4;
    --border: #2a323c;
    --accent: #4d8bff;
    --group: rgba(77, 139, 255, 0.10);
    --group-border: #3a4b6b;
    --edge: #8a97a6;
  }
}
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body {
  background: var(--bg);
  color: var(--ink);
  font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  display: flex;
  flex-direction: column;
}
header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  flex-wrap: wrap;
}
header h1 { font-size: 15px; margin: 0; font-weight: 600; }
.tabs { display: flex; gap: 4px; flex-wrap: wrap; }
.tab {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  padding: 5px 12px;
  border-radius: 999px;
  cursor: pointer;
  font: inherit;
}
.tab[aria-selected="true"] {
  color: #fff;
  background: var(--accent);
  border-color: var(--accent);
}
.toolbar { margin-left: auto; display: flex; gap: 6px; }
.toolbar button {
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--ink);
  border-radius: 6px;
  padding: 5px 10px;
  cursor: pointer;
  font: inherit;
}
.toolbar button:hover { border-color: var(--accent); }
main { position: relative; flex: 1; overflow: hidden; }
svg { width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; }
svg.panning { cursor: grabbing; }
.node rect, .node polygon, .node ellipse, .node path {
  fill: var(--panel);
  stroke: var(--border);
  stroke-width: 1.5;
}
.node text { fill: var(--ink); }
.group > rect {
  fill: var(--group);
  stroke: var(--group-border);
  stroke-width: 1.5;
  stroke-dasharray: 4 3;
  rx: 8;
}
.group.collapsed > rect { stroke-dasharray: none; fill: var(--panel); }
.group-header { cursor: pointer; }
.group-header text { fill: var(--muted); font-weight: 600; }
.group-header:hover text { fill: var(--accent); }
.toggle { fill: var(--muted); font-weight: 700; }
.edge path { fill: none; stroke: var(--edge); stroke-width: 1.5; }
.edge.dotted path { stroke-dasharray: 4 3; }
.edge.thick path { stroke-width: 3; }
.edge text {
  fill: var(--muted);
  font-size: 12px;
}
.edge .edge-label-bg { fill: var(--bg); opacity: 0.85; }
.warnings {
  position: absolute;
  left: 12px;
  bottom: 12px;
  max-width: 420px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-left: 3px solid #d19a00;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 12px;
  color: var(--muted);
  max-height: 30%;
  overflow: auto;
}
.warnings strong { color: var(--ink); }
.empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--muted);
}
#editor {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(460px, 46vw);
  background: var(--panel);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 12px;
  gap: 8px;
  z-index: 5;
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.18);
}
#editor[hidden] { display: none; }
.editor-head { display: flex; align-items: center; justify-content: space-between; }
.editor-head strong { font-size: 13px; }
#editor-status { font-size: 12px; color: var(--muted); }
#editor-status.error { color: #e5534b; }
#editor-status.ok { color: #3fb950; }
#editor-text {
  flex: 1;
  resize: none;
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--ink);
  padding: 10px;
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  tab-size: 2;
}
.editor-actions { display: flex; gap: 6px; justify-content: flex-end; }
.editor-actions button {
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--ink);
  border-radius: 6px;
  padding: 6px 14px;
  cursor: pointer;
  font: inherit;
}
#editor-apply { background: var(--accent); border-color: var(--accent); color: #fff; }
`;

export const EXPLORER_RUNTIME_SOURCE = String.raw`
(function () {
  "use strict";

  var DATA = (window.__EXPLORER__ && window.__EXPLORER__.diagrams) || [];
  var SVG_NS = "http://www.w3.org/2000/svg";
  var CHAR_W = 7.2;
  var NODE_PAD_X = 18;
  var NODE_H = 44;
  var GROUP_HEADER_H = 26;

  var app = document.getElementById("app");
  var header = document.getElementById("tabs");
  var stage = document.getElementById("stage");

  var activeIndex = 0;
  // Per-diagram set of collapsed group ids, keyed by diagram id.
  var collapsedByDiagram = {};

  function collapsedSet(diagram) {
    if (!collapsedByDiagram[diagram.id]) collapsedByDiagram[diagram.id] = {};
    return collapsedByDiagram[diagram.id];
  }

  function estimateWidth(label) {
    var text = label || "";
    return Math.max(120, Math.round(text.length * CHAR_W) + NODE_PAD_X * 2);
  }

  function buildIndex(diagram) {
    var byId = {};
    var children = {};
    diagram.nodes.forEach(function (n) {
      byId[n.id] = { kind: "node", entity: n };
      var p = n.parent || "__root__";
      (children[p] || (children[p] = [])).push(n.id);
    });
    diagram.groups.forEach(function (g) {
      byId[g.id] = { kind: "group", entity: g };
      var p = g.parent || "__root__";
      (children[p] || (children[p] = [])).push(g.id);
    });
    return { byId: byId, children: children };
  }

  // The outermost collapsed ancestor an entity folds into, or the entity itself when visible.
  function representative(id, idx, collapsed) {
    var rep = id;
    var cur = idx.byId[id];
    while (cur && cur.entity.parent) {
      var parent = cur.entity.parent;
      if (collapsed[parent]) rep = parent;
      cur = idx.byId[parent];
    }
    return rep;
  }

  // True when an ancestor is collapsed, so this entity is not drawn at all.
  function isHidden(id, idx, collapsed) {
    var cur = idx.byId[id];
    while (cur && cur.entity.parent) {
      if (collapsed[cur.entity.parent]) return true;
      cur = idx.byId[cur.entity.parent];
    }
    return false;
  }

  function buildElkNode(id, idx, collapsed) {
    var record = idx.byId[id];
    var entity = record.entity;
    if (record.kind === "node") {
      return { id: id, width: estimateWidth(entity.label), height: NODE_H };
    }
    if (collapsed[id]) {
      return {
        id: id,
        width: Math.max(150, estimateWidth("▸ " + entity.label)),
        height: NODE_H,
      };
    }
    var kids = (idx.children[id] || []).map(function (childId) {
      return buildElkNode(childId, idx, collapsed);
    });
    return {
      id: id,
      children: kids,
      layoutOptions: { "elk.padding": "[top=" + (GROUP_HEADER_H + 8) + ",left=14,bottom=14,right=14]" },
    };
  }

  var DIRECTION_TO_ELK = { TD: "DOWN", TB: "DOWN", BT: "UP", LR: "RIGHT", RL: "LEFT" };

  function buildElkGraph(diagram, idx, collapsed) {
    var roots = (idx.children["__root__"] || []).map(function (id) {
      return buildElkNode(id, idx, collapsed);
    });

    var seen = {};
    var edges = [];
    diagram.edges.forEach(function (e) {
      var s = representative(e.source, idx, collapsed);
      var t = representative(e.target, idx, collapsed);
      if (s === t) return;
      if (!idx.byId[s] || !idx.byId[t]) return;
      var key = s + " " + t + " " + (e.label || "") + e.line + e.arrow;
      if (seen[key]) return;
      seen[key] = true;
      edges.push({
        id: "edge-" + edges.length,
        sources: [s],
        targets: [t],
        meta: { label: e.label, line: e.line, arrow: e.arrow },
      });
    });

    return {
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": DIRECTION_TO_ELK[diagram.direction] || "DOWN",
        "elk.randomSeed": "1",
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
        "elk.hierarchyHandling": "INCLUDE_CHILDREN",
        "elk.layered.spacing.nodeNodeBetweenLayers": "56",
        "elk.spacing.nodeNode": "36",
        "elk.spacing.edgeNode": "24",
      },
      children: roots,
      edges: edges,
    };
  }

  function flatten(node, ox, oy, out) {
    (node.children || []).forEach(function (child) {
      var x = ox + (child.x || 0);
      var y = oy + (child.y || 0);
      out[child.id] = { x: x, y: y, w: child.width || 0, h: child.height || 0 };
      if (child.children && child.children.length) flatten(child, x, y, out);
    });
  }

  function el(name, attrs) {
    var node = document.createElementNS(SVG_NS, name);
    if (attrs) {
      for (var k in attrs) {
        if (attrs[k] != null) node.setAttribute(k, String(attrs[k]));
      }
    }
    return node;
  }

  function nodeShape(shape, x, y, w, h) {
    var cx = x + w / 2;
    var cy = y + h / 2;
    switch (shape) {
      case "round":
        return el("rect", { x: x, y: y, width: w, height: h, rx: 12, ry: 12 });
      case "stadium":
        return el("rect", { x: x, y: y, width: w, height: h, rx: h / 2, ry: h / 2 });
      case "circle":
        return el("ellipse", { cx: cx, cy: cy, rx: w / 2, ry: h / 2 });
      case "diamond":
        return el("polygon", {
          points: cx + "," + y + " " + (x + w) + "," + cy + " " + cx + "," + (y + h) + " " + x + "," + cy,
        });
      case "hexagon":
        var i = Math.min(20, w / 4);
        return el("polygon", {
          points:
            (x + i) + "," + y + " " + (x + w - i) + "," + y + " " + (x + w) + "," + cy + " " +
            (x + w - i) + "," + (y + h) + " " + (x + i) + "," + (y + h) + " " + x + "," + cy,
        });
      case "cylinder":
        var r = Math.min(10, h / 4);
        return el("path", {
          d:
            "M" + x + "," + (y + r) +
            " A" + w / 2 + "," + r + " 0 0 0 " + (x + w) + "," + (y + r) +
            " L" + (x + w) + "," + (y + h - r) +
            " A" + w / 2 + "," + r + " 0 0 1 " + x + "," + (y + h - r) + " Z",
        });
      case "parallelogram":
        var s = Math.min(22, w / 5);
        return el("polygon", {
          points: (x + s) + "," + y + " " + (x + w) + "," + y + " " + (x + w - s) + "," + (y + h) + " " + x + "," + (y + h),
        });
      case "subroutine":
        return el("rect", { x: x, y: y, width: w, height: h, rx: 2 });
      default:
        return el("rect", { x: x, y: y, width: w, height: h, rx: 4 });
    }
  }

  function centeredLabel(text, x, y, w, h, cls) {
    var t = el("text", {
      x: x + w / 2,
      y: y + h / 2,
      "text-anchor": "middle",
      "dominant-baseline": "central",
    });
    if (cls) t.setAttribute("class", cls);
    t.textContent = text;
    return t;
  }

  function toggleGroup(diagram, groupId) {
    var collapsed = collapsedSet(diagram);
    if (collapsed[groupId]) delete collapsed[groupId];
    else collapsed[groupId] = true;
    render();
  }

  function edgePath(edge, pos) {
    if (edge.sections && edge.sections.length) {
      var pts = [];
      edge.sections.forEach(function (sec) {
        pts.push(sec.startPoint);
        (sec.bendPoints || []).forEach(function (b) { pts.push(b); });
        pts.push(sec.endPoint);
      });
      return pts
        .map(function (p, i) { return (i === 0 ? "M" : "L") + p.x + "," + p.y; })
        .join(" ");
    }
    var s = pos[edge.sources[0]];
    var t = pos[edge.targets[0]];
    if (!s || !t) return null;
    return "M" + (s.x + s.w / 2) + "," + (s.y + s.h / 2) +
      " L" + (t.x + t.w / 2) + "," + (t.y + t.h / 2);
  }

  var elk = new ELK();
  var currentSvg = null;
  var view = { x: 0, y: 0, scale: 1 };

  function applyView() {
    if (currentSvg) currentSvg.group.setAttribute("transform",
      "translate(" + view.x + "," + view.y + ") scale(" + view.scale + ")");
  }

  function render() {
    var diagram = DATA[activeIndex];
    stage.innerHTML = "";
    if (!diagram) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No diagrams to display.";
      stage.appendChild(empty);
      return;
    }
    var collapsed = collapsedSet(diagram);
    var idx = buildIndex(diagram);
    var graph = buildElkGraph(diagram, idx, collapsed);

    elk.layout(graph).then(function (laid) {
      draw(diagram, idx, collapsed, laid);
    }).catch(function (err) {
      var e = document.createElement("div");
      e.className = "empty";
      e.textContent = "Layout failed: " + (err && err.message ? err.message : err);
      stage.appendChild(e);
    });
  }

  function draw(diagram, idx, collapsed, laid) {
    var pos = {};
    flatten(laid, 0, 0, pos);

    var svg = el("svg", { xmlns: SVG_NS });
    var defs = el("defs");
    ["normal", "open", "cross", "circle"].forEach(function (kind) {
      var marker = el("marker", {
        id: "arrow-" + kind, viewBox: "0 0 10 10", refX: 9, refY: 5,
        markerWidth: 8, markerHeight: 8, orient: "auto-start-reverse",
      });
      var head;
      if (kind === "circle") head = el("circle", { cx: 5, cy: 5, r: 3, fill: "var(--edge)" });
      else if (kind === "cross") {
        head = el("path", { d: "M2,2 L8,8 M8,2 L2,8", stroke: "var(--edge)", "stroke-width": 1.5, fill: "none" });
      } else if (kind === "open") head = el("path", { d: "M1,1 L9,5 L1,9", fill: "none", stroke: "var(--edge)", "stroke-width": 1.5 });
      else head = el("path", { d: "M1,1 L9,5 L1,9 Z", fill: "var(--edge)" });
      marker.appendChild(head);
      defs.appendChild(marker);
    });
    svg.appendChild(defs);

    var root = el("g");
    svg.appendChild(root);
    currentSvg = { svg: svg, group: root };

    // Groups, outermost first so nested ones render on top.
    var groups = diagram.groups
      .filter(function (g) { return !isHidden(g.id, idx, collapsed); })
      .map(function (g) { return { g: g, depth: depthOf(g.id, idx) }; })
      .sort(function (a, b) { return a.depth - b.depth; });

    groups.forEach(function (item) {
      var g = item.g;
      var p = pos[g.id];
      if (!p) return;
      var wrap = el("g", { class: collapsed[g.id] ? "group collapsed" : "group" });
      wrap.appendChild(el("rect", { x: p.x, y: p.y, width: p.w, height: p.h, rx: 8 }));
      var headerH = collapsed[g.id] ? p.h : GROUP_HEADER_H;
      var head = el("g", { class: "group-header" });
      var hit = el("rect", { x: p.x, y: p.y, width: p.w, height: headerH, fill: "transparent" });
      head.appendChild(hit);
      var toggle = el("text", {
        x: p.x + 10, y: p.y + headerH / 2, "dominant-baseline": "central", class: "toggle",
      });
      toggle.textContent = collapsed[g.id] ? "▸" : "▾";
      head.appendChild(toggle);
      var label = el("text", {
        x: p.x + 26, y: p.y + headerH / 2, "dominant-baseline": "central",
      });
      label.textContent = g.label;
      head.appendChild(label);
      head.addEventListener("click", function (ev) {
        ev.stopPropagation();
        toggleGroup(diagram, g.id);
      });
      wrap.appendChild(head);
      root.appendChild(wrap);
    });

    // Edges.
    (laid.edges || []).forEach(function (edge) {
      var d = edgePath(edge, pos);
      if (!d) return;
      var meta = edge.meta || {};
      var wrap = el("g", { class: "edge " + (meta.line || "solid") });
      var path = el("path", { d: d, "marker-end": "url(#arrow-" + (meta.arrow || "normal") + ")" });
      wrap.appendChild(path);
      if (meta.label) {
        var mid = midpoint(edge, pos);
        if (mid) {
          var text = el("text", { x: mid.x, y: mid.y, "text-anchor": "middle", "dominant-baseline": "central" });
          text.textContent = meta.label;
          var bg = el("rect", { class: "edge-label-bg", rx: 3 });
          wrap.appendChild(bg);
          wrap.appendChild(text);
          // Size the label background to the text after it is in the DOM.
          requestAnimationFrame(function () {
            try {
              var box = text.getBBox();
              bg.setAttribute("x", box.x - 3);
              bg.setAttribute("y", box.y - 1);
              bg.setAttribute("width", box.width + 6);
              bg.setAttribute("height", box.height + 2);
            } catch (e) {}
          });
        }
      }
      root.appendChild(wrap);
    });

    // Nodes.
    diagram.nodes
      .filter(function (n) { return !isHidden(n.id, idx, collapsed); })
      .forEach(function (n) {
        var p = pos[n.id];
        if (!p) return;
        var wrap = el("g", { class: "node" });
        wrap.appendChild(nodeShape(n.shape, p.x, p.y, p.w, p.h));
        wrap.appendChild(centeredLabel(n.label, p.x, p.y, p.w, p.h));
        root.appendChild(wrap);
      });

    stage.appendChild(svg);
    renderWarnings(diagram);
    fitToView(laid);
    wirePanZoom(svg);
  }

  function midpoint(edge, pos) {
    if (edge.sections && edge.sections.length) {
      var sec = edge.sections[0];
      var pts = [sec.startPoint].concat(sec.bendPoints || [], [sec.endPoint]);
      var m = pts[Math.floor(pts.length / 2)];
      return m;
    }
    var s = pos[edge.sources[0]];
    var t = pos[edge.targets[0]];
    if (!s || !t) return null;
    return { x: (s.x + s.w / 2 + t.x + t.w / 2) / 2, y: (s.y + s.h / 2 + t.y + t.h / 2) / 2 };
  }

  function depthOf(id, idx) {
    var d = 0;
    var cur = idx.byId[id];
    while (cur && cur.entity.parent) { d += 1; cur = idx.byId[cur.entity.parent]; }
    return d;
  }

  function renderWarnings(diagram) {
    if (!diagram.warnings || !diagram.warnings.length) return;
    var box = document.createElement("div");
    box.className = "warnings";
    var head = document.createElement("strong");
    head.textContent = "Import notes (" + diagram.warnings.length + ")";
    box.appendChild(head);
    var list = document.createElement("ul");
    list.style.margin = "6px 0 0";
    list.style.paddingLeft = "18px";
    diagram.warnings.slice(0, 12).forEach(function (w) {
      var li = document.createElement("li");
      li.textContent = w;
      list.appendChild(li);
    });
    box.appendChild(list);
    stage.appendChild(box);
  }

  function fitToView(laid) {
    var w = laid.width || 1;
    var h = laid.height || 1;
    var rect = stage.getBoundingClientRect();
    var pad = 40;
    var scale = Math.min((rect.width - pad) / w, (rect.height - pad) / h, 1.5);
    if (!isFinite(scale) || scale <= 0) scale = 1;
    view.scale = scale;
    view.x = (rect.width - w * scale) / 2;
    view.y = (rect.height - h * scale) / 2;
    applyView();
  }

  function wirePanZoom(svg) {
    var dragging = false;
    var last = null;
    svg.addEventListener("pointerdown", function (e) {
      if (e.target && e.target.closest && e.target.closest(".group-header")) return;
      dragging = true; last = { x: e.clientX, y: e.clientY };
      svg.classList.add("panning");
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      view.x += e.clientX - last.x;
      view.y += e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      applyView();
    });
    function stop(e) {
      dragging = false; svg.classList.remove("panning");
      try { svg.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    svg.addEventListener("pointerup", stop);
    svg.addEventListener("pointercancel", stop);
    svg.addEventListener("wheel", function (e) {
      e.preventDefault();
      var rect = svg.getBoundingClientRect();
      var mx = e.clientX - rect.left;
      var my = e.clientY - rect.top;
      var factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      var next = Math.max(0.1, Math.min(4, view.scale * factor));
      view.x = mx - (mx - view.x) * (next / view.scale);
      view.y = my - (my - view.y) * (next / view.scale);
      view.scale = next;
      applyView();
    }, { passive: false });
  }

  function setAllCollapsed(diagram, value) {
    var collapsed = collapsedSet(diagram);
    for (var k in collapsed) delete collapsed[k];
    if (value) diagram.groups.forEach(function (g) { collapsed[g.id] = true; });
    render();
  }

  function buildTabs() {
    DATA.forEach(function (diagram, i) {
      var tab = document.createElement("button");
      tab.className = "tab";
      tab.type = "button";
      tab.textContent = diagram.name;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", i === activeIndex ? "true" : "false");
      tab.addEventListener("click", function () {
        activeIndex = i;
        Array.prototype.forEach.call(header.children, function (child, ci) {
          child.setAttribute("aria-selected", ci === i ? "true" : "false");
        });
        syncEditor();
        render();
      });
      header.appendChild(tab);
    });
  }

  var editor = document.getElementById("editor");
  var editorText = document.getElementById("editor-text");
  var editorStatus = document.getElementById("editor-status");
  var editButton = document.getElementById("edit");
  var canEdit = !!(window.__STRUCTURE__ && window.__STRUCTURE__.buildStructureDiagram);

  function syncEditor() {
    if (!editor || editor.hidden) return;
    var diagram = DATA[activeIndex];
    editorText.value = diagram ? diagram.source || "" : "";
    setStatus("", "");
  }

  function setStatus(text, kind) {
    if (!editorStatus) return;
    editorStatus.textContent = text;
    editorStatus.className = kind || "";
  }

  function openEditor() {
    if (!editor) return;
    editor.hidden = false;
    syncEditor();
    editorText.focus();
  }

  function closeEditor() {
    if (editor) editor.hidden = true;
  }

  function applyEdit() {
    var diagram = DATA[activeIndex];
    if (!diagram || !canEdit) return;
    var source = editorText.value;
    try {
      var next = window.__STRUCTURE__.buildStructureDiagram({
        id: diagram.id,
        name: diagram.name,
        source: source,
      });
      DATA[activeIndex] = next;
      var collapsed = collapsedSet(next);
      for (var k in collapsed) delete collapsed[k];
      render();
      var warned = next.warnings && next.warnings.length
        ? " (" + next.warnings.length + " note" + (next.warnings.length === 1 ? "" : "s") + ")"
        : "";
      setStatus("Applied" + warned, "ok");
    } catch (err) {
      setStatus(
        (err && err.reason) || (err && err.message) || "Could not parse the diagram.",
        "error",
      );
    }
  }

  if (editButton) {
    if (!canEdit) {
      editButton.hidden = true;
    } else {
      editButton.addEventListener("click", function () {
        if (editor && editor.hidden) openEditor();
        else closeEditor();
      });
      document.getElementById("editor-apply").addEventListener("click", applyEdit);
      document.getElementById("editor-close").addEventListener("click", closeEditor);
      editorText.addEventListener("keydown", function (e) {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          applyEdit();
        }
      });
    }
  }

  document.getElementById("expand-all").addEventListener("click", function () {
    setAllCollapsed(DATA[activeIndex], false);
  });
  document.getElementById("collapse-all").addEventListener("click", function () {
    setAllCollapsed(DATA[activeIndex], true);
  });
  document.getElementById("fit").addEventListener("click", function () {
    if (currentSvg) {
      // Re-fit using the last SVG's content bounds.
      var bbox;
      try { bbox = currentSvg.group.getBBox(); } catch (e) { return; }
      var rect = stage.getBoundingClientRect();
      var pad = 40;
      var scale = Math.min((rect.width - pad) / bbox.width, (rect.height - pad) / bbox.height, 1.5);
      if (!isFinite(scale) || scale <= 0) scale = 1;
      view.scale = scale;
      view.x = (rect.width - bbox.width * scale) / 2 - bbox.x * scale;
      view.y = (rect.height - bbox.height * scale) / 2 - bbox.y * scale;
      applyView();
    }
  });

  buildTabs();
  render();
})();
`;
