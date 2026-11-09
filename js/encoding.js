/* encoding.js — ONE colour encoding shared by the 3D stack, the tissue map and both UMAPs.
   encoding() returns:
     fn(i)      -> colour, or null when the attribute does not apply to cell i (drawn as gray context)
     key(i)     -> category id (for legend isolation), categorical encodings only
     sort(i)    -> draw order (ascending; high values on top), optional
     legend     -> [{k, label, color, click}] or ramp {ramp, lo, hi, label}
     perSection -> true when values are not comparable across sections (Leiden group numbers)
     withFailed -> true when QC-removed cells should be drawn too */
'use strict';

function encodingOptions() {
  // embedding-quality encodings are offered only in the UMAP sensitivity view
  const sens = sensOn() ? [['trust', 'UMAP reliability (scDEED)'], ['pres', 'Neighbour preservation']] : [];
  return [['region', 'Region'], ['type', 'Cell type (published)'], ['cluster', 'DG group (Leiden)'], ['nsc', 'NSC score']]
    .concat(sens, [['qc', 'Quality control']], S.genes.map(g => ['gene:' + g, 'Gene · ' + g]));
}
const ENC_LABEL = { region: 'Region', type: 'Published cell type', cluster: 'DG Leiden group', nsc: 'NSC score',
  trust: 'scDEED reliability class', pres: 'Neighbour preservation', qc: 'QC kept / removed' };

let _nscMax = { key: null, v: 1 };
function nscMax() {
  const k = S.focus + '|' + [...S.nsc].sort().join(',');
  if (_nscMax.key === k) return _nscMax.v;
  const sc = nscScore(), v = Array.from(cellsOf(S.focus, 'dg'), i => sc[i]).sort((a, b) => a - b);
  _nscMax = { key: k, v: Math.max(0.05, v[Math.floor(v.length * 0.995)] || 0.05) };
  return _nscMax.v;
}

function encoding(key = S.color, k = S.layout) {
  if (key === 'region') return {
    fn: i => regionColor(C.region[i]), key: i => C.region[i],
    legend: REG.map((r, j) => ({ k: j, label: r, color: regionColor(j), click: true })) };
  if (key === 'type') return {
    fn: i => broadColor(C.broad[i]), key: i => C.broad[i],
    legend: BROAD.map((b, j) => ({ k: j, label: b, color: broadColor(j), click: true })) };
  if (key === 'cluster') return {
    perSection: true, fn: i => (C.leiden[i] !== 255 ? clusterColor(C.leiden[i]) : null), key: i => C.leiden[i],
    legend: d3.range(nClusters(S.focus)).map(c => ({ k: c, label: `Group ${c}`, color: clusterColor(c), click: true })) };
  if (key === 'qc') return {
    withFailed: true, fn: i => (C.qc[i] ? P.cat[0] : P.crit), key: i => C.qc[i],
    legend: [{ k: 1, label: 'Kept', color: P.cat[0], click: true }, { k: 0, label: 'Removed by QC', color: P.crit, click: true }] };
  if (key === 'trust') {
    const c = C['cls' + k];
    return { fn: i => (c[i] !== 255 ? clsColor(c[i]) : null), key: i => c[i], sort: i => c[i],
      legend: CLS.map((l, j) => ({ k: j, label: l, color: clsColor(j), click: true })),
      note: `classes for layout ${'AB'[k]} (min_dist ${M.min_dists[k]})` };
  }
  if (key === 'pres') {
    const v = C['pres' + k];
    return { fn: i => (v[i] === v[i] ? rampAt(P.seq, v[i]) : null), sort: i => -v[i],
      legend: { ramp: P.seq, lo: '0', hi: '1', label: `share of 15 PCA neighbours that are also UMAP neighbours (layout ${'AB'[k]})` } };
  }
  if (key === 'nsc') {
    const sc = nscScore(), mx = nscMax();
    return { fn: i => rampAt(P.nsc, sc[i] / mx), sort: i => sc[i],
      legend: { ramp: P.nsc, lo: '0', hi: fmt.f2(mx), label: `NSC score (threshold ${fmt.f2(S.nscThr)})` } };
  }
  if (key.startsWith('gene:')) {
    const g = key.slice(5), v = GENE.get(g), q = M.genes[g].q99;
    if (!v) return { fn: () => P.bg, legend: [] };
    return { fn: i => (v[i] > 0 ? rampAt(P.seq, Math.min(1, v[i] / q)) : P.bg), sort: i => v[i],
      legend: { ramp: P.seq, lo: '0', hi: '99th pct', label: `${g} · log1p(counts/10k)` } };
  }
  return { fn: () => P.muted, legend: [] };
}

/* the colour actually painted, after selection and legend isolation */
function paintColor(enc, i, { focusOnly = false } = {}) {
  if (enc.perSection && focusOnly && C.sec[i] !== S.focus) return P.bg;
  let c = enc.fn(i);
  if (c == null) return P.bg;
  if (S.sel && C.sec[i] === S.sel.si && !isSel(i)) return P.faint;
  if (S.pick.size && enc.key && !S.pick.has(enc.key(i))) return P.faint;
  return c;
}

function encodingLegendHTML(enc) {
  if (!enc.legend) return '';
  if (!Array.isArray(enc.legend)) {
    const l = enc.legend;
    return `<span class="colorbar" style="margin:0"><span>${l.lo}</span><span class="bar" style="background:${cssRamp(l.ramp)}"></span><span>${l.hi} · ${l.label}</span></span>`;
  }
  const picked = S.pick.size > 0;
  return legendHTML(enc.legend.map(d => ({ ...d, dim: picked && !S.pick.has(d.k) }))) +
    (enc.note ? `<span class="it muted">${enc.note}</span>` : '') +
    (picked ? `<button class="legbtn" data-act="all">show all</button><button class="legbtn primary" data-act="select" title="Use the shown categories in the focus section as the selection for the charts">Select these cells</button>`
            : `<span class="it muted">click to show / hide (several allowed)</span>`);
}
