/* views.js — the persistent workspace: 3D section stack, tissue map, UMAP A / B, gene × section grid.
   Every view uses the same encoding (encoding.js), the same selection and the same hover. */
'use strict';

const Views = (() => {
  let stack = null, tissue = null, ua = null, ub = null, stackKey = '', gridKey = '', grid = [];
  const umap = k => (k ? ub : ua);

  /* ---------------- linked hover + neighbour lens */
  function hover(i, ev) {
    const lensOn = sensOn() && S.lens && i >= 0 && C.dgrow && C.dgrow[i] >= 0;
    const nb = lensOn ? pcaNeighbours(i) : [];
    for (const v of [tissue, ua, ub]) if (v) (lensOn ? v.lens(i, nb, { spokes: v !== tissue }) : v.highlight(i));
    if (stack) stack.highlight(i);
    lensReadout(i, nb);
    if (i < 0) return hideTip();
    const rows = [['NSC score', fmt.f2(nscScore()[i])]];
    if (sensOn() && C.leiden[i] !== 255) M.min_dists.forEach((m, k) => rows.push([`Layout ${'AB'[k]}`, `${CLS[C['cls' + k][i]]} · r ${fmt.f2(C['rel' + k][i])}`]));
    if (S.color.startsWith('gene:') && GENE.has(S.color.slice(5))) rows.push([S.color.slice(5), fmt.f2(GENE.get(S.color.slice(5))[i]) + ' log1p']);
    showTip(ev, cellTip(i, rows));
  }
  function lensReadout(i, nb) {
    const el = document.getElementById('lens-readout');
    el.hidden = !(sensOn() && S.lens);
    if (el.hidden) return;
    if (i < 0 || !nb.length) { el.innerHTML = `<b>Lens on</b> · hover a DG cell to see its ${KL} nearest neighbours in PCA space (rings + spokes)`; return; }
    const kept = M.min_dists.map((m, k) => Math.round(C['pres' + k][i] * KL));
    const dsp = median(nb.map(j => Math.hypot(C.x[j] - C.x[i], C.y[j] - C.y[i])));
    const spread = k => median(nb.map(j => Math.hypot(C[`u${k}_1`][j] - C[`u${k}_1`][i], C[`u${k}_2`][j] - C[`u${k}_2`][i])));
    el.innerHTML = `<b>Lens</b> · of ${KL} PCA neighbours, <b>${kept[0]}</b> stay nearest in layout A and <b>${kept[1]}</b> in B ·
      median UMAP distance A ${fmt.f2(spread(0))}, B ${fmt.f2(spread(1))} · median tissue distance ${fmt.um(dsp)}`;
  }

  /* ---------------- painting helpers */
  function ordered(idx, enc) {
    if (!enc.sort) return idx;
    return Array.from(idx).sort((a, b) => enc.sort(a) - enc.sort(b));
  }
  function paint(sc, idx, enc, r) {
    const back = [], front = [];
    for (const i of idx) { const c = paintColor(enc, i); (c === P.faint || c === P.bg ? back : front).push(i); }
    sc.dots(back, i => paintColor(enc, i), r * 0.8);
    sc.dots(front, i => paintColor(enc, i), r * (S.sel || S.pick.size ? 1.25 : 1));
  }
  function trustRings(sc, idx, k) {
    const c = C['cls' + k], dub = [];
    for (const i of idx) if (c[i] === 2) dub.push(i);
    sc.dots(dub, 'none', 3.6, { stroke: P.crit, lw: 1.6 });
  }
  const _regionAt = new Map();
  function regionLabels(si) {
    if (_regionAt.has(si)) return _regionAt.get(si);
    const all = Array.from(cellsOf(si, 'qc')), out = [];
    for (let r = 0; r < REG.length; r++) {
      const ids = all.filter(i => C.region[i] === r);
      if (ids.length >= 80) out.push({ r, x: d3.median(ids, i => C.x[i]), y: d3.median(ids, i => C.y[i]) });
    }
    _regionAt.set(si, out);
    return out;
  }
  function nearestLinks(idx) {
    if (!idx.length || idx.length > 400) return [];
    const ref = Array.from(cellsOf(S.focus, 'qc')).filter(i => C.broad[i] === S.ref);
    if (!ref.length) return [];
    const q = d3.quadtree().x(i => C.x[i]).y(i => C.y[i]).addAll(ref), out = [];
    for (const i of idx) {
      const self = C.broad[i] === S.ref;
      if (self) q.remove(i);
      const j = q.find(C.x[i], C.y[i]);
      if (self) q.add(i);
      if (j !== undefined) out.push([i, j]);
    }
    return out;
  }

  /* turn the legend categories currently shown into a selection (focus section) */
  function selectPicked(enc) {
    if (!S.pick.size || !enc.key) return;
    const pool = enc.perSection || S.color === 'trust' || S.color === 'pres' ? cellsOf(S.focus, 'dg') : cellsOf(S.focus, enc.withFailed ? 'all' : 'qc');
    const idx = Array.from(pool).filter(i => S.pick.has(enc.key(i)));
    const names = enc.legend.filter(d => S.pick.has(d.k)).map(d => d.label);
    const meta = S.color === 'cluster' && S.pick.size === 1 ? { cluster: [...S.pick][0] } : {};
    setSelection(idx, `${SEC[S.focus].name} · ${names.length > 3 ? names.length + ' categories' : names.join(' + ')}`, meta);
  }

  /* ---------------- construction */
  function init() {
    const mkScatter = (id, opts) => new Scatter(document.getElementById(id), Object.assign({ lasso: true, zoom: true, zoomGrow: true, onHover: hover }, opts));
    tissue = mkScatter('v-tissue', { r: 1.3,
      onLasso: idx => setSelection(idx, `${idx.length} cells lassoed in tissue`),
      onClick: i => { if (i < 0) clearSelection(); else if (C.leiden[i] !== 255 && S.color === 'cluster') selectCluster(S.focus, C.leiden[i]); } });
    const umapOpts = k => ({ r: 1.7, equal: false,
      onLasso: idx => setSelection(idx, `${idx.length} cells lassoed in UMAP ${'AB'[k]}`),
      onClick: i => (i >= 0 ? selectCluster(S.focus, C.leiden[i]) : clearSelection()) });
    ua = mkScatter('v-umapA', umapOpts(0));
    ub = mkScatter('v-umapB', umapOpts(1));
    scatterTools('v-tissue', tissue, { extra: [['DG', 'Zoom to the dentate gyrus', () => tissue.zoomTo(cellsOf(S.focus, 'dg'))]] });
    scatterTools('v-umapA', ua); scatterTools('v-umapB', ub);
    stack = new Stack3D(document.getElementById('v-stack'), { r: 0.8, onHover: hover, onPickSection: si => update({ focus: si }) });
    stack.setData(SEC.map(s => ({ si: s.i, idx: cellsOf(s.i, 'all'), depth: s.depth_mm })), C.x, C.y);
    window.__views = { stack, tissue, ua, ub }; // console debugging

    document.querySelectorAll('#mv-view button').forEach(b => b.onclick = () => {
      const v = b.dataset.v, patch = { view: v };
      if (v === 'compare' && S.view !== 'compare') Object.assign(patch, { evid: 'reliability', trust: true });
      if (v !== 'compare' && S.evid === 'reliability') patch.evid = 'groups';
      update(patch);
    });
    document.getElementById('mv-color').onchange = async e => { const v = e.target.value; if (v.startsWith('gene:')) await loadGene(v.slice(5)); update({ color: v, pick: new Set() }); };
    for (const [id, k] of [['t-trust', 'trust'], ['t-lens', 'lens'], ['t-links', 'links']])
      document.getElementById(id).onclick = () => update({ [k]: !S[k] });
    document.querySelectorAll('#stack-spacing button').forEach(b => b.onclick = () => { stack.setSpacing(b.dataset.v); stackKey = ''; update(); });
    const views = { oblique: [-14, 50], side: [0, 6], top: [0, 90] };
    document.querySelectorAll('[data-sview]').forEach(b => b.onclick = () => stack.setView(...views[b.dataset.sview]));
  }

  /* ---------------- header + legend */
  function header(enc) {
    document.querySelectorAll('#mv-view button').forEach(b => b.classList.toggle('on', b.dataset.v === S.view));
    const sel = document.getElementById('mv-color');
    sel.innerHTML = encodingOptions().map(([v, l]) => `<option value="${v}"${v === S.color ? ' selected' : ''}>${l}</option>`).join('');
    for (const [id, k] of [['t-trust', 'trust'], ['t-lens', 'lens'], ['t-links', 'links']]) document.getElementById(id).classList.toggle('on', S[k]);
    // helpers belong to one view each: links -> one section; reliability rings + lens -> UMAP sensitivity
    document.getElementById('t-trust').style.display = sensOn() ? '' : 'none';
    document.getElementById('t-lens').style.display = sensOn() ? '' : 'none';
    document.getElementById('t-links').style.display = S.view === 'section' ? '' : 'none';
    const lg = document.getElementById('mv-legend');
    lg.innerHTML = (S.view === 'grid' ? '<span class="it muted">colour applies to the 3D stack ·</span>' : '') + encodingLegendHTML(enc) +
      (sensOn() && S.trust ? `<span class="it"><span class="sw" style="border:1.6px solid ${P.crit};background:none"></span>dubious position (scDEED)</span>` : '');
    lg.querySelectorAll('.it.click').forEach(it => it.onclick = () => {
      const k = +it.dataset.k, pick = new Set(S.pick);
      pick.has(k) ? pick.delete(k) : pick.add(k);
      update({ pick });
    });
    lg.querySelectorAll('.legbtn').forEach(b => b.onclick = () => (b.dataset.act === 'all' ? update({ pick: new Set() }) : selectPicked(enc)));
    const cells = { tissue: 'mv-tissue', A: 'mv-umapA', B: 'mv-umapB', grid: 'mv-grid' };
    const show = S.view === 'grid' ? ['grid'] : S.view === 'compare' ? ['tissue', 'A', 'B'] : ['tissue', 'A'];
    for (const [k, id] of Object.entries(cells)) document.getElementById(id).style.display = show.includes(k) ? '' : 'none';
    document.getElementById('mv').dataset.view = S.view;
  }

  /* ---------------- tissue + UMAPs */
  function drawTissue(enc) {
    const si = S.focus, kind = enc.withFailed ? 'all' : 'qc', key = si + kind;
    if (tissue._k !== key) { tissue.setPoints(C.x, C.y, cellsOf(si, kind), cellsOf(si, 'all')); tissue._k = key; }
    tissue.hoverIdx = tissue.idx; tissue.selectIdx = cellsOf(si, 'qc');
    const idx = ordered(tissue.idx, enc);
    const coi = Evidence.cellsOfInterest();
    const linksOn = S.links && S.view === 'section', links = linksOn ? nearestLinks(coi.idx) : [];
    tissue.draw(sc => {
      paint(sc, idx, enc, 1.3);
      if (sensOn() && S.trust) trustRings(sc, cellsOf(si, 'dg'), 0);
      if (links.length) {
        sc.segments(links, P.text2, 0.8);
        sc.dots([...new Set(links.map(l => l[1]))], 'none', 2.6, { stroke: broadColor(S.ref), lw: 1.4 });
      }
      sc.scaleBar(500);
    }, (sc, g) => {
      for (const r of regionLabels(si)) g.append('text').attr('class', 'region').attr('x', sc.pxv(r.x)).attr('y', sc.pyv(r.y)).attr('text-anchor', 'middle').text(REG[r.r]);
    });
    document.getElementById('mv-tissue-sub').textContent = `${SEC[si].name} · ${fmt.f2(SEC[si].depth_mm)} mm` +
      (linksOn ? ` · ${links.length ? links.length + ' links to nearest ' + BROAD[S.ref].toLowerCase() : 'links hidden (> 400 cells)'}` : '');
  }
  function drawUmap(k, enc) {
    const si = S.focus, u = umap(k), dg = cellsOf(si, 'dg');
    if (u._si !== si) { u.setPoints(C[`u${k}_1`], C[`u${k}_2`], dg); u._si = si; }
    u.hoverIdx = dg; u.selectIdx = dg;
    const idx = ordered(dg, enc);
    u.draw(sc => { paint(sc, idx, enc, 1.7); if (sensOn() && S.trust) trustRings(sc, dg, k); }, (sc, g) => {
      if (S.color !== 'cluster') return;
      for (let c = 0; c < nClusters(si); c++) {
        const ids = Array.from(dg).filter(i => C.leiden[i] === c);
        if (ids.length) g.append('text').attr('x', d3.median(ids, i => sc.px(i))).attr('y', d3.median(ids, i => sc.py(i)))
          .attr('text-anchor', 'middle').attr('font-weight', 700).text(c);
      }
    });
    const r = SEC[si].scdeed[k];
    document.getElementById(`mv-umap${'AB'[k]}-sub`).innerHTML = sensOn()
      ? `min_dist ${r.min_dist} · <b style="color:${P.crit}">${r.dubious} dubious</b> of ${fmt.int(dg.length)}`
      : `${SEC[si].name} · ${fmt.int(dg.length)} DG cells`;
  }

  /* ---------------- 3D stack */
  function drawStack(enc) {
    const scope = scopeSecs(), scopeKey = scope.map(s => s.i).join(',');
    if (stack._scope !== scopeKey) {
      const wasSingle = stack._single;
      stack.setData(scope.map(s => ({ si: s.i, idx: cellsOf(s.i, 'all'), depth: s.depth_mm })), C.x, C.y);
      stack._scope = scopeKey; stack._single = scope.length === 1;
      if (stack._single) stack.setView(0, 90);           // single-section view: flat, top-down
      else if (wasSingle) stack.setView(-14, 50);
      stackKey = '';
    }
    document.querySelector('#p-stack h3').textContent = stack._single ? `Section ${scope[0].name}` : `Sections in 3D (${scope.length})`;
    document.getElementById('stack-spacing').style.display = stack._single ? 'none' : '';
    const key = [S.color, S.focus, [...S.pick].join(), S.sel ? S.sel.label + S.sel.n : '', [...S.nsc].join(), S.nscThr, P.surface, scopeKey].join('|');
    document.querySelectorAll('#stack-spacing button').forEach(b => b.classList.toggle('on', b.dataset.v === stack.spacing));
    if (key === stackKey) return;
    stackKey = key;
    stack.backColors = new Set([P.faint, P.bg]);
    stack.colorFn = i => (!C.qc[i] && !enc.withFailed ? null : paintColor(enc, i, { focusOnly: true }));
    stack.draw();
    document.getElementById('stack-sub').textContent = stack._single ? `${fmt.f2(scope[0].depth_mm)} mm · ${fmt.int(scope[0].n)} cells · single-section view`
      : enc.perSection ? 'groups shown for the focus section only' : 'same encoding as the tissue map';
  }

  /* ---------------- gene × section grid (Q1) */
  function buildGrid() {
    const host = document.getElementById('v-grid'), secs = SEC.filter(s => S.shown.has(s.i)), genes = S.genes;
    const key = secs.map(s => s.i).join(',') + '|' + genes.join(',');
    if (key === gridKey) return;
    gridKey = key; host.innerHTML = ''; grid = [];
    if (!genes.length || !secs.length) { host.innerHTML = '<p class="note">Add genes and sections in the sidebar.</p>'; return; }
    const cb = el('div', { class: 'colorbar' });
    cb.innerHTML = `<span>not detected / below threshold</span><span class="bar" style="background:${P.bg};width:18px"></span><span>low</span>
      <span class="bar" style="background:${cssRamp(P.seq)}"></span><span>≥ 99th pct of detecting cells (per gene)</span>`;
    host.appendChild(cb);
    const g = el('div', { class: 'smgrid' });
    g.style.gridTemplateColumns = `64px repeat(${secs.length}, minmax(0, 1fr))`;
    g.appendChild(el('div'));
    secs.forEach(s => g.appendChild(el('div', { class: 'colh' }, `${s.name}<span>${fmt.f2(s.depth_mm)} mm</span>`)));
    for (const gene of genes) {
      const det = secs.reduce((a, s) => a + M.genes[gene].detected[s.i], 0), n = secs.reduce((a, s) => a + s.qc.n_pass, 0);
      g.appendChild(el('div', { class: 'rowh' }, `${gene}<span>${fmt.pct1(det / n)} of cells</span>`));
      for (const s of secs) {
        const box = el('div', { class: 'cell' });
        box.style.aspectRatio = '1.45';
        g.appendChild(box);
        const sc = new Scatter(box, { pad: 4, r: 0.9, onHover: (i, ev) => (i < 0 ? hideTip() : showTip(ev, cellTip(i, [[gene, fmt.f2(GENE.get(gene)[i]) + ' log1p']]))) });
        sc.setPoints(C.x, C.y, cellsOf(s.i, 'qc'));
        grid.push({ sc, gene, si: s.i });
      }
    }
    host.appendChild(g);
  }
  const _ord = new Map();
  function drawGrid() {
    for (const c of grid) {
      const v = GENE.get(c.gene);
      if (!v) continue;
      const k = c.gene + '|' + c.si;
      if (!_ord.has(k)) _ord.set(k, Array.from(cellsOf(c.si, 'qc')).sort((a, b) => v[a] - v[b]));
      const idx = _ord.get(k), q = M.genes[c.gene].q99, anyReg = S.regions.size > 0;
      c.sc.draw(sc => {
        const inReg = i => !anyReg || S.regions.has(C.region[i]);
        const bgIn = [], bgOut = [], onIn = [], onOut = [];
        for (const i of idx) { const on = v[i] > 0 && v[i] / q >= S.thr; (on ? (inReg(i) ? onIn : onOut) : (inReg(i) ? bgIn : bgOut)).push(i); }
        const color = i => rampAt(P.seq, Math.min(1, v[i] / q));
        sc.dots(bgOut, P.faint, 0.8); sc.dots(bgIn, P.bg, 0.8);
        sc.dots(onOut, color, 1.0, { alpha: 0.35 }); sc.dots(onIn, color, 1.0);
      });
    }
  }

  function render() {
    if (!tissue) init();
    if (!sensOn() && (S.color === 'trust' || S.color === 'pres')) S.color = 'cluster';
    const enc = encoding();
    header(enc);
    drawStack(enc);
    if (S.view === 'grid') { buildGrid(); drawGrid(); return; }
    drawTissue(enc);
    if (S.view === 'compare') { drawUmap(0, encoding(S.color, 0)); drawUmap(1, encoding(S.color, 1)); }
    else drawUmap(0, enc);
  }
  function invalidate() { gridKey = ''; stackKey = ''; }
  return { render, invalidate };
})();
