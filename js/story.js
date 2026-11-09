/* story.js — guided steps in the style of Minerva Story (Rashid et al., Nat Biomed Eng 2021):
   a narrative panel walks through the questions, and each step only changes the STATE of the one workspace.

   EDIT ME: the step texts are plain-language placeholders describing what each view shows and how to use it.
   Rewrite them in your own words before presenting (course policy on AI-written text). Each `state` is a patch
   of the shared state S (core.js), so steps are easy to add, reorder or retune. */
'use strict';

const STORY = [
  { short: 'Start', title: 'Meet the data',
    state: { view: 'section', color: 'region', evid: 'data', trust: false, lens: false, links: false, pick: new Set(), sel: null, shown: new Set(SEC.map(s => s.i)) },
    text: () => `Each dot is one cell: ${fmt.int(N)} cells from ${SEC.length} sections of one macaque hippocampus, colour = subregion.
      Left: all sections stacked in 3D. Middle: one section in real tissue coordinates (left) and its DG cells on a similarity map, the UMAP (right).
      <br><i>Try:</i> click a section name in the 3D stack; hover any ⓘ for an explanation.` },
  { short: 'Q1 Cells', title: 'Q1 · Which cell types live where?',
    state: { view: 'section', color: 'type', evid: 'regions', q1view: 'comp', pick: new Set(), sel: null, trust: false, lens: false, links: false },
    text: () => `Colour = cell type as published by the authors. The bars below compare the cell-type mix of DG and CA1 in every section.
      <br><i>Look for:</i> does the difference between regions repeat in all sections?
      <br><i>Try:</i> click a cell type in the legend to show only that type everywhere.` },
  { short: 'Q1 Genes', title: 'Q1 · Do marker genes mark the same regions in every section?',
    state: { view: 'grid', color: 'gene:FIBCD1', evid: 'regions', q1view: 'depth', pick: new Set(), sel: null, trust: false, lens: false, links: false, shown: new Set(SEC.map(s => s.i)) },
    before: () => ({ genes: PAPER_GENES.filter(inPanel) }),
    text: () => `Rows = genes, columns = sections. These are the subregion markers named in the paper (PROX1 → DG, FIBCD1 → CA1,
      HOMER3 → CA3/4, NTS → subiculum). The 3D stack shows the gene chosen under “Colour cells by”.
      <br><i>Look for:</i> the region that lights up, not how bright it is. Brightness also depends on how deeply each section was sequenced.` },
  { short: 'Q2 Groups', title: 'Q2 · What makes a group of DG cells distinct?',
    state: { view: 'section', color: 'cluster', evid: 'groups', trust: false, lens: false, links: false, pick: new Set() },
    after: () => { const c = groupWithMost('Astrocyte'); if (c != null) selectCluster(S.focus, c); },
    text: () => `The DG cells were split automatically into groups with similar gene activity. One group is selected; it lights up in every view.
      Below: its top genes and what the authors called those cells.
      <br><i>Try:</i> click another group, or drag a lasso around cells on the UMAP.` },
  { short: 'Q2 Niche', title: 'Q2 · Do stem-cell-like cells sit next to astrocytes?',
    state: { view: 'section', color: 'nsc', evid: 'niche', links: true, trust: false, lens: false, pick: new Set(), sel: null, nullMode: 'all' },
    text: () => `Colour = NSC score (stem-cell markers in the sidebar). Lines join each NSC-like cell to its nearest ${BROAD[S.ref].toLowerCase()}.
      The charts below ask whether this closeness beats chance.
      <br><i>Try:</i> switch the chance model to “within astrocytes”. Does the effect survive?` },
  { short: 'Q3 Sensitivity', title: 'Q3 · How sensitive is the UMAP?',
    state: { view: 'compare', color: 'trust', trust: true, lens: true, links: false, evid: 'reliability', pick: new Set(), sel: null },
    text: () => `This is the only place where embedding quality is shown. The same DG cells are drawn with two UMAP settings (A, B).
      Red rings mark cells whose position does not match their true neighbours in gene activity (scDEED “dubious”).
      With the neighbour lens on, hovering a cell rings its ${KL} most similar cells: short spokes = faithful, long spokes = distorted.
      <br><i>Try:</i> lasso cells in UMAP A and find them in UMAP B; hover cells in small groups.` },
];

function groupWithMost(broadName) {
  const b = BROAD.indexOf(broadName), dg = Array.from(cellsOf(S.focus, 'dg'));
  let best = null, bestF = -1;
  for (let c = 0; c < nClusters(S.focus); c++) {
    const ids = dg.filter(i => C.leiden[i] === c);
    const f = ids.filter(i => C.broad[i] === b).length / (ids.length || 1);
    if (ids.length >= 30 && f > bestF) { bestF = f; best = c; }
  }
  return best;
}

const Story = (() => {
  async function go(k) {
    k = Math.max(0, Math.min(STORY.length - 1, k));
    const st = STORY[k];
    const patch = Object.assign({}, st.state, st.before ? st.before() : {}, { step: k });
    if (patch.color && patch.color.startsWith('gene:') && inPanel(patch.color.slice(5))) await loadGene(patch.color.slice(5));
    if (patch.genes) await loadGenes(patch.genes);
    patch.tour = true;
    update(patch);
    if (st.after) st.after();
    history.replaceState(null, '', location.search + '#step=' + k);
  }
  function setTour(on) {
    try { localStorage.setItem('mhe-tour', on ? 'on' : 'off'); } catch (e) { /* storage unavailable */ }
    const u = new URL(location.href);                       // keep the URL in sync so a reload keeps the mode
    if (on) u.searchParams.delete('tour'); else { u.searchParams.set('tour', 'off'); u.hash = ''; }
    history.replaceState(null, '', u);
    if (on) go(S.step || 0); else update({ tour: false });
  }
  function render() {
    document.body.classList.toggle('no-tour', !S.tour);
    const tb = document.getElementById('btn-tour');
    tb.textContent = S.tour ? 'Exit tour' : 'Start tour';
    tb.classList.toggle('on', !S.tour);
    if (!S.tour) return;
    const st = STORY[S.step];
    document.getElementById('story-count').textContent = `Step ${S.step + 1} of ${STORY.length}`;
    document.getElementById('story-title').textContent = st.title;
    document.getElementById('story-text').innerHTML = st.text();
    document.getElementById('story-prev').disabled = S.step === 0;
    const last = S.step === STORY.length - 1, nx = document.getElementById('story-next');
    nx.textContent = last ? 'Finish tour ✓' : 'Next →';
    const pills = document.getElementById('steps');
    if (!pills.childElementCount) {
      pills.innerHTML = STORY.map((s, k) => `<button data-k="${k}"><span class="n">${k + 1}</span>${s.short}</button>`).join('');
      pills.querySelectorAll('button').forEach(b => b.onclick = () => go(+b.dataset.k));
    }
    pills.querySelectorAll('button').forEach(b => b.classList.toggle('active', +b.dataset.k === S.step));
  }
  function init() {
    document.getElementById('story-prev').onclick = () => go(S.step - 1);
    document.getElementById('story-next').onclick = () => (S.step === STORY.length - 1 ? setTour(false) : go(S.step + 1));
    document.getElementById('btn-tour').onclick = () => setTour(!S.tour);
    document.getElementById('story-reset').onclick = () => go(S.step);
    document.addEventListener('keydown', e => {
      if (!S.tour || /input|select|textarea/i.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight') go(S.step + 1);
      if (e.key === 'ArrowLeft') go(S.step - 1);
    });
  }
  return { go, render, init, setTour };
})();
