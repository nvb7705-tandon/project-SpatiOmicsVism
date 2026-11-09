/* scatter.js — canvas scatter with zoom, lasso, click, hover, and an SVG overlay for labels.
   Used for every tissue map and UMAP so encodings and interactions stay identical across views. */
'use strict';

class Scatter {
  constructor(container, opts = {}) {
    this.o = Object.assign({ equal: true, pad: 10, lasso: false, zoom: false, r: 1.6 }, opts);
    this.root = d3.select(container).append('div').attr('class', 'scatter');
    this.canvas = this.root.append('canvas').node();
    this.ctx = this.canvas.getContext('2d');
    this.svg = this.root.append('svg').attr('class', 'overlay');
    this.annG = this.svg.append('g').attr('class', 'ann');
    this.hlG = this.svg.append('g').attr('class', 'ann');
    this.lassoPath = this.svg.append('path').attr('class', 'lasso-path').style('display', 'none');
    this.t = d3.zoomIdentity;
    this.mode = this.o.lasso ? 'lasso' : 'pan';
    this.root.classed(this.mode, true);
    this.idx = new Int32Array(0);
    this.w = 0; this.h = 0;
    this.drawFn = null; this.annFn = null; this.hoverIdx = null; this.selectIdx = null;
    this._qt = null;
    if (this.o.zoom) this._initZoom();
    this._initPointer();
    new ResizeObserver(() => this.resize()).observe(this.root.node());
  }

  /* ---- data + scales */
  setPoints(X, Y, idx, domainIdx = idx) {
    this.X = X; this.Y = Y; this.idx = idx;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const i of domainIdx) {
      const x = X[i], y = Y[i];
      if (!(x === x) || !(y === y)) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (!isFinite(x0)) { x0 = 0; x1 = 1; y0 = 0; y1 = 1; }
    this.dom = { x0, x1, y0, y1 };
    this.resetZoom(false);
    this._scales();
  }
  _scales() {
    if (!this.dom) return;
    const { x0, x1, y0, y1 } = this.dom, p = this.o.pad, w = this.w, h = this.h;
    const dx = Math.max(x1 - x0, 1e-9), dy = Math.max(y1 - y0, 1e-9);
    let kx = (w - 2 * p) / dx, ky = (h - 2 * p) / dy;
    if (this.o.equal) kx = ky = Math.min(kx, ky);
    const ox = (w - kx * dx) / 2, oy = (h - ky * dy) / 2;
    this.bx = v => ox + (v - x0) * kx;
    this.by = v => h - oy - (v - y0) * ky;
    this.kData = kx; // px per data unit at zoom 1
  }
  px(i) { return this.t.k * this.bx(this.X[i]) + this.t.x; }
  py(i) { return this.t.k * this.by(this.Y[i]) + this.t.y; }
  pxv(v) { return this.t.k * this.bx(v) + this.t.x; }
  pyv(v) { return this.t.k * this.by(v) + this.t.y; }

  /* read the container size; returns true if it changed */
  _measure() {
    const n = this.root.node(), w = n.clientWidth, h = n.clientHeight;
    if (w === this.w && h === this.h) return false;
    this.w = w; this.h = h;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this._scales();
    return true;
  }
  resize() { if (this._measure()) this.draw(); }

  /* ---- drawing */
  draw(fn, annFn) {
    if (fn) this.drawFn = fn;
    if (annFn !== undefined) this.annFn = annFn;
    if (!this.w) this._measure(); // ResizeObserver may not have fired yet (e.g. hidden tab)
    if (!this.w || !this.X || !this.drawFn) return;
    const dpr = window.devicePixelRatio || 1, ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    this.drawFn(this, ctx);
    this._qt = null;
    this.annG.selectAll('*').remove();
    if (this.annFn) this.annFn(this, this.annG);
    if (this._lensArgs) this.lens(this._lensArgs[0], this._lensArgs[1], { spokes: this._lensArgs[2] });
    else this.highlight(this._hl ?? -1);
  }
  /* batched dots: colour is a string or i -> string|null; insertion order of colours = draw order */
  dots(ind, color, r = this.o.r, { alpha = 1, stroke = null, lw = 1 } = {}) {
    const ctx = this.ctx, w = this.w, h = this.h;
    const buckets = new Map();
    if (typeof color === 'string') buckets.set(color, ind);
    else for (const i of ind) {
      const c = color(i);
      if (!c) continue;
      let b = buckets.get(c);
      if (!b) buckets.set(c, (b = []));
      b.push(i);
    }
    const rr = r * (this.o.zoomGrow ? Math.min(2.2, Math.sqrt(this.t.k)) : 1);
    ctx.globalAlpha = alpha;
    for (const [c, list] of buckets) {
      ctx.beginPath();
      for (const i of list) {
        const x = this.px(i), y = this.py(i);
        if (x < -rr || x > w + rr || y < -rr || y > h + rr || !(x === x)) continue;
        if (rr <= 1.3) ctx.rect(x - rr, y - rr, 2 * rr, 2 * rr);
        else { ctx.moveTo(x + rr, y); ctx.arc(x, y, rr, 0, 2 * Math.PI); }
      }
      if (c !== 'none') { ctx.fillStyle = c; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
  }
  segments(pairs, color, lw = 1) { // pairs: [[i, j], ...] cell indices
    const ctx = this.ctx;
    ctx.beginPath();
    for (const [i, j] of pairs) { ctx.moveTo(this.px(i), this.py(i)); ctx.lineTo(this.px(j), this.py(j)); }
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke();
  }
  scaleBar(um = 500) { // data units are µm for tissue views
    const ctx = this.ctx, len = um * this.kData * this.t.k;
    if (!(len > 8)) return;
    const x = 12, y = this.h - 12;
    ctx.fillStyle = P.text2; ctx.fillRect(x, y - 2, len, 2);
    ctx.font = '11px system-ui, sans-serif'; ctx.fillText(um >= 1000 ? `${um / 1000} mm` : `${um} µm`, x, y - 6);
  }
  /* neighbour lens: ring cell i and its true (PCA-space) neighbours; spokes show how far apart the layout put them */
  lens(i, nbrs, { spokes = true } = {}) {
    this._lensArgs = i >= 0 ? [i, nbrs, spokes] : null;
    const g = this.hlG;
    g.selectAll('*').remove();
    if (i < 0 || !this.X || !(this.X[i] === this.X[i])) return;
    const x = this.px(i), y = this.py(i), ok = j => this.X[j] === this.X[j];
    if (spokes) for (const j of nbrs) if (ok(j)) g.append('line').attr('class', 'spoke').attr('x1', x).attr('y1', y).attr('x2', this.px(j)).attr('y2', this.py(j));
    for (const j of nbrs) if (ok(j)) g.append('circle').attr('class', 'nb').attr('cx', this.px(j)).attr('cy', this.py(j)).attr('r', 3.5);
    g.append('circle').attr('class', 'hl').attr('cx', x).attr('cy', y).attr('r', 6);
  }
  highlight(i) {
    this._lensArgs = null;
    this._hl = i;
    const g = this.hlG;
    g.selectAll('*').remove();
    if (i == null || i < 0 || !this.X || !(this.X[i] === this.X[i])) return;
    const x = this.px(i), y = this.py(i);
    if (x < 0 || y < 0 || x > this.w || y > this.h) return;
    g.append('circle').attr('class', 'hl').attr('cx', x).attr('cy', y).attr('r', 6);
  }

  /* ---- zoom */
  _initZoom() {
    this.zoom = d3.zoom().scaleExtent([1, 60])
      .filter(ev => ev.type === 'wheel' || (this.mode === 'pan' && (ev.type === 'mousedown' || ev.type === 'touchstart') && !ev.button))
      .on('zoom', ev => { this.t = ev.transform; this.draw(); });
    this.svg.call(this.zoom).on('dblclick.zoom', null);
  }
  resetZoom(redraw = true) {
    this.t = d3.zoomIdentity;
    if (this.zoom) this.svg.property('__zoom', d3.zoomIdentity);
    if (redraw) this.draw();
  }
  zoomTo(idx, pad = 0.12) {
    if (!this.zoom || !idx.length) return;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const i of idx) { const x = this.bx(this.X[i]), y = this.by(this.Y[i]); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const k = Math.min(60, (1 - 2 * pad) * Math.min(this.w / (x1 - x0 || 1), this.h / (y1 - y0 || 1)));
    const t = d3.zoomIdentity.translate(this.w / 2, this.h / 2).scale(Math.max(1, k)).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
    this.svg.call(this.zoom.transform, t);
  }
  setMode(m) {
    this.mode = m;
    this.root.classed('lasso', m === 'lasso').classed('pan', m === 'pan');
  }

  /* ---- pointer: hover, click, lasso */
  _nearest(mx, my, maxd = 8) {
    const cand = this.hoverIdx || this.idx;
    if (!this._qt) this._qt = d3.quadtree().x(i => this.px(i)).y(i => this.py(i)).addAll(Array.from(cand));
    const i = this._qt.find(mx, my, maxd);
    return i === undefined ? -1 : i;
  }
  _initPointer() {
    const node = this.svg.node();
    let lasso = null, down = null;
    const pos = ev => { const r = node.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
    node.addEventListener('pointerdown', ev => {
      if (ev.button !== 0 || this.mode === 'pan') return;
      down = pos(ev);
      if (this.o.lasso) { lasso = [down]; try { node.setPointerCapture(ev.pointerId); } catch (e) { /* synthetic events */ } }
    });
    node.addEventListener('pointermove', ev => {
      const p = pos(ev);
      if (lasso) {
        lasso.push(p);
        this.lassoPath.style('display', null).attr('d', 'M' + lasso.join('L') + 'Z');
        hideTip();
        return;
      }
      if (!this.o.onHover) return;
      const i = this._nearest(p[0], p[1]);
      this.o.onHover(i, ev);
    });
    node.addEventListener('pointerleave', ev => { if (!lasso && this.o.onHover) this.o.onHover(-1, ev); });
    node.addEventListener('pointerup', ev => {
      const p = pos(ev);
      const moved = down && Math.hypot(p[0] - down[0], p[1] - down[1]) > 4;
      if (lasso && moved && lasso.length > 3) {
        const poly = lasso, cand = this.selectIdx || this.idx, out = [];
        for (const i of cand) if (d3.polygonContains(poly, [this.px(i), this.py(i)])) out.push(i);
        this.o.onLasso && this.o.onLasso(Int32Array.from(out));
      } else if (down && !moved && this.o.onClick) {
        this.o.onClick(this._nearest(p[0], p[1]), ev);
      }
      lasso = null; down = null;
      this.lassoPath.style('display', 'none');
    });
  }
}

/* Lasso / Pan / Reset buttons for a panel header */
function scatterTools(forId, sc, { extra = [] } = {}) {
  const box = document.querySelector(`.tools[data-for="${forId}"]`);
  if (!box) return;
  box.innerHTML = '';
  const mk = (label, title, fn) => { const b = el('button', { title }, label); b.onclick = fn; box.appendChild(b); return b; };
  extra.forEach(([l, t, f]) => mk(l, t, f));
  if (sc.o.lasso) {
    const bl = mk('Lasso', 'Drag to select cells', () => { sc.setMode('lasso'); bl.classList.add('on'); bp.classList.remove('on'); });
    const bp = mk('Pan', 'Drag to pan (wheel zooms in either mode)', () => { sc.setMode('pan'); bp.classList.add('on'); bl.classList.remove('on'); });
    (sc.mode === 'lasso' ? bl : bp).classList.add('on');
  }
  if (sc.o.zoom) mk('Reset', 'Reset zoom', () => sc.resetZoom());
}
