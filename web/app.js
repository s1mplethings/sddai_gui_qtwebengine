/*
  SDDAI GUI Web Renderer (Cytoscape)
  HARD RULES (requested):
  1) Default view = Summary (small graph). NEVER auto-load full details on startup.
  2) Layout = preset only by default (no force-directed).
  3) Category single-click => drill down into next layer (requestGraph).
  4) Normal node single-click => open preview window (rendered), not raw txt.
  5) Must be able to go Back / Home (front-end view stack).
  6) If backend provides no positions => hard fallback positions so nodes never stack at (0,0).
  7) Reduce edge noise: Summary only aggregate edges; hide edge labels by default.
  8) Performance: LOD + focus-edges when edge count is high.
*/

(function () {
  const CY_ID = "cy";
  const container = document.getElementById(CY_ID);
  if (!container) {
    console.error("[web] missing #cy container");
    return;
  }

  // ---------- Utilities ----------
  function safeStr(x) { return (x === null || x === undefined) ? "" : String(x); }
  function isObj(x) { return typeof x === "object" && x !== null; }

  function shortLabel(input) {
    let s = safeStr(input).trim();
    if (!s) return "";
    s = s.replace(/.*[\\/]/g, "");                 // strip path
    s = s.replace(/\s*\([^)]*\)\s*/g, " ");        // remove (...) details
    s = s.replace(/\s*\[[^\]]*\]\s*/g, " ");       // remove [...] details
    s = s.replace(/\s+/g, " ").trim();
    const MAX = 18;
    return (s.length > MAX) ? (s.slice(0, MAX) + "…") : s;
  }

  function normalizeGraphPayload(payload) {
    const g = isObj(payload) ? payload : {};
    const nodes = Array.isArray(g.nodes) ? g.nodes : [];
    const edges = Array.isArray(g.edges) ? g.edges : [];

    const normNodes = nodes.map(n => {
      const data = isObj(n.data) ? { ...n.data } : { ...(isObj(n) ? n : {}) };
      data.id = safeStr(data.id);
      data.fullLabel = safeStr(data.fullLabel || data.label || data.id);
      data.label = shortLabel(data.fullLabel);
      data.kind = safeStr(data.kind || data.type || "");
      data.category = safeStr(data.category || "");
      data.tier = safeStr(data.tier || "");
      data.mutable = safeStr(data.mutable || "");
      data.path = safeStr(data.path || "");

      data.pinned = (data.pinned === true || data.pinned === "true") ? "true" : "false";

      const pos = isObj(n.position) ? n.position : (isObj(data.position) ? data.position : null);
      const out = { data };
      if (pos && typeof pos.x === "number" && typeof pos.y === "number") out.position = pos;
      return out;
    });

    const normEdges = edges.map(e => {
      const data = isObj(e.data) ? { ...e.data } : { ...(isObj(e) ? e : {}) };
      data.id = safeStr(data.id || ("e_" + Math.random().toString(16).slice(2)));
      data.source = safeStr(data.source);
      data.target = safeStr(data.target);
      data.kind = safeStr(data.kind || data.type || "");
      data.label = ""; // HARD RULE: hide edge labels (too noisy)
      return { data };
    });

    return { nodes: normNodes, edges: normEdges };
  }

  function inferView(payload, forced) {
    if (forced) return safeStr(forced);
    const v = payload && (payload.view || payload.current_view || (payload.meta && payload.meta.view));
    return safeStr(v) || "Unknown";
  }

  function filterEdgesByView(g, view) {
    const v = safeStr(view);
    const edges = g.edges || [];

    if (v === "Summary") {
      const kept = edges.filter(e => e && e.data && e.data.kind === "aggregate");
      return kept.slice(0, 12);
    }
    if (v === "Docs") {
      const kept = edges.filter(e => e && e.data && (e.data.kind === "docs_link" || e.data.kind === "link"));
      return kept.slice(0, 600);
    }
    const kept = edges.filter(e => !(e && e.data && (e.data.kind === "docs_link" || e.data.kind === "link")));
    return kept.slice(0, 900);
  }

  function ensurePositionsHard(g, view) {
    const nodes = g.nodes || [];
    if (!nodes.length) return g;

    let withPos = 0;
    for (const n of nodes) if (n && n.position && typeof n.position.x === "number" && typeof n.position.y === "number") withPos++;
    if ((withPos / nodes.length) >= 0.7) return g;

    const v = safeStr(view);
    if (v === "Summary") return g;

    const GAP_X = 240;
    const GAP_Y = 140;
    const MAX_COLS = 6;
    const ORIGIN_X = 0;
    const ORIGIN_Y = 0;
    const rows = ["Doc", "Module", "Contract", "Gate", "Run", "Other"];

    function kindOf(n) {
      const k = safeStr(n && n.data && (n.data.kind || n.data.type));
      return rows.includes(k) ? k : "Other";
    }

    const buckets = {};
    for (const r of rows) buckets[r] = [];
    for (const n of nodes) {
      if (n.position) continue;
      buckets[kindOf(n)].push(n);
    }

    let baseY = ORIGIN_Y;
    for (const r of rows) {
      const arr = buckets[r] || [];
      if (!arr.length) continue;

      let i = 0;
      while (i < arr.length) {
        const slice = arr.slice(i, i + MAX_COLS);
        for (let j = 0; j < slice.length; j++) {
          slice[j].position = { x: ORIGIN_X + j * GAP_X, y: baseY };
        }
        baseY += GAP_Y;
        i += MAX_COLS;
      }
    }
    return g;
  }

  // ---------- UI (Toolbar + Preview Modal) ----------
  const TOOLBAR_H = 44;

  function injectCssOnce() {
    if (document.getElementById("sddaiInjectedCss")) return;
    const style = document.createElement("style");
    style.id = "sddaiInjectedCss";
    style.textContent = `
      body { margin: 0; }
      #${CY_ID} { position: absolute; top: ${TOOLBAR_H}px; left: 0; right: 0; bottom: 0; }
      .toolbar {
        position: fixed; top: 0; left: 0; right: 0;
        height: ${TOOLBAR_H}px;
        display: flex; align-items: center; gap: 10px;
        padding: 0 12px;
        background: rgba(18,18,18,0.92);
        border-bottom: 1px solid rgba(255,255,255,0.08);
        z-index: 9999; user-select: none;
      }
      .btn {
        padding: 6px 10px;
        border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.14);
        background: rgba(255,255,255,0.06);
        color: #e8e8e8; cursor: pointer; font-size: 12px;
      }
      .btn:hover { background: rgba(255,255,255,0.10); }
      .btn:active { transform: translateY(1px); }
      .btn.danger { border-color: rgba(255,80,80,0.35); background: rgba(255,80,80,0.12); }
      .btn:disabled { opacity: 0.45; cursor: not-allowed; }
      .crumb { font-size: 12px; color: rgba(255,255,255,0.75); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 58vw; }
      .badge { font-size: 12px; padding: 4px 10px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.12); color: rgba(255,255,255,0.85); background: rgba(255,255,255,0.05); }
      .spacer { flex: 1; }

      .modal.hidden { display: none; }
      .modal { position: fixed; inset: 0; z-index: 10000; }
      .modalBackdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.6); }
      .modalPanel {
        position: absolute; top: 6vh; left: 6vw; right: 6vw; bottom: 6vh;
        border-radius: 18px; background: rgba(18,18,18,0.96);
        border: 1px solid rgba(255,255,255,0.10);
        box-shadow: 0 18px 50px rgba(0,0,0,0.55);
        display: flex; flex-direction: column; overflow: hidden;
      }
      .modalHeader {
        display: flex; align-items: center; gap: 10px;
        padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.08);
      }
      .modalTitle {
        font-size: 13px; color: rgba(255,255,255,0.9); font-weight: 600;
        overflow:hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60vw;
      }
      .modalBody {
        padding: 14px 16px; overflow: auto;
        color: rgba(255,255,255,0.86); font-size: 13px; line-height: 1.55;
      }
      .md h1, .md h2, .md h3 { margin: 14px 0 8px 0; }
      .md h1 { font-size: 20px; }
      .md h2 { font-size: 16px; }
      .md h3 { font-size: 14px; }
      .md p { margin: 8px 0; }
      .md code { padding: 2px 6px; border-radius: 8px; background: rgba(255,255,255,0.08); }
      .md pre { padding: 12px; border-radius: 14px; background: rgba(255,255,255,0.07); overflow: auto; }
      .md pre code { background: transparent; padding: 0; }
      .md a { color: rgba(120,200,255,0.95); text-decoration: none; }
      .md a:hover { text-decoration: underline; }
      .md ul { margin: 8px 0 8px 18px; }
      .md hr { border: none; border-top: 1px solid rgba(255,255,255,0.12); margin: 14px 0; }
    `;
    document.head.appendChild(style);
  }

  function ensureToolbar() {
    if (document.getElementById("sddaiToolbar")) return;
    injectCssOnce();

    const bar = document.createElement("div");
    bar.id = "sddaiToolbar";
    bar.className = "toolbar";
    bar.innerHTML = `
      <button id="btnBack" class="btn" title="Back">← Back</button>
      <button id="btnHome" class="btn" title="Home">⌂ Home</button>
      <div id="crumb" class="crumb"></div>
      <div class="spacer"></div>
      <div id="viewBadge" class="badge">Summary</div>
    `;
    document.body.appendChild(bar);

    const modal = document.createElement("div");
    modal.id = "previewModal";
    modal.className = "modal hidden";
    modal.innerHTML = `
      <div class="modalBackdrop"></div>
      <div class="modalPanel">
        <div class="modalHeader">
          <div id="previewTitle" class="modalTitle">Preview</div>
          <div class="spacer"></div>
          <button id="btnOpenExternal" class="btn">Open External</button>
          <button id="btnClosePreview" class="btn danger">Close ✕</button>
        </div>
        <div id="previewBody" class="modalBody"></div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  // ---------- Styles (graph) ----------
  const STYLE = [
    { selector: "core", style: { "background-color": "#0b0f14" } },
    {
      selector: "node",
      style: {
        "shape": "round-rectangle",
        "background-color": "#1b2430",
        "border-width": 1,
        "border-color": "#2b3a4a",
        "color": "#e6edf3",
        "font-size": 12,
        "text-wrap": "wrap",
        "text-max-width": 160,
        "text-halign": "center",
        "text-valign": "center",
        "label": "data(label)",
        "text-outline-width": 2,
        "text-outline-color": "#0b0f14",
        "text-background-color": "#0b0f14",
        "text-background-opacity": 0.6,
        "text-background-padding": 3,
        "width": 200,
        "height": 72,
        "padding": 6,
      }
    },
    {
      selector: 'node[kind = "Category"]',
      style: {
        "background-color": "#163d2b",
        "border-color": "#2ad67a",
        "border-width": 2,
        "width": 260,
        "height": 140,
        "font-size": 16,
        "text-max-width": 220,
        "text-background-opacity": 0.0
      }
    },
    {
      selector: 'node[pinned = "true"]',
      style: { "border-color": "#7aa2f7", "border-width": 2 }
    },
    {
      selector: "node:selected",
      style: { "border-color": "#f7b955", "border-width": 3 }
    },
    {
      selector: "edge",
      style: {
        "curve-style": "bezier",
        "line-color": "#334155",
        "target-arrow-color": "#334155",
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.9,
        "width": 1,
        "opacity": 0.55
      }
    },
    { selector: 'edge[kind = "aggregate"]', style: { "width": 2, "opacity": 0.75 } },
    { selector: "node.labelHidden", style: { "label": "" } },
    { selector: "edge.edgeHidden", style: { "display": "none" } },
    { selector: "edge.edgeHiddenZoom", style: { "display": "none" } },
  ];

  ensureToolbar();

  // ---------- Cytoscape init ----------
  const cy = cytoscape({
    container,
    elements: [],
    style: STYLE,
    layout: { name: "preset" }, // HARD RULE
    wheelSensitivity: 0.15,
    minZoom: 0.1,
    maxZoom: 2.5
  });

  // ---------- LOD / Performance ----------
  const PERF_EDGE_FOCUS_THRESHOLD = 420;
  const PERF_EDGE_HIDE_ZOOM = 0.38;
  const PERF_LABEL_HIDE_ZOOM = 0.28;

  let perfFocusEdges = false;
  let perfZoomState = { edgesHidden: false, labelsHidden: false };
  let perfZoomTimer = null;

  function perfEnableFocusEdges() {
    perfFocusEdges = true;
    cy.edges().addClass("edgeHidden");
  }

  function perfDisableFocusEdges() {
    perfFocusEdges = false;
    cy.edges().removeClass("edgeHidden");
  }

  function perfApplyFocusEdgesForNode(node) {
    if (!perfFocusEdges) return;
    if (!node || !node.isNode()) return;
    cy.edges().addClass("edgeHidden");
    node.connectedEdges().removeClass("edgeHidden");
  }

  function perfUpdateZoomLOD() {
    const z = cy.zoom();

    const hideEdges = z < PERF_EDGE_HIDE_ZOOM;
    if (hideEdges !== perfZoomState.edgesHidden) {
      perfZoomState.edgesHidden = hideEdges;
      if (hideEdges) cy.edges().addClass("edgeHiddenZoom");
      else cy.edges().removeClass("edgeHiddenZoom");
    }

    const hideLabels = z < PERF_LABEL_HIDE_ZOOM;
    if (hideLabels !== perfZoomState.labelsHidden) {
      perfZoomState.labelsHidden = hideLabels;
      if (hideLabels) cy.nodes().addClass("labelHidden");
      else cy.nodes().removeClass("labelHidden");
    }
  }

  function perfThrottleZoomLOD() {
    if (perfZoomTimer) return;
    perfZoomTimer = setTimeout(function () {
      perfZoomTimer = null;
      perfUpdateZoomLOD();
    }, 70);
  }
  cy.on("zoom", perfThrottleZoomLOD);

  // ---------- State (Back/Home) ----------
  const viewStack = [];
  let currentView = "Summary";
  let currentFocus = "";
  let lastGraphPayload = null;

  function setToolbar(view, focus) {
    currentView = safeStr(view) || currentView;
    currentFocus = safeStr(focus) || currentFocus;

    const badge = document.getElementById("viewBadge");
    if (badge) badge.textContent = currentView || "View";

    const crumb = document.getElementById("crumb");
    if (crumb) {
      const parts = [];
      for (const it of viewStack) {
        const v = safeStr(it.view);
        const f = safeStr(it.focus);
        parts.push(f ? `${v}:${f}` : v);
      }
      const cur = currentFocus ? `${currentView}:${currentFocus}` : `${currentView}`;
      parts.push(cur);
      crumb.textContent = parts.join("  ›  ");
    }

    const backBtn = document.getElementById("btnBack");
    if (backBtn) backBtn.disabled = (viewStack.length === 0);
  }

  function pushView(payload, view, focus) {
    viewStack.push({ payload, view: safeStr(view), focus: safeStr(focus) });
    setToolbar(currentView, currentFocus);
  }

  function popView() {
    if (viewStack.length === 0) return null;
    const it = viewStack.pop();
    setToolbar(currentView, currentFocus);
    return it;
  }

  function goBack() {
    const it = popView();
    if (!it || !it.payload) return;
    renderGraph(it.payload, it.view, it.focus);
  }

  function goHome() {
    viewStack.length = 0;
    requestAndRender("Summary", "", true);
  }

  // ---------- Preview Modal (Rendered Markdown) ----------
  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function renderMarkdownLite(mdText) {
    const src = String(mdText || "").replaceAll("\r\n", "\n");
    const lines = src.split("\n");

    let out = [];
    let inCode = false;
    let codeBuf = [];

    function flushCode() {
      if (!inCode) return;
      const code = escapeHtml(codeBuf.join("\n"));
      out.push(`<pre><code>${code}</code></pre>`);
      inCode = false;
      codeBuf = [];
    }

    function inlineFmt(s) {
      let t = escapeHtml(s);
      t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
      t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
      t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      t = t.replace(/\*([^*]+)\*/g, "<em>$1</em>");
      return t;
    }

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      const mFence = line.match(/^```\s*([\w-]+)?\s*$/);
      if (mFence) {
        if (inCode) flushCode();
        else { inCode = true; codeBuf = []; }
        i++; continue;
      }

      if (inCode) { codeBuf.push(line); i++; continue; }

      if (/^\s*---\s*$/.test(line) || /^\s*\*\*\*\s*$/.test(line)) { out.push("<hr/>"); i++; continue; }

      const mH1 = line.match(/^#\s+(.+)$/);
      const mH2 = line.match(/^##\s+(.+)$/);
      const mH3 = line.match(/^###\s+(.+)$/);
      if (mH1) { out.push(`<h1>${inlineFmt(mH1[1])}</h1>`); i++; continue; }
      if (mH2) { out.push(`<h2>${inlineFmt(mH2[1])}</h2>`); i++; continue; }
      if (mH3) { out.push(`<h3>${inlineFmt(mH3[1])}</h3>`); i++; continue; }

      if (/^\s*[-*]\s+/.test(line)) {
        let items = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          items.push(`<li>${inlineFmt(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>`);
          i++;
        }
        out.push("<ul>" + items.join("") + "</ul>");
        continue;
      }

      if (/^\s*$/.test(line)) { out.push(""); i++; continue; }

      out.push(`<p>${inlineFmt(line)}</p>`);
      i++;
    }

    flushCode();
    return `<div class="md">${out.join("\n")}</div>`;
  }

  function showPreviewModal(title, htmlBody, openExternalPath) {
    const modal = document.getElementById("previewModal");
    const t = document.getElementById("previewTitle");
    const b = document.getElementById("previewBody");
    const btnOpen = document.getElementById("btnOpenExternal");

    if (t) t.textContent = safeStr(title) || "Preview";
    if (b) b.innerHTML = htmlBody || "";
    if (btnOpen) {
      btnOpen.style.display = openExternalPath ? "" : "none";
      btnOpen.onclick = function () {
        const bridge = window.__sddai_bridge;
        if (bridge && bridge.openPath && openExternalPath) bridge.openPath(openExternalPath);
      };
    }

    if (modal) modal.classList.remove("hidden");
  }

  function hidePreviewModal() {
    const modal = document.getElementById("previewModal");
    if (modal) modal.classList.add("hidden");
  }

  function previewViaBridge(path) {
    const pth = safeStr(path);
    if (!pth) return false;
    const bridge = window.__sddai_bridge || window.bridge;
    try {
      if (bridge && typeof bridge.openPath === "function") {
        bridge.openPath(pth);
        return true;
      }
    } catch (e) {
      console.error("[preview] openPath failed", e);
      return false;
    }
    console.warn("[preview] bridge.openPath not available");
    return false;
  }
  window.sddaiPreviewPath = previewViaBridge;

  function openRenderedPreview(d) {
    const path = safeStr(d.path || d.relPath || (d.meta && d.meta.path) || "");
    if (previewViaBridge(path)) return;

    showPreviewModal(
      `${d.fullLabel || d.label || d.id}`,
      `<div class="md"><p>Preview requires native bridge.openPath().</p>${path ? `<p><code>${escapeHtml(path)}</code></p>` : ""}</div>`,
      ""
    );
  }

  // ---------- Inspector (optional) ----------
  function setInspector(html) {
    const el = document.getElementById("inspector");
    if (!el) return;
    el.innerHTML = html;
  }

  function renderInspector(d) {
    const full = safeStr(d.fullLabel || d.label || d.id);
    const path = safeStr(d.path || "");
    const kind = safeStr(d.kind || d.type || "");
    const tier = safeStr(d.tier || "");
    const mutable = safeStr(d.mutable || "");
    setInspector(
      `<div style="font-family: ui-sans-serif, system-ui; font-size: 12px; line-height: 1.3;">
        <div style="font-size:14px; font-weight:700; margin-bottom:6px;">${full}</div>
        <div><b>id</b>: ${safeStr(d.id)}</div>
        ${kind ? `<div><b>kind</b>: ${kind}</div>` : ""}
        ${tier ? `<div><b>tier</b>: ${tier}</div>` : ""}
        ${mutable ? `<div><b>mutable</b>: ${mutable}</div>` : ""}
        ${path ? `<div style="margin-top:6px;"><b>path</b>: <code>${path}</code></div>` : ""}
      </div>`
    );
  }

  // ---------- Hard Summary (never overlaps) ----------
  function buildHardSummary() {
    const GAP_X = 520, GAP_Y = 320, ORIGIN_X = 0, ORIGIN_Y = 0;

    const cats = [
      { id: "cat.Docs",      fullLabel: "Docs",      kind: "Category", tier: "core",     mutable: "true",  pinned: "true",  category: "Docs" },
      { id: "cat.Modules",   fullLabel: "Modules",   kind: "Category", tier: "core",     mutable: "true",  pinned: "true",  category: "Modules" },
      { id: "cat.Contracts", fullLabel: "Contracts", kind: "Category", tier: "core",     mutable: "true",  pinned: "true",  category: "Contracts" },
      { id: "cat.Meta",      fullLabel: "Meta",      kind: "Category", tier: "settings", mutable: "false", pinned: "false", category: "Meta" },
      { id: "cat.Runs",      fullLabel: "Runs",      kind: "Category", tier: "settings", mutable: "false", pinned: "false", category: "Runs" },
      { id: "cat.Gates",     fullLabel: "Gates",     kind: "Category", tier: "settings", mutable: "false", pinned: "false", category: "Gates" },
    ];

    const positions = [
      { x: ORIGIN_X + 0 * GAP_X, y: ORIGIN_Y + 0 * GAP_Y },
      { x: ORIGIN_X + 1 * GAP_X, y: ORIGIN_Y + 0 * GAP_Y },
      { x: ORIGIN_X + 2 * GAP_X, y: ORIGIN_Y + 0 * GAP_Y },
      { x: ORIGIN_X + 0 * GAP_X, y: ORIGIN_Y + 1 * GAP_Y },
      { x: ORIGIN_X + 1 * GAP_X, y: ORIGIN_Y + 1 * GAP_Y },
      { x: ORIGIN_X + 2 * GAP_X, y: ORIGIN_Y + 1 * GAP_Y },
    ];

    const nodes = cats.map((c, i) => ({
      data: {
        id: c.id,
        fullLabel: c.fullLabel,
        label: shortLabel(c.fullLabel),
        kind: c.kind,
        tier: c.tier,
        mutable: c.mutable,
        pinned: c.pinned,
        category: c.category,
        view: "Summary",
      },
      position: positions[i]
    }));

    const edges = [
      { data: { id: "e_agg_1", source: "cat.Modules", target: "cat.Contracts", kind: "aggregate" } }
    ];

    return normalizeGraphPayload({ nodes, edges, view: "Summary" });
  }

  // ---------- Render ----------
  function renderGraph(payload, forcedView, forcedFocus) {
    console.time("renderGraph.total");
    const view = inferView(payload, forcedView);
    const focus = safeStr(forcedFocus);

    lastGraphPayload = payload;
    currentView = view;
    currentFocus = focus;
    setToolbar(view, focus);

    let g = normalizeGraphPayload(payload);
    const nodeCount = (g.nodes || []).length;
    const edgeCount = (g.edges || []).length;
    const denseGraph = nodeCount > 400 || edgeCount > 800;

    // Layout choice: 若大量节点缺位则用同心蛛网布局，否则尊重后端坐标
    const missingPos = (g.nodes || []).filter(n => !(n.position && typeof n.position.x === "number" && typeof n.position.y === "number")).length;
    const needRadial = missingPos > (nodeCount * 0.2);

    if (!needRadial) {
      g = ensurePositionsHard(g, view);
    }
    g.edges = filterEdgesByView(g, view);

    cy.batch(() => {
      cy.elements().remove();
      cy.add((g.nodes || []).map(n => { n.data = n.data || {}; n.data.weight = n.data.weight || 1; return n; }));
      cy.add((g.edges || []).map(e => { e.data = e.data || {}; e.data.weight = e.data.weight || 1; return e; }));
    });

    if (needRadial) {
      const center = cy.nodes().filter(n => n.data("kind") === "Category").first() || cy.nodes().first();
      cy.layout({
        name: "concentric",
        animate: false,
        concentric: n => (n.id() === center.id() ? 200 : 100 + (n.data("tier") ? 40 : 0)),
        levelWidth: () => 40,
        spacingFactor: 1.05,
        padding: 60
      }).run();
    } else {
      cy.layout({ name: "preset", fit: true, padding: 70, animate: false }).run();
    }
    cy.fit(undefined, 80);

    // PERF: decide focus-edges based on edge count (only for non-Summary views)
    if (currentView !== "Summary" && edgeCount > PERF_EDGE_FOCUS_THRESHOLD) {
      perfEnableFocusEdges();
    } else {
      perfDisableFocusEdges();
    }

    // Dense graph LOD:隐藏部分标签
    if (denseGraph) {
      cy.nodes().addClass("labelHidden");
    }

    // Apply zoom-based LOD once after render
    perfUpdateZoomLOD();
    console.timeEnd("renderGraph.total");
  }

  // ---------- Bridge integration ----------
  function requestAndRender(view, focus, allowFallback) {
    const bridge = window.__sddai_bridge;
    if (!(bridge && bridge.requestGraph)) {
      if (allowFallback) renderGraph(buildHardSummary(), "Summary", "");
      return;
    }
    bridge.requestGraph(view, focus, function (jsonStr) {
      try {
        const payload = JSON.parse(jsonStr);
        renderGraph(payload, view, focus);
      } catch (e) {
        console.warn("[web] requestGraph parse failed", e);
        if (allowFallback) renderGraph(buildHardSummary(), "Summary", "");
      }
    });
  }

  function tryBootstrapFromBridge() {
    if (!(window.qt && window.qt.webChannelTransport)) return false;
    try {
      new QWebChannel(window.qt.webChannelTransport, function (channel) {
        const bridge = channel.objects.bridge || channel.objects.backend || channel.objects.SDDABridge;
        window.__sddai_bridge = bridge;
        window.bridge = bridge;
        requestAndRender("Summary", "", true);
      });
      return true;
    } catch (e) {
      console.warn("[web] QWebChannel init failed", e);
      return false;
    }
  }

  // ---------- Drill-down mapping ----------
  function requestForCategoryNode(d) {
    const key = safeStr(d.category || d.id).replace(/^cat\./, "").replace(/^category\./, "");

    if (key === "Docs") return { view: "Docs", focus: key };
    if (key === "Contracts") return { view: "Contracts", focus: key };
    if (key === "Modules") return { view: "Pipeline", focus: key };
    if (key === "Meta") return { view: "Meta", focus: key };
    if (key === "Runs") return { view: "Runs", focus: key };
    if (key === "Gates") return { view: "Gates", focus: key };

    return { view: "Pipeline", focus: key || safeStr(d.id) };
  }

  function doDrillDown(d) {
    pushView(lastGraphPayload, currentView, currentFocus);
    const req = requestForCategoryNode(d);
    requestAndRender(req.view, req.focus, false);
  }

  // ---------- Interactions ----------
  let __tapTimer = null;
  let __lastTapId = "";
  let __lastTapAt = 0;

  function handleSingleClick(d) {
    renderInspector(d);

    // PERF: focus edges on clicked node (if enabled)
    try { perfApplyFocusEdgesForNode(cy.$id(d.id)); } catch (e) {}

    if (d.kind === "Category") { doDrillDown(d); return; }
    openRenderedPreview(d);
  }

  function handleDoubleClick(d) {
    if (d.kind === "Category") { doDrillDown(d); return; }
    openRenderedPreview(d);
  }

  cy.on("tap", "node", function (evt) {
    const d = evt.target.data();
    const now = Date.now();

    if (__lastTapId === d.id && (now - __lastTapAt) <= 280) {
      __lastTapId = "";
      __lastTapAt = 0;
      if (__tapTimer) { clearTimeout(__tapTimer); __tapTimer = null; }
      handleDoubleClick(d);
      return;
    }

    __lastTapId = d.id;
    __lastTapAt = now;

    if (__tapTimer) { clearTimeout(__tapTimer); __tapTimer = null; }
    __tapTimer = setTimeout(function () {
      __tapTimer = null;
      handleSingleClick(d);
    }, 260);
  });

  cy.on("dbltap", "node", function (evt) {
    const d = evt.target.data();
    if (__tapTimer) { clearTimeout(__tapTimer); __tapTimer = null; }
    handleDoubleClick(d);
  });

  cy.on("tap", function (evt) {
    if (evt.target === cy) setInspector("");
  });

  // ---------- Toolbar bindings + keyboard ----------
  const btnBack = document.getElementById("btnBack");
  if (btnBack) btnBack.addEventListener("click", goBack);

  const btnHome = document.getElementById("btnHome");
  if (btnHome) btnHome.addEventListener("click", goHome);

  const btnClose = document.getElementById("btnClosePreview");
  if (btnClose) btnClose.addEventListener("click", hidePreviewModal);

  const modal = document.getElementById("previewModal");
  if (modal) {
    const backdrop = modal.querySelector(".modalBackdrop");
    if (backdrop) backdrop.addEventListener("click", hidePreviewModal);
  }

  window.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { hidePreviewModal(); return; }
    if ((e.altKey && e.key === "ArrowLeft") || e.key === "Backspace") { goBack(); }
    if (e.key === "h" || e.key === "H") {
      if (perfFocusEdges) perfDisableFocusEdges(); else perfEnableFocusEdges();
      perfUpdateZoomLOD();
    }
  });

  // ---------- Boot ----------
  if (!tryBootstrapFromBridge()) {
    renderGraph(buildHardSummary(), "Summary", "");
  }
})();