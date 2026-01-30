# SCOPE_GUARDRAILS (Hard Constraints)

These rules are hard constraints for any AI agent modifying this repository.

## Scope Rules
1. Do NOT add new UI panels, buttons, dashboards, or additional screens unless the user explicitly requests them.
2. Primary interaction must be on the graph canvas:
   - Click: select
   - Click again / Double-click: drill down
   - Ctrl+Click: open file/dir
3. Any details panel must be optional and must NOT block canvas clicks (no absolute overlay over the canvas).

## Navigation Rules
1. User must always be able to go back (Back / Up / Home).
2. Do NOT change click behavior to “single click opens and navigates away”.

## Performance Rules
1. Avoid heavy frameworks or large bundles.
2. Prefer deterministic layout; allow LOD for labels/nodes.

## Patch Rules
1. Only produce unified diff patches.
2. After any change, run the self-check suite (scripts/self_check.py) if present.
3. If a change introduces new failures, revert or minimize changes until checks pass.
