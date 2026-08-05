# Pedimap 2 — Interaction Model

> **Status:** authoritative design reference. This document describes the
> interaction model Pedimap 2 is expected to reproduce. Where the wording says
> MUST / SHOULD / MAY, it is normative for the UI implementation.
>
> **Source attribution.** The interaction model described here is derived from
> the design of Pedimap 1.x (Voorrips, Bink & van de Weg 2012) and its
> accompanying manual. This is original documentation written for Pedimap 2 and
> does not reproduce text from the original manual, which is copyrighted by
> Wageningen UR.

---

## 1. Window layout

Below the menu bar and toolbar, the window is divided into **three regions**: a
left column split into two stacked panels, and a large main panel on the right.

```
┌───────────────────────────────────────────────────────────────┐
│ menu bar / toolbar                                             │
├───────────────────┬───────────────────────────────────────────┤
│ Population panel   │                                           │
│ (upper left)       │   Main panel (right) — tabbed             │
│                    │   [ Individuals | Overview | View 1 | … ] │
├───────────────────┤                                           │
│ Information panel  │                                           │
│ (lower left)       │                                           │
└───────────────────┴───────────────────────────────────────────┘
```

### 1.1 Population panel (upper left)

A **tree** of the full population and every subpopulation derived from it.
Derived subpopulations nest beneath the population they were created from (§4).

- **Click** a node to switch the active population; the main panel and
  information panel update to reflect it.
- **Ctrl+click** to multi-select population nodes (used, for example, when
  combining subpopulations into a union — §4).

### 1.2 Information panel (lower left)

A **live** details panel. As the cursor moves over an individual or a cross in
the main panel, this panel updates to show that individual's or cross's
details (name, parents, trait values, and — when present — marker/IBD summary).
It reflects the item **under the cursor**, which is distinct from the current
selection and from the focused individual (§3).

### 1.3 Main panel (right) — tabbed

The main panel is a tab strip. Two tabs are **fixed** and always present; the
user MAY create any number of additional **View** tabs.

| Tab | Kind | Contents |
|---|---|---|
| **Individuals** | fixed | A **sortable table**: one row per individual, with columns for its parents and each trait value. Clicking a column header sorts by that column. |
| **Overview** | fixed | A **compact pedigree** used for orientation and selection: generations laid out **left to right**, **names only**, no decoration. Meant to be scanned quickly to find and select individuals. |
| **View 1, View 2, …** | user-created | Fully **customized pedigree graphics** rendered per that view's View Options (§6). Each view carries its own configuration. |

---

## 2. Menu / toolbar

The menu bar and toolbar sit above the three regions and remain available at all
times. They host file operations, the **Select Relatives** operation (§3.3),
subpopulation operations (§4), and access to **View Options** (§6) and settings
(including the performance limit, §5).

---

## 3. Selection model

Selection is a property of **individuals** and is global to the loaded data, not
to any one tab.

### 3.1 Selecting

- **Plain click** on an individual **selects that one individual and clears all
  others** — a single-selection replace.
- **Ctrl+click** on an individual **toggles just that individual** (select if
  unselected, deselect if selected) **without disturbing** the rest of the
  selection.

### 3.2 Persistence and appearance

- The selection **persists across tab switches and across views.** Selecting an
  individual in Overview and then switching to a View tab shows the same
  individual selected there, and vice versa.
- **Selected** individuals draw a **blue border.**
- Exactly one individual at a time is the **focused** individual (the most
  recent target of interaction). The focused individual draws:
  - **purple** if it is also selected, or
  - **red** if it is not selected.

This yields an unambiguous reading: blue = in the selection; purple = the
focused member of the selection; red = the focus point, currently outside the
selection.

### 3.3 Select Relatives

**Select Relatives** grows or shrinks the selection by tracing the pedigree
outward from the **focused individual**. It is parameterized as follows:

- **Mode** — either **add to** the current selection or **remove from** it.
- **Ancestor generations** — how many generations of ancestors to traverse
  (0 = none).
- **Progeny generations** — how many generations of descendants to traverse
  (0 = none).
- **Line** — trace through the **male line**, the **female line**, or **both.**
- **Include progeny parents** — when tracing progeny, also include the *other*
  parent of each descendant (the "cold side" of the cross — the mate that is not
  on the traced line).
- **Include full sibs** — also include the full siblings of individuals reached
  by the trace.

The operation applies its **Mode** to the set of individuals identified by the
generation/line/option parameters, leaving all other individuals' selection
state unchanged.

---

## 4. Subpopulations

A **subpopulation** is a named, persisted subset of individuals, shown as a node
in the Population panel tree (§1.1).

### 4.1 Creating and nesting

- Create a subpopulation **from the current selection.**
- A new subpopulation **nests under the population it was derived from** in the
  tree, preserving the derivation lineage visually.

### 4.2 Managing

Each subpopulation can be:

- **renamed,**
- **deleted,**
- **flagged** (a user marker for quick visual identification), and
- annotated with **free-text notes.**

### 4.3 Selection history

Each subpopulation **records and displays the selection history** that produced
it: the **base individual** it was derived from and the **criteria** used
(e.g. the Select Relatives parameters — ancestor/progeny generations, line,
options). This makes a subpopulation self-documenting: a later reader can see
not just *which* individuals it contains but *how* they were chosen.

### 4.4 Combining

Multiple subpopulations MAY be **combined into a new union subpopulation** (the
set union of their members), created as its own node. This is the primary use of
Ctrl+click multi-select in the Population panel (§1.1).

### 4.5 Copying view configuration

A subpopulation's **view configurations** (its View tabs and their View Options)
MAY be **copied to another subpopulation**, so a display style tuned on one
subset can be reused on another without rebuilding it.

---

## 5. Performance guard

Large pedigrees both exhaust rendering resources and are effectively unreadable
as graphics, so graphical views are **suppressed above a size threshold.**

- The **default limit is 1000 individuals**, matching the original design.
- The limit MUST be **configurable in settings.**
- When the active population/subpopulation **exceeds the limit**, Pedimap 2 MUST
  **not** attempt to render a graphical view. Instead it MUST:
  1. show the **Individuals** table (which scales fine), and
  2. **prompt the user to narrow the selection first** (e.g. via Select
     Relatives or by creating a smaller subpopulation) before a graphical View
     can be shown.

The fixed **Overview** and **View** tabs are subject to this guard; the
**Individuals** table is not.

---

## 6. View Options

**View Options** is the customization surface for a **View** tab. It is
organized as a set of **pages.** Each page governs one aspect of the rendered
pedigree graphic.

### 6.1 Layout

- **Orientation** — **top-to-bottom** or **left-to-right.**
- **Cross symbols** — on/off, and their **size.**
- **Generation spacing** — distance between successive generations.
- **Sib spacing** — distance between siblings within a family.

### 6.2 Individuals

- **Name font** for individual labels.
- **Fill color** — either a **fixed** color, or **driven by a trait** (the
  individual's cell is colored according to a chosen trait's value).
- **Cell contents** — **name only**, or **name plus marker / IBD data.**

### 6.3 IBD

- **Linkage group selector** — which linkage group's IBD data to display.
- **Haplotype rectangle dimensions** — width/height of the drawn haplotype
  blocks.
- **Founder-allele colors,** with selectable **presets:**
  - **homozygous founders,**
  - **heterozygous founders** *(default),*
  - **all one color.**

### 6.4 Markers

- **Marker selection** — which markers to show.
- **Sort** markers by **name** or by **map position.**
- **Marker font.**
- **Per-color-code colors** — the color assigned to each marker color code
  (codes `0`–`9` are distinct; codes above `9` render gray — see the `.dat`
  format reference).

### 6.5 Colors

- **Page background** color.
- **Cross connectors** — with defaults **female = red**, **male = blue.**
- **Uniparental connector** — the connector drawn for selfing / DH / mutant /
  vegetative-propagation relationships, **purple by default.**

---

## 7. Notes for implementers

- **Under-cursor vs. selected vs. focused** are three independent concepts. The
  information panel (§1.2) tracks *under-cursor*; the blue border tracks
  *selected*; the purple/red highlight tracks *focused* (§3.2). Keep them as
  separate state.
- Selection is **global** (§3), so all tabs and views subscribe to one selection
  model; switching tabs MUST NOT reset it.
- View configuration is **per View tab** and **per subpopulation**, and is
  copyable between subpopulations (§4.5); design it as serializable data that
  can be attached to any subpopulation.
- The performance limit (§5) is a **default**, not a hard cap; respect the
  user's configured value and always leave the Individuals table reachable.
