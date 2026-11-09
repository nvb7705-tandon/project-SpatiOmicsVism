/* core.js — data decoding, lazy gene loading, shared state, colour tokens, tooltip. */
'use strict';

const fmt = {
  int: d3.format(',.0f'), pct: d3.format('.0%'), pct1: d3.format('.1%'),
  f1: d3.format('.1f'), f2: d3.format('.2f'), f3: d3.format('.3f'), um: v => `${d3.format('.1f')(v)} µm`,
};

/* ---------------------------------------------------------------- data */
const DT = { f4: Float32Array, u1: Uint8Array, u2: Uint16Array, i4: Int32Array };
function b64ToBytes(b64) {
  const bin = atob(b64), n = bin.length, u = new Uint8Array(n);
  for (let i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
  return u;
}
const M = window.__cells.meta;
const C = {};
for (const [k, v] of Object.entries(window.__cells.cols)) C[k] = new DT[v.dtype](b64ToBytes(v.b64).buffer);
delete window.__cells;

const N = M.n_cells;
const REG = M.regions, BROAD = M.broad, SUBT = M.subtypes;
const DG = REG.indexOf('DG');
const SEC = [];
{
  let off = 0;
  M.sections.forEach((s, i) => { SEC.push({ ...s, i, start: off, end: off + s.n }); off += s.n; });
}
const secByName = Object.fromEntries(SEC.map(s => [s.name, s.i]));
const DEPTH_EXTENT = d3.extent(SEC, s => s.depth_mm);

/* cached index lists per section */
const _idx = new Map();
function cellsOf(si, kind = 'qc') {
  const key = si + '|' + kind;
  if (_idx.has(key)) return _idx.get(key);
  const s = SEC[si], out = [];
  for (let i = s.start; i < s.end; i++) {
    if (kind === 'all') out.push(i);
    else if (kind === 'qc') { if (C.qc[i]) out.push(i); }
    else if (kind === 'dg') { if (C.qc[i] && C.region[i] === DG && C.leiden[i] !== 255) out.push(i); }
    else if (kind === 'nondg') { if (C.qc[i] && !(C.region[i] === DG && C.leiden[i] !== 255)) out.push(i); }
    else if (kind === 'fail') { if (!C.qc[i]) out.push(i); }
  }
  const arr = Int32Array.from(out);
  _idx.set(key, arr);
  return arr;
}
function nClusters(si) { return SEC[si].n_clusters; }

/* ---------------------------------------------------------------- genes (lazy) */
const GENE = new Map();
const _pending = new Map();
window.__gene = (name, b64) => {
  const u = b64ToBytes(b64), k = M.genes[name].vmax / 255, f = new Float32Array(u.length);
  for (let i = 0; i < u.length; i++) f[i] = u[i] * k;
  GENE.set(name, f);
  const p = _pending.get(name);
  if (p) { p.res(f); _pending.delete(name); }
};
function loadGene(name) {
  if (GENE.has(name)) return Promise.resolve(GENE.get(name));
  if (!M.genes[name]) return Promise.reject(new Error('not in panel: ' + name));
  if (_pending.has(name)) return _pending.get(name).promise;
  let res, rej;
  const promise = new Promise((a, b) => { res = a; rej = b; });
  _pending.set(name, { promise, res, rej });
  const s = document.createElement('script');
  s.src = `data/genes/${M.genes[name].file}.js`;
  s.onload = () => s.remove();
  s.onerror = () => { _pending.delete(name); rej(new Error('failed to load ' + name)); };
  document.head.appendChild(s);
  return promise;
}
const loadGenes = names => Promise.all([...new Set(names)].filter(g => M.genes[g]).map(loadGene));
const inPanel = g => !!M.genes[g];
/* expression scaled 0–1 by the gene's 99th percentile among detecting cells */
const scaled = (g, i) => Math.min(1, GENE.get(g)[i] / M.genes[g].q99);

/* ---------------------------------------------------------------- state */
const S = {
  tour: true,                             // guided tour on (story card + step pills) or off (free exploration)
  step: 0,                                // guided-story step (story.js)
  view: 'section',                        // main viewer: 'section' | 'compare' (UMAP sensitivity) | 'grid'
  color: 'region',                        // ONE encoding shared by 3D stack, tissue and UMAPs
  layout: 0,                              // UMAP layout used by the tissue map in the sensitivity view (0 = A)
  evid: 'data',                           // evidence panel tab
  trust: false,                           // sensitivity view only: ring dubious cells (scDEED)
  lens: false,                            // sensitivity view only: show true PCA neighbours on hover
  links: false,                           // links to nearest reference cell (tissue)
  pick: new Set(),                        // legend categories shown (multi-select); empty = show all
  shown: new Set(SEC.map(s => s.i)),      // sections in scope (3D stack, grid, across-section charts); one = single-section view
  focus: secByName['T30'] ?? 0,           // the section shown in tissue / UMAP / evidence
  regions: new Set([DG, REG.indexOf('CA1')]),
  genes: ['PROX1', 'FIBCD1', 'GFAP', 'SLC1A3', 'GAD1'].filter(inPanel),
  thr: 0,
  nsc: new Set(M.nsc_markers.filter(inPanel)),
  nscThr: 0.25,
  ref: BROAD.indexOf('Astrocyte'),
  radius: 25,
  q1view: 'depth',
  nullMode: 'all',                        // permutation null: 'all' DG labels, or 'astro' (within astrocytes)
  sel: null,                              // { mask: Uint8Array(N), n, label, si, idx, cluster }
};

/* neighbour graphs exported by precompute.py */
const KL = M.k_lens || 15, KS = M.k_spatial || 10;
function pcaNeighbours(i) {
  const r = C.dgrow ? C.dgrow[i] : -1;
  return r < 0 ? [] : Array.from(C.pknn.subarray(r * KL, r * KL + KL));
}
/* embedding-quality information (scDEED, lens) lives only in the UMAP sensitivity view */
const sensOn = () => S.view === 'compare';
/* sections in scope, in depth order; single-section view when there is exactly one */
const scopeSecs = () => SEC.filter(s => S.shown.has(s.i));
const singleSection = () => S.shown.size === 1;

function spatialNeighbours(i) {
  if (!C.sknn) return [];
  const s = SEC[C.sec[i]], out = [];
  for (let k = 0; k < KS; k++) { const v = C.sknn[i * KS + k]; if (v !== 65535) out.push(s.start + v); }
  return out;
}
const SLIDE_GENES = ['PROX1', 'FIBCD1', 'GFAP', 'SLC1A3', 'GAD1'];
const PAPER_GENES = ['PROX1', 'FIBCD1', 'HOMER3', 'NTS']; // conserved subregion markers, Fei et al. 2026 Fig. 1D

let _raf = 0;
const _renderers = [];
function onRender(fn) { _renderers.push(fn); }
function update(patch) {
  if (patch) Object.assign(S, patch);
  if (_raf) return;
  _raf = 1;
  // rAF for smooth updates; the timeout fallback keeps rendering when the tab is hidden (rAF is paused there)
  const run = () => { if (!_raf) return; _raf = 0; _renderers.forEach(fn => fn()); };
  requestAnimationFrame(run);
  setTimeout(run, 80);
}

/* selection shared by every linked view */
function setSelection(indices, label, meta = {}) {
  if (!indices || !indices.length) { S.sel = null; update(); return; }
  const mask = new Uint8Array(N);
  for (const i of indices) mask[i] = 1;
  S.sel = { mask, n: indices.length, label, si: C.sec[indices[0]], idx: Int32Array.from(indices), cluster: null, ...meta };
  update();
}
function selectCluster(si, c) {
  const idx = cellsOf(si, 'dg').filter(i => C.leiden[i] === c);
  setSelection(idx, `${SEC[si].name} · DG group ${c}`, { cluster: c });
}
function clearSelection() { S.sel = null; update(); }
const isSel = i => S.sel && S.sel.mask[i] === 1;
const selIn = si => S.sel && S.sel.si === si;

/* NSC score (computed client-side so the marker library can be edited) */
let _nsc = { key: null, arr: null };
function nscScore() {
  const genes = [...S.nsc].filter(g => GENE.has(g)).sort();
  const key = genes.join(',');
  if (_nsc.key === key) return _nsc.arr;
  const arr = new Float32Array(N);
  if (genes.length) {
    const cols = genes.map(g => [GENE.get(g), M.genes[g].q99]);
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (const [v, q] of cols) s += Math.min(1, v[i] / q);
      arr[i] = s / cols.length;
    }
  }
  _nsc = { key, arr };
  return arr;
}

/* ---------------------------------------------------------------- colour */
let P = {};
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function ramp(lo, hi, n = 64) {
  const it = d3.interpolateLab(lo, hi);
  return d3.range(n).map(i => d3.color(it(i / (n - 1))).formatHex());
}
function divRamp(neg, mid, pos, n = 65) {
  const a = d3.interpolateLab(neg, mid), b = d3.interpolateLab(mid, pos), h = (n - 1) / 2;
  return d3.range(n).map(i => d3.color(i <= h ? a(i / h) : b((i - h) / h)).formatHex());
}
function refreshPalette() {
  const cat = [1, 2, 3, 4, 5, 6, 7, 8].map(k => cssVar('--s' + k));
  P = {
    cat, crit: cssVar('--critical'), text: cssVar('--text'), text2: cssVar('--text-2'), muted: cssVar('--muted'),
    grid: cssVar('--grid'), axis: cssVar('--axis'), surface: cssVar('--surface'), bg: cssVar('--cell-bg'),
    faint: cssVar('--cell-faint'), sel: cssVar('--sel'), accent: cssVar('--accent'),
    seq: ramp(cssVar('--seq-lo'), cssVar('--seq-hi')),
    nsc: ramp(cssVar('--nsc-lo'), cssVar('--nsc-hi')),
    div: divRamp(cssVar('--div-neg'), cssVar('--div-mid'), cssVar('--div-pos')),
  };
}
const rampAt = (r, t) => r[Math.max(0, Math.min(r.length - 1, Math.round((t || 0) * (r.length - 1))))];
const broadColor = b => P.cat[b];
const clusterColor = c => (c < 8 ? P.cat[c] : P.muted);
/* fixed region -> slot mapping (DG and CA1 get the two leading slots) */
const REGION_SLOT = { DG: 0, CA1: 1, CA3: 2, SUB: 3, CA2: 4, CA4: 5, preS: 6, proS: 7, paraS: -1 };
const regionColor = r => (REGION_SLOT[REG[r]] >= 0 ? P.cat[REGION_SLOT[REG[r]]] : P.muted);
const CLS = ['Trustworthy', 'Intermediate', 'Dubious'];
const clsColor = k => [P.cat[0], P.muted, P.crit][k];

/* ---------------------------------------------------------------- tooltip */
const tipEl = d3.select('body').append('div').attr('class', 'tip');
function showTip(ev, html) {
  tipEl.html(html).style('display', 'block');
  const r = tipEl.node().getBoundingClientRect();
  let x = ev.clientX + 14, y = ev.clientY + 14;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14;
  tipEl.style('left', x + 'px').style('top', y + 'px');
}
function hideTip() { tipEl.style('display', 'none'); }
const tipRows = rows => rows.map(([k, v]) => `<div class="r"><span>${k}</span><span>${v}</span></div>`).join('');
function cellTip(i, extra = []) {
  const rows = [['Section', SEC[C.sec[i]].name], ['Region', REG[C.region[i]]], ['Published type', SUBT[C.sub[i]]]];
  if (C.leiden[i] !== 255) rows.push(['Leiden cluster', C.leiden[i]]);
  return `<div class="h">Cell ${i - SEC[C.sec[i]].start + 1}</div>` + tipRows(rows.concat(extra));
}

/* ---------------------------------------------------------------- small helpers */
function el(tag, attrs = {}, html) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html !== undefined) e.innerHTML = html;
  return e;
}
function mean(arr) { let s = 0; for (const v of arr) s += v; return arr.length ? s / arr.length : NaN; }
function median(arr) { if (!arr.length) return NaN; const a = Float64Array.from(arr).sort(); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
function legendHTML(items, { square = false } = {}) {
  return items.map(d => `<span class="it${d.click ? ' click' : ''}${d.dim ? ' dim' : ''}" data-k="${d.k ?? ''}">
    <span class="sw${square ? ' sq' : ''}" style="background:${d.color}"></span>${d.label}</span>`).join('');
}
