# Chapter 7 — Data Export

## Overview

_Placeholder: Pedimap 2 supports exporting the graph image, the individual table, and the full pedigree as JSON._

## Exporting the Graph as an Image

Click **🖼 Export image…** in the toolbar. The export always contains the whole
displayed chart (the full population, or the subpopulation you are showing),
no matter how far you have zoomed or panned. It uses the current display
style (Modern or Classic Pedimap) and orientation, with the same fills,
role-colored parent links and cross symbols as on screen, plus a legend for
the trait you are coloring by.

| Format | Use it for |
|--------|------------|
| **PNG** | Slides and documents. Saved at 2× screen resolution. A very large chart is saved at a lower scale so neither side exceeds 16,000 pixels; the dialog tells you when this happened. |
| **SVG** | Editing in Inkscape or Illustrator. A vector drawing in which names are text. |
| **PDF** | Printing and publication. Vector, with names as text. Choose a page fitted to the chart, or US Letter or A4 in landscape (the chart is scaled down to fit inside the margins). |

Names are set in Noto Sans, which is bundled with Pedimap 2 and embedded in
every exported file, so accented and non-Latin names appear correctly on any
computer.

The chart cannot be exported while the population is too large to draw (see
the drawing limit under ⚙); build a subpopulation first.

## Exporting the Individual Table as CSV

_Placeholder: File → Export → CSV; columns exported — ID, name, parents, cross type, ploidy, generation, all traits._

## Saving the Pedigree as JSON

_Placeholder: File → Save As → JSON; explain the round-trip guarantee — saved files can be re-opened with no data loss._

## Copying Node Data to Clipboard

_Placeholder: right-click a node → Copy Details to copy the individual's data as tab-separated text._

## Printing

_Placeholder: File → Print opens the system print dialog; tips for landscape orientation and scaling._

## Batch Export

_Placeholder: placeholder for a planned batch-export feature (multiple subpopulations as separate files); marked as roadmap._
