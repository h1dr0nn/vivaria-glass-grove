# Design Bible - Vivaria - Glass Grove

> Long-term content roadmap from the research phase (2026-06-04). The vertical slice
> ships ONE archetype band (~30% land RIVERBANK) with ~6–8 species across 3 stages.
> Everything here beyond that is post-slice content, built incrementally.

## The slider is the game

`landPercent` (0–100) reshapes terrain ruggedness, waterline, which zones EXIST, the
species pool, succession pacing, and exclusive unlocks. Each species carries a
`[minLand, maxLand]` viability window + required zones (tag from day one - cheap
forward-compat). Active pool = zones present ∩ viability windows.

- **0% - OPEN AQUARIUM**: Walstad-style planted aquascape game. Goal: self-clearing
  climax tank, breeding shrimp + schooling fish. Complete on its own.
- **6–30 - RIVERBANK**: slice archetype. Most legible mixed band.
- **31–69 - PALUDARIUM**: aspirational endgame. All zones, both succession clocks,
  ALL cross-boundary exclusives (frogs, mudskippers, mini crabs, mangrove shore shrub).
- **70–94 - BOG/HILLSIDE**, **95–100 - DRYLAND**: bioactive vivarium game. Condensation
  rain is the only water source. Goal: self-sustaining moss forest floor + living wall.

Pacing: water succession pays off fast (algae bloom in hours) but balances slowly;
land starts quiet (waiting on cleanup crew) with a richer late decomposition web.
Mixed tanks run BOTH clocks → most frequent "something new happened" moments.

## Zones × succession (the full matrix - ~36 species)

| Zone | Conditions | Species (examples) | Succession arc |
|---|---|---|---|
| **Deep water** (land <85) | low light, cool, O2-poor floor | cherry shrimp, nerite/ramshorn snails, ember-tetra-like fish, Anubias/Java fern, Vallisneria, detritus worms | cyano film → green algae bloom + snails → macrophytes + shrimp colony + fish → balanced self-clearing aquascape |
| **Shallows** (littoral) | bright, warm, nutrient inflow | carpet plants, shrimp (peak), snails, fry nursery, Bacopa/Rotala stems, ostracods/copepods | algal turf → carpet seedlings + microfauna → dense carpet, stems breach surface → flowering nursery meadow |
| **Waterline/shore** (6–94 ONLY) | roots wet leaves dry, high humidity | emergent marginals, mangrove-like shrub*, wicking moss, mudskipper-like fish*, small frogs*, fiddler crabs* (*mixed-exclusive) | wet mud + first wick moss → marginal sprouts + springtails → flowers + amphibians crossing → mangrove root tangle centerpiece |
| **Lowland** (forest floor) | damp, litter-rich, dappled | springtails, dwarf isopods, creeping moss/liverworts, button ferns, fittonia-like groundcover | mold bloom → springtails crash it + moss carpet → isopods make nutrients (flow downhill!) → bioactive floor |
| **Midland** (slope, land >40) | drier, moderate light | larger ferns, selaginella, epiphytic orchids, begonias, climbing aroids | lichen crust → ferns in pockets + first epiphyte → layered understory → terraced living wall |
| **Highland/canopy** (land 70–100 dominant) | driest, brightest, condensation source | air plants, canopy aroids, mood moss cushions, tree-fern centerpiece, frog basking spot | dry crust + lichen → pioneer moss + air plant → canopy shades zones below (light feedback) → full silhouette + reliable rain |

## Cross-zone systems (ALL post-slice; cosmetic condensation OK earlier)

1. **Closed water cycle** (headline): evaporation → droplets on cool upper glass
   (visible!) → grow → "rain" onto highland → moisture + nutrients wash downhill.
   Sim as a few aggregate scalars, never per-cell physics.
2. **Humidity gradient**: f(distance-to-water, height, canopy, recent rain).
   Driftwood = "biological wick" - moss bridges water→land along it.
3. **Creature crossings** (mixed-only, the emotional core): frogs hop shore↔lowland,
   mudskippers flop shallows↔mud, crabs forage tideline, froglets metamorphose in
   shallows then emigrate. The screenshot moments. Physically impossible at 0%/100%.
4. **Nutrient flow**: land decomposition feeds water algae→plants; fish/shrimp waste
   feeds emergent roots. Balanced paludarium out-produces either pure tank.
5. **Light feedback**: canopy growth shades lower zones over time, shifting who thrives.
6. **Tank balance mood** (one gentle indicator, never a fail state).

## Cozy contract (non-negotiable)

No fail states. No permanent loss. Neglect → gentle dormancy, fully revives on return.
Goals are invitations ("encourage the moss"), never daily quests. Lifecycle = aging into
the next generation, never stark death. Prestige = **propagation** ("take a cutting /
spore sample" → new faster jar, almanac + meta carry over), never erasure.

## Retention spine

- **Three nested clocks**: microbes in minutes (active), plants in hours (daily
  check-in), creatures in days (attachment).
- **Almanac/field journal**: auto-fills on first sighting of species AND interactions
  ("first pollination", "first symbiosis"). Completion % = quiet long-term goal.
- **Individuated creatures**: named, small persistent traits, visible life events.
- **Day/night + seasons**: different inhabitants visible at different times; seasonal
  blooms; rotates which organisms thrive. Cheap return reasons.
- **Soft session ends**: reach "nothing urgent" + one impending beat (a bud about to
  open) pulling the player back tomorrow.

## Seed sharing (post-slice, zero backend)

Tank fully reproducible from (seed, landPercent, genVersion). Code format: pack into
bytes → Crockford base32 → nature-flavored chunks, e.g. `MOSS-7K3F-PALU-9QX2`, leading
token hints archetype (REEF/TIDE/MOSS), 1-char checksum. "Grow from code" previews the
cross-section before committing. Daily featured seed; personal tank journal of codes.
Old genVersion → "grown with an older world recipe" legacy render, never breaks.

## Art direction

Soft warm Ghibli-like: pastel base + few close-on-wheel accents; **tinted warm shadows**
(never neutral black); subtle bloom; DoF feel via layer blur/desaturation falloff.
Coziness lives in lighting + ambient motion + sound, not asset detail. All ambient motion
shader/tween-driven (sway, ripple, drift) - organisms are 2–4 frame loops or reskinnable
rigs. Stage growth as additive sprite layers (reuse + recolor across stages/species).
UI: diegetic, minimal chrome (wooden-shelf toolbar, soft toasts), oklch warm tokens,
designed hover/focus states - anti-template.

## Market guardrails (from research)

$5.99–7.99 one-time. Never F2P/IAP. Compete on the succession arc + ratio spectrum +
art identity - NOT on Bugtopia's collection breadth or Tiny Glade's polish. Steam page +
demo + wishlist gate before deep content investment. Lead marketing with the fantasy:
"grow a living world from an empty jar" / one killer before-after GIF.
