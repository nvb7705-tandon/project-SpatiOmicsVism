# SpatiOmicsVis — Macaque Hippocampus Explorer

**An interactive visual analytics tool for exploring spatial transcriptomics data from the macaque hippocampus.**

SpatiOmicsVis provides an interactive visualization of approximately **139,000 cells across seven tissue sections** from a single macaque hippocampus. The tool enables users to explore spatial organization, gene expression patterns, cell populations, and relationships between cells through linked visualizations.

Designed for accessibility, the explorer runs locally in a web browser without requiring installation, programming experience, or an internet connection.

## Quick Start

1. **Download and extract** the entire project folder. Keep all files and subfolders together. Do not open files directly from the ZIP archive.
2. **Launch the explorer** by double-clicking one of the following files:
   - **`index.html` (Recommended):** Opens the guided tour, introducing the main features and scientific questions in six short steps.
   - **`explore.html`:** Opens the explorer directly, with all visualization and analysis controls available.
3. **Wait a few seconds** for the cell data and visualizations to load.

**Browser compatibility:** Tested in Google Chrome. Other modern browsers, including Microsoft Edge, Firefox, and Safari, are expected to work but have not been tested.

## Features and Navigation

### Interactive Visualizations
- **Spatial Tissue Map:** Explore the anatomical locations of individual cells across hippocampal sections.
- **UMAP Visualization:** Examine similarities between cells based on their gene expression profiles.
- **Linked Views:** Explore cell populations across multiple visualizations, with coordinated coloring and selections.
- **UMAP Sensitivity:** Investigate the reliability of the UMAP representation using visual indicators such as red rings and the neighbor lens.

### Cell Exploration and Selection
- **Color Cells By:** Change the coloring of cells across all linked views.
- **Interactive Legends:** Click legend categories to show or hide cell groups. Multiple categories can be displayed simultaneously.
- **Select These Cells:** Convert the currently visible categories into a selection for downstream charts.
- **Interactive Selection:** Click cell groups or use the lasso tool to select cells directly from the visualizations.
- **Clear Selection:** Press `Esc` to reset the current selection.

### Section Navigation
- Use the **Sections** panel in the left sidebar to include or exclude individual tissue sections.
- Select **Only Focus** to isolate a single section for closer examination.

### Guided Tour and Help
- **Guided Tour:** Follow six introductory steps using the navigation cards on the left. Click **Next** to continue.
- **Exit Tour:** Switch to free exploration at any time using the button in the upper-right corner.
- **Start Tour:** Restart the guided experience whenever needed.
- **Tooltips:** Hover over information (`i`) icons or buttons for plain-language explanations.
- **Guide:** Open the accompanying two-page guide for instructions and an overview of the scientific findings.

## Troubleshooting

If the page appears blank or remains on **"Loading cells..."**:

1. Confirm that the entire project folder has been extracted from the ZIP archive.
2. Verify that all files and subfolders remain in their original locations.
3. If your browser restricts access to local files, launch the included local server.

**Running the local server (requires Python 3):**

Open a terminal in the project folder and run:

```bash
python3 serve.py
```

Then open the following address in your browser:

`http://localhost:8765`

The server runs locally on your computer and does not require an internet connection.

## Project Structure

```text
SpatiOmicsVis/
│
├── index.html             # Explorer with guided tour
├── explore.html           # Explorer without guided tour
├── Explorer_Guide.pdf     # Two-page user guide and findings
├── guide.html             # Web-based version of the guide
├── serve.py               # Optional local Python server
├── style.css              # Application styling
│
├── data/                  # Precomputed cell and gene data
│   └── findings.json      # Quantitative findings in the guide
│
├── js/                    # Application JavaScript
└── vendor/                # Supporting libraries
```

**Important:** The `data/`, `js/`, and `vendor/` directories contain files required for the application to function correctly. Do not modify or relocate them.

## Dataset and Reference

The explorer uses cell-level spatial transcriptomics data from seven macaque hippocampal tissue sections, generated using Stereo-seq technology.

**Reference:**

Fei, T., Dong, Y., Gou, X., et al. (2026). *Evolutionary convergence and divergence of hippocampal cytoarchitecture between rodents and primates revealed by single-cell spatial transcriptomics.* National Science Review, 13(5), nwaf595.

DOI: https://doi.org/10.1093/nsr/nwaf595

## Authors and Acknowledgments

**Developed by:**
- Nicolle Bejarano
- Zhihao Chen

**Course:** Biomedical Visual Analytics  
**Institution:** New York University (NYU)  
**Semester:** Fall 2026

Developed as an academic visualization project to support interactive exploration and interpretation of spatial transcriptomics data in the macaque hippocampus.
