/* stats.js — permutation-based spatial statistics for the focus section's DG (in the spirit of Squidpy's
   nhood_enrichment and co_occurrence; Palla et al. 2022). Computed in the browser so they follow the
   current NSC marker library, threshold, reference type and selection.

   Null models
     'all'   : shuffle category labels across all DG cells (keeps positions and composition)          — Squidpy default
     'astro' : shuffle the "cells of interest" label only among astrocytes (asks: are these astrocytes placed
               differently from other astrocytes?) — the fair test when the cells of interest are astrocytes. */
'use strict';

const Stats = (() => {
  const N_PERM = 199;
  const cache = new Map();

  function rng(seed) { // mulberry32 — deterministic, so results do not flicker between renders
    return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function shuffleAt(arr, pos, rand) { // permute arr values at the given positions
    for (let k = pos.length - 1; k > 0; k--) {
      const j = Math.floor(rand() * (k + 1)), a = pos[k], b = pos[j];
      const t = arr[a]; arr[a] = arr[b]; arr[b] = t;
    }
  }

  /* categories: 0 = cells of interest, 1.. = broad types of the remaining DG cells */
  function labels(si, coi) {
    const D = cellsOf(si, 'dg'), loc = new Int32Array(SEC[si].n).fill(-1), start = SEC[si].start;
    D.forEach((i, k) => { loc[i - start] = k; });
    const inC = new Uint8Array(D.length);
    for (const i of coi) { const k = loc[i - start]; if (k >= 0) inC[k] = 1; }
    const lab = new Uint8Array(D.length);
    D.forEach((i, k) => { lab[k] = inC[k] ? 0 : 1 + C.broad[i]; });
    return { D, loc, start, lab };
  }

  function enrichment(si, coi, coiName, mode) {
    const key = ['enr', si, mode, coi.length, coi.slice(0, 50).join(',')].join('|');
    if (cache.has(key)) return cache.get(key);
    const { D, loc, start, lab } = labels(si, coi);
    const cats = [{ label: coiName, color: P.cat[1] }].concat(BROAD.map((b, j) => ({ label: b === 'Astrocyte' ? 'Astrocyte (other)' : b, color: broadColor(j) })));
    const K = cats.length;
    // DG–DG edges of the spatial kNN graph
    const EA = [], EB = [];
    D.forEach((i, a) => { for (const j of spatialNeighbours(i)) { const b = loc[j - start]; if (b >= 0) { EA.push(a); EB.push(b); } } });
    const count = L => { const m = new Float64Array(K * K); for (let e = 0; e < EA.length; e++) m[L[EA[e]] * K + L[EB[e]]]++; return m; };
    const obs = count(lab), sum = new Float64Array(K * K), sq = new Float64Array(K * K), ge = new Float64Array(K * K);
    const pos = mode === 'astro' ? Array.from(D.keys()).filter(k => C.broad[D[k]] === BROAD.indexOf('Astrocyte')) : Array.from(D.keys());
    const rand = rng(20261024), L = new Uint8Array(lab);
    for (let p = 0; p < N_PERM; p++) {
      shuffleAt(L, pos, rand);
      const m = count(L);
      for (let q = 0; q < K * K; q++) { sum[q] += m[q]; sq[q] += m[q] * m[q]; if (m[q] >= obs[q]) ge[q]++; }
    }
    const nCat = new Array(K).fill(0);
    for (const v of lab) nCat[v]++;
    const out = { cats, K, nCat, obs, mean: [], z: [], p: [], edges: EA.length };
    for (let q = 0; q < K * K; q++) {
      const mu = sum[q] / N_PERM, sd = Math.sqrt(Math.max(0, sq[q] / N_PERM - mu * mu));
      out.mean.push(mu); out.z.push(sd > 1e-9 ? (obs[q] - mu) / sd : NaN); out.p.push((ge[q] + 1) / (N_PERM + 1));
    }
    cache.set(key, out);
    return out;
  }

  /* co-occurrence ratio P(reference type within d of a cell of interest) / P(reference type), cumulative in d */
  function cooccurrence(si, coi, ref, mode, dmax = 150, step = 10) {
    const key = ['co', si, ref, mode, coi.length, coi.slice(0, 50).join(',')].join('|');
    if (cache.has(key)) return cache.get(key);
    const D = Array.from(cellsOf(si, 'dg')), isRef = new Uint8Array(N);
    let nRef = 0;
    for (const i of D) if (C.broad[i] === ref) { isRef[i] = 1; nRef++; }
    const pB = nRef / D.length, nb = Math.ceil(dmax / step);
    const qt = d3.quadtree().x(i => C.x[i]).y(i => C.y[i]).addAll(D);
    const curve = A => {
      const tot = new Float64Array(nb), hit = new Float64Array(nb);
      for (const a of A) {
        const x = C.x[a], y = C.y[a];
        qt.visit((node, x0, y0, x1, y1) => {
          if (!node.length) {
            do {
              const j = node.data;
              if (j !== a) {
                const d = Math.hypot(C.x[j] - x, C.y[j] - y);
                if (d <= dmax) { const b = Math.min(nb - 1, Math.floor(d / step)); tot[b]++; if (isRef[j]) hit[b]++; }
              }
            } while ((node = node.next));
          }
          return x0 > x + dmax || x1 < x - dmax || y0 > y + dmax || y1 < y - dmax;
        });
      }
      const r = new Float64Array(nb);
      let t = 0, h = 0;
      for (let b = 0; b < nb; b++) { t += tot[b]; h += hit[b]; r[b] = t ? (h / t) / pB : NaN; }
      return r;
    };
    const obs = curve(coi);
    const pool = mode === 'astro' ? D.filter(i => C.broad[i] === BROAD.indexOf('Astrocyte')) : D;
    const rand = rng(7), nPerm = 99, sims = [];
    const k = Math.min(coi.length, pool.length);
    for (let p = 0; p < nPerm; p++) {
      const pick = pool.slice();
      for (let q = 0; q < k; q++) { const j = q + Math.floor(rand() * (pick.length - q)); const t = pick[q]; pick[q] = pick[j]; pick[j] = t; }
      sims.push(curve(pick.slice(0, k)));
    }
    const qnt = f => d3.range(nb).map(b => d3.quantile(sims.map(s => s[b]).filter(v => v === v).sort(d3.ascending), f));
    const out = { d: d3.range(nb).map(b => (b + 1) * step), obs: Array.from(obs), lo: qnt(0.025), mid: qnt(0.5), hi: qnt(0.975), pB, nRef, nA: coi.length };
    cache.set(key, out);
    return out;
  }

  return { enrichment, cooccurrence };
})();
