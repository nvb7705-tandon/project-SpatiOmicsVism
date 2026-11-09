/* charts.js — small SVG chart builders shared by the tabs (thin marks, hairline axes, hover tooltips). */
'use strict';

function svgFor(host, { minH = 120 } = {}) {
  const node = typeof host === 'string' ? document.getElementById(host) : host;
  node.innerHTML = '';
  const w = Math.max(160, node.clientWidth), h = Math.max(minH, node.clientHeight);
  const svg = d3.select(node).append('svg').attr('width', w).attr('height', h);
  return { svg, w, h, node };
}
function gridY(g, y, w) {
  g.append('g').attr('class', 'grid').call(d3.axisLeft(y).ticks(4).tickSize(-w).tickFormat(''));
}

/* Depth axis: x = position along the A–P axis (mm), ticks at the sections themselves */
function depthScale(x0, x1) {
  return d3.scaleLinear().domain([DEPTH_EXTENT[0] - 0.4, DEPTH_EXTENT[1] + 0.4]).range([x0, x1]);
}
function depthAxis(g, x, h, { names = true, focus = null, secs = SEC } = {}) {
  const ax = g.append('g').attr('class', 'axis').attr('transform', `translate(0,${h})`)
    .call(d3.axisBottom(x).tickValues(secs.map(s => s.depth_mm)).tickFormat('').tickSizeOuter(0));
  if (names) {
    // stagger labels of sections closer than ~34px so names never collide
    let lastX = -1e9, lift = 0;
    secs.forEach(s => {
      const px = x(s.depth_mm);
      lift = px - lastX < 34 ? (lift ? 0 : 11) : 0;
      lastX = px;
      ax.append('text').attr('x', px).attr('y', 15 + lift).attr('text-anchor', 'middle')
        .attr('class', s.i === focus ? 'lbl strong' : 'lbl').text(s.name);
    });
  }
}

/* Line + dot chart over depth; series = [{key, label, color, pts:[{si, y, tip}]}] */
function depthLines(host, { series, yLabel, yFmt = fmt.f2, focus = null, yDomain = null, title = null, height = null, secs = SEC }) {
  const { svg, w, h } = svgFor(host, { minH: 110 });
  const H = height || h;
  const m = { l: 44, r: 70, t: title ? 20 : 8, b: 34 };
  const iw = w - m.l - m.r, ih = H - m.t - m.b;
  const g = svg.append('g').attr('transform', `translate(${m.l},${m.t})`);
  if (title) svg.append('text').attr('class', 'ttl').attr('x', m.l).attr('y', 13).text(title);
  const x = depthScale(0, iw);
  const all = series.flatMap(s => s.pts.map(p => p.y)).filter(v => v === v);
  const y = d3.scaleLinear().domain(yDomain || [0, (d3.max(all) || 1) * 1.1]).nice().range([ih, 0]);
  gridY(g, y, iw);
  g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(4).tickFormat(yFmt).tickSizeOuter(0));
  depthAxis(g, x, ih, { focus, secs });
  g.append('text').attr('class', 'lbl').attr('x', -m.l + 2).attr('y', -2).text(yLabel).attr('dy', title ? 0 : 0)
    .style('display', title ? 'none' : null);
  if (focus != null) g.append('rect').attr('x', x(SEC[focus].depth_mm) - 9).attr('width', 18).attr('y', 0).attr('height', ih)
    .attr('fill', P.text).attr('opacity', 0.05);
  const ends = [];
  for (const s of series) {
    const pts = s.pts.filter(p => p.y === p.y);
    g.append('path').datum(pts).attr('fill', 'none').attr('stroke', s.color).attr('stroke-width', 2)
      .attr('d', d3.line().x(p => x(SEC[p.si].depth_mm)).y(p => y(p.y)));
    g.selectAll(null).data(pts).join('circle').attr('cx', p => x(SEC[p.si].depth_mm)).attr('cy', p => y(p.y))
      .attr('r', 4).attr('fill', s.color).attr('stroke', P.surface).attr('stroke-width', 2);
    g.selectAll(null).data(pts).join('circle').attr('cx', p => x(SEC[p.si].depth_mm)).attr('cy', p => y(p.y))
      .attr('r', 11).attr('fill', 'transparent')
      .on('mousemove', (ev, p) => showTip(ev, `<div class="h">${s.label} · ${SEC[p.si].name}</div>` + (p.tip || tipRows([[yLabel, yFmt(p.y)]]))))
      .on('mouseleave', hideTip);
    const last = pts[pts.length - 1];
    if (last && series.length > 1) ends.push({ y: y(last.y), label: s.label });
  }
  // direct labels at line ends, nudged apart so they never overlap
  ends.sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) ends[k].y = Math.max(ends[k].y, ends[k - 1].y + 12);
  for (const e of ends) g.append('text').attr('class', 'lbl').attr('x', iw + 6).attr('y', e.y + 4).text(e.label);
  return svg;
}

/* Histogram; series = [{counts, color, kind:'bar'|'step', label}], shared bins (edges array) */
function histChart(host, { edges, series, xLabel, vlines = [], xFmt = null, xTicks = null, density = false, title = null }) {
  const { svg, w, h } = svgFor(host, { minH: 110 });
  const m = { l: 40, r: 12, t: title ? 22 : 8, b: 32 };
  const iw = w - m.l - m.r, ih = h - m.t - m.b;
  const g = svg.append('g').attr('transform', `translate(${m.l},${m.t})`);
  if (title) svg.append('text').attr('class', 'ttl').attr('x', m.l).attr('y', 14).text(title);
  const x = d3.scaleLinear().domain([edges[0], edges[edges.length - 1]]).range([0, iw]);
  const norm = s => { const tot = d3.sum(s.counts) || 1; return density ? s.counts.map(c => c / tot) : s.counts; };
  const vals = series.map(norm);
  const y = d3.scaleLinear().domain([0, (d3.max(vals.flat()) || 1) * 1.08]).nice().range([ih, 0]);
  gridY(g, y, iw);
  g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(4).tickFormat(density ? d3.format('.0%') : d3.format('~s')).tickSizeOuter(0));
  g.append('g').attr('class', 'axis').attr('transform', `translate(0,${ih})`).call((xTicks ? d3.axisBottom(x).tickValues(xTicks) : d3.axisBottom(x).ticks(6)).tickFormat(xFmt).tickSizeOuter(0));
  g.append('text').attr('class', 'lbl').attr('x', iw).attr('y', ih + 28).attr('text-anchor', 'end').text(xLabel);
  series.forEach((s, k) => {
    const v = vals[k];
    if (s.kind === 'step') {
      const pts = [];
      v.forEach((c, b) => { pts.push([x(edges[b]), y(c)], [x(edges[b + 1]), y(c)]); });
      g.append('path').attr('d', d3.line()(pts)).attr('fill', 'none').attr('stroke', s.color).attr('stroke-width', 1.5);
    } else {
      g.selectAll(null).data(v).join('rect')
        .attr('x', (c, b) => x(edges[b]) + 1).attr('width', (c, b) => Math.max(0.5, x(edges[b + 1]) - x(edges[b]) - 2))
        .attr('y', c => y(c)).attr('height', c => ih - y(c)).attr('fill', s.color).attr('rx', 1.5);
    }
  });
  // hover bands
  g.selectAll(null).data(d3.range(edges.length - 1)).join('rect')
    .attr('x', b => x(edges[b])).attr('width', b => x(edges[b + 1]) - x(edges[b])).attr('y', 0).attr('height', ih)
    .attr('fill', 'transparent')
    .on('mousemove', (ev, b) => showTip(ev, `<div class="h">${(xFmt || fmt.f2)(edges[b])} – ${(xFmt || fmt.f2)(edges[b + 1])}</div>` +
      tipRows(series.map((s, k) => [s.label, density ? fmt.pct1(vals[k][b]) : fmt.int(s.counts[b])]))))
    .on('mouseleave', hideTip);
  for (const v of vlines) {
    if (!(v.x >= edges[0] && v.x <= edges[edges.length - 1])) continue;
    g.append('line').attr('x1', x(v.x)).attr('x2', x(v.x)).attr('y1', 0).attr('y2', ih).attr('stroke', v.color || P.crit).attr('stroke-width', 1.5);
    g.append('text').attr('class', 'lbl').attr('x', x(v.x) + 4).attr('y', 10 + (v.dy || 0)).text(v.label).attr('fill', v.color || P.crit);
  }
  return { svg, x, y, g };
}

function binEdges(lo, hi, n) { return d3.range(n + 1).map(k => lo + (hi - lo) * k / n); }
function binCounts(values, edges) {
  const n = edges.length - 1, lo = edges[0], hi = edges[n], c = new Array(n).fill(0);
  for (const v of values) { if (!(v === v)) continue; let b = Math.floor((v - lo) / (hi - lo) * n); if (b < 0) b = 0; if (b >= n) b = n - 1; c[b]++; }
  return c;
}

/* Heatmap; rows/cols arrays of {key,label}; value(r,c) -> [colour, tipHTML] */
function heatmap(host, { rows, cols, cell, colGroups = null, onCol = null, highlightCol = null, legend = null, m: mm = {} }) {
  const { svg, w, h } = svgFor(host, { minH: 100 });
  const m = Object.assign({ l: 62, r: 10, t: colGroups ? 30 : 10, b: 34 }, mm);
  const iw = w - m.l - m.r, ih = Math.min(h - m.t - m.b, rows.length * 34);
  const g = svg.append('g').attr('transform', `translate(${m.l},${m.t})`);
  const x = d3.scaleBand().domain(cols.map(c => c.key)).range([0, iw]).paddingInner(0.06);
  const y = d3.scaleBand().domain(rows.map(r => r.key)).range([0, ih]).paddingInner(0.08);
  for (const r of rows) for (const c of cols) {
    const [color, tip] = cell(r, c);
    g.append('rect').attr('x', x(c.key)).attr('y', y(r.key)).attr('width', x.bandwidth()).attr('height', y.bandwidth())
      .attr('rx', 2).attr('fill', color)
      .on('mousemove', ev => showTip(ev, tip)).on('mouseleave', hideTip)
      .on('click', () => onCol && onCol(c)).style('cursor', onCol ? 'pointer' : null);
  }
  if (highlightCol != null && x(highlightCol) != null) g.append('rect').attr('x', x(highlightCol) - 2).attr('y', -3)
    .attr('width', x.bandwidth() + 4).attr('height', ih + 6).attr('fill', 'none').attr('stroke', P.sel).attr('stroke-width', 1.5).attr('rx', 3);
  g.selectAll(null).data(rows).join('text').attr('class', 'lbl strong').attr('x', -6).attr('y', r => y(r.key) + y.bandwidth() / 2 + 4)
    .attr('text-anchor', 'end').text(r => r.label);
  const labelEvery = Math.ceil(cols.length / Math.max(1, iw / 22));
  g.selectAll(null).data(cols.filter((c, k) => k % labelEvery === 0)).join('text').attr('class', 'lbl')
    .attr('x', c => x(c.key) + x.bandwidth() / 2).attr('y', ih + 14).attr('text-anchor', 'middle').text(c => c.label)
    .style('cursor', onCol ? 'pointer' : null).on('click', (ev, c) => onCol && onCol(c));
  if (colGroups) for (const grp of colGroups) {
    const xs = grp.keys.map(k => x(k)).filter(v => v != null);
    if (!xs.length) continue;
    const a = d3.min(xs), b = d3.max(xs) + x.bandwidth();
    g.append('line').attr('x1', a).attr('x2', b).attr('y1', -8).attr('y2', -8).attr('stroke', grp.color).attr('stroke-width', 3).attr('stroke-linecap', 'round');
    g.append('text').attr('class', 'lbl strong').attr('x', (a + b) / 2).attr('y', -14).attr('text-anchor', 'middle').text(grp.label);
  }
  if (legend) legend(svg, w, m.t + ih + 22);
  return { svg, x, y };
}

/* Horizontal colour-bar legend drawn into an SVG */
function rampLegend(svg, x, y, ramp, lo, hi, label, wdt = 110) {
  const id = 'g' + Math.random().toString(36).slice(2, 8);
  const grad = svg.append('defs').append('linearGradient').attr('id', id);
  ramp.forEach((c, k) => grad.append('stop').attr('offset', k / (ramp.length - 1)).attr('stop-color', c));
  const g = svg.append('g').attr('transform', `translate(${x},${y})`);
  g.append('rect').attr('width', wdt).attr('height', 8).attr('rx', 4).attr('fill', `url(#${id})`);
  g.append('text').attr('class', 'lbl').attr('x', 0).attr('y', 20).text(lo);
  g.append('text').attr('class', 'lbl').attr('x', wdt).attr('y', 20).attr('text-anchor', 'end').text(hi);
  g.append('text').attr('class', 'lbl').attr('x', wdt + 8).attr('y', 8).text(label);
}
function cssRamp(ramp) { return `linear-gradient(90deg, ${ramp.filter((c, k) => k % 8 === 0).concat(ramp[ramp.length - 1]).join(',')})`; }

/* 100% stacked vertical bars; bars = [{key,label,group,total,parts:[{k,label,value,color}]}] */
function stackedBars(host, { bars, groups, yLabel = 'Share of cells' }) {
  const { svg, w, h } = svgFor(host, { minH: 160 });
  const m = { l: 44, r: 8, t: 26, b: 34 };
  const iw = w - m.l - m.r, ih = h - m.t - m.b;
  const g = svg.append('g').attr('transform', `translate(${m.l},${m.t})`);
  const x = d3.scaleBand().domain(bars.map(b => b.key)).range([0, iw]).paddingInner(0.25).paddingOuter(0.1);
  const y = d3.scaleLinear().domain([0, 1]).range([ih, 0]);
  g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(4).tickFormat(d3.format('.0%')).tickSizeOuter(0));
  for (const b of bars) {
    let acc = 0;
    const tot = d3.sum(b.parts, p => p.value) || 1;
    b.parts.forEach(p => {
      const f = p.value / tot;
      if (f <= 0) return;
      const y1 = y(acc), y0 = y(acc + f);
      g.append('rect').attr('x', x(b.key)).attr('width', x.bandwidth()).attr('y', y0 + 1).attr('height', Math.max(0, y1 - y0 - 2))
        .attr('fill', p.color).attr('rx', 1.5)
        .on('mousemove', ev => showTip(ev, `<div class="h">${b.label} · ${b.group}</div>` + tipRows([[p.label, fmt.pct1(f)], ['Cells', fmt.int(p.value) + ' of ' + fmt.int(tot)]])))
        .on('mouseleave', hideTip);
      acc += f;
    });
    g.append('text').attr('class', 'lbl').attr('x', x(b.key) + x.bandwidth() / 2).attr('y', ih + 13).attr('text-anchor', 'middle').text(b.label);
  }
  for (const grp of groups) {
    const ks = bars.filter(b => b.group === grp.label).map(b => x(b.key));
    if (!ks.length) continue;
    const a = d3.min(ks), bb = d3.max(ks) + x.bandwidth();
    g.append('line').attr('x1', a).attr('x2', bb).attr('y1', -10).attr('y2', -10).attr('stroke', grp.color).attr('stroke-width', 3).attr('stroke-linecap', 'round');
    g.append('text').attr('class', 'lbl strong').attr('x', (a + bb) / 2).attr('y', -15).attr('text-anchor', 'middle').text(grp.label);
  }
  return svg;
}

/* Grouped bars with optional ± error whiskers (single-section statistics; no lines across sections).
   groups = [{label, bars:[{label, value, err, color, tip}]}] */
function barGroups(host, { groups, yFmt = fmt.f2, title = null, maxLabel = 12 }) {
  const { svg, w, h } = svgFor(host, { minH: 110 });
  const m = { l: 42, r: 8, t: title ? 22 : 8, b: 24 }, iw = w - m.l - m.r, ih = h - m.t - m.b;
  const g = svg.append('g').attr('transform', `translate(${m.l},${m.t})`);
  if (title) svg.append('text').attr('class', 'ttl').attr('x', 4).attr('y', 14).text(title);
  const x0 = d3.scaleBand().domain(groups.map(d => d.label)).range([0, iw]).paddingInner(0.28).paddingOuter(0.12);
  const keys = [...new Set(groups.flatMap(d => d.bars.map(b => b.label)))];
  const x1 = d3.scaleBand().domain(keys).range([0, x0.bandwidth()]).padding(0.12);
  const mx = d3.max(groups.flatMap(d => d.bars.map(b => (b.value || 0) + (b.err || 0)))) || 1;
  const y = d3.scaleLinear().domain([0, mx * 1.1]).nice().range([ih, 0]);
  gridY(g, y, iw);
  g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(4).tickFormat(yFmt).tickSizeOuter(0));
  g.append('line').attr('x1', 0).attr('x2', iw).attr('y1', ih).attr('y2', ih).attr('stroke', P.axis);
  for (const d of groups) {
    const gx = x0(d.label);
    for (const b of d.bars) {
      const bx = gx + x1(b.label), bw = Math.max(1, x1.bandwidth()), v = b.value || 0;
      g.append('path').attr('fill', b.color)
        .attr('d', `M${bx},${ih}V${y(v) + 3}q0,-3 3,-3h${Math.max(0, bw - 6)}q3,0 3,3V${ih}Z`)
        .on('mousemove', ev => showTip(ev, `<div class="h">${d.label} · ${b.label}</div>` + (b.tip || tipRows([['Value', yFmt(v)]]))))
        .on('mouseleave', hideTip);
      if (b.err) {
        const cx = bx + bw / 2;
        g.append('line').attr('x1', cx).attr('x2', cx).attr('y1', y(v - b.err)).attr('y2', y(v + b.err)).attr('stroke', P.text2).attr('stroke-width', 1.2);
        g.append('line').attr('x1', cx - 3).attr('x2', cx + 3).attr('y1', y(v + b.err)).attr('y2', y(v + b.err)).attr('stroke', P.text2).attr('stroke-width', 1.2);
      }
    }
    const lab = d.label.length > maxLabel ? d.label.slice(0, maxLabel - 1) + '…' : d.label;
    g.append('text').attr('class', 'lbl strong').attr('x', gx + x0.bandwidth() / 2).attr('y', ih + 14).attr('text-anchor', 'middle').text(lab);
  }
  return svg;
}
