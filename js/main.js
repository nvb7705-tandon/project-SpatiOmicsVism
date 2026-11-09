/* main.js — sidebar controls, depth strip, selection chip and render dispatch for the integrated workspace. */
'use strict';

// ?theme=light / ?theme=dark forces a theme (used for printable screenshots); otherwise follow the OS
const _theme = new URLSearchParams(location.search).get('theme');
if (_theme === 'light' || _theme === 'dark') document.documentElement.dataset.theme = _theme;
refreshPalette();

/* ---------------- depth strip: sections at their true position; ☐ = shown in the grid, name = focus */
function renderDepthStrip() {
  const host = document.getElementById('depth-strip');
  host.innerHTML = '';
  const W = host.clientWidth || 250, H = 206;
  const svg = d3.select(host).append('svg').attr('width', W).attr('height', H);
  const y = d3.scaleLinear().domain(DEPTH_EXTENT).range([24, H - 8]);
  svg.append('line').attr('x1', 30).attr('x2', 30).attr('y1', 4).attr('y2', H - 4).attr('stroke', P.axis).attr('stroke-width', 2);
  svg.append('text').attr('class', 'lbl').attr('x', W).attr('y', 9).attr('text-anchor', 'end').text('position (ebz) ↓');
  for (const s of SEC) {
    const shown = S.shown.has(s.i), focus = s.i === S.focus;
    const g = svg.append('g').attr('class', 'sec').attr('transform', `translate(0,${y(s.depth_mm)})`);
    g.append('rect').attr('x', 4).attr('y', -5).attr('width', 10).attr('height', 10).attr('rx', 2)
      .attr('fill', shown ? P.accent : P.surface).attr('stroke', shown ? P.accent : P.muted).style('cursor', 'pointer')
      .on('click', () => { const sh = new Set(S.shown); if (sh.has(s.i) && sh.size > 1) sh.delete(s.i); else sh.add(s.i); update({ shown: sh }); });
    const t = g.append('g').style('cursor', 'pointer').on('click', () => update({ focus: s.i, shown: S.shown.has(s.i) ? S.shown : new Set([...S.shown, s.i]) }));
    t.append('rect').attr('class', 'hit').attr('x', 22).attr('y', -7).attr('width', W - 24).attr('height', 14).attr('rx', 4).attr('fill', 'transparent');
    t.append('circle').attr('cx', 30).attr('r', focus ? 5.5 : 3.5).attr('fill', focus ? P.accent : P.surface).attr('stroke', focus ? P.accent : P.muted).attr('stroke-width', 1.5);
    t.append('text').attr('x', 42).attr('y', 4).attr('font-weight', focus ? 700 : 400).text(s.name);
    t.append('text').attr('class', 'meta').attr('x', 74).attr('y', 4).text(`${fmt.f2(s.depth_mm)} mm · ${fmt.int(s.n)} cells`);
  }
}

/* ---------------- sidebar */
function renderRegions() {
  const host = document.getElementById('region-list');
  host.innerHTML = REG.map((r, k) => `<label><input type="checkbox" data-r="${k}" ${S.regions.has(k) ? 'checked' : ''}><span class="sw" style="background:${regionColor(k)}"></span>${r}</label>`).join('');
  host.querySelectorAll('input').forEach(inp => inp.onchange = () => { const rs = new Set(S.regions); inp.checked ? rs.add(+inp.dataset.r) : rs.delete(+inp.dataset.r); update({ regions: rs }); });
}
function renderGeneChips() {
  const host = document.getElementById('gene-chips');
  host.innerHTML = S.genes.map(g => `<span class="chip">${g}<button data-g="${g}" title="Remove">×</button></span>`).join('') || '<span class="muted">No genes selected</span>';
  host.querySelectorAll('button').forEach(b => b.onclick = () => {
    const genes = S.genes.filter(g => g !== b.dataset.g);
    update({ genes, color: S.color === 'gene:' + b.dataset.g ? 'region' : S.color });
  });
}
function renderNscChips() {
  const host = document.getElementById('nsc-chips'), dg = cellsOf(S.focus, 'dg');
  host.innerHTML = M.nsc_markers.filter(inPanel).map(g => {
    const v = GENE.get(g), n = v ? dg.reduce((a, i) => a + (v[i] > 0 ? 1 : 0), 0) : '…';
    return `<span class="chip${S.nsc.has(g) ? ' on' : ''}" data-g="${g}">${g} <span class="n">${n}</span></span>`;
  }).join('');
  host.querySelectorAll('.chip').forEach(c => c.onclick = () => { const ns = new Set(S.nsc); ns.has(c.dataset.g) ? ns.delete(c.dataset.g) : ns.add(c.dataset.g); if (ns.size) update({ nsc: ns }); });
}
function renderSettings() {
  const st = M.settings;
  document.getElementById('settings').innerHTML = [
    ['QC', `median ± ${st.qc_mad_k} MAD per section`], ['Normalise', st.normalisation],
    ['DG embedding', `${st.n_hvg} HVGs · ${st.n_pcs} PCs · ${st.n_neighbors} NN (exact)`], ['Clustering', `Leiden, resolution ${st.leiden_resolution}`],
    ['UMAP', `A min_dist ${M.min_dists[0]} · B ${M.min_dists[1]}`], ['Markers', st.de], ['scDEED', st.scdeed],
    ['Lens', `${KL} nearest neighbours in PCA space`], ['Niche tests', `${KS}-NN spatial graph, 199 label permutations`],
    ['Units', `${st.um_per_unit} µm per Stereo-seq unit`], ['Seed', st.seed],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}
function syncInputs() {
  document.getElementById('thr').value = S.thr; document.getElementById('thr-out').textContent = fmt.pct(S.thr);
  document.getElementById('nsc-thr').value = S.nscThr; document.getElementById('nsc-out').textContent = fmt.f2(S.nscThr);
  document.getElementById('radius').value = S.radius; document.getElementById('rad-out').textContent = S.radius + ' µm';
  document.getElementById('ref-type').value = S.ref;
}
function renderSelChip() {
  const chip = document.getElementById('selchip');
  chip.hidden = !S.sel;
  if (S.sel) document.getElementById('seltext').textContent = `${S.sel.label} · ${fmt.int(S.sel.n)} cells`;
}

function initControls() {
  document.getElementById('gene-options').innerHTML = M.panel.slice().sort().map(g => `<option value="${g}">`).join('');
  const gi = document.getElementById('gene-input');
  const add = async () => {
    const g = gi.value.trim().toUpperCase(), match = M.panel.find(x => x.toUpperCase() === g);
    gi.value = '';
    if (match && !S.genes.includes(match) && S.genes.length < 12) { await loadGene(match); update({ genes: [...S.genes, match], color: 'gene:' + match }); }
  };
  gi.addEventListener('change', add);
  gi.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  document.querySelectorAll('.presets button').forEach(b => b.onclick = () => {
    const p = b.dataset.preset, genes = (p === 'paper' ? PAPER_GENES : p === 'slide' ? SLIDE_GENES : p === 'nsc' ? M.nsc_markers : []).filter(inPanel);
    update({ genes, color: S.color.startsWith('gene:') && !genes.includes(S.color.slice(5)) ? 'region' : S.color });
  });
  document.getElementById('thr').oninput = e => update({ thr: +e.target.value });
  document.getElementById('nsc-thr').oninput = e => update({ nscThr: +e.target.value });
  document.getElementById('radius').oninput = e => update({ radius: +e.target.value });
  const rt = document.getElementById('ref-type');
  rt.innerHTML = BROAD.map((b, k) => `<option value="${k}">${b}</option>`).join('');
  rt.onchange = e => update({ ref: +e.target.value });
  document.getElementById('selclear').onclick = clearSelection;
  document.getElementById('scope-all').onclick = () => update({ shown: new Set(SEC.map(s => s.i)) });
  document.getElementById('scope-one').onclick = () => update({ shown: new Set([S.focus]) });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') clearSelection(); });
  let rz = 0;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { Views.invalidate(); update(); }, 150); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { refreshPalette(); Views.invalidate(); update(); });
}

/* ---------------- render dispatch */
let _busy = false, _again = false;
async function renderAll() {
  if (_busy) { _again = true; return; }
  _busy = true;
  try {
    const need = [...M.nsc_markers, ...S.genes, ...(S.color.startsWith('gene:') ? [S.color.slice(5)] : [])];
    await loadGenes(need);
    if (!S.shown.has(S.focus)) S.focus = scopeSecs()[0].i;   // focus always inside the scope
    document.getElementById('scope-all').classList.toggle('on', S.shown.size === SEC.length);
    document.getElementById('scope-one').classList.toggle('on', singleSection());
    Story.render();
    Help.render();
    renderDepthStrip(); renderRegions(); renderGeneChips(); syncInputs(); renderSelChip();
    Views.render();
    Evidence.render();
    renderNscChips();
    // marker genes of the focus section's groups, fetched in the background (lasso rankings, click-to-map)
    const de = Object.values(SEC[S.focus].de).flatMap(r => r.map(x => x.gene)).filter(g => inPanel(g) && !GENE.has(g));
    if (de.length) loadGenes(de);
  } catch (err) {
    console.error(err);
  } finally {
    _busy = false;
    document.getElementById('loading').hidden = true;
    if (_again) { _again = false; renderAll(); }
  }
}
onRender(renderAll);

initControls();
renderSettings();
Story.init();
Help.init();
// tour on/off: ?tour=off (or explore.html) wins, then the saved preference, then on
const _tq = new URLSearchParams(location.search).get('tour');
let _tourPref = null;
try { _tourPref = localStorage.getItem('mhe-tour'); } catch (e) { /* storage unavailable */ }
const m = location.hash.match(/step=(\d+)/);
const _tourOn = _tq ? _tq !== 'off' : (m ? true : _tourPref !== 'off');   // a #step=N deep link always opens the tour
if (_tourOn) Story.go(m ? +m[1] : 0);
else update({ tour: false });
