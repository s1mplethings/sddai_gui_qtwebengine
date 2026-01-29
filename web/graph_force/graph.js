(function () {
  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d", { alpha: false });

  const statusEl = document.getElementById("status");
  const selEl = document.getElementById("sel");
  const searchEl = document.getElementById("search");

  let scale = 1.0;
  let offsetX = 0;
  let offsetY = 0;

  let isDown = false;
  let downX = 0, downY = 0;
  let draggingNode = null;

  let nodes = [];
  let links = [];

  let hovered = null;
  let selected = null;

  let bridge = null;
  let sim = null;

  function resize() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    render();
  }
  window.addEventListener("resize", resize);

  function worldToScreen(x, y) {
    return { x: x * scale + offsetX, y: y * scale + offsetY };
  }
  function screenToWorld(x, y) {
    return { x: (x - offsetX) / scale, y: (y - offsetY) / scale };
  }

  function pickNode(mx, my) {
    const p = screenToWorld(mx, my);
    let best = null;
    let bestD2 = Infinity;
    for (const n of nodes) {
      const r = (n.r || 6) + 6;
      const dx = p.x - n.x;
      const dy = p.y - n.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r && d2 < bestD2) {
        best = n;
        bestD2 = d2;
      }
    }
    return best;
  }

  function render() {
    const w = window.innerWidth;
    const h = window.innerHeight;

    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, w, h);

    ctx.lineWidth = 1;
    for (const e of links) {
      const s = e.source;
      const t = e.target;
      const a = (hovered && (s === hovered || t === hovered)) ? 0.9 : 0.25;
      ctx.strokeStyle = `rgba(200,200,200,${a})`;
      const p1 = worldToScreen(s.x, s.y);
      const p2 = worldToScreen(t.x, t.y);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    for (const n of nodes) {
      const p = worldToScreen(n.x, n.y);
      const baseR = n.r || 6;
      const r = (n === hovered || n === selected) ? baseR + 2 : baseR;
      const alpha = (n === hovered || n === selected) ? 0.95 : 0.75;

      ctx.fillStyle = `rgba(220,220,220,${alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = "14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.fillStyle = "rgba(245,245,245,0.92)";
      ctx.textBaseline = "middle";
      ctx.fillText(n.label ?? n.id, p.x + r + 8, p.y);
    }
  }

  async function loadGraphData() {
    if (bridge && typeof bridge.getGraphJson === "function") {
      try {
        const txt = await bridge.getGraphJson();
        const g = JSON.parse(txt);
        statusEl.textContent = "Qt graph loaded";
        return g;
      } catch (e) {}
    }
    try {
      const r = await fetch("./sample_graph.json", { cache: "no-store" });
      statusEl.textContent = "sample_graph.json loaded";
      return await r.json();
    } catch (e) {}
    statusEl.textContent = "inline fallback graph";
    return {
      nodes: [
        { id: "welcome", label: "Welcome" },
        { id: "create_link", label: "create a link" },
        { id: "main_character", label: "main character" },
        { id: "course", label: "选课推荐系统" }
      ],
      links: [{ source: "welcome", target: "create_link" }]
    };
  }

  function normalizeGraph(g) {
    const map = new Map();
    nodes = (g.nodes || []).map((n, i) => {
      const id = n.id ?? String(i);
      const obj = {
        id,
        label: n.label ?? id,
        path: n.path ?? "",
        r: n.r ?? 6,
        x: (n.x ?? (Math.random() - 0.5) * 400),
        y: (n.y ?? (Math.random() - 0.5) * 260),
        vx: 0,
        vy: 0,
        _fixed: false
      };
      map.set(id, obj);
      return obj;
    });

    links = (g.links || []).map(e => {
      const s = (typeof e.source === "string") ? map.get(e.source) : e.source;
      const t = (typeof e.target === "string") ? map.get(e.target) : e.target;
      return { source: s, target: t };
    }).filter(e => e.source && e.target);

    offsetX = window.innerWidth * 0.5;
    offsetY = window.innerHeight * 0.5;
    scale = 1.0;
  }

  function connectQtBridge() {
    try {
      if (typeof QWebChannel !== "undefined" && window.qt && qt.webChannelTransport) {
        new QWebChannel(qt.webChannelTransport, (channel) => {
          bridge = channel.objects.GraphBridge || channel.objects.bridge || null;
          statusEl.textContent = bridge ? "Qt bridge connected" : "Qt channel ok, bridge missing";
          boot();
        });
        return true;
      }
    } catch (_) {}
    return false;
  }

  function startSim() {
    if (!window.ForceSim) {
      statusEl.textContent = "ForceSim missing";
      return;
    }
    sim = new window.ForceSim(nodes, links).onTick(render);
    sim.restart();
    statusEl.textContent = `${statusEl.textContent} | nodes=${nodes.length} links=${links.length}`;
  }

  canvas.addEventListener("mousemove", (ev) => {
    const mx = ev.clientX, my = ev.clientY;
    if (isDown) {
      const dx = mx - downX;
      const dy = my - downY;
      if (draggingNode) {
        const p = screenToWorld(mx, my);
        draggingNode.x = p.x;
        draggingNode.y = p.y;
        draggingNode._fixed = true;
        if (sim) sim.restart();
      } else {
        offsetX += dx;
        offsetY += dy;
      }
      downX = mx;
      downY = my;
      render();
      return;
    }
    const hit = pickNode(mx, my);
    if (hit !== hovered) { hovered = hit; render(); }
  });

  canvas.addEventListener("mousedown", (ev) => {
    isDown = true;
    downX = ev.clientX;
    downY = ev.clientY;
    draggingNode = pickNode(downX, downY);
  });
  window.addEventListener("mouseup", () => { isDown = false; draggingNode = null; });

  canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const mx = ev.clientX, my = ev.clientY;
    const before = screenToWorld(mx, my);
    const z = Math.exp(-ev.deltaY * 0.001);
    scale = Math.min(3.5, Math.max(0.25, scale * z));
    const after = worldToScreen(before.x, before.y);
    offsetX += (mx - after.x);
    offsetY += (my - after.y);
    render();
  }, { passive: false });

  canvas.addEventListener("click", async (ev) => {
    const hit = pickNode(ev.clientX, ev.clientY);
    if (!hit) return;
    selected = hit;
    selEl.textContent = `selected: ${hit.label}${hit.path ? "  |  " + hit.path : ""}`;
    render();
    if (bridge && typeof bridge.openNode === "function") {
      try { await bridge.openNode(JSON.stringify(hit)); } catch (_) {}
    } else if (bridge && typeof bridge.openPath === "function") {
      try { await bridge.openPath(hit.path || hit.id); } catch (_) {}
    }
  });

  searchEl.addEventListener("input", () => {
    const q = (searchEl.value || "").trim().toLowerCase();
    if (!q) { hovered = null; render(); return; }
    hovered = nodes.find(n => (n.label || n.id).toLowerCase().includes(q)) || null;
    render();
  });

  async function boot() {
    const g = await loadGraphData();
    normalizeGraph(g);
    resize();
    startSim();
  }

  if (!connectQtBridge()) boot();
})();
