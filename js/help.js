/* help.js — plain-language help: glossary tooltips (any element with data-help), the welcome card,
   step-aware sidebar controls and one-line captions for the evidence panel. Written for readers with
   a neuroscience background and little CS / statistics / visualization background. */
'use strict';

const GLOSSARY = {
  sections: ['Tissue sections', 'The 7 sections with cell-level data, placed at their real position along the hippocampus (ebz, mm). Ticked sections are in scope (3D stack, grid, across-section charts); tick just one, or press “Only focus”, for a single-section view. Click a name to make it the focus section.'],
  genes: ['Genes', 'Genes you want to look at. Expression is shown as log-normalised counts: RNA molecules per 10,000 in the cell, on a log scale. Comparing regions within one section is safer than comparing levels across sections.'],
  regions: ['Regions', 'Hippocampal subregions as annotated by the authors (DG = dentate gyrus, CA1–CA4 = cornu ammonis fields, SUB/proS/preS/paraS = subicular complex).'],
  nsc: ['NSC score', 'A neural-stem-cell-like score: the average strength of the selected markers in a cell (0 = none expressed, 1 = all strongly expressed). It is a hint, not a cell-type call.'],
  ref: ['Neighbour cell type', 'The cell type whose distance to your cells of interest is measured, e.g. how far each NSC-like cell is from the nearest astrocyte.'],
  stack: ['Sections in 3D', 'All 7 sections stacked by their position. Same colours as the tissue map, so you can follow a gene or cell type through the hippocampus. Alignment is approximate (each section rotated and centred), not a true 3D reconstruction.'],
  tissue: ['Tissue map', 'Each dot is a cell at its real position in the section (scale bar in µm). This answers “where?”.'],
  umap: ['UMAP', 'A 2D “similarity map” of the DG cells: cells with similar gene activity are drawn close together. Positions are not anatomy, and distances are only approximate. A and B are the same cells with two different UMAP settings.'],
  sensitivity: ['UMAP sensitivity', 'The one place where embedding quality is shown: the same DG cells with two UMAP settings side by side, scDEED reliability rings and the neighbour lens. Use it to check how much a UMAP picture depends on the settings.'],
  trust: ['Flag unreliable positions', 'scDEED checks every cell: are its neighbours on the UMAP the same as its true neighbours in gene space? Cells that fail are ringed in red (“dubious”). Do not build a story on them.'],
  lens: ['Neighbour lens', 'Hover a DG cell to see its 15 most similar cells by gene activity (rings, with spokes on the UMAP). If they land far apart, the UMAP is distorting that cell.'],
  links: ['Nearest-cell links', 'Draws a line from each cell of interest (NSC-like cells, or your selection) to the nearest cell of the chosen neighbour type.'],
  leiden: ['Leiden groups', 'Groups of DG cells with similar gene activity, found automatically. Group numbers are arbitrary and are not comparable between sections.'],
  enrichment: ['Neighbourhood enrichment', 'Do your cells touch the neighbour type more often than expected by chance? We shuffle cell labels 199 times to see what “chance” looks like. z above about 2 means more often than chance; p is the share of shuffles that did as well.'],
  nullmodel: ['What “chance” means', '“All DG cells” shuffles every label in the DG. “Within astrocytes” only shuffles among astrocytes. Use it when your cells are themselves astrocytes, to ask if they are special among astrocytes.'],
  cooc: ['Co-occurrence', 'How much more often the neighbour type is found within a given distance of your cells than on average. 1 = no preference; the gray band is the range expected by chance.'],
  qc: ['Quality control', 'Cells with too few RNA molecules or genes, or too many mitochondrial reads (a sign of damaged cells), are flagged and left out of the analyses.'],
  pres: ['Neighbour preservation', 'For each cell: how many of its 15 most similar cells (in gene space) are also among its 15 nearest on the UMAP. 1 = all kept.'],
};

const CAPTIONS = {
  data: 'Sections in order of position, with cell counts and quality. The histograms show how many RNA molecules and genes each cell has; red lines are the cut-offs used to drop poor-quality cells.',
  regions: 'Compare the regions ticked in the sidebar, section by section. Each point is an average over all cells of that region in that section.',
  groups: 'Automatic groups of DG cells in the focus section. Blue = lower than the other groups, red = higher. Pick a group to see the genes that set it apart and what the authors called those cells.',
  niche: 'Are NSC-like cells (or your selection) placed next to a particular cell type more than chance? Compare the orange curve and the coloured cells against the gray “chance” band. Then switch the chance model.',
  reliability: 'How faithful the UMAP is. Blue bars = real cells, gray outline = scores expected by chance. Cells left of the red line are “dubious”. The table shows which groups contain them.',
};

/* which sidebar controls each tour step needs (others hide unless "show all") */
const STEP_CONTROLS = [['sections'], ['sections', 'regions'], ['sections', 'genes', 'regions'], ['sections', 'genes'],
  ['sections', 'nsc', 'ref'], ['sections']];

const Help = (() => {
  let showAll = false;
  function initTips() {
    document.addEventListener('mouseover', ev => {
      const t = ev.target.closest && ev.target.closest('[data-help]');
      if (!t) return;
      const g = GLOSSARY[t.dataset.help];
      if (g) showTip(ev, `<div class="h">${g[0]}</div>${g[1]}`);
    });
    document.addEventListener('mouseout', ev => { const t = ev.target.closest && ev.target.closest('[data-help]'); if (t) hideTip(); });
  }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function initWelcome() {
    const w = document.getElementById('welcome');
    const close = () => { w.hidden = true; store('mhe-welcome', 'seen'); };
    document.getElementById('wl-start').onclick = () => { close(); Story.setTour(true); };
    document.getElementById('wl-skip').onclick = () => { close(); Story.setTour(false); };
    document.getElementById('btn-welcome').onclick = () => { w.hidden = false; };
    w.addEventListener('click', e => { if (e.target === w) close(); });
    if (store('mhe-welcome') !== 'seen' && !location.hash && !/tour=off/.test(location.search)) w.hidden = false;
  }
  function renderControls() {
    const need = S.tour ? STEP_CONTROLS[S.step] : null;
    const all = showAll || !need;
    let hidden = 0;
    document.querySelectorAll('.side [data-ctl]').forEach(c => {
      const on = all || need.includes(c.dataset.ctl) || (c.dataset.ctl === 'settings' && all);
      c.style.display = on ? '' : 'none';
      if (!on) hidden++;
    });
    const b = document.getElementById('ctl-all');
    b.textContent = need ? (showAll ? 'show fewer' : `show all (+${hidden})`) : '';
    b.onclick = () => { showAll = !showAll; renderControls(); };
    document.querySelector('.ctl-head span').textContent = need ? 'Controls for this step' : 'All controls';
  }
  function caption() { document.getElementById('ev-caption').textContent = CAPTIONS[S.evid] || ''; }
  function init() { initTips(); initWelcome(); }
  function render() { renderControls(); caption(); }
  return { init, render };
})();
