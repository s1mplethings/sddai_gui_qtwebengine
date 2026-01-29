// force_sim.js
// A tiny force-directed simulation (charge + link + center + collide) for Canvas graphs.
// No external deps. Designed to be "D3-force-like" enough for this project.

(() => {
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  class ForceSim {
    constructor(nodes, links) {
      this.nodes = nodes || [];
      this.links = links || [];

      // params
      this.chargeStrength = -420;
      this.linkDistance = 120;
      this.linkStrength = 0.18;
      this.centerStrength = 0.0006;
      this.collideRadius = (n) => (n.r || 6) + 10;
      this.alpha = 1.0;
      this.alphaMin = 0.02;
      this.alphaDecay = 0.02;
      this.velocityDecay = 0.92;

      this._tick = null;
      this._running = false;
      this._raf = 0;
      this._last = performance.now();
    }

    onTick(fn) {
      this._tick = fn;
      return this;
    }

    restart() {
      this.alpha = 1.0;
      if (!this._running) this.start();
      return this;
    }

    start() {
      if (this._running) return;
      this._running = true;
      this._last = performance.now();
      const loop = () => {
        if (!this._running) return;
        this.step();
        this._raf = requestAnimationFrame(loop);
      };
      this._raf = requestAnimationFrame(loop);
    }

    stop() {
      this._running = false;
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = 0;
    }

    step() {
      const now = performance.now();
      const dt = clamp((now - this._last) / 1000, 0.001, 0.03);
      this._last = now;

      if (this.alpha < this.alphaMin) {
        if (this._tick) this._tick();
        return;
      }

      const a = this.alpha;
      const nodes = this.nodes;
      const links = this.links;

      for (const n of nodes) {
        n.vx = (n.vx || 0) * this.velocityDecay;
        n.vy = (n.vy || 0) * this.velocityDecay;
      }

      const kRepel = -this.chargeStrength;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const p = nodes[i], q = nodes[j];
          const dx = p.x - q.x;
          const dy = p.y - q.y;
          const d2 = dx * dx + dy * dy + 0.01;
          const inv = 1 / Math.sqrt(d2);
          const f = (kRepel / d2) * a;
          const fx = dx * inv * f;
          const fy = dy * inv * f;
          p.vx += fx * dt; p.vy += fy * dt;
          q.vx -= fx * dt; q.vy -= fy * dt;
        }
      }

      const L = this.linkDistance;
      const kLink = this.linkStrength;
      for (const e of links) {
        const s = e.source, t = e.target;
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const d = Math.sqrt(dx * dx + dy * dy) + 0.001;
        const diff = d - L;
        const f = diff * kLink * a;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        s.vx += fx; s.vy += fy;
        t.vx -= fx; t.vy -= fy;
      }

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const p = nodes[i], q = nodes[j];
          const rp = this.collideRadius(p);
          const rq = this.collideRadius(q);
          const minD = rp + rq;
          const dx = q.x - p.x;
          const dy = q.y - p.y;
          const d2 = dx * dx + dy * dy + 0.01;
          const d = Math.sqrt(d2);
          if (d >= minD) continue;
          const overlap = (minD - d) / d;
          const ox = dx * overlap * 0.5 * a;
          const oy = dy * overlap * 0.5 * a;
          if (!p._fixed) { p.x -= ox; p.y -= oy; }
          if (!q._fixed) { q.x += ox; q.y += oy; }
        }
      }

      const kC = this.centerStrength * a;
      for (const n of nodes) {
        n.vx += (-n.x) * kC;
        n.vy += (-n.y) * kC;
      }

      for (const n of nodes) {
        if (n._fixed) continue;
        n.x += (n.vx || 0);
        n.y += (n.vy || 0);
      }

      this.alpha = this.alpha * (1 - this.alphaDecay);
      if (this._tick) this._tick();
    }
  }

  window.ForceSim = ForceSim;
})();
