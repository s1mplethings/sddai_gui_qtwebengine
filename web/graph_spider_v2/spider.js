(() => {
  const c = document.getElementById("c");
  const ctx = c.getContext("2d", { alpha: false });
  const $status = document.getElementById("status");
  const $sel = document.getElementById("sel");
  const $crumb = document.getElementById("crumb");
  const $search = document.getElementById("search");
  const $btnOverview = document.getElementById("btnOverview");
  const $btnFocus = document.getElementById("btnFocus");
  const $btnReset = document.getElementById("btnReset");

  // -------- config (重要性分层 + 渐进显示) --------
  const CFG = {
    groupPrefix: "grp:",
    initialTopK: 20,
    perGroupMin: 3,
    expandTopN: 25,
    focusNeighborMax: 30,
    initGroupDepth: 1
  };

  // -------- view state --------
  let scale = 1, ox = 0, oy = 0;
  let dragging = false, dragNode = null, downX = 0, downY = 0;
  let hovered = null, selected = null;
  let mode = "overview"; // overview | focus

  // full graph (with derived groups)
  let fullNodes = [];
  let fullLinks = [];

  // visible subgraph
  let nodes = [];
  let links = [];

  // Qt bridge (optional)
  let bridge = null;

  const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
  const setStatus = (s)=>($status.textContent=s);
  const isGroup = (n)=>!!n.isGroup;
  const worldToScreen = (x,y)=>({x:x*scale+ox,y:y*scale+oy});
  const screenToWorld = (x,y)=>({x:(x-ox)/scale,y:(y-oy)/scale});

  // -------- minimal force sim (subgraph only) --------
  function tickSim(iter=1){
    const charge = -420, centerK = 0.0008, linkK = 0.18, linkLen = 120;
    for(let k=0;k<iter;k++){
      // repel
      for(let i=0;i<nodes.length;i++){
        for(let j=i+1;j<nodes.length;j++){
          const a = nodes[i], b = nodes[j];
          const dx = a.x-b.x, dy = a.y-b.y;
          const d2 = dx*dx+dy*dy+0.01;
          const f = (-charge/d2);
          const inv = 1/Math.sqrt(d2);
          const fx = dx*inv*f, fy = dy*inv*f;
          a.vx += fx; a.vy += fy;
          b.vx -= fx; b.vy -= fy;
        }
      }
      // links
      for(const e of links){
        const s=e.source, t=e.target;
        const dx=t.x-s.x, dy=t.y-s.y;
        const d=Math.sqrt(dx*dx+dy*dy)+0.001;
        const L=e.len||linkLen, K=e.k||linkK;
        const diff=d-L;
        const f=diff*K;
        const fx=(dx/d)*f, fy=(dy/d)*f;
        s.vx += fx; s.vy += fy;
        t.vx -= fx; t.vy -= fy;
      }
      // center + integrate
      for(const n of nodes){
        n.vx += (-n.x)*centerK;
        n.vy += (-n.y)*centerK;
        if(!n._fixed){
          n.x += (n.vx||0)*0.015; n.y += (n.vy||0)*0.015;
        }
        n.vx *= 0.90; n.vy *= 0.90;
      }
    }
  }

  // -------- importance (保持你之前“重要性分层”的逻辑) --------
  function degreeMap(leafNodes, linkArr){
    const deg = new Map(leafNodes.map(n=>[n.id,0]));
    for(const e of linkArr){
      const s = typeof e.source==="string"?e.source:e.source?.id;
      const t = typeof e.target==="string"?e.target:e.target?.id;
      if(s) deg.set(s,(deg.get(s)||0)+1);
      if(t) deg.set(t,(deg.get(t)||0)+1);
    }
    return deg;
  }
  function heuristicScore(n, deg){
    const label=(n.label||n.id||"").toLowerCase();
    const path=(n.path||"").toLowerCase();
    let w=0;
    const pins=["agent_protocol","playbook","readme","index","main","mainwindow","spec","verify","cli.py"];
    const mids=["recipe","webengine","qwebchannel","graph","bridge"];
    for(const p of pins) if(label.includes(p)||path.includes(p)) w+=6;
    for(const p of mids) if(label.includes(p)||path.includes(p)) w+=2;
    return (deg.get(n.id)||0)*0.6 + w;
  }
  function tierFromScore(sorted, v){
    if(!sorted.length) return "P2";
    const n=sorted.length;
    const p95=sorted[Math.floor(n*0.95)];
    const p80=sorted[Math.floor(n*0.80)];
    if(v>=p95) return "P1";
    if(v>=p80) return "P2";
    return "P3";
  }
  function radius(n){
    if(n.isGroup) return 12;
    if(n.tier==="P0") return 10;
    if(n.tier==="P1") return 8;
    if(n.tier==="P2") return 7;
    return 6;
  }
  function alpha(n){
    if(n===selected) return 0.95;
    if(n===hovered) return 0.92;
    if(n.isGroup) return 0.70;
    if(n.tier==="P0") return 0.90;
    if(n.tier==="P1") return 0.82;
    if(n.tier==="P2") return 0.70;
    return 0.55;
  }
  function showLabel(n){
    if(n.isGroup) return true;
    if(n.tier==="P0"||n.tier==="P1") return true;
    if(n===hovered||n===selected) return true;
    return false;
  }

  // -------- hierarchy derive (结构骨架节点) --------
  function deriveGroups(rawNodes){
    const groups = new Map();
    function ensure(parts){
      let parent="";
      for(let d=0; d<parts.length; d++){
        const seg=parts[d];
        const id=CFG.groupPrefix + parts.slice(0,d+1).join("/");
        if(!groups.has(id)){
          groups.set(id,{id,label:seg,isGroup:true,depth:d+1,parent,score:0,tier:"P2"});
        }
        parent=id;
      }
      return parent;
    }
    for(const n of rawNodes){
      if(n.parent) continue;
      if(!n.path) continue;
      const parts=n.path.replace(/\\/g,"/").split("/").filter(Boolean);
      if(parts.length<=1) continue;
      const dir=parts.slice(0,-1);
      const p=ensure(dir);
      if(p) n.parent=p;
    }
    return Array.from(groups.values());
  }

  function normalizeGraph(g){
    const rawNodes=(g.nodes||[]).map((x,i)=>({
      id: x.id ?? String(i),
      label: x.label ?? x.id ?? String(i),
      path: x.path ?? "",
      parent: x.parent ?? "",
      score: typeof x.score==="number"?x.score:null,
      tier: x.tier ?? ""
    }));
    const rawLinks=(g.links||[]).map(e=>({
      source: e.source,
      target: e.target
    }));
    const groupNodes=deriveGroups(rawNodes);
    const all=[];
    const map=new Map();
    for(const gn of groupNodes){ all.push(gn); map.set(gn.id,gn); }
    for(const n of rawNodes){
      const nn={id:n.id,label:n.label,path:n.path,parent:n.parent||"",isGroup:false,score:n.score,tier:n.tier||""};
      all.push(nn); map.set(nn.id,nn);
    }
    const L=[];
    for(const e of rawLinks){
      const s=typeof e.source==="string"?e.source:e.source?.id;
      const t=typeof e.target==="string"?e.target:e.target?.id;
      if(!s||!t) continue;
      if(!map.has(s)||!map.has(t)) continue;
      L.push({source:s,target:t});
    }

    // score/tier for leaves
    const leaf=all.filter(n=>!n.isGroup);
    const deg=degreeMap(leaf,L);
    const scores=[];
    for(const n of leaf){
      if(typeof n.score!=="number") n.score=heuristicScore(n,deg);
      scores.push(n.score);
    }
    scores.sort((a,b)=>a-b);
    for(const n of leaf){
      const label=(n.label||"").toLowerCase();
      const path=(n.path||"").toLowerCase();
      const pin = label.includes("agent_protocol")||path.includes("agent_protocol")
        || label.includes("playbook")||path.includes("playbook")
        || path.endsWith("readme.md")||path.endsWith("main.cpp")||path.endsWith("main.py");
      n.tier = pin ? "P0" : (n.tier || tierFromScore(scores,n.score));
    }

    // group score = sum top5 children
    const byGroup=new Map();
    for(const n of leaf){
      if(!n.parent) continue;
      if(!byGroup.has(n.parent)) byGroup.set(n.parent,[]);
      byGroup.get(n.parent).push(n);
    }
    const gScores=[];
    for(const gn of groupNodes){
      const arr=(byGroup.get(gn.id)||[]).slice().sort((a,b)=>b.score-a.score);
      gn.score=arr.slice(0,5).reduce((s,x)=>s+(x.score||0),0);
      gScores.push(gn.score||0);
    }
    gScores.sort((a,b)=>a-b);
    const p80=gScores[Math.floor(gScores.length*0.80)]||0;
    const p50=gScores[Math.floor(gScores.length*0.50)]||0;
    for(const gn of groupNodes){
      const v=gn.score||0;
      gn.tier = v>=p80 ? "P1" : (v>=p50 ? "P2" : "P3");
    }

    fullNodes=all; fullLinks=L;
    initPos();
  }

  function initPos(){
    const w=window.innerWidth, h=window.innerHeight;
    const topGroups=fullNodes.filter(n=>n.isGroup && (!n.parent || (n.depth||99)<=CFG.initGroupDepth));
    const R=Math.min(w,h)*0.28;
    const step=(Math.PI*2)/Math.max(1,topGroups.length);
    topGroups.forEach((g,i)=>{ g.x=Math.cos(i*step)*R; g.y=Math.sin(i*step)*R; g.vx=0; g.vy=0; });

    const map=new Map(fullNodes.map(n=>[n.id,n]));
    for(const n of fullNodes){
      if(n.isGroup) continue;
      const p=n.parent?map.get(n.parent):null;
      const px=p?.x ?? (Math.random()-0.5)*200;
      const py=p?.y ?? (Math.random()-0.5)*200;
      n.x=px+(Math.random()-0.5)*120;
      n.y=py+(Math.random()-0.5)*120;
      n.vx=0; n.vy=0;
    }
    ox=w*0.5; oy=h*0.5; scale=1;
  }

  // -------- visible building (开局：结构骨架 + TopK) --------
  function ancestors(n,map){
    const res=[];
    let cur = n.parent ? map.get(n.parent) : null;
    while(cur){ res.push(cur); cur = cur.parent ? map.get(cur.parent) : null; }
    return res;
  }
  function topKLeaves(){
    const leaf=fullNodes.filter(n=>!n.isGroup).slice().sort((a,b)=>(b.score||0)-(a.score||0));
    return leaf.slice(0,CFG.initialTopK);
  }
  function overviewVisible(){
    const map=new Map(fullNodes.map(n=>[n.id,n]));
    const vis=new Set();
    for(const g of fullNodes){
      if(!g.isGroup) continue;
      const depth=g.depth||99;
      if(!g.parent || depth<=CFG.initGroupDepth) vis.add(g.id);
    }
    const top=topKLeaves();
    const by=new Map();
    for(const n of top){
      const gid=n.parent||"";
      if(!by.has(gid)) by.set(gid,[]);
      by.get(gid).push(n);
    }
    for(const [gid,arr] of by.entries()){
      arr.sort((a,b)=>(b.score||0)-(a.score||0));
      arr.slice(0,CFG.perGroupMin).forEach(n=>vis.add(n.id));
    }
    top.forEach(n=>vis.add(n.id));
    for(const id of Array.from(vis)){
      const n=map.get(id);
      if(!n||n.isGroup) continue;
      ancestors(n,map).forEach(a=>vis.add(a.id));
    }
    return vis;
  }
  function buildSubgraph(vis){
    const map=new Map(fullNodes.map(n=>[n.id,n]));
    const vNodes=[];
    for(const id of vis){
      const n=map.get(id); if(!n) continue;
      vNodes.push({...n,r:radius(n),_fixed:false});
    }
    const vMap=new Map(vNodes.map(n=>[n.id,n]));
    const vLinks=[];
    for(const e of fullLinks){
      const s=vMap.get(e.source), t=vMap.get(e.target);
      if(s&&t) vLinks.push({source:s,target:t});
    }
    // membership edges
    for(const n of vNodes){
      if(!n.parent) continue;
      const p=vMap.get(n.parent), s=vMap.get(n.id);
      if(!p||!s) continue;
      vLinks.push({source:p,target:s,len:n.isGroup?120:90,k:0.12});
    }
    nodes=vNodes; links=vLinks;
    setStatus(`${mode} | nodes=${nodes.length} links=${links.length}`);
  }

  function expandGroup(gid, deep){
    const map=new Map(fullNodes.map(n=>[n.id,n]));
    const vis=new Set(nodes.map(n=>n.id));
    fullNodes.filter(n=>n.isGroup && n.parent===gid).forEach(n=>vis.add(n.id));
    const leaf=fullNodes.filter(n=>!n.isGroup && n.parent===gid).slice().sort((a,b)=>(b.score||0)-(a.score||0));
    leaf.slice(0,CFG.expandTopN).forEach(n=>vis.add(n.id));
    if(deep) leaf.filter(n=>n.tier==="P0"||n.tier==="P1"||n.tier==="P2").forEach(n=>vis.add(n.id));
    const g=map.get(gid); if(g) ancestors(g,map).forEach(a=>vis.add(a.id));
    buildSubgraph(vis);
    warmSim();
  }

  function focusOn(id){
    const map=new Map(fullNodes.map(n=>[n.id,n]));
    const center=map.get(id); if(!center) return;
    mode="focus";
    const vis=new Set([center.id]);
    const neigh=new Set();
    for(const e of fullLinks){
      if(e.source===center.id) neigh.add(e.target);
      if(e.target===center.id) neigh.add(e.source);
    }
    const arr=Array.from(neigh).map(x=>map.get(x)).filter(Boolean).sort((a,b)=>(b.score||0)-(a.score||0));
    arr.slice(0,CFG.focusNeighborMax).forEach(n=>vis.add(n.id));
    for(const id2 of Array.from(vis)){
      const n=map.get(id2); if(!n) continue;
      ancestors(n,map).forEach(a=>vis.add(a.id));
    }
    buildSubgraph(vis);
    $crumb.textContent = breadcrumb(center,map);
    warmSim();
  }

  function breadcrumb(n,map){
    const parts=[];
    let cur=n;
    while(cur){
      parts.push(cur.isGroup?cur.label:(cur.label||cur.id));
      cur=cur.parent?map.get(cur.parent):null;
    }
    return parts.reverse().join("  >  ");
  }

  // -------- render + hit test --------
  function pick(mx,my){
    const p=screenToWorld(mx,my);
    let best=null, bestD2=1e18;
    for(const n of nodes){
      const r=(n.r||6)+8;
      const dx=p.x-n.x, dy=p.y-n.y;
      const d2=dx*dx+dy*dy;
      if(d2<r*r && d2<bestD2){ best=n; bestD2=d2; }
    }
    return best;
  }

  function draw(){
    const w=window.innerWidth, h=window.innerHeight;
    ctx.fillStyle="#111";
    ctx.fillRect(0,0,w,h);

    // edges
    for(const e of links){
      const s=e.source, t=e.target;
      const isH=hovered && (s.id===hovered.id||t.id===hovered.id);
      const isS=selected && (s.id===selected.id||t.id===selected.id);
      const a=isS?0.9:(isH?0.75:0.22);
      ctx.strokeStyle=`rgba(200,200,200,${a})`;
      ctx.lineWidth=1;
      const p1=worldToScreen(s.x,s.y), p2=worldToScreen(t.x,t.y);
      ctx.beginPath(); ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y); ctx.stroke();
    }

    // nodes
    for(const n of nodes){
      const p=worldToScreen(n.x,n.y);
      const r=(n.r||6)+((n===hovered||n===selected)?2:0);
      if(n.isGroup){
        const ringA=n.tier==="P1"?0.55:(n.tier==="P2"?0.40:0.30);
        ctx.strokeStyle=`rgba(230,230,230,${ringA})`;
        ctx.lineWidth=2;
        ctx.beginPath(); ctx.arc(p.x,p.y,r+4,0,Math.PI*2); ctx.stroke();
      }
      ctx.fillStyle=`rgba(220,220,220,${alpha(n)})`;
      ctx.beginPath(); ctx.arc(p.x,p.y,r,0,Math.PI*2); ctx.fill();
      if(showLabel(n)){
        ctx.font=n.isGroup?"12px system-ui":"14px system-ui";
        ctx.fillStyle="rgba(245,245,245,0.90)";
        ctx.textBaseline="middle";
        ctx.fillText(n.isGroup?n.label:(n.label||n.id), p.x+r+8, p.y);
      }
    }
  }

  function warmSim(){
    // small burst ticks to settle view (avoid blank / layout jump)
    for(let i=0;i<140;i++) tickSim(1);
    draw();
  }

  function resize(){
    const dpr=Math.max(1,window.devicePixelRatio||1);
    c.width=Math.floor(window.innerWidth*dpr);
    c.height=Math.floor(window.innerHeight*dpr);
    c.style.width=window.innerWidth+"px";
    c.style.height=window.innerHeight+"px";
    ctx.setTransform(1,0,0,1,0,0);
    ctx.scale(dpr,dpr);
    draw();
  }
  window.addEventListener("resize", resize);

  // -------- interaction --------
  c.addEventListener("mousemove",(ev)=>{
    const mx=ev.clientX,my=ev.clientY;
    if(dragging){
      const dx=mx-downX, dy=my-downY;
      if(dragNode){
        const p=screenToWorld(mx,my);
        dragNode.x=p.x; dragNode.y=p.y; dragNode._fixed=true;
        tickSim(4); draw();
      }else{
        ox+=dx; oy+=dy; draw();
      }
      downX=mx; downY=my;
      return;
    }
    const hit=pick(mx,my);
    if((hit&&!hovered)||(!hit&&hovered)||(hit&&hovered&&hit.id!==hovered.id)){
      hovered=hit; draw();
    }
  });
  c.addEventListener("mousedown",(ev)=>{
    dragging=true; downX=ev.clientX; downY=ev.clientY;
    dragNode=pick(downX,downY);
  });
  window.addEventListener("mouseup",()=>{ dragging=false; dragNode=null; });
  c.addEventListener("wheel",(ev)=>{
    ev.preventDefault();
    const mx=ev.clientX,my=ev.clientY;
    const before=screenToWorld(mx,my);
    const z=Math.exp(-ev.deltaY*0.001);
    scale=clamp(scale*z,0.25,3.5);
    const after=worldToScreen(before.x,before.y);
    ox+=(mx-after.x); oy+=(my-after.y);
    draw();
  },{passive:false});

  c.addEventListener("click", async (ev)=>{
    const hit=pick(ev.clientX,ev.clientY);
    if(!hit) return;
    selected=hit;
    const label=hit.isGroup?`[GROUP] ${hit.label}`:(hit.label||hit.id);
    $sel.textContent=`selected: ${label}${hit.path?("  |  "+hit.path):""}`;
    draw();

    if(hit.isGroup && mode==="overview"){
      expandGroup(hit.id, !!ev.altKey);
      $crumb.textContent=hit.label;
      return;
    }
    if(!hit.isGroup){
      focusOn(hit.id);
      if(bridge && typeof bridge.openPath==="function" && hit.path){
        try{ await bridge.openPath(hit.path); }catch(_){}}
      else if(bridge && typeof bridge.openNode==="function"){
        try{ await bridge.openNode(JSON.stringify(hit)); }catch(_){}}
    }
  });

  $btnOverview.addEventListener("click",()=>{
    mode="overview"; $crumb.textContent="";
    buildSubgraph(overviewVisible()); warmSim();
  });
  $btnFocus.addEventListener("click",()=>{
    if(selected && !selected.isGroup) focusOn(selected.id);
  });
  $btnReset.addEventListener("click",()=>{
    hovered=null; selected=null; mode="overview"; $crumb.textContent="";
    initPos(); buildSubgraph(overviewVisible()); warmSim();
  });
  $search.addEventListener("input",()=>{
    const q=($search.value||"").trim().toLowerCase();
    if(!q){ hovered=null; draw(); return; }
    hovered=nodes.find(n=>(n.label||n.id).toLowerCase().includes(q))||null;
    draw();
  });

  // -------- load graph (Qt bridge first, else sample) --------
  async function loadGraph(){
    if(bridge && typeof bridge.getGraphJson==="function"){
      try{ return JSON.parse(await bridge.getGraphJson()); }catch(_){}}
    try{
      const r=await fetch("./sample_graph.json",{cache:"no-store"});
      return await r.json();
    }catch(_){}
    return {nodes:[],links:[]};
  }

  function connectQt(){
    try{
      if(typeof QWebChannel!=="undefined" && window.qt && qt.webChannelTransport){
        new QWebChannel(qt.webChannelTransport, (channel)=>{
          bridge = channel.objects.GraphBridge || channel.objects.bridge || null;
          setStatus(bridge ? "Qt bridge connected" : "Qt channel ok, bridge missing");
          boot();
        });
        return true;
      }
    }catch(_){ }
    return false;
  }

  async function boot(){
    const g = await loadGraph();
    normalizeGraph(g);
    resize();
    mode="overview";
    buildSubgraph(overviewVisible());
    warmSim();
    setStatus(`${mode} ready`);
  }

  if(!connectQt()){
    setStatus("no Qt bridge, using sample");
    boot();
  }
})();


