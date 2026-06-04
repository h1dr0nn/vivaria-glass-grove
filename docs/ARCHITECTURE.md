# Architecture — RCT Terarium

> Decisions locked 2026-06-04 after multi-agent research + red-team review.
> This file is the build contract. Deviations require a written reason here.

## Product in one line

Cozy desktop idle game: pick a **land/water ratio (0–100%)**, the game generates a glass
tank (side-view cross-section), and a **from-zero ecological succession** unfolds in real
time — sterile substrate → microbes → algae/moss → plants → small creatures.
Soft warm Ghibli-like palette. Near-zero CPU when idle. Windows-first.

## Stack (locked)

| Layer | Choice | Why |
|---|---|---|
| Shell | **Tauri v2** (Rust kept thin) | 5–15MB installer, WebView2, code-driven |
| Build | **Vite 6 + TypeScript 5** | HMR inside Tauri window |
| Render | **PixiJS v8** — WebGL pinned (`preference:'webgl'`), NOT WebGPU | WebView2 stability; ParticleContainer covers all perf needs |
| UI | **Solid.js** DOM overlay on canvas | signal-based, near-zero idle work, real CSS for cozy UI |
| Sim | **Pure TypeScript** — no Rust/WASM sim (YAGNI) | hot-reloadable, deterministic, unit-testable |
| Validation | **zod** at boundaries (save files, seed codes) | |
| Tests | **vitest** (+coverage), golden-master property tests for sim | |

Rust side does ONLY: window management, atomic save IO, single-instance guard,
(much later: steamworks crate). `main.rs`/`lib.rs` stay small and stable.

## Simulation (the most important decisions)

**Approach: stat-curve succession + decorative visual layer.**
The red-team explicitly REJECTED a live cellular-automata chemistry field — it is the
orb.farm chaos source, breaks deterministic offline catch-up, and is the biggest CPU sink.

1. **ONE pure function advances time**: `integrate(state, fromMs, toMs)`.
   The "live" tick is just `integrate()` over a small dt. Offline catch-up is the SAME
   function over a big (clamped ≤ 24h) dt. Never two code paths.
   - Property test (load-bearing): `N small steps === one batched step` for random seeds.
   - WebView2 throttles background timers (~1s, harder with intensive throttling), so
     wall-clock analytic integration is the ONLY correct source of truth. Never count ticks.
2. **Succession = authored, looks emergent**: biomass scalars per tier with
   logistic/Verhulst curves + carrying caps, gated by STATIC environment fields
   (light/moisture/nutrient as closed-form lookups computed at tankgen). Phase FSM
   (sterile → microbes → algae/biofilm → plants → fauna) keeps the arc pleasant and tunable.
3. **Determinism contract**: seeded PRNG (mulberry32/splitmix64 sub-streams), advanced
   only inside `integrate()`, keyed by simTime buckets. Same (seed, landPercent,
   genVersion) ⇒ byte-identical tank. Tunables live in ONE versioned config; the save
   stores a `tunablesHash` so balance patches don't silently mutate old tanks.
4. **Agents**: a hard-capped handful of visible creatures driven BY the stats
   (positions are cosmetic). Microbes/algae are scalars rendered as particle fields.

## Procgen pipeline (deterministic, <5ms, pure function)

```
seed + landPercent
  → STEP 0  split seed into sub-streams (terrain/water/substrate/hardscape/biome)
            archetype by landPercent bucket: 0-5 OPEN_WATER, 6-30 RIVERBANK,
            31-69 PALUDARIUM, 70-94 BOG/HILLSIDE, 95-100 DRYLAND
  → STEP 1  1D fBm heightmap (3 octaves), amplitude scales with landPercent, soft tilt bias
  → STEP 2  waterline: binary-search Y so submerged volume hits (100-landPercent)% ±2%
  → STEP 3  substrate stack per column: DRAINAGE → SOIL → SAND cap (wet) / LITTER (dry)
  → STEP 4  hardscape: Poisson-disk rocks (0-4) + driftwood (0-2, bridges waterline)
  → STEP 5  static fields: light (top-down attenuation), moisture (closed-form gradient),
            nutrients (~0 — succession generates them). Coarse grid, bilinear sample.
  → TankState { seed, landPercent, archetype, materialGrid, terrainHeight[], waterlineY,
                hardscape[], fields, zoneMap } — immutable
```

## Rendering rules (idle CPU is a feature)

- `app.ticker.autoStart = false`. Manual `app.render()` gated on a **dirty flag**.
  A still-but-visible tank must render **<5 frames/sec**. Minimized = 0.
- Page Visibility API + Tauri focus/minimize events = master switch.
  On resume: single clamped catch-up pass, then re-enable motion.
- Max **2** full-screen filters. v1 ships ONE ColorMatrixFilter (warm grade). Bloom later,
  gated on the same dirty flag. Pre-bake static glow into the atlas.
- ParticleContainer per species, ONE packed atlas per layer (single-texture-source rule).
- Layer order (back→front): room bg / back glass / water body (cheap UV-wobble shader,
  animates only when visible) / substrate / plants (sine sway) / creatures / bubbles /
  front glass (condensation, inner shadow) / glow container.
- Land vs water regions are masks from tankgen — same layer stack renders the whole
  aquarium↔terrarium spectrum.
- HMR: `import.meta.hot` dispose/rebuild hook for the Pixi app in the FIRST commit
  (GL context leak otherwise). Render layer is a pure reader of sim state.

## Persistence

- JSON, zod-validated, written by **Rust** commands (`save_game`/`load_game`) to app-data
  dir. Atomic write (temp + rename) + one rolling `.bak`. Never next to the exe.
- Save = `{ schemaVersion, tunablesHash, savedAtUnixMs, seed, rngState, simTimeMs,
  landPercent, genVersion, scalars, pools, phase, agents }` (small).
- Migration = ordered pure `migrate_vN_to_vN+1` chain, then zod. On failure: try `.bak`;
  on double failure: non-destructive error, offer new tank WITHOUT overwriting the file.
- Autosave: 60–120s interval + on stage advance + on visibilitychange→hidden + on exit.

## Explicitly OUT of v1 (deferred, do not build)

- ❌ Live CA / diffusion chemistry field (post-launch experiment flag at most)
- ❌ Steam anything (overlay over WebView2 is architecturally IMPOSSIBLE — verified;
  achievements/cloud via Rust steamworks crate post-itch.io)
- ❌ Transparent always-on-bottom companion mode (opt-in, passive-only, post-launch)
- ❌ Interactive-while-transparent cursor polling (never build)
- ❌ `backdrop-filter` anywhere (broken under WebView2 transparency)
- ❌ Rust/WASM sim port (Web Worker is the escape hatch if main thread ever janks)

## Vertical slice acceptance (gate before content expansion)

1. New tank at ~30% land (RIVERBANK) → watch microbes → algae → first plants over
   ~10 compressed minutes.
2. Close app mid-stage → reopen after a real gap → tank advanced correctly
   (no jump/rewind; matches re-simulated reference).
3. Still visible tank renders <5 fps; minimized 30 min ≈ 0% CPU.
4. Same seed + slider ⇒ identical tank, every time.

## Roadmap after slice (task list mirrors this)

Content expansion per docs/DESIGN-BIBLE.md (6 zones, ~36 species, cross-zone systems,
closed water cycle) → UI/almanac → audio → packaging (NSIS → itch.io via Butler) →
multi-agent QA → production check.
