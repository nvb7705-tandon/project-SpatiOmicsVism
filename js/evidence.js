/* evidence.js — the evidence panel under the workspace. One panel, five lenses on the same state:
   data (QC), regions (Q1), groups (Q2), niche (Q2 + permutation statistics), reliability (Q3). */
'use strict';

const Evidence = (() => {
  const TABS = [['data', 'Data quality'], ['regions', 'Regions'], ['groups', 'DG groups'], ['niche', 'Niche test'], ['reliability', 'UMAP reliability']];
  const body = () => document.getElementById('ev-body');
  const tools = () => document.getElementById('ev-tools');

  /* ---------------- shared helpers */
  const dgCells = () => cellsOf(S.focus, 'dg');
  function nscLike(si) {
    const sc = nscScore(), out = [];
    for (const i of cellsOf(si, 'dg')) if (sc[i] >= S.nscThr) out.push(i);
    return out;
  }
  /* the selection if it lives in the focus section, otherwise NSC-like DG cells */
  function cellsOfInterest() {
    if (selIn(S.focus)) return { idx: Array.from(S.sel.idx).filter(i => C.leiden[i] !== 255), name: 'Selected cells', isSel: true };
    return { idx: nscLike(S.focus), name: 'NSC-like cells', isSel: false };
  }
  const _mc = {};
  const medCounts = si => _mc[si] ?? (_mc[si] = median(Array.from(cellsOf(si, 'qc'), i => C.counts[i])));
  function composition(idx) {
    const cnt = new Map();
    for (const i of idx) cnt.set(C.sub[i], (cnt.get(C.sub[i]) || 0) + 1);
    return [...cnt.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => ({ label: SUBT[s], frac: n / idx.length, n }));
  }
  const swatch = c => `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${c}"></span>`;

  /* ================= DATA & QC ================= */
  function renderData() {
    tools().innerHTML = '';
    body().innerHTML = `<div class="ev-grid" style="grid-template-columns:minmax(0,1.35fr) minmax(0,1fr)">
      <div class="scrollbox" id="ev-table"></div><div class="stack3" id="ev-hists"><div class="plot" id="qh1"></div><div class="plot" id="qh2"></div><div class="plot" id="qh3"></div></div></div>`;
    const rows = SEC.map((s, k) => {
      const all = cellsOf(s.i, 'all'), med = col => median(Array.from(all, i => C[col][i]));
      return `<tr class="click${s.i === S.focus ? ' on' : ''}${S.shown.has(s.i) ? '' : ' out'}" data-si="${s.i}"><td><b>${s.name}</b></td><td class="num">${fmt.f2(s.depth_mm)}</td>
        <td class="num">${k ? '+' + fmt.f2(s.depth_mm - SEC[k - 1].depth_mm) : '—'}</td><td class="num">${fmt.int(s.n)}</td>
        <td class="num">${fmt.pct1(s.qc.n_pass / s.n)}</td><td class="num">${fmt.int(med('counts'))}</td><td class="num">${fmt.f1(med('mt'))}%</td>
        <td class="num">${fmt.int(s.dg_cells)}</td><td class="num">${s.n_clusters}</td></tr>`;
    }).join('');
    const t = document.getElementById('ev-table');
    t.innerHTML = `<table class="t"><thead><tr><th>Section</th><th class="num">ebz (mm)</th><th class="num">Gap</th><th class="num">Cells</th>
      <th class="num">Kept</th><th class="num">Median counts</th><th class="num">Median mito</th><th class="num">DG kept</th><th class="num">Groups</th></tr></thead>
      <tbody>${rows}</tbody></table><p class="note">Only these 7 sections have cell-level expression; neighbours are 0.5–1.8 mm apart, so sections are compared as
      analogous populations, not the same cells. Which end of the axis is anterior is not verified. Sequencing depth differs about 3× between sections.
      Colour the map by "QC kept / removed" to see where removed cells sit.</p>`;
    t.querySelectorAll('tr.click').forEach(tr => tr.onclick = () => { const si = +tr.dataset.si; update({ focus: si, shown: S.shown.has(si) ? S.shown : new Set([...S.shown, si]) }); });
    const s = SEC[S.focus], q = s.qc, all = cellsOf(S.focus, 'all');
    const lg = c => Array.from(all, i => Math.log10(Math.max(1, C[c][i]))), tf = v => d3.format('~s')(Math.round(10 ** v));
    const ticks = [30, 100, 300, 1000, 3000].map(Math.log10);
    const mk = (id, vals, lo, hi, cut, lab, xl, xf, xt) => { const e = binEdges(lo, hi, 50);
      histChart(id, { edges: e, series: [{ counts: binCounts(vals, e), color: P.cat[0], label: 'Cells' }], xLabel: xl, xFmt: xf, xTicks: xt, vlines: [{ x: cut, label: lab }] }); };
    mk('qh1', lg('counts'), 1.4, 4, Math.log10(q.min_counts), `≥ ${fmt.int(q.min_counts)}`, `${s.name} · counts per cell (log)`, tf, ticks.concat(4));
    mk('qh2', lg('ngenes'), 1.2, 3.6, Math.log10(q.min_genes), `≥ ${fmt.int(q.min_genes)}`, 'genes per cell (log)', tf, ticks);
    mk('qh3', Array.from(all, i => C.mt[i]), 0, 35, q.max_pct_mt, `≤ ${fmt.f1(q.max_pct_mt)}%`, 'mitochondrial %', v => v + '%');
  }

  /* ================= REGIONS × SECTIONS (Q1) ================= */
  const _g = new Map(), _st = new Map();
  function group(si, r) { const k = si + '|' + r; if (!_g.has(k)) _g.set(k, cellsOf(si, 'qc').filter(i => C.region[i] === r)); return _g.get(k); }
  function stat(g, r, si) {
    const k = `${g}|${r}|${si}`;
    if (_st.has(k)) return _st.get(k);
    const v = GENE.get(g), idx = group(si, r);
    let s = 0, s2 = 0, det = 0;
    for (const i of idx) { const x = v[i]; s += x; s2 += x * x; if (x > 0) det++; }
    const n = idx.length, m = n ? s / n : NaN;
    const o = { mean: m, sem: n > 1 ? Math.sqrt(Math.max(0, s2 / n - m * m) / (n - 1)) : 0, det: n ? det / n : NaN, n };
    _st.set(k, o);
    return o;
  }
  const regs = () => [...S.regions].sort((a, b) => REGION_SLOT[REG[a]] - REGION_SLOT[REG[b]]);
  const shown = () => SEC.filter(s => S.shown.has(s.i));
  function renderRegions() {
    tools().innerHTML = `<span class="seg">${[['depth', 'Mean by depth'], ['comp', 'Cell types'], ['dot', 'Dot plot'], ['heat', 'Heatmap']]
      .map(([v, l]) => `<button data-v="${v}" class="${S.q1view === v ? 'on' : ''}">${l}</button>`).join('')}</span>`;
    tools().querySelectorAll('button').forEach(b => b.onclick = () => update({ q1view: b.dataset.v }));
    body().innerHTML = `<div class="ev-col"><div class="legend" id="ev-legend"></div><div class="plot" id="ev-chart"></div></div>`;
    if (!S.regions.size) { body().innerHTML = '<p class="note">Select at least one region in the sidebar.</p>'; return; }
    ({ depth: regDepth, comp: regComp, dot: regDot, heat: regHeat })[S.q1view]();
  }
  function regSingle() {
    const s = shown()[0], rs = regs();
    document.getElementById('ev-legend').innerHTML = legendHTML(rs.map(r => ({ color: regionColor(r), label: REG[r] }))) +
      `<span class="it muted">single-section view · ${s.name} · bars = mean, whiskers = ± SEM</span>`;
    barGroups('ev-chart', { title: `${s.name} · mean expression by region`, yFmt: d3.format('.2f'),
      groups: S.genes.map(g => ({ label: g, bars: rs.map(r => { const st = stat(g, r, s.i);
        return { label: REG[r], value: st.mean, err: st.sem, color: regionColor(r),
          tip: tipRows([['Mean log1p', fmt.f2(st.mean)], ['± SEM', fmt.f3(st.sem)], ['Detected in', fmt.pct1(st.det)], ['Cells', fmt.int(st.n)]]) }; }) })) });
  }
  function regDepth() {
    if (singleSection()) return regSingle();
    const host = document.getElementById('ev-chart'), rs = regs();
    document.getElementById('ev-legend').innerHTML = legendHTML(rs.map(r => ({ color: regionColor(r), label: REG[r] }))) +
      '<span class="it muted">absolute levels track sequencing depth — compare regions within a section</span>';
    host.className = 'smallmult';
    host.innerHTML = '';
    for (const g of S.genes) {
      const d = el('div'); host.appendChild(d);
      depthLines(d, { title: g, yLabel: 'mean log1p', focus: S.focus, secs: shown(), series: rs.map(r => ({ label: REG[r], color: regionColor(r),
        pts: shown().map(s => { const st = stat(g, r, s.i);
          return { si: s.i, y: st.mean, tip: tipRows([['Mean log1p', fmt.f2(st.mean)], ['Detected in', fmt.pct1(st.det)], ['Cells', fmt.int(st.n)], ['Median counts (section)', fmt.int(medCounts(s.i))]]) }; }) })) });
    }
  }
  function regComp() {
    document.getElementById('ev-legend').innerHTML = legendHTML(BROAD.map((b, k) => ({ color: broadColor(k), label: b })), { square: true });
    const bars = [];
    for (const r of regs()) for (const s of shown()) {
      const cnt = new Array(BROAD.length).fill(0);
      for (const i of group(s.i, r)) cnt[C.broad[i]]++;
      bars.push({ key: r + '|' + s.i, label: s.name, group: REG[r], parts: cnt.map((v, k) => ({ k, label: BROAD[k], value: v, color: broadColor(k) })) });
    }
    stackedBars('ev-chart', { bars, groups: regs().map(r => ({ label: REG[r], color: regionColor(r) })) });
  }
  const colsRS = () => regs().flatMap(r => shown().map(s => ({ key: r + '|' + s.i, label: s.name, r, si: s.i })));
  function regDot() {
    document.getElementById('ev-legend').innerHTML = '<span class="it muted">dot size = % of cells detecting · colour = mean log1p</span>';
    const rows = colsRS(), genes = S.genes, { svg, w, h } = svgFor('ev-chart', { minH: 150 });
    const m = { l: 82, r: 110, t: 6, b: 24 }, iw = w - m.l - m.r, ih = h - m.t - m.b;
    const g = svg.append('g').attr('transform', `translate(${m.l},${m.t})`);
    const x = d3.scaleBand().domain(genes).range([0, iw]).padding(0.1), y = d3.scaleBand().domain(rows.map(r => r.key)).range([0, ih]).padding(0.08);
    const mx = d3.max(rows.flatMap(r => genes.map(gn => stat(gn, r.r, r.si).mean))) || 1;
    const rs = d3.scaleSqrt().domain([0, 1]).range([0, Math.max(2.5, Math.min(x.bandwidth(), y.bandwidth()) / 2)]);
    for (const r of rows) for (const gn of genes) {
      const st = stat(gn, r.r, r.si);
      g.append('circle').attr('cx', x(gn) + x.bandwidth() / 2).attr('cy', y(r.key) + y.bandwidth() / 2).attr('r', rs(st.det || 0)).attr('fill', rampAt(P.seq, st.mean / mx))
        .on('mousemove', ev => showTip(ev, `<div class="h">${gn} · ${REG[r.r]} · ${SEC[r.si].name}</div>` + tipRows([['Mean log1p', fmt.f2(st.mean)], ['Detected in', fmt.pct1(st.det)], ['Cells', fmt.int(st.n)]])))
        .on('mouseleave', hideTip);
    }
    const step = Math.ceil(rows.length / Math.max(1, ih / 11));
    g.selectAll(null).data(rows.filter((r, k) => k % step === 0)).join('text').attr('class', 'lbl').attr('x', -6).attr('y', r => y(r.key) + y.bandwidth() / 2 + 4).attr('text-anchor', 'end').text(r => `${REG[r.r]} · ${SEC[r.si].name}`);
    g.selectAll(null).data(genes).join('text').attr('class', 'lbl strong').attr('x', d => x(d) + x.bandwidth() / 2).attr('y', ih + 15).attr('text-anchor', 'middle').text(d => d);
    rampLegend(svg, w - m.r + 10, m.t + 4, P.seq, '0', fmt.f1(mx), '', 80);
    [0.1, 0.4, 0.8].forEach((f, k) => { const cy = m.t + 44 + k * 22;
      svg.append('circle').attr('cx', w - m.r + 18).attr('cy', cy).attr('r', rs(f)).attr('fill', P.muted);
      svg.append('text').attr('class', 'lbl').attr('x', w - m.r + 32).attr('y', cy + 4).text(fmt.pct(f)); });
  }
  function regHeat() {
    document.getElementById('ev-legend').innerHTML = `<span class="colorbar" style="margin:0"><span>low</span><span class="bar" style="background:${cssRamp(P.seq)}"></span><span>highest column for that gene (row-scaled)</span></span>`;
    const cs = colsRS(), genes = S.genes, rowMax = Object.fromEntries(genes.map(gn => [gn, d3.max(cs, c => stat(gn, c.r, c.si).mean) || 1]));
    heatmap('ev-chart', { rows: genes.map(gn => ({ key: gn, label: gn })), cols: cs,
      colGroups: regs().map(r => ({ label: REG[r], color: regionColor(r), keys: cs.filter(c => c.r === r).map(c => c.key) })),
      cell: (row, c) => { const st = stat(row.key, c.r, c.si);
        return [rampAt(P.seq, st.mean / rowMax[row.key]), `<div class="h">${row.key} · ${REG[c.r]} · ${SEC[c.si].name}</div>` + tipRows([['Mean log1p', fmt.f2(st.mean)], ['Detected in', fmt.pct1(st.det)]])]; } });
  }

  /* ================= DG GROUPS (Q2) ================= */
  function clusterStats(si) {
    const dg = cellsOf(si, 'dg'), k = nClusters(si), out = {};
    for (const g of M.nsc_markers.filter(x => GENE.has(x))) {
      const v = GENE.get(g), sum = new Float64Array(k), det = new Float64Array(k), n = new Float64Array(k);
      for (const i of dg) { const c = C.leiden[i]; sum[c] += v[i]; n[c]++; if (v[i] > 0) det[c]++; }
      const means = Array.from(sum, (s, c) => s / (n[c] || 1)), mu = d3.mean(means), sd = d3.deviation(means) || 1;
      out[g] = means.map((m, c) => ({ mean: m, z: (m - mu) / sd, det: det[c], n: n[c] }));
    }
    return out;
  }
  function renderGroups() {
    tools().innerHTML = `<span class="muted">${SEC[S.focus].name} · click a column, a UMAP group or a table row</span> <span class="info" data-help="leiden">ⓘ</span>`;
    body().innerHTML = `<div class="ev-grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.1fr)"><div class="plot" id="ev-heat"></div><div class="scrollbox" id="ev-side"></div></div>`;
    const si = S.focus, k = nClusters(si), st = clusterStats(si), genes = Object.keys(st);
    heatmap('ev-heat', { rows: genes.map(g => ({ key: g, label: g })), cols: d3.range(k).map(c => ({ key: c, label: String(c) })),
      highlightCol: selIn(si) ? S.sel.cluster : null, m: { l: 50, b: 50 }, onCol: c => selectCluster(si, c.key),
      cell: (r, c) => { const d = st[r.key][c.key];
        return [rampAt(P.div, (Math.max(-2, Math.min(2, d.z)) + 2) / 4), `<div class="h">${r.key} · group ${c.key}</div>` +
          tipRows([['Mean log1p', fmt.f3(d.mean)], ['z across groups', fmt.f2(d.z)], ['Detected in', `${fmt.int(d.det)} of ${fmt.int(d.n)}`]])]; },
      legend: (svg, w, y) => rampLegend(svg, 50, y, P.div, '−2', '+2', 'z across groups (NSC library)', 90) });
    groupSide(st);
  }
  function groupSide(st) {
    const host = document.getElementById('ev-side'), si = S.focus;
    if (!selIn(si)) {
      host.innerHTML = `<table class="t"><thead><tr><th>Group</th><th class="num">Cells</th><th>Main published label</th><th class="num">Share</th></tr></thead><tbody>` +
        d3.range(nClusters(si)).map(c => { const idx = Array.from(dgCells()).filter(i => C.leiden[i] === c), top = composition(idx)[0];
          return `<tr class="click" data-c="${c}"><td>${swatch(clusterColor(c))} ${c}</td><td class="num">${fmt.int(idx.length)}</td><td>${top.label}</td><td class="num">${fmt.pct(top.frac)}</td></tr>`; }).join('') +
        '</tbody></table>';
      host.querySelectorAll('tr.click').forEach(tr => tr.onclick = () => selectCluster(si, +tr.dataset.c));
      return;
    }
    const idx = Array.from(S.sel.idx), comp = composition(idx).slice(0, 3), sc = nscScore();
    let table, ups;
    if (S.sel.cluster != null) {
      const c = S.sel.cluster, de = SEC[si].de[String(c)] || [];
      table = `<div class="lbl"><b>Top marker genes, group ${c}</b> · Wilcoxon vs other DG cells · click to map</div><table class="t"><thead><tr><th>Gene</th><th class="num">log2FC</th><th class="num">% in</th><th class="num">% rest</th></tr></thead><tbody>` +
        de.slice(0, 10).map(r => `<tr class="${inPanel(r.gene) ? 'click' : ''}" data-g="${r.gene}" title="adj. p = ${d3.format('.1e')(r.padj)}"><td><b>${r.gene}</b></td><td class="num">${fmt.f2(r.logfc)}</td><td class="num">${fmt.pct(r.pct_in)}</td><td class="num">${fmt.pct(r.pct_out)}</td></tr>`).join('') + '</tbody></table>';
      ups = Object.keys(st).filter(g => st[g][c].z > 0.5);
    } else {
      const rest = Array.from(dgCells()).filter(i => !isSel(i));
      const rank = [...GENE.keys()].map(g => { const v = GENE.get(g); return { g, d: d3.mean(idx, i => v[i]) - d3.mean(rest, i => v[i]) }; }).sort((a, b) => b.d - a.d).slice(0, 8);
      table = `<div class="lbl"><b>Loaded panel genes ranked</b> · Δ mean log1p vs other DG cells</div><table class="t"><tbody>${rank.map(r => `<tr class="click" data-g="${r.g}"><td><b>${r.g}</b></td><td class="num">${d3.format('+.2f')(r.d)}</td></tr>`).join('')}</tbody></table>`;
      ups = M.nsc_markers.filter(g => GENE.has(g) && d3.mean(idx, i => GENE.get(g)[i]) > 1.5 * d3.mean(dgCells(), i => GENE.get(g)[i]));
    }
    const sparse = M.nsc_markers.filter(g => GENE.has(g) && idx.filter(i => GENE.get(g)[i] > 0).length < Math.max(5, idx.length * 0.02));
    host.innerHTML = table + `<div class="annot"><b>Candidate annotation</b> (descriptive)<br>Published labels: ${comp.map(c => `<b>${c.label}</b> ${fmt.pct(c.frac)}`).join(', ')}.<br>
      NSC-library markers above the DG average: ${ups.length ? ups.map(g => `<b>${g}</b>`).join(', ') : 'none'}. Mean NSC score ${fmt.f2(d3.mean(idx, i => sc[i]))} vs ${fmt.f2(d3.mean(dgCells(), i => sc[i]))} (all DG).<br>
      ${sparse.length ? `<br><span class="muted">Detected in &lt;2% of these cells: ${sparse.join(', ')} — too sparse for a stem/progenitor call.</span>` : ''}</div>`;
    host.querySelectorAll('tr.click').forEach(tr => tr.onclick = async () => { const g = tr.dataset.g; if (!inPanel(g)) return; await loadGene(g);
      update({ color: 'gene:' + g, genes: S.genes.includes(g) || S.genes.length >= 12 ? S.genes : [...S.genes, g] }); });
  }

  /* ================= NICHE (Q2 + permutation statistics) ================= */
  function renderNiche() {
    tools().innerHTML = `<span data-help="nullmodel">chance model <span class="info">ⓘ</span></span> <span class="seg"><button data-n="all" class="${S.nullMode === 'all' ? 'on' : ''}" title="Shuffle labels across all DG cells">all DG cells</button>
      <button data-n="astro" class="${S.nullMode === 'astro' ? 'on' : ''}" title="Shuffle the cells-of-interest label among astrocytes only">within astrocytes</button></span>`;
    tools().querySelectorAll('button').forEach(b => b.onclick = () => update({ nullMode: b.dataset.n }));
    body().innerHTML = `<div class="ev-grid" style="grid-template-columns:150px minmax(0,1fr) minmax(0,1fr) minmax(0,1.05fr)">
      <div class="tiles col" id="ev-tiles"></div>
      <div class="ev-col"><div class="plot" id="ev-hist"></div><div class="plot" id="ev-across"></div></div>
      <div class="plot" id="ev-cooc"></div><div class="plot" id="ev-enr"></div></div>`;
    const si = S.focus, d = C['d_' + M.broad_key[S.ref]], coi = cellsOfInterest(), base = Array.from(dgCells());
    const refName = BROAD[S.ref].toLowerCase(), plural = refName.endsWith('a') ? refName : refName + 's';
    const dc = coi.idx.map(i => d[i]).filter(v => v === v), db = base.map(i => d[i]).filter(v => v === v);
    const dr = base.filter(i => C.broad[i] === S.ref).map(i => d[i]).filter(v => v === v);
    const within = a => (a.length ? a.filter(v => v <= S.radius).length / a.length : NaN);
    if (coi.idx.length < 5) { document.getElementById('ev-tiles').innerHTML = `<div class="tile"><div class="k">${coi.name}</div><div class="v">${coi.idx.length}</div><div class="c">too few cells — lower the NSC threshold or select cells</div></div>`; return; }
    // permutation statistics
    const enr = Stats.enrichment(si, coi.idx, coi.name, S.nullMode), K = enr.K, refCat = 1 + S.ref;
    const zRef = enr.z[0 * K + refCat], pRef = enr.p[0 * K + refCat];
    document.getElementById('ev-tiles').innerHTML = `
      <div class="tile"><div class="k">${coi.name}</div><div class="v">${fmt.int(dc.length)}</div><div class="c">${fmt.pct1(dc.length / base.length)} of DG</div></div>
      <div class="tile"><div class="k">Median dist. to ${refName}</div><div class="v">${fmt.um(median(dc))}</div><div class="c">all DG ${fmt.um(median(db))}<br>DG ${plural} ${dr.length ? fmt.um(median(dr)) : '—'}</div></div>
      <div class="tile"><div class="k">Within ${S.radius} µm</div><div class="v">${fmt.pct(within(dc))}</div><div class="c">all DG ${fmt.pct(within(db))}</div></div>
      <div class="tile ${pRef < 0.05 && zRef > 0 ? 'hi' : ''}" data-help="enrichment"><div class="k">Neighbourhood enrichment <span class="info">ⓘ</span></div><div class="v">z ${zRef === zRef ? d3.format('+.1f')(zRef) : 'n/a'}</div>
        <div class="c">${coi.name.toLowerCase()} → ${refName}<br>p = ${d3.format('.3f')(pRef)} (${S.nullMode === 'all' ? 'all-DG' : 'within-astrocyte'} null, 199 perms)</div></div>`;
    // distance histogram
    const sorted = db.slice().sort((a, b) => a - b), hi = Math.max(S.radius * 1.5, sorted[Math.floor(sorted.length * 0.98)] || 50), e = binEdges(0, hi, 26);
    histChart('ev-hist', { edges: e, density: true, title: `Distance to nearest ${refName} (µm)`, xLabel: '', xFmt: d3.format('~f'),
      series: [{ counts: binCounts(dc, e), color: P.cat[1], label: coi.name }, { counts: binCounts(db, e), color: P.text2, kind: 'step', label: 'All DG cells' }],
      vlines: [{ x: S.radius, label: `${S.radius} µm`, color: P.text2 }] });
    // across sections (NSC-like definition)
    if (singleSection() || shown().length < 2) {
      const comp = composition(coi.idx).slice(0, 5);
      barGroups('ev-across', { title: `${SEC[si].name} · what are the ${coi.name.toLowerCase()}? (published labels)`, yFmt: d3.format('.0%'), maxLabel: 11,
        groups: comp.map(c => ({ label: c.label, bars: [{ label: 'share', value: c.frac, color: P.cat[1], tip: tipRows([['Share', fmt.pct1(c.frac)], ['Cells', fmt.int(c.n)]]) }] })) });
    } else {
      const per = shown().map(s => { const n = nscLike(s.i).length, nd = cellsOf(s.i, 'dg').length; return { si: s.i, y: n / nd, tip: tipRows([['NSC-like', `${n} of ${fmt.int(nd)}`], ['Median counts', fmt.int(medCounts(s.i))]]) }; });
      depthLines('ev-across', { title: '% NSC-like by section (tracks sequencing depth)', yLabel: '%', yFmt: d3.format('.1%'), focus: si, secs: shown(), series: [{ label: 'NSC-like', color: P.cat[1], pts: per }] });
    }
    // co-occurrence with permutation envelope
    const co = Stats.cooccurrence(si, coi.idx, S.ref, S.nullMode);
    coocChart('ev-cooc', co, `${BROAD[S.ref]}s near ${coi.name.toLowerCase()} (vs chance)`);
    // enrichment heatmap (categories with ≥ 5 cells)
    const keep = d3.range(K).filter(c => enr.nCat[c] >= 5);
    heatmap('ev-enr', { rows: keep.map(c => ({ key: c, label: short(enr.cats[c].label) })), cols: keep.map(c => ({ key: c, label: abbr(enr.cats[c].label) })),
      m: { l: 74, b: 58, t: 8 },
      cell: (r, c) => { const q = r.key * K + c.key, z = enr.z[q];
        return [z === z ? rampAt(P.div, (Math.max(-6, Math.min(6, z)) + 6) / 12) : P.faint,
          `<div class="h">${enr.cats[r.key].label} → ${enr.cats[c.key].label}</div>` + tipRows([['Observed kNN edges', fmt.int(enr.obs[q])], ['Expected (null)', fmt.f1(enr.mean[q])], ['z', z === z ? fmt.f2(z) : 'n/a (fixed by null)'], ['p (enriched)', d3.format('.3f')(enr.p[q])]])]; },
      legend: (svg, w, y) => rampLegend(svg, 74, y, P.div, '−6', '+6', `z · ${KS}-NN graph · rows → neighbours`, 80) });
  }
  const abbr = l => ({ 'NSC-like cells': 'NSC', 'Selected cells': 'Sel', 'Glutamatergic neuron': 'Glu', 'GABAergic neuron': 'GABA', 'Astrocyte (other)': 'Ast', 'Oligodendrocyte': 'Olig', 'OPC': 'OPC', 'Microglia': 'Mic', 'VLMC': 'VLMC' }[l] || l.slice(0, 4));
  const short = l => l.replace('Glutamatergic neuron', 'Glu neuron').replace('GABAergic neuron', 'GABA neuron').replace('Oligodendrocyte', 'Oligo').replace('Astrocyte (other)', 'Astro (other)').replace(' cells', '');
  function coocChart(host, co, title) {
    const { svg, w, h } = svgFor(host, { minH: 140 });
    const m = { l: 40, r: 10, t: 22, b: 30 }, iw = w - m.l - m.r, ih = h - m.t - m.b;
    const g = svg.append('g').attr('transform', `translate(${m.l},${m.t})`);
    svg.append('text').attr('class', 'ttl').attr('x', 4).attr('y', 14).text(title);
    const x = d3.scaleLinear().domain([0, d3.max(co.d)]).range([0, iw]);
    const vals = co.obs.concat(co.hi, co.lo).filter(v => v === v);
    const y = d3.scaleLinear().domain([Math.min(0.5, d3.min(vals)), Math.max(1.5, d3.max(vals))]).nice().range([ih, 0]);
    gridY(g, y, iw);
    g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(4).tickSizeOuter(0));
    g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`).call(d3.axisBottom(x).ticks(5).tickSizeOuter(0));
    g.append('text').attr('class', 'lbl').attr('x', iw).attr('y', ih + 26).attr('text-anchor', 'end').text('within distance (µm)');
    g.append('line').attr('x1', 0).attr('x2', iw).attr('y1', y(1)).attr('y2', y(1)).attr('stroke', P.axis);
    const pts = co.d.map((d, b) => ({ d, o: co.obs[b], lo: co.lo[b], hi: co.hi[b], mid: co.mid[b] })).filter(p => p.o === p.o && p.lo === p.lo);
    g.append('path').datum(pts).attr('fill', P.text).attr('opacity', 0.08).attr('d', d3.area().x(p => x(p.d)).y0(p => y(p.lo)).y1(p => y(p.hi)));
    g.append('path').datum(pts).attr('fill', 'none').attr('stroke', P.muted).attr('stroke-width', 1.5).attr('d', d3.line().x(p => x(p.d)).y(p => y(p.mid)));
    g.append('path').datum(pts).attr('fill', 'none').attr('stroke', P.cat[1]).attr('stroke-width', 2).attr('d', d3.line().x(p => x(p.d)).y(p => y(p.o)));
    const last = pts[pts.length - 1];
    if (last) {
      g.append('text').attr('class', 'lbl').attr('x', iw - 2).attr('y', y(last.o) - 6).attr('text-anchor', 'end').text('observed');
      g.append('text').attr('class', 'lbl').attr('x', iw - 2).attr('y', y(last.hi) - 4).attr('text-anchor', 'end').text('null 95% band');
    }
    g.selectAll(null).data(pts).join('rect').attr('x', p => x(p.d) - iw / pts.length / 2).attr('width', iw / pts.length).attr('y', 0).attr('height', ih).attr('fill', 'transparent')
      .on('mousemove', (ev, p) => showTip(ev, `<div class="h">within ${p.d} µm</div>` + tipRows([['Observed ratio', fmt.f2(p.o)], ['Null median', fmt.f2(p.mid)], ['Null 95% band', `${fmt.f2(p.lo)} – ${fmt.f2(p.hi)}`]])))
      .on('mouseleave', hideTip);
  }

  /* ================= LAYOUT RELIABILITY (Q3) ================= */
  function renderReliability() {
    tools().innerHTML = `<span class="muted">turn on <b>Flag unreliable</b> and <b>Neighbour lens</b> above</span>`;
    body().innerHTML = `<div class="ev-grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.15fr) minmax(0,1fr)">
      <div class="ev-col"><div class="plot" id="rn0"></div><div class="plot" id="rn1"></div></div><div class="scrollbox" id="ev-rtable"></div>
      <div class="ev-col"><div class="legend" id="ev-rleg"></div><div class="plot" id="ev-rdepth"></div></div></div>`;
    const si = S.focus, e = binEdges(-0.2, 1.0, 40);
    SEC[si].scdeed.forEach((r, k) => histChart('rn' + k, { title: `${'AB'[k]} · min_dist ${r.min_dist}`, edges: e, density: true, xLabel: 'reliability (Pearson r)', xFmt: d3.format('.1f'),
      series: [{ counts: r.obs_hist, color: P.cat[0], label: 'Observed' }, { counts: r.null_hist, color: P.text2, kind: 'step', label: 'Shuffled null' }],
      vlines: [{ x: r.null_q05, label: 'dubious', color: P.crit }, { x: r.null_q95, label: 'trustworthy', color: P.text2, dy: 12 }] }));
    const dg = Array.from(dgCells()), cls = k => C['cls' + k];
    const row = (label, idx, key, on) => {
      const n = idx.length, a = idx.filter(i => cls(0)[i] === 2).length, b = idx.filter(i => cls(1)[i] === 2).length;
      const pa = d3.mean(idx, i => C.pres0[i]), pb = d3.mean(idx, i => C.pres1[i]);
      return `<tr class="${key != null ? 'click' : ''}${on ? ' on' : ''}" data-c="${key ?? ''}"><td>${label}</td><td class="num">${fmt.int(n)}</td>
        <td class="num">${a} <span class="muted">(${fmt.pct1(a / n)})</span></td><td class="num">${b} <span class="muted">(${fmt.pct1(b / n)})</span></td>
        <td class="num">${fmt.pct(pa)}</td><td class="num">${fmt.pct(pb)}</td></tr>`;
    };
    let rows = d3.range(nClusters(si)).map(c => row(`${swatch(clusterColor(c))} Group ${c}`, dg.filter(i => C.leiden[i] === c), c, selIn(si) && S.sel.cluster === c)).join('');
    rows += row('<b>All DG</b>', dg, null, false);
    if (selIn(si)) rows += row('<b>Selection</b>', Array.from(S.sel.idx).filter(i => C.leiden[i] !== 255), null, true);
    const t = document.getElementById('ev-rtable');
    t.innerHTML = `<table class="t"><thead><tr><th>DG group</th><th class="num">Cells</th><th class="num">Dubious A</th><th class="num">Dubious B</th>
      <th class="num" title="mean share of 15 PCA neighbours kept as UMAP neighbours">Nbrs kept A</th><th class="num">Nbrs kept B</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="note">"Dubious" flags a cell's position in the layout, not a bad cell. Small groups carry most dubious cells; check their story with the Lens.</p>`;
    t.querySelectorAll('tr.click').forEach(tr => tr.onclick = () => selectCluster(si, +tr.dataset.c));
    document.getElementById('ev-rleg').innerHTML = legendHTML([{ color: P.cat[0], label: `A · min_dist ${M.min_dists[0]}` }, { color: P.cat[1], label: `B · min_dist ${M.min_dists[1]}` }]);
    if (singleSection()) {
      const host = document.getElementById('ev-rdepth');
      host.innerHTML = '<div class="plot" id="ev-r1"></div><div class="plot" id="ev-r2"></div>';
      host.style.display = 'flex'; host.style.flexDirection = 'column';
      const sd = SEC[si].scdeed, bar = (k, v, tip) => ({ label: 'AB'[k], value: v, color: P.cat[k], tip });
      barGroups('ev-r1', { title: `${SEC[si].name} · % dubious cells`, yFmt: d3.format('.1%'),
        groups: [{ label: 'A vs B', bars: sd.map((r, k) => bar(k, r.dubious / r.n_cells, tipRows([['Dubious', `${r.dubious} of ${fmt.int(r.n_cells)}`]]))) }] });
      barGroups('ev-r2', { title: 'median reliability', yFmt: d3.format('.2f'),
        groups: [{ label: 'A vs B', bars: sd.map((r, k) => bar(k, r.median_reliability, tipRows([['Median reliability', fmt.f3(r.median_reliability)]]))) }] });
      return;
    }
    depthLines('ev-rdepth', { title: '% dubious by section', yLabel: '% dubious', yFmt: d3.format('.1%'), focus: si, secs: shown(),
      series: [0, 1].map(k => ({ label: 'AB'[k], color: P.cat[k], pts: shown().map(s => ({ si: s.i, y: s.scdeed[k].dubious / s.scdeed[k].n_cells,
        tip: tipRows([['Dubious', `${s.scdeed[k].dubious} of ${fmt.int(s.scdeed[k].n_cells)}`], ['Median reliability', fmt.f3(s.scdeed[k].median_reliability)], ['Median counts', fmt.int(medCounts(s.i))]]) })) })) });
  }

  function render() {
    const tabs = document.getElementById('ev-tabs');
    if (S.evid === 'reliability' && !sensOn()) S.evid = 'groups';
    tabs.innerHTML = TABS.filter(([k]) => k !== 'reliability' || sensOn())
      .map(([k, l]) => `<button data-e="${k}" class="${S.evid === k ? 'on' : ''}">${l}</button>`).join('');
    tabs.querySelectorAll('button').forEach(b => b.onclick = () => update({ evid: b.dataset.e }));
    ({ data: renderData, regions: renderRegions, groups: renderGroups, niche: renderNiche, reliability: renderReliability })[S.evid]();
  }
  return { render, cellsOfInterest, nscLike };
})();
