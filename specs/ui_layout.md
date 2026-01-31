# UI Layout & Hit-Testing Guidelines

## Scope
Graph Spider (web) embedded in Qt WebEngine shell. Applies to layout, sidebar behavior, and pointer hit detection (pan/zoom/DPI).

## Layout rules
- Use flex split: `#container { display:flex; height:100%; }` with `#graphPane` (canvas) flex:1 and sidebar flex basis ~360px.
- Sidebar must never overlay the canvas; when collapsed it sets width=0, pointer-events:none.
- Provide a single action to collapse/expand sidebar (button + Tab/Ctrl+B in web).
- Sidebar width can be resized via a drag handle; graph resizes/fit on width change.
- Canvas host (`#graphPane` / `canvas`) keeps `position:relative` so overlays (results, toast) anchor inside without intercepting clicks.

## Hit-testing & coordinates
- Pointer coords: use `clientX/Y - rect.left/top` of the canvas container.
- DevicePixelRatio: canvas width/height = cssSize * dpr; convert local coords via `world = ((local*dpr) - pan)/zoom`.
- After resize or Windows scale (100/125/150%), recalc canvas size and keep helpers using current rect + dpr.
- When zoom/pan active, apply inverse transform for picking/selection; keep overlays (results, toast) in screen space.

## Acceptance checklist
- Sidebar collapse/expand works and never blocks canvas interactions.
- Picking/drag/zoom stay aligned after resize and at DPI 100/125/150.
- Verify scripts pass (`scripts/verify_repo.*`).
