Macaque Hippocampus Explorer
============================
An interactive map of ~139,000 cells from 7 sections of one macaque hippocampus (spatial transcriptomics).

QUICK START
  1. Unzip the whole folder (do not open files from inside the zip; keep the folder together).
  2. Double-click one of:
       index.html     guided tour: 6 short steps through the questions (recommended the first time)
       explore.html   the same tool without the tour: all controls at once
  3. Wait a few seconds for the cells to load. No installation and no internet connection are needed.
  Tested in Google Chrome. Other modern browsers (Edge, Firefox, Safari) should work but were not tested.

USING IT
  - Guided tour: read the card on the left, press "Next". "Exit tour" (top right) switches to free
    exploration; "Start tour" brings it back.
  - Every dot is a cell. Tissue map = where the cell is; UMAP = which cells have similar gene activity.
  - "Colour cells by" changes the colour in every view. Click legend entries to show / hide categories
    (several at once); "Select these cells" turns them into the selection used by the charts.
  - Click a group or drag a lasso on the maps to select cells; Esc clears the selection.
  - Sections (left sidebar): tick the sections to include; "Only focus" = single-section view.
  - "UMAP sensitivity" view: the only place showing how reliable the UMAP is (red rings, neighbour lens).
  - Hover any (i) symbol or button for a plain-language explanation. "Guide" opens the 2-page guide.

IF THE PAGE STAYS BLANK OR SAYS "Loading cells..."
  Make sure the folder was unzipped and nothing was moved out of it. If your browser still blocks local
  files, run a tiny local server from this folder (needs Python 3):
      python3 serve.py        then open  http://localhost:8765

WHAT'S INSIDE
  index.html                   the interactive tool, with the guided tour
  explore.html                 the same tool without the tour (all controls at once)
  Explorer_Guide.pdf           2-page guide: how to use the tool + scientific findings
  guide.html                   the same guide as a web page (also linked from the tool's "Guide" button)
  data/                        precomputed cells and genes (do not edit)
  data/findings.json           the numbers quoted in the guide
  js/, vendor/, style.css      program files

DATA
  Fei et al. (2026) Natl Sci Rev 13: nwaf595 — macaque hippocampus Stereo-seq, 7 sections with cell-level data.
  Built by Nicolle Bejarano & Zhihao Chen, Biomedical Visual Analytics (NYU), Fall 2026.
