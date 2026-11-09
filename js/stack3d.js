/* stack3d.js — pseudo-3D "exploded" stack of tissue sections on a 2D canvas (no WebGL needed).

   Each section is a horizontal sheet in world space: in-plane coordinates (x, y) in µm, stacked vertically by
   position along the long axis (ebz). The camera is orthographic with yaw (spin) and elevation (tilt).
   Sheets are painted back-to-front, each as a translucent plate with its cells on top.
   Reusable: give it sections + a colour function, e.g. region (QC tab), gene expression (Q1), NSC score (Q2). */
'use strict';

class Stack3D {
  constructor(container, opts = {}) {
    this.o = Object.assign({ r: 1.1, onHover: null, onPickSection: null }, opts);
    this.root = d3.select(container).append('div').attr('class', 'scatter pan');
    this.canvas = this.root.append('canvas').node();
    this.ctx = this.canvas.getContext('2d');
    this.svg = this.root.append('svg').attr('class', 'overlay');
    this.annG = this.svg.append('g').attr('class', 'ann');
    this.hlG = this.svg.append('g').attr('class', 'ann');
    this.yaw = -14; this.elev = 50; this.zoom = 1; this.spacing = 'even'; this.zx = 1;
    this.secs = []; this.w = 0; this.h = 0;
    this.colorFn = () => P.muted;
    this._initPointer();
    new ResizeObserver(() => { if (this._measure()) this.draw(); }).observe(this.root.node());
  }

  /* secs: [{si, idx: Int32Array, depth}] ; X, Y: per-cell in-plane coordinates (µm) */
  setData(secs, X, Y) {
    this.secs = secs; this.X = X; this.Y = Y;
    let Rx = 1, Ry = 1;
    for (const s of secs) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const i of s.idx) { const x = X[i], y = Y[i]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const px = (x1 - x0) * 0.03, py = (y1 - y0) * 0.03;
      s.b = [[x0 - px, y0 - py], [x1 + px, y0 - py], [x1 + px, y1 + py], [x0 - px, y1 + py]]; // plate corners
      Rx = Math.max(Rx, Math.abs(x0), Math.abs(x1)); Ry = Math.max(Ry, Math.abs(y0), Math.abs(y1));
    }
    this.Rx = Rx; this.Ry = Ry;
    this._layout();
  }
  /* vertical position of each sheet (world units = µm) */
  _layout() {
    const ds = this.secs.map(s => s.depth), mid = (d3.min(ds) + d3.max(ds)) / 2;
    const n = this.secs.length, order = this.secs.slice().sort((a, b) => a.depth - b.depth);
    const gap = this.Ry * 1.9; // even spacing: sheets just clear each other at the default tilt
    order.forEach((s, k) => {
      s.yw = this.spacing === 'even' ? ((n - 1) / 2 - k) * gap : -(s.depth - mid) * 1000 * this.zx;
    });
  }
  setSpacing(mode) { this.spacing = mode; this._layout(); this.draw(); }
  setView(yaw, elev) { this.yaw = yaw; this.elev = elev; this.zoom = 1; this.draw(); }

  _measure() {
    const n = this.root.node(), w = n.clientWidth, h = n.clientHeight;
    if (w === this.w && h === this.h) return false;
    this.w = w; this.h = h;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    return true;
  }

  /* world -> rotated camera coords; returns [sx, sy, depth] after fitting */
  _camera() {
    const a = this.yaw * Math.PI / 180, e = this.elev * Math.PI / 180;
    const ca = Math.cos(a), sa = Math.sin(a), ce = Math.cos(e), se = Math.sin(e);
    // world: x = u, z = -v (in-plane), y = sheet height
    const rot = (u, v, yw) => {
      const x = u, z = -v, y = yw;
      const x1 = x * ca + z * sa, z1 = -x * sa + z * ca;
      return [x1, y * ce - z1 * se, y * se + z1 * ce];
    };
    // fit: project the 4 corners of every sheet
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const s of this.secs) for (const [u, v] of s.b) {
      const p = rot(u, v, s.yw);
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    }
    const pad = 14, k = this.zoom * Math.min((this.w - 2 * pad - 34) / (x1 - x0 || 1), (this.h - 2 * pad) / (y1 - y0 || 1));
    const cx = this.w / 2 + 16 - k * (x0 + x1) / 2, cy = this.h / 2 + k * (y0 + y1) / 2;
    return { rot, k, cx, cy, toScreen: p => [cx + k * p[0], cy - k * p[1], p[2]] };
  }

  draw(fast = false) {
    if (!this.w) this._measure();
    if (!this.w || !this.X || !this.secs.length) return;
    const dpr = window.devicePixelRatio || 1, ctx = this.ctx, X = this.X, Y = this.Y;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const cam = this._camera();
    this._cam = cam;
    // painter's order: farthest sheet first (smaller camera depth = farther)
    const order = this.secs.map(s => ({ s, d: cam.rot(0, 0, s.yw)[2] })).sort((a, b) => a.d - b.d).map(o => o.s);
    const stride = fast ? 3 : 1, r = this.o.r * Math.min(2, Math.sqrt(this.zoom));
    const pts = [];
    this.annG.selectAll('*').remove();
    for (const s of order) {
      // plate
      const corners = s.b.map(([u, v]) => cam.toScreen(cam.rot(u, v, s.yw)));
      ctx.beginPath();
      corners.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = P.surface; ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = s.si === S.focus ? P.accent : P.axis; ctx.lineWidth = s.si === S.focus ? 1.5 : 1; ctx.stroke();
      // cells, batched by colour
      const buckets = new Map(), idx = s.idx;
      for (let k = 0; k < idx.length; k += stride) {
        const i = idx[k], c = this.colorFn(i);
        if (!c) continue;
        let b = buckets.get(c);
        if (!b) buckets.set(c, (b = []));
        b.push(i);
      }
      // de-emphasised colours first so highlighted cells stay on top
      const back = this.backColors || new Set();
      const entries = [...buckets].sort((a, b) => (back.has(b[0]) ? 1 : 0) - (back.has(a[0]) ? 1 : 0));
      for (const [c, list] of entries) {
        ctx.beginPath();
        for (const i of list) {
          const p = cam.toScreen(cam.rot(X[i], Y[i], s.yw));
          ctx.rect(p[0] - r, p[1] - r, 2 * r, 2 * r);
          if (!fast && (k_hover(i))) pts.push([p[0], p[1], i]);
        }
        ctx.fillStyle = c; ctx.fill();
      }
      // label at the sheet's left-most corner
      const left = corners.reduce((m, p) => (p[0] < m[0] ? p : m));
      this.annG.append('text').attr('x', left[0] - 4).attr('y', left[1] + 4).attr('text-anchor', 'end')
        .attr('font-weight', s.si === S.focus ? 700 : 400).style('cursor', 'pointer')
        .style('pointer-events', 'all').text(SEC[s.si].name)
        .on('click', () => this.o.onPickSection && this.o.onPickSection(s.si))
        .append('title').text(`${SEC[s.si].name} · ebz ${fmt.f2(SEC[s.si].depth_mm)} mm · click to focus`);
    }
    if (!fast) this._qt = d3.quadtree().x(p => p[0]).y(p => p[1]).addAll(pts);
    this.highlight(this._hl ?? -1);
    // hover candidates are sub-sampled to keep the quadtree cheap
    function k_hover(i) { return (i & 3) === 0; }
  }

  highlight(i) {
    this._hl = i;
    this.hlG.selectAll('*').remove();
    if (i == null || i < 0 || !this._cam) return;
    const s = this.secs.find(s => s.si === C.sec[i]);
    if (!s) return;
    const p = this._cam.toScreen(this._cam.rot(this.X[i], this.Y[i], s.yw));
    this.hlG.append('circle').attr('class', 'hl').attr('cx', p[0]).attr('cy', p[1]).attr('r', 6);
  }

  _initPointer() {
    const node = this.svg.node();
    let drag = null;
    const pos = ev => { const r = node.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
    node.addEventListener('pointerdown', ev => {
      if (ev.button !== 0 || ev.target.tagName === 'text') return;
      drag = { p: pos(ev), yaw: this.yaw, elev: this.elev };
      try { node.setPointerCapture(ev.pointerId); } catch (e) { /* synthetic */ }
      this.root.classed('dragging', true);
    });
    node.addEventListener('pointermove', ev => {
      const p = pos(ev);
      if (drag) {
        this.yaw = drag.yaw + (p[0] - drag.p[0]) * 0.4;
        this.elev = Math.max(0, Math.min(90, drag.elev + (p[1] - drag.p[1]) * 0.3));
        this.draw(true);
        hideTip();
        return;
      }
      if (!this.o.onHover || !this._qt) return;
      const f = this._qt.find(p[0], p[1], 6);
      this.o.onHover(f ? f[2] : -1, ev);
    });
    const end = () => { if (drag) { drag = null; this.root.classed('dragging', false); this.draw(false); } };
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', end);
    node.addEventListener('pointerleave', ev => { if (!drag && this.o.onHover) this.o.onHover(-1, ev); });
    node.addEventListener('wheel', ev => {
      ev.preventDefault();
      this.zoom = Math.max(0.5, Math.min(8, this.zoom * Math.exp(-ev.deltaY * 0.0015)));
      this.draw(true);
      clearTimeout(this._wt); this._wt = setTimeout(() => this.draw(false), 150);
    }, { passive: false });
  }
}
