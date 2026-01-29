from pathlib import Path
p=Path('web/app.js')
text=p.read_text(encoding='utf-8')
old='''  function renderGraph(payload, forcedView, forcedFocus) {
    const view = inferView(payload, forcedView);
    const focus = safeStr(forcedFocus);

    lastGraphPayload = payload;
    currentView = view;
    currentFocus = focus;
    setToolbar(view, focus);

    let g = normalizeGraphPayload(payload);
    g = ensurePositionsHard(g, view);
    g.edges = filterEdgesByView(g, view);

    cy.batch(() => {
      cy.elements().remove();
      cy.add(g.nodes);
      cy.add(g.edges);
    });

    cy.layout({ name: "preset", fit: true, padding: 70, animate: false }).run();
    cy.fit(undefined, 80);

    // PERF: decide focus-edges based on edge count (only for non-Summary views)
    const edgeCount = cy.edges().length;
    if (currentView !== "Summary" && edgeCount > PERF_EDGE_FOCUS_THRESHOLD) {
      perfEnableFocusEdges();
    } else {
      perfDisableFocusEdges();
    }

    // Apply zoom-based LOD once after render
    perfUpdateZoomLOD();
  }
'''
new='''  function renderGraph(payload, forcedView, forcedFocus) {
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

    // Layout choice: if many nodes缺位，则自动同心/蛛网布局；否则尊重后端坐标
    const missingPos = (g.nodes || []).filter(n => not (n.get('position') and isinstance(n['position'].get('x'), (int,float)) and isinstance(n['position'].get('y'), (int,float)))).__len__()
'''
