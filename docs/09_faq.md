# Chapter 9 — Frequently Asked Questions

## Installation

### The app won't open on macOS — "unidentified developer" warning

_Placeholder: right-click the app icon → Open → Open in the confirmation dialog to bypass Gatekeeper for unsigned builds._

### On Linux the app crashes immediately

_Placeholder: ensure `libwebkit2gtk-4.1` is installed (`sudo apt install libwebkit2gtk-4.1-dev`) and the AppImage is executable._

## Loading Data

### My .dat file loads but shows no individuals

_Placeholder: check that the header row uses the expected column names (ID, FemalePar, MalePar) and that the file is tab-delimited._

### Pedimap 1.x files look different — are they compatible?

_Placeholder: Pedimap 2 reads Pedimap 1.x DAT files; trait columns beyond the standard set are imported as generic traits._

## Visualization

### The graph is too large to navigate

_Placeholder: press F to fit the entire graph in view, then use Ctrl+scroll to zoom into regions of interest._

### Nodes overlap even after fitting the view

_Placeholder: large pedigrees may require manual node repositioning (drag) or the condensed-view toggle (Chapter 8)._

## Performance

### The app is slow with my 10,000-individual pedigree

_Placeholder: enable condensed view, hide edge labels, and consider splitting the pedigree into subpopulations._

## Data and Privacy

### Does Pedimap 2 send my data anywhere?

_Placeholder: all data stays local — the Python backend runs on 127.0.0.1:8765 and no network requests are made to external servers._
