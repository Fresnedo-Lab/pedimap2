# CLAUDE.md — Pedimap 2

## Project overview
Pedimap 2 is a multiplatform desktop application for pedigree visualization
in plant breeding. Spiritual successor to Pedimap 1.x (Voorrips et al. 2012,
J. Hered. 103:903–907).

Stack: Tauri 2.x (Rust shell) · React 18 / TypeScript / Vite (frontend)
· FastAPI / NetworkX / PyInstaller (Python backend sidecar)

Repo: github.com/Fresnedo-Lab/pedimap2

## Directory layout
backend/          FastAPI app + PyInstaller spec + tests
frontend/         React 18 / TypeScript / Vite
src-tauri/        Rust / Tauri shell (main.rs, Cargo.toml, tauri.conf.json,
                  capabilities/, icons/)
docs/             User manual source (Markdown)
.github/workflows/  ci.yml and release.yml

## Key conventions
- American English throughout
- Backend sidecar runs on 127.0.0.1 on a free port the Rust shell picks
  (PEDIMAP_PORT, get_backend_url), in release builds and `npm run app:dev`
  alike, so a busy 8765 never blocks the app. Only the frontend outside Tauri
  (Vite in a browser, the e2e tests) looks for it at 8765; the e2e tests run
  their backend on 8799 and redirect 8765 there. /api/health carries
  "app": "pedimap2"; the frontend accepts no other reply.
- Sidecar binary naming: pedimap-backend-{rust-triple} in src-tauri/binaries/
- Semver: bump package.json, Cargo.toml, and tauri.conf.json together
- All backend routes prefixed /api/

## Build commands
Dev:   npm run app:dev    (stages the sidecar; Tauri starts it on a free port)
       Browser only: cd backend && uvicorn api:app --port 8765   (terminal A)
                     cd frontend && npm run dev                  (terminal B)
Prod:  cd backend && pyinstaller pedimap_backend.spec --distpath dist --noconfirm
       cargo tauri build --target aarch64-apple-darwin

## Test commands
Backend:  cd backend && python -m pytest tests/ -v
Frontend: cd frontend && npm run typecheck && npm test && npm run build
WebKit:   cd frontend && npm run test:e2e   (after the build; starts the backend on
          8799, or E2E_BACKEND_PORT, and stops it with the run, even when the
          run fails or is killed: e2e/backend.mjs, e2e/lifetime.mjs)
Rust:     cd src-tauri && cargo test

## Tauri 2.x migration checklist
- [ ] cargo tauri migrate
- [ ] Cargo.toml: tauri = "2", remove window-all feature
- [ ] tauri.conf.json: remove allowlist, add capabilities/
- [ ] main.rs: rewrite for Tauri 2 Builder API
- [ ] ci.yml: libwebkit2gtk-4.1-dev, Node 22
- [ ] release.yml: tauri-apps/tauri-action v0 + Tauri 2, Linux re-enabled
- [ ] Verify Linux AppImage + deb build in CI

## GitHub secrets in place
APPLE_CERTIFICATE, APPLE_CERTIFICATE_PASSWORD, APPLE_SIGNING_IDENTITY,
APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID

## Known issues
- Tauri 1.x had a Linux webkit2gtk ABI mismatch — Tauri 2 resolves this
- secrets context not available in step-level if: — use job-level env: blocks
- Signed macOS builds need src-tauri/Entitlements.plist
  (com.apple.security.cs.disable-library-validation, wired in via
  bundle.macOS.entitlements). Without it the hardened runtime refuses to load
  the Python.framework the PyInstaller onefile sidecar unpacks ("different
  Team IDs"), the backend exits at startup, and the app shows "Cannot reach
  the Pedimap backend service". Unsigned dev builds never show this — only
  running the signed binary does (release.yml smoke test,
  scripts/verify-macos-dmg.sh --run).
- Set GitHub secrets from files, never by pasting: e.g.
  gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/pedimap2.key
  Copying `cat` output from zsh picked up its trailing "%" end-of-line mark;
  the key then failed to decode ("Invalid symbol 37") on the first build that
  signed updater artifacts.
- CSP lives ONLY in src-tauri/tauri.conf.json (app.security.csp). Never add
  a <meta http-equiv="Content-Security-Policy"> tag to frontend/index.html:
  in dev the Vite-served page has no CSP header, so a meta tag becomes the
  sole enforced policy and silently overrides the Tauri config.
- Parser emits individuals in topological order (Kahn's algorithm keyed by
  file-appearance index), not file order. Parents always precede children;
  sib order within full-sib families is preserved. This changes the order of
  the `individuals` array in every .dat load and to_dict payload — do not
  rely on file order anywhere.
- The original Pedimap 1.x source (github.com/PBR/Pedimap) has NO LICENSE
  file, so all rights are reserved by default. Use it only as a BEHAVIORAL
  reference: read it to understand what the original did, then implement
  independently. Never copy, port, or transliterate its code into this
  MIT-licensed repo. The examples/ folder contains .dat data files usable as
  additional parser test fixtures.
- Cross (×) nodes and link waypoints exist only in the frontend chart model
  (frontend/src/chart/model.ts). Never send them to the backend or list them
  as individuals; the backend's individual ids are the authority.
- Links are drawn from frontend/src/chart/routing.ts on the canvas and in
  every export; vis-network's own edges are invisible and only steer the
  layout. Keep both paths on routeLinks so exports match the screen, and keep
  the invariant test (chart/linkRouting.test.tsx) passing: no link may cross
  a box other than its own endpoints. Dragging is limited to a node's own row
  and its neighbors (routing.ts dragRange), which that guarantee relies on.
- vis-network lays out synchronously. Above LARGE_LAYOUT_NODES the canvas
  skips vis's edgeMinimization pass (most of the time for big charts); above
  NOTICE_LAYOUT_NODES it paints a "Laying out…" notice first. Both are in
  PedigreeCanvas.tsx; recheck them with synthetic pedigrees
  (src/test/syntheticPedigree.ts) if the layout changes.
- vis-network lays out each individual without links as a separate tree;
  packUnconnected (PedigreeCanvas.tsx) moves them into their row at the
  sibling spacing. vis lays the chart out again on every "_dataChanged" and
  "_resetHierarchicalLayout" of its internal emitter, so the canvas repacks
  after each; anything else that adjusts vis's positions must do the same.
- Release tags are created only by scripts/tag-release.sh VERSION (on main,
  or for a patch of an older minor version on its maintenance branch
  maint/X.Y; clean, in sync with origin, all four version files and a
  CHANGELOG section at VERSION). Never `git tag` a release by hand: a
  hand-made v2.2.2 once landed on the commit before the version bump.
- Patch releases of an older minor version (e.g. 2.3.1 while main heads for
  2.4.0): a release/X.Y.Z branch from the vX.Y.0 tag (or maint/X.Y), PR into
  maint/X.Y, tag there, then merge maint/X.Y back into main with a merge
  commit (never squash) so the tag is in main's history. In that merge keep
  main's code, take the patch's version files and CHANGELOG section, and
  drop from [Unreleased] whatever the patch already shipped. When publishing
  a patch older than the newest release, untick "Set as latest release": the
  updater follows /releases/latest.
- Test a macOS build only after checking which branch it was built from:
  the app embeds frontend/dist as built at that moment. A build made right
  after switching branches tests that branch, not the open PR.
- FlexQTL and Binko files (pedimap.ped) are read as
  docs/reference/flexqtl-binko-pedimap/ specifies. Never take an IBDPOSITION
  section's linkage group from its comment: the k-th section belongs to the
  k-th position of the IBDPOSITIONS lines (reading the comment mixed up the
  groups of FlexQTL files through 2.2.2). Founder alleles come from the
  founders' own IBD rows (dat_meta.founder_order). backend/tests/
  test_flexqtl_binko.py compares the three fixtures with the spec's expected
  JSON through tests/reader_spec.py; keep it passing.
- To run frontend tests on the private TransApple file, generate its graph
  (gitignored) with `cd backend && python -m tests.test_frontend_fixture`.
- frontend/src/test/fixtures/apple_public.json is generated from the backend.
  After changing apple_public.dat or the API output, regenerate it with
  `cd backend && python -m tests.test_frontend_fixture` (a backend test fails
  until you do).
- The desktop write commands (write_file, write_binary_file) only accept paths
  returned by save_file_dialog in the same session. The fs plugin has no
  write permissions; keep it that way.

## On the horizon
- .pmp subpopulations and views are parsed only for the population name. The
  file carries a subpopulation tree, saved Views, notes, and per-view color
  configuration. Example.pmp defines a "Septer relatives" subpopulation with
  "Length" and "Color" views — a ready-made demo once the engine has a
  subpopulation model and the UI has a Population panel.
- Markers with genotypes but no MAP entry are exported as trailing ALLELES
  sections after the mapped loci. Pedimap 1.x reads exactly one ALLELES
  section per MAP locus, so in a file with IBD data it stops there
  ("Looking for 'IBDPOSITION …'"). Options to evaluate: a separate linkage
  group for unmapped markers, or writing them as comments.
