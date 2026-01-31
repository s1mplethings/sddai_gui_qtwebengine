# Task — UI fix: layout and selection box

## Context
- Right-side detail panel currently overlays the graph canvas, blocking drag/zoom/click/box interactions.
- Selection/pick hitboxes drift after window resize or Windows DPI scaling (100/125/150%) because we mix client coords with canvas pixels and ignore container offsets/zoom.

## Acceptance (DoD)
- [ ] Right-side detail panel never overlays the graph area; graph interactions remain usable.
- [ ] Detail panel can be collapsed/expanded via a single action (button or shortcut); when collapsed it does not intercept pointer events.
- [ ] Hit/selection/pick math stays aligned with the mouse after window resize and at Windows DPI 100/125/150%, including when zoom/pan is active.
- [ ] `scripts/verify_repo.ps1` (or `verify_repo.sh`) completes successfully.

## Plan
1) Update web UI layout for graph spider: flex-based split, sidebar collapsible without covering canvas.
2) Fix coordinate math: base on container rect + devicePixelRatio; ensure zoom/pan transforms use inverted coordinates for picking.
3) Add drill-down/back behavior and default expand depth=1 on startup.
4) Update specs (graph/ui layout) with rules, then run verify.

## Files to touch (expected)
- web/graph_spider/index.html, spider_v4.css, spider_v4.js (layout + coords)
- specs/ (new UI spec entry)
- meta/tasks/ (this file)

## Self-test
- Manual: launch app, ensure sidebar collapse/expand works; drag/zoom/click on graph unaffected; try window resize.
- Manual (if possible): set Windows display scale to 125% / 150%, confirm hit alignment.

## Verify
- powershell -ExecutionPolicy Bypass -File scripts/verify_repo.ps1

## Results
- Implemented flex sidebar layout + resizer + collapse; graph keeps full interactive area.
- Fixed pick/drag coord mapping with container rect + DPR; added root drill-down/back with default depth=1.
- Updated specs; verify run successful.
  - Verify: `powershell -ExecutionPolicy Bypass -File scripts/verify_repo.ps1`
