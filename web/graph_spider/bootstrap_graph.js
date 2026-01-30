// Bootstrap graph used when Qt bridge is missing/late/returns empty.
// Keeps the UI non-blank: show a "project skeleton" immediately.

(() => {
  function nowISO() {
    try { return new Date().toISOString(); } catch { return '' }
  }

  const TOP = [
    // tier 3: core
    { id: 'src',      label: 'src',      group: 'dir', importance: 1.00, tier: 3 },
    { id: 'include',  label: 'include',  group: 'dir', importance: 0.95, tier: 3 },
    { id: 'web',      label: 'web',      group: 'dir', importance: 0.90, tier: 3 },
    // tier 2: workflow
    { id: 'specs',    label: 'specs',    group: 'dir', importance: 0.75, tier: 2 },
    { id: 'docs',     label: 'docs',     group: 'dir', importance: 0.70, tier: 2 },
    { id: 'scripts',  label: 'scripts',  group: 'dir', importance: 0.68, tier: 2 },
    { id: 'ai_context', label: 'ai_context', group: 'dir', importance: 0.64, tier: 2 },
    { id: 'ai',       label: 'ai',       group: 'dir', importance: 0.60, tier: 2 },
    // tier 1: secondary
    { id: 'meta',     label: 'meta',     group: 'dir', importance: 0.50, tier: 1 },
    { id: 'third_party', label: 'third_party', group: 'dir', importance: 0.45, tier: 1 },
    { id: 'resources', label: 'resources', group: 'dir', importance: 0.42, tier: 1 },
    { id: '.codex',   label: '.codex',   group: 'dir', importance: 0.40, tier: 1 },
  ];

  function buildBootstrapGraph() {
    const root = {
      id: 'ROOT',
      label: 'workspace',
      group: 'root',
      importance: 1.20,
      tier: 4,
      meta: { kind: 'bootstrap', at: nowISO() },
    };

    const nodes = [root, ...TOP.map(x => ({
      ...x,
      path: x.id + '/',
      meta: { kind: 'topdir', tier: x.tier, importance: x.importance }
    }))];

    const links = TOP.map(x => ({ source: 'ROOT', target: x.id, w: 1 }));

    // small cross-links that match typical SDDAI flow
    links.push(
      { source: 'specs', target: 'src', w: 1 },
      { source: 'docs', target: 'specs', w: 1 },
      { source: 'scripts', target: 'src', w: 1 },
      { source: 'ai_context', target: 'docs', w: 1 },
      { source: 'ai', target: 'ai_context', w: 1 },
      { source: 'meta', target: 'docs', w: 1 },
    );

    return { nodes, links };
  }

  // Expose a stable getter so spider.js can consume it without coupling.
  window.SDDAI_getBootstrapGraph = window.SDDAI_getBootstrapGraph || buildBootstrapGraph;
})();

