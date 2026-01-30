/* spider_v5.js - canvas-first
   Click: select
   Click again (same node within 650ms) OR Double-click: drill down
   Ctrl+Click: open (delegate)
   Main labels shown by default (importance-based)
   Details panel is optional, docked, never overlays canvas
*/
(() => {
  const canvas = document.getElementById("c");
  const wrap = document.getElementById("canvasWrap");
  const panel = document.getElementById("panel");
  const panelBody = document.getElementById("panelBody");
  const crumb = document.getElementById("crumb");

  const btnBack = document.getElementById("btnBack");
  const btnUp = document.getElementById("btnUp");
  const btnHome = document.getElementById("btnHome");
  const btnDetails = document.getElementById("btnDetails");
  const btnClosePanel = document.getElementById("btnClosePanel");

  const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

  const state = {
    graph: { nodes: [], links: [] },
    nodesById: new Map(),
    links: [],
    rootId: null,
    stack: [],
    viewNodeIds: new Set(),
    viewLinks: [],
    pos: new Map(),
    depthOf: new Map(),
    parentOf: new Map(),
    mainLabelSet: new Set(),
    hoveredId: null,
    selectedId: null,
    lastClickId: null,
    lastClickT: 0,
    panX: 0, panY: 0, zoom: 1.0,
    isPanning: false,
    panStart: {x:0,y:0, panX:0, panY:0},
    maxDepth: 2,
    maxNodes: 240,
    mainLabels: 60,
    clickAgainMs: 650,
  };

  window.__SPIDER_DEBUG__ = {
    get nodesVisible(){ return state.viewNodeIds.size; },
    get edgesVisible(){ return state.viewLinks.length; },
    get selectedId(){ return state.selectedId; },
    get hoveredId(){ return state.hoveredId; },
    get rootId(){ return state.rootId; },
  };

  function resizeCanvas() {
    const r = wrap.getBoundingClientRect();
    canvas.width = Math.floor(r.width * DPR);
    canvas.height = Math.floor(r.height * DPR);
    canvas.style.width = r.width + "px";
    canvas.style.height = r.height + "px";
    draw();
  }

  const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
  const getNode = (id)=>state.nodesById.get(id)||null;
  const safeStr = (x)=>(x===undefined||x===null)?"":String(x);

  function importance(n){
    const v = n.importance;
    if (typeof v==="number" && isFinite(v)) return v;
    const d = n.degree;
    if (typeof d==="number" && isFinite(d)) return d;
    return 0;
  }
  function nodeLabel(n){ return safeStr(n.label||n.name||n.title||n.id); }
  function nodePath(n){ return safeStr(n.path||n.file||n.uri||n.id); }

  function parentPathOfPath(p){
    if (!p) return "";
    let s = p.replace(/\\/g,"/");
    if (s.endsWith("/")) s = s.slice(0,-1);
    const idx = s.lastIndexOf("/");
    if (idx<=0) return "";
    return s.slice(0, idx+1);
  }

  function tryBuildParentMap(){
    const pathToId = new Map();
    for (const n of state.graph.nodes){
      const p = nodePath(n);
      if (p) pathToId.set(p, n.id);
      if (p) pathToId.set(p.replace(/\\/g,"/"), n.id);
    }
    for (const n of state.graph.nodes){
      const p = nodePath(n).replace(/\\/g,"/");
      const pp = parentPathOfPath(p);
      const pid = pathToId.get(pp);
      if (pid) state.parentOf.set(n.id, pid);
    }
  }

  function openPath(path, node){
    const payload = { path, id: node?.id, label: node ? nodeLabel(node) : "" };
    window.dispatchEvent(new CustomEvent("sddai:open", { detail: payload }));
    try { window.SDDAI?.openPath?.(path); return; } catch {}
    try { window.qt?.bridge?.openPath?.(path); return; } catch {}
    try { window.pywebview?.api?.open_path?.(path); return; } catch {}
    try { window.external?.invoke?.(JSON.stringify({ type:"open", ...payload })); return; } catch {}
    try { window.location.href = "sddai://open?path=" + encodeURIComponent(path); } catch {}
  }

  async function fetchJsonCandidates(candidates){
    for (const url of candidates){
      try{
        const r = await fetch(url, { cache:"no-store" });
        if (!r.ok) continue;
        const j = await r.json();
        if (j && (Array.isArray(j.nodes) || Array.isArray(j.links))) return j;
      }catch(e){}
    }
    return null;
  }

  async function loadGraph(){
    if (window.__SDDAI_GRAPH__ && (window.__SDDAI_GRAPH__.nodes || window.__SDDAI_GRAPH__.links)) return window.__SDDAI_GRAPH__;
    const j = await fetchJsonCandidates(["./graph.json","./graph_data.json","./graph_nodes_links.json","../graph.json","../graph_data.json"]);
    if (j) return j;
    return {
      nodes: [
        {id:"root", label:"Welcome", path:"/", group:"dir", tier:"P0", importance:10},
        {id:"dir:specs/", label:"specs", path:"specs/", group:"dir", tier:"P1", importance:9},
        {id:"dir:specs/modules/", label:"modules", path:"specs/modules/", group:"dir", tier:"P2", importance:7},
        {id:"dir:specs/modules/graph_builder/", label:"graph_builder", path:"specs/modules/graph_builder/", group:"dir", tier:"P2", importance:6},
        {id:"dir:specs/modules/view_manager/", label:"view_manager", path:"specs/modules/view_manager/", group:"dir", tier:"P2", importance:6},
        {id:"file:specs/modules/graph_builder/spec.md", label:"spec.md", path:"specs/modules/graph_builder/spec.md", group:"file", tier:"P3", importance:4},
      ],
      links: [
        {source:"root", target:"dir:specs/"},
        {source:"dir:specs/", target:"dir:specs/modules/"},
        {source:"dir:specs/modules/", target:"dir:specs/modules/graph_builder/"},
        {source:"dir:specs/modules/", target:"dir:specs/modules/view_manager/"},
        {source:"dir:specs/modules/graph_builder/", target:"file:specs/modules/graph_builder/spec.md"},
      ]
    };
  }

  function normalizeGraph(g){
    const nodes = Array.isArray(g.nodes) ? g.nodes : [];
    const links = Array.isArray(g.links) ? g.links : (Array.isArray(g.edges) ? g.edges : []);
    state.graph = { nodes, links };
    state.nodesById.clear();
    for (const n of nodes){ if (n.id) state.nodesById.set(n.id, n); }
    state.links = links.map(e=>{
      const s = (typeof e.source==="object" && e.source) ? e.source.id : e.source;
      const t = (typeof e.target==="object" && e.target) ? e.target.id : e.target;
      return { source:s, target:t, weight:e.weight||1 };
    }).filter(e=>e.source && e.target && state.nodesById.has(e.source) && state.nodesById.has(e.target));
    tryBuildParentMap();
  }

  function pickDefaultRoot(){
    for (const id of ["dir:specs/","specs/","root"]){ if (state.nodesById.has(id)) return id; }
    return state.graph.nodes[0]?.id ?? null;
  }

  function buildAdj(){
    const adj = new Map();
    for (const n of state.graph.nodes) adj.set(n.id, []);
    for (const e of state.links){
      adj.get(e.source)?.push(e.target);
      adj.get(e.target)?.push(e.source);
    }
    return adj;
  }

  function buildView(rootId){
    const adj = buildAdj();
    state.viewNodeIds.clear();
    state.depthOf.clear();

    const q=[rootId];
    state.depthOf.set(rootId,0);
    state.viewNodeIds.add(rootId);

    while(q.length){
      const id=q.shift();
      const d=state.depthOf.get(id) ?? 0;
      if (d>=state.maxDepth) continue;
      const neigh=(adj.get(id)||[]).slice().sort((a,b)=>importance(getNode(b)||{})-importance(getNode(a)||{}));
      for (const nb of neigh){
        if (state.viewNodeIds.size>=state.maxNodes) break;
        if (!state.viewNodeIds.has(nb)){
          state.viewNodeIds.add(nb);
          state.depthOf.set(nb,d+1);
          q.push(nb);
        }
      }
    }

    state.viewLinks = state.links.filter(e=>state.viewNodeIds.has(e.source)&&state.viewNodeIds.has(e.target));

    const ids = Array.from(state.viewNodeIds).sort((a,b)=>importance(getNode(b)||{})-importance(getNode(a)||{}));
    state.mainLabelSet = new Set(ids.slice(0, Math.min(state.mainLabels, ids.length)));
    state.mainLabelSet.add(rootId);
    for (const e of state.viewLinks){
      if (e.source===rootId) state.mainLabelSet.add(e.target);
      if (e.target===rootId) state.mainLabelSet.add(e.source);
    }

    layoutView(rootId);
    updateBreadcrumb();
    if (!panel.classList.contains("hidden") && state.selectedId) renderPanel(state.selectedId);
    draw();
  }


function forceRelax(rootId){
  // Lightweight force relaxation: keeps ring structure but makes it more organic.
  const ids = Array.from(state.viewNodeIds);
  const N = ids.length;
  if (N <= 2) return;

  const W = canvas.width / DPR, H = canvas.height / DPR;
  const cx = W/2, cy = H/2;

  const x = new Array(N), y = new Array(N), vx = new Array(N), vy = new Array(N), depth = new Array(N);
  const idx = new Map();
  for (let i=0;i<N;i++){
    const id = ids[i];
    idx.set(id, i);
    const p = state.pos.get(id);
    x[i] = p?.x ?? cx;
    y[i] = p?.y ?? cy;
    vx[i] = 0; vy[i] = 0;
    depth[i] = state.depthOf.get(id) ?? 0;
  }

  const repK = 9000;
  const springK = 0.010;
  const radialK = 0.030;
  const damp = 0.85;
  const dt = 1.0;
  const iters = Math.min(90, Math.max(40, Math.floor(N/2)));

  const baseR = Math.min(W, H) * 0.10;
  const stepR = Math.min(W, H) * 0.16;
  const ringR = (d)=> (d<=0 ? 0 : (baseR + (d-1)*stepR));

  const edges = [];
  for (const e of state.viewLinks){
    const a = idx.get(e.source);
    const b = idx.get(e.target);
    if (a===undefined || b===undefined) continue;
    edges.push([a,b]);
  }

  for (let it=0; it<iters; it++){
    for (let i=0;i<N;i++){ vx[i]*=damp; vy[i]*=damp; }

    for (let i=0;i<N;i++){
      for (let j=i+1;j<N;j++){
        const dx = x[i]-x[j];
        const dy = y[i]-y[j];
        const d2 = dx*dx + dy*dy + 0.01;
        const f = repK / d2;
        const fx = f * dx;
        const fy = f * dy;
        vx[i] += fx; vy[i] += fy;
        vx[j] -= fx; vy[j] -= fy;
      }
    }

    const springLen = Math.min(W,H) * 0.12;
    for (let k=0;k<edges.length;k++){
      const a = edges[k][0], b = edges[k][1];
      const dx = x[b]-x[a];
      const dy = y[b]-y[a];
      const d = Math.sqrt(dx*dx + dy*dy) + 1e-6;
      const f = (d - springLen) * springK;
      const fx = f * dx / d;
      const fy = f * dy / d;
      vx[a] += fx; vy[a] += fy;
      vx[b] -= fx; vy[b] -= fy;
    }

    for (let i=0;i<N;i++){
      const d = depth[i];
      if (d<=0) continue;
      const tx = x[i]-cx;
      const ty = y[i]-cy;
      const r = Math.sqrt(tx*tx + ty*ty) + 1e-6;
      const tr = ringR(d);
      const f = (r - tr) * radialK;
      vx[i] -= f * tx / r;
      vy[i] -= f * ty / r;
    }

    for (let i=0;i<N;i++){
      x[i] += vx[i]*dt;
      y[i] += vy[i]*dt;
    }
  }

  const ri = idx.get(rootId);
  if (ri !== undefined){
    const dx = cx - x[ri];
    const dy = cy - y[ri];
    for (let i=0;i<N;i++){ x[i] += dx; y[i] += dy; }
  }

  for (let i=0;i<N;i++){
    const id = ids[i];
    const p = state.pos.get(id);
    if (!p) continue;
    state.pos.set(id, { x:x[i], y:y[i], depth:p.depth });
  }
}

  function layoutView(rootId){
    state.pos.clear();
    const W=canvas.width/DPR, H=canvas.height/DPR;
    const cx=W/2, cy=H/2;

    const byDepth=new Map();
    for (const id of state.viewNodeIds){
      const d=state.depthOf.get(id) ?? 99;
      if (!byDepth.has(d)) byDepth.set(d,[]);
      byDepth.get(d).push(id);
    }

    state.pos.set(rootId, {x:cx,y:cy,depth:0});
    const baseR=Math.min(W,H)*0.10;
    const stepR=Math.min(W,H)*0.16;

    for (let d=1; d<=state.maxDepth; d++){
      const ids=(byDepth.get(d)||[]).slice().sort((a,b)=>nodeLabel(getNode(a)||{id:a}).localeCompare(nodeLabel(getNode(b)||{id:b})));
      const n=ids.length||1;
      const R=baseR+(d-1)*stepR;
      for (let i=0;i<ids.length;i++){
        const ang=(i/n)*Math.PI*2;
        state.pos.set(ids[i], {x:cx+R*Math.cos(ang), y:cy+R*Math.sin(ang), depth:d});
      }
    }
    // Make layout more organic (without changing interaction)
    forceRelax(rootId);
    state.panX=0; state.panY=0; state.zoom=1.0;
  }

  function updateBreadcrumb(){
    const chain=[];
    let cur=state.rootId, guard=0;
    while(cur && guard++<20){ chain.push(cur); cur=state.parentOf.get(cur); }
    chain.reverse();
    crumb.innerHTML="";
    for (const id of chain){
      const n=getNode(id);
      const el=document.createElement("div");
      el.className="crumbItem";
      el.textContent=n?nodeLabel(n):id;
      crumb.appendChild(el);
    }
  }

  function kv(k,v){
    const box=document.createElement("div"); box.className="kv";
    const kk=document.createElement("div"); kk.className="k"; kk.textContent=k;
    const vv=document.createElement("div"); vv.className="v"; vv.textContent=safeStr(v);
    box.appendChild(kk); box.appendChild(vv);
    return box;
  }
  function badge(t){ const b=document.createElement("span"); b.className="badge"; b.textContent=t; return b; }

  function renderPanel(id){
    const n=getNode(id);
    panelBody.innerHTML="";
    if (!n){ panelBody.appendChild(kv("id",id)); return; }
    const top=document.createElement("div");
    top.appendChild(badge(safeStr(n.tier||"")));
    top.appendChild(badge(safeStr(n.group||"")));
    top.appendChild(badge("importance="+importance(n)));
    panelBody.appendChild(top);
    panelBody.appendChild(kv("label", nodeLabel(n)));
    panelBody.appendChild(kv("path", nodePath(n)));
    panelBody.appendChild(kv("id", n.id));
    if (n.meta) panelBody.appendChild(kv("meta", JSON.stringify(n.meta,null,2)));
  }

  function getCss(vn){ return getComputedStyle(document.documentElement).getPropertyValue(vn).trim(); }

  function screenToWorld(sx,sy){
    const W=canvas.width/DPR, H=canvas.height/DPR;
    const cx=W/2, cy=H/2;
    let x=(sx - cx - state.panX)/state.zoom + cx;
    let y=(sy - cy - state.panY)/state.zoom + cy;
    return {x,y};
  }

  function nodeRadius(n, hovered=false, selected=false){
    const base=6.3;
    const r=base + Math.sqrt(Math.max(0,importance(n))) * 1.1;
    return r * (hovered?1.55:1.0) * (selected?1.10:1.0);
  }

  function pickNodeAt(sx,sy){
    const p=screenToWorld(sx,sy);
    let best=null, bestD2=1e18;
    for (const id of state.viewNodeIds){
      const n=getNode(id), pos=state.pos.get(id);
      if (!n||!pos) continue;
      const r=nodeRadius(n)+6;
      const dx=p.x-pos.x, dy=p.y-pos.y;
      const d2=dx*dx+dy*dy;
      if (d2<=r*r && d2<bestD2){ bestD2=d2; best=id; }
    }
    return best;
  }

  function roundRect(ctx,x,y,w,h,r){
    const rr=Math.min(r,w/2,h/2);
    ctx.beginPath();
    ctx.moveTo(x+rr,y);
    ctx.arcTo(x+w,y,x+w,y+h,rr);
    ctx.arcTo(x+w,y+h,x,y+h,rr);
    ctx.arcTo(x,y+h,x,y,rr);
    ctx.arcTo(x,y,x+w,y,rr);
    ctx.closePath();
  }

  function drawWeb(ctx,w,h,cx,cy){
    const rings=5;
    const maxR=Math.min(w,h)*0.42;
    ctx.save();
    ctx.strokeStyle="rgba(180,200,255,.06)";
    ctx.lineWidth=1.0;
    for (let i=1;i<=rings;i++){
      ctx.beginPath(); ctx.arc(cx,cy,(i/rings)*maxR,0,Math.PI*2); ctx.stroke();
    }
    const rays=16;
    for (let i=0;i<rays;i++){
      const ang=(i/rays)*Math.PI*2;
      ctx.beginPath();
      ctx.moveTo(cx,cy);
      ctx.lineTo(cx+maxR*Math.cos(ang), cy+maxR*Math.sin(ang));
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawLabels(ctx){
    const zoom=state.zoom;
    ctx.save();
    ctx.font="12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto";
    ctx.textBaseline="middle";

    for (const id of state.viewNodeIds){
      const n=getNode(id), p=state.pos.get(id);
      if (!n||!p) continue;

      const force = state.mainLabelSet.has(id) || id===state.rootId || id===state.selectedId || id===state.hoveredId;
      if (!force && zoom<0.92) continue;

      const label=nodeLabel(n);
      const r=nodeRadius(n, id===state.hoveredId, id===state.selectedId);

      const padX=6;
      const tw=ctx.measureText(label).width;
      const bx=p.x + r + 7;
      const by=p.y;
      const bw=tw + padX*2;
      const bh=18;

      ctx.save();
      ctx.globalAlpha = force ? 0.85 : 0.0;
      roundRect(ctx,bx,by-bh/2,bw,bh,9);
      ctx.fillStyle="rgba(0,0,0,.35)";
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = force ? 1.0 : 0.78;
      ctx.fillStyle="rgba(255,255,255,.92)";
      ctx.fillText(label, bx+padX, by);
      ctx.restore();
    }
    ctx.restore();
  }

  function draw(){
    const ctx=canvas.getContext("2d");
    const W=canvas.width, H=canvas.height;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,W,H);

    const w=W/DPR, h=H/DPR;
    const cx=w/2, cy=h/2;

    ctx.scale(DPR,DPR);
    ctx.translate(cx+state.panX, cy+state.panY);
    ctx.scale(state.zoom, state.zoom);
    ctx.translate(-cx, -cy);

    drawWeb(ctx,w,h,cx,cy);

    for (const e of state.viewLinks){
      const a=state.pos.get(e.source), b=state.pos.get(e.target);
      if (!a||!b) continue;

      const isHi = (state.hoveredId && (e.source===state.hoveredId || e.target===state.hoveredId)) ||
                   (state.selectedId && (e.source===state.selectedId || e.target===state.selectedId));

      ctx.beginPath();
      ctx.moveTo(a.x,a.y);
      ctx.lineTo(b.x,b.y);
      ctx.lineWidth = isHi ? 2.1 : 1.0;
      ctx.strokeStyle = isHi ? getCss("--lineHi") : getCss("--line");
      ctx.stroke();
    }

    for (const id of state.viewNodeIds){
      const n=getNode(id), p=state.pos.get(id);
      if (!n||!p) continue;
      const hovered=id===state.hoveredId;
      const selected=id===state.selectedId;
      const r=nodeRadius(n, hovered, selected);

      ctx.beginPath();
      ctx.arc(p.x,p.y,r,0,Math.PI*2);
      ctx.fillStyle = selected ? getCss("--nodeSel") : getCss("--node");
      ctx.globalAlpha = hovered ? 1.0 : 0.92;
      ctx.fill();
      ctx.globalAlpha = 1.0;

      ctx.lineWidth = hovered ? 2.0 : 1.0;
      ctx.strokeStyle = hovered ? getCss("--accent") : "rgba(0,0,0,.25)";
      ctx.stroke();
    }

    drawLabels(ctx);
  }

  // --- Events ---
  canvas.addEventListener("mousemove", (ev)=>{
    const rect=canvas.getBoundingClientRect();
    const sx=ev.clientX-rect.left;
    const sy=ev.clientY-rect.top;
    const hit=pickNodeAt(sx,sy);
    if (hit!==state.hoveredId){
      state.hoveredId=hit;
      canvas.style.cursor = hit ? (ev.ctrlKey ? "alias" : "pointer") : "default";
      draw();
    } else {
      canvas.style.cursor = hit ? (ev.ctrlKey ? "alias" : "pointer") : "default";
    }
  });

  canvas.addEventListener("mouseleave", ()=>{
    state.hoveredId=null;
    canvas.style.cursor="default";
    draw();
  });

  canvas.addEventListener("mousedown", (ev)=>{
    if (ev.button===1 || ev.button===2 || (ev.button===0 && ev.getModifierState && ev.getModifierState("Space"))){
      state.isPanning=true;
      state.panStart.x=ev.clientX;
      state.panStart.y=ev.clientY;
      state.panStart.panX=state.panX;
      state.panStart.panY=state.panY;
      ev.preventDefault();
    }
  });

  window.addEventListener("mousemove", (ev)=>{
    if (!state.isPanning) return;
    const dx=ev.clientX-state.panStart.x;
    const dy=ev.clientY-state.panStart.y;
    state.panX=state.panStart.panX+dx;
    state.panY=state.panStart.panY+dy;
    draw();
  });

  window.addEventListener("mouseup", ()=>{ state.isPanning=false; });
  canvas.addEventListener("contextmenu", (ev)=>ev.preventDefault());

  canvas.addEventListener("wheel", (ev)=>{
    ev.preventDefault();
    const delta = -Math.sign(ev.deltaY) * 0.10;
    state.zoom = clamp(state.zoom*(1+delta), 0.35, 2.8);
    draw();
  }, {passive:false});

  canvas.addEventListener("dblclick", (ev)=>{
    const rect=canvas.getBoundingClientRect();
    const sx=ev.clientX-rect.left;
    const sy=ev.clientY-rect.top;
    const hit=pickNodeAt(sx,sy);
    if (hit) drillDown(hit);
  });

  canvas.addEventListener("click", (ev)=>{
    const rect=canvas.getBoundingClientRect();
    const sx=ev.clientX-rect.left;
    const sy=ev.clientY-rect.top;
    const hit=pickNodeAt(sx,sy);

    if (!hit){
      state.selectedId=null;
      if (!panel.classList.contains("hidden")) panelBody.innerHTML="";
      draw();
      return;
    }

    const n=getNode(hit);
    if (ev.ctrlKey){ openPath(nodePath(n), n); return; }

    const now=performance.now();
    const isSecond=(state.lastClickId===hit) && ((now-state.lastClickT)<=state.clickAgainMs);
    state.lastClickId=hit;
    state.lastClickT=now;

    if (isSecond){ drillDown(hit); return; }
    select(hit);
  });

  function select(id){
    state.selectedId=id;
    if (!panel.classList.contains("hidden")) renderPanel(id);
    draw();
  }

  function drillDown(id){
    if (!id) return;
    if (state.rootId) state.stack.push(state.rootId);
    state.rootId=id;
    state.selectedId=id;
    buildView(id);
  }

  function goBack(){
    const prev=state.stack.pop();
    if (!prev) return;
    state.rootId=prev;
    state.selectedId=prev;
    buildView(prev);
  }

  function goUp(){
    if (!state.rootId) return;
    const pid=state.parentOf.get(state.rootId);
    if (pid){
      state.stack.push(state.rootId);
      state.rootId=pid;
      state.selectedId=pid;
      buildView(pid);
    }
  }

  function goHome(){
    state.stack=[];
    const r=pickDefaultRoot();
    state.rootId=r;
    state.selectedId=r;
    buildView(r);
  }

  btnBack.addEventListener("click", goBack);
  btnUp.addEventListener("click", goUp);
  btnHome.addEventListener("click", goHome);
  btnDetails.addEventListener("click", ()=>{
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden") && state.selectedId) renderPanel(state.selectedId);
    resizeCanvas();
  });
  btnClosePanel.addEventListener("click", ()=>{
    panel.classList.add("hidden");
    resizeCanvas();
  });

  window.addEventListener("keydown", (ev)=>{
    if (ev.altKey && ev.key==="ArrowLeft"){ goBack(); return; }
    if (ev.key==="Backspace"){ goBack(); ev.preventDefault(); return; }
    if (ev.key.toLowerCase()==="u"){ goUp(); return; }
    if (ev.key.toLowerCase()==="h"){ goHome(); return; }
    if (ev.key.toLowerCase()==="d"){ panel.classList.toggle("hidden"); resizeCanvas(); return; }
    if (ev.key==="Enter" && state.selectedId){ drillDown(state.selectedId); return; }
  });

  async function init(){
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    const g=await loadGraph();
    normalizeGraph(g);

    const url=new URL(window.location.href);
    const focusId=url.searchParams.get("focus") || (new URLSearchParams((window.location.hash||"").replace(/^#/,""))).get("focus");
    const focusPath=url.searchParams.get("path") || (new URLSearchParams((window.location.hash||"").replace(/^#/,""))).get("path");

    let root=null;
    if (focusId && state.nodesById.has(focusId)) root=focusId;
    if (!root && focusPath){
      const fp=focusPath.replace(/\\/g,"/");
      for (const n of state.graph.nodes){
        const p=nodePath(n).replace(/\\/g,"/");
        if (p===fp){ root=n.id; break; }
      }
    }

    state.rootId = root || pickDefaultRoot();
    state.selectedId = state.rootId;
    panel.classList.add("hidden");
    buildView(state.rootId);
  }

  init();
})();
