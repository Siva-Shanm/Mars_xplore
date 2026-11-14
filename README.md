# Mars Rover Interactive Globe

A static, no-build educational site for the NASA Space Apps Hackathon. Visitors can orbit a 3D Mars and open the landing sites of **Mars Pathfinder & Sojourner**, **Spirit**, and **Opportunity**. Each site shows dates, distances, discoveries, imagery, a journey schematic, and NASA source links. Version 3 adds **Neo’s guided expedition**: one press of **Explore with Neo** starts a narrated, cue-driven tour across all three missions with a fully 3D, procedurally built guide robot. It is built from `Mars Rover Interactive Globe - PRD v0.2.md`, `Neo Narration Script.md` and the Neo upgrade brief, which supersede the PRD's earlier limits on rover models, close-ups and playback.

## Run locally

From the repository root (the static web root):

```bash
python3 -m http.server 8000
```

On Windows use `py -m http.server 8000`. Then open <http://localhost:8000/>. Always use an HTTP server; `file://` will not load the modules or JSON.

Runtime dependencies come from jsDelivr through the import map in `index.html` (`three@0.180.0` and `gsap@3.13.0`). Everything else is local.

**Updating a running copy:** browsers cache JavaScript from simple static servers. `index.html` therefore loads every local module and the stylesheet with a version tag (`?v=4`, applied to all local modules through the import map). When you change any file in `js/` or `css/`, bump that number everywhere it appears in `index.html`, and update the "Version" line in the footer. To check which version a browser is running, read the footer line, for example "Version 4 · Neo speaks and waits for you".

## Structure

```text
.nojekyll               branch-based GitHub Pages
index.html              shell, import map, semantic controls, <noscript> NASA links
css/styles.css          layout, POI radar, Ken Burns, panel, reduced motion
js/main.js              bootstrap, data load, selection state, fallbacks (local static imports only)
js/validate.js          schema / URL / reference checks for rovers.json and assets.json   (added)
js/geography.js         pure lat/lon → unit vector, wrapping, great-circle densify
js/MissionPanel.js      safe DOM rendering (textContent), credits, journey steps, odometer bars
js/GlobeRenderer.js     renderer, OrbitControls, model lifecycle, marker projection, picking
js/CameraFlight.js      single cancellable GSAP slerp flight
js/TraverseRenderer.js  schematic journeys + validated sourcePolyline renderer
js/replays.js           the single PlaybackClock and timing helpers (pure)
js/tour.js              tour.json → chapter timelines, approval gates, data-resolved labels (pure)
js/TourController.js    one authoritative playhead: auto-advance, controls, captions, cards, speech hold, HTML fallback
js/Narrator.js          opt-in browser speech synthesis (never required, never waited on)
js/NeoCharacter.js      Neo: procedural 3D model, rig, CanvasTexture expressions, deterministic actions
js/NeoView.js           Neo in a reserved corner of the same renderer (scissored viewport)
js/TourStage.js         illustrative local stages for the three chapters, science visuals, endings
js/RoverModels.js       MER GLB loader/validator/wheel rig + procedural Sojourner, lander, MER fallback
js/EvidenceView.js      "Evidence for ancient water" tab view
data/rovers.json        PRD §5 seed, plus `evidence` cards and sourced `ending` facts
data/tour.json          cue presentation metadata: verbatim script lines, timing, shots, Neo actions, gates
data/assets.json        model registration + rover image manifest
tests/geography.test.mjs  dev-only unit tests incl. synthetic seam-crossing line
tests/replays.test.mjs    dev-only unit tests for the clock and keyframes
tests/tour.test.mjs       dev-only: script lines verbatim, gates, timelines, data-resolved labels
Mars3dmodel.glb, Spirit&Opportunity3dmodel.glb, *.jpeg, 24883_MER_static.usdz   supplied assets, original paths and names
Neospritesheet1.jpeg, Neospritesheet2.jpeg   Neo design references (not loaded at runtime, except a cropped still in the no-WebGL text guide)
```

## Asset inventory and manifest

A recursive scan (excluding `.git`) found one model and five JPEGs. I inspected each file visually.

| File (exact case) | What it shows | Use |
| --- | --- | --- |
| `Mars3dmodel.glb` | glTF 2.0 Blender export, 3.9 MB. One mesh with an embedded 2048×1536 PNG diffuse map and normal map. No compression extensions. | Globe model |
| `sojourner1.jpeg` (466×429) | A real surface photo of the Sojourner rover on rocky ground | **Hero**, Pathfinder & Sojourner |
| `pathfinder2.jpeg` (640×479) | Overhead view of the Pathfinder lander with petals open on deflated airbags | **Secondary**, Pathfinder & Sojourner |
| `pathfinder1.jpeg` (597×335) | **Artist's rendering** of the Pathfinder lander | Not used. The secondary image is the overhead view, which ties to the airbag landing. |
| `Spirit1.jpeg` (185×148) | **Artist's rendering** of a Mars Exploration Rover | Spirit hero, captioned as an artist's concept |
| `opportunity1.jpeg` (638×480) | **Artist's rendering** of a Mars Exploration Rover | Opportunity hero, captioned as an artist's concept |

**Flags for review**

- **Spirit / Opportunity identity.** Both images show the identical MER twin design. Their mission identity comes from the filename only and cannot be verified from the pixels. The captions say so.
- **`Spirit1.jpeg` is very small** (185×148, 5 KB) and looks soft in the 4:3 hero frame. A larger image is recommended.
- **Credits.** No file came with a credit or usage terms. Every caption reads "Credit not supplied with file; presumed NASA/JPL. Confirm before release." The model's origin and license are also unconfirmed.
- **Case sensitivity.** `Spirit1.jpeg` has a capital S. `spirit1.jpeg` returns 404 on a case-sensitive host, so keep the manifest path exact.
- The model stays at the repository root as `Mars3dmodel.glb`, as requested, instead of the PRD's default `assets/mars/mars.glb`.

The image records in `assets.json` add optional `caption` and `objectPosition` fields alongside the PRD's `{src, alt, credit}`.

## Rover models

| Asset | Used for | Result |
| --- | --- | --- |
| `Spirit&Opportunity3dmodel.glb` (11.9 MB) | Spirit and Opportunity (the rovers were identical twins) | Loaded with GLTFLoader and validated (results below). The `&` is percent-encoded in requests and works on `python -m http.server` and GitHub Pages. |
| `24883_MER_static.usdz` | Not used at runtime | Binary USDC inside a USDZ, which the Three.js r180 USD loader cannot parse. Its mesh and texture names match the GLB, so the GLB appears to be a conversion of it. |
| Sojourner | Procedural | Low chassis, flat solar deck, six cleated wheels, antenna. Labelled "simplified illustration". |
| Pathfinder lander | Procedural | Core, three petals, rear ramp at the sourced 20°, airbag clusters that inflate and retract. Labelled "simplified illustration". |
| MER fallback | Procedural | Used while the GLB loads, or if it fails. Taller body, wide solar wings, camera mast, six wheels. Labelled "Simplified rover model". |

Results from the MER loader's validation report, which `?debug` exposes as `window.__roverReport`:

- **Wrapper (from `assets.json`):** +Y up, +Z forward, metres (`unitsPerMeter: 1`), yaw 0°.
- **Forward axis:** three independent cues put the front at +Z, and the loader checks the first at runtime:
  - the camera mast (`tex_mast`) is centred at z = +0.46 m
  - the stowed arm (`tex_arm`) is at +Z
  - the middle wheels sit closer to the rear wheels, which is the rocker-bogie layout
- **Bounds:** 2.28 W × 1.58 H × 1.65 L m, inside the plausible range.
- **Contact:** the lowest wheel point is moved to y = 0.
- **Textures:** 7 of 7 base-colour textures loaded; the supplied materials are kept.
- **Wheel rig:** the GLB has a single node and no wheel nodes or animations; the wheels are baked into the `tex_suspension_n` primitive. At load the loader finds six wheel-shaped connected parts (radius 0.131 m, axle along X, three per side, radii within 10%). It moves them, with their hubs, onto six axle pivots that share the original vertex buffers, and spins them by distance ÷ radius. If the rig is not found, the whole model translates and orients instead; wheels never fake a spin by rotating the rover.
- **Fallbacks:**
  - Missing, corrupt or implausible model: the procedural MER is used.
  - Missing textures: the model is kept untextured and the failure is recorded.
- **Promotion:** the validated model replaces the fallback only at a stable point (paused, ended, or before playback starts). Replay progress, focus and selection are kept.

## Neo’s guided expedition (version 3)

**Explore with Neo** is the primary entry action: 52 px tall with a primary fill, and the description directly below it is linked with `aria-describedby`. **Explore the globe** remains the secondary action. Each mission's panel offers **Watch with Neo** for that chapter alone, and the navigator still opens any mission manually.

**Flow.** One press plays the intro on the globe (Neo greets, then the camera flies to Ares Vallis) and then the whole Pathfinder & Sojourner chapter. (Version 4 adds required taps at five checkpoints; see below.) Each chapter ends on its record, offering **Next rover** and **Explore the globe**. Opportunity's record offers **Finish the expedition**, which plays the closing line on the globe and highlights all three sites.

**Neo.** Neo is built entirely in Three.js from lathe, sphere and torus meshes. There are no image files, rigs or clips at runtime.
- **References:** proportions come from `Neospritesheet2.jpeg` (front, side, back) and expressions and gestures from `Neospritesheet1.jpeg`.
- **Local frame:** +Y up, +Z forward, and a 1.0 unit body excluding the antenna. The helmet takes about two fifths of the body, above a narrow neck seam, a tapered capsule torso with a pale lower shell and trim band, deeper-blue chest plates, and a ringed cyan chest light.
- **Other parts:** a rear inset panel with seams, a thin antenna with a round tip, detached paddle arms (blue shell, pale inner face), an inverted-hull outline for the illustrated look, and a floating gap above a cyan glow ellipse.
- **Rig:** root → glow + float (hover) → yaw → lean → torso, head pivot, and arm pivots at the shoulder edges.
- **Pose:** composed once per frame from a single pose object, so animations never fight over a property.
- **Face:** expressions are drawn on one CanvasTexture on the curved visor and redrawn only when the expression, mouth shape or blink changes. They are smile, neutral, speaking (three mouth shapes), surprised, thoughtful, quiet, wink, star eyes, concerned, and a static red error face. The error face is used only when a stage genuinely fails to build.
- **Actions:** greet, present/point (head first, then the nearest arm, clamped outside the body), inspect (lean and a nod at the explanation), upward gaze, reflect (lowered arms, quiet face) and farewell. Each is a pure function of cue time, so seeking reconstructs the pose. Decorative hover and blink stop on pause, inspection, reduced motion and hidden tabs.
- **Placement:** Neo renders through the same renderer in a reserved corner (a scissored viewport, restored afterwards), on the side the cue names, so he never covers the rover or clue. He is never in any picked scene.

**One playhead.** `TourController` owns a single `PlaybackClock` per chapter.
- **Derived from it:** camera, Neo, rover pose and wheels, lander state, route reveal, science effects, lighting, captions, labels, cards and the active stop. The render loop ticks it, or a fallback animation-frame loop does when 3D is unavailable.
- **Speech:** narration is optional browser speech and off until **Listen to Neo** is pressed. A line starts only when forward playback crosses it, so seeking never replays it. Pause, seek, inspection, chapter switch, Back and hidden tabs cancel speech. Resuming restarts only the active line.
- **Speech hold:** speech can hold a cue at the end of its line for a bounded time (60% of the line plus 4 s). It is never waited on indefinitely.
- **Silent mode:** without speech, timed captions drive the mouth cycle and the tour.
- **Controls:** Pause/Resume, Previous/Next stop, Replay chapter, Back to globe, a labelled scrubber, a chapter and stop indicator, Listen/Mute, Replay line, and a keyboard-operable stop list. Seeking pauses at the target.
- **Inspection:** one inspection button at a time (Inspect pebble, Inspect rock, Inspect outcrop, Look back) holds the playhead and lets the visitor drag the view. Close returns to the same beat and the prior play/pause intent.

**Chapters (estimated playhead durations, without speech holds).**
- **Pathfinder & Sojourner, 2:17 (2:32 with the intro).**
  - Ares Vallis establishing shot.
  - Airbag landing: about 15 bounces and up to 50 ft as lander figures; about 1 km from first impact to rest, labelled "lander, not a drive".
  - Airbags retract, petals open, and the 20° ramp deploys automatically. Sojourner rolls down, with its 1 ft / 23 lb card.
  - Drive to an illustrated pebble field: an outlined pebble and **Inspect pebble**, then the rounded-edge inference.
  - A separate magnified-dust illustration, with particles drawn to a magnet.
  - Dawn tilt with water-ice clouds.
  - The lander's signal pulses, with records for Sept 27, 1997 and 2.3 billion bits (attributed to the Pathfinder mission). Sojourner is not placed, because its final position is uncertain.
- **Spirit, 2:04.**
  - Gusev basin with a dashed shoreline and "Possible ancient lake — hypothesis".
  - Drive from the lander past Bonneville toward Columbia Hills, with the lifetime odometer card shown separately and the early plan as its own dashed toggle.
  - A Columbia Hills specimen with alteration veins and **Inspect rock**.
  - A time cut to *Later in the mission*: wheels settle into soft soil as winter light fades. Last contact (March 22, 2010) and formal closure (May 25, 2011) are separate cards.
- **Opportunity, 2:02.**
  - Orbital mineral clue over Meridiani, then descent into Eagle Crater.
  - The landing outcrop as an approved fallback beat (no spheres; shared MER conclusion card) with **Inspect outcrop**.
  - Climb out with **Look back**, then onward toward Endurance, with "about 750 m apart (separation, not distance driven)".
  - Odometer comparison: 7.73 km vs 45.16 km on one linear baseline, numbers always visible, and the historical record card.
  - A time cut to Perseverance Valley, where an illustrated dust storm dims the sun: final transmission June 10, 2018.
- **Closing, 0:22:** back to the globe, all three sites highlighted, and Neo waves.

**Source gates.** All four optional cues are pending, so their fallbacks play. The visitor can see the list under "Beats awaiting source approval", and the console logs it.

| Cue | Status | Fallback used |
| --- | --- | --- |
| `pf-record` (Chimp) | pending: panorama and annotation not approved, and no panorama asset | Cue skipped; the lander and final-transmission record are held; no precise rover placement |
| `sp-troy` | pending: JPL Troy and closure pages are outside the PRD allowlist | Cue skipped; `sp-final` keeps "Soft soil stopped Spirit’s drive." |
| `op-outcrop` (spherules) | pending | Spoken line and spheres skipped; outcrop beat with the shared MER conclusion card |
| `op-image` (last image) | pending, and no image asset | Cue skipped; the illustrated valley and date are held |

To enable a gate, set it to `true` under `approvals` in `data/tour.json`; `op-image` also needs its asset. Durations and stop indices are recomputed after filtering.

**Script wording to confirm.** `op-meridiani` says "observations **from orbit**". The allowlisted MER page supports that mineral deposits suggested a wet history, but I did not find the orbital wording on the allowlisted pages.

**Data.** Spoken lines live verbatim in `data/tour.json`, which a unit test checks against the script. Every number on screen is resolved from `data/rovers.json` by key. New sourced records were added from the allowlisted Spirit and Opportunity pages:
- Spirit: Columbia Hills rocks altered by water.
- Ending facts: Spirit stuck in soft soil, and its panels could not be tilted toward the winter Sun; Opportunity in Perseverance Valley during the Mars-wide dust storm.

## Version 4: Neo speaks, and waits for you

This release supersedes the earlier rule that visitors must never be required to click inside a chapter.

**Neo's words in a speech bubble.** While a line is active, it appears in a comic-style bubble attached to Neo's corner inside the view.
- **Look:** dark text on white with a tail pointing at Neo, a maximum width, and placement that tries narrower widths rather than cover the rover or the highlighted object.
- **Reveal:** the text appears progressively in step with the line, and never trails the voice (it uses speech boundary events when available). Reduced motion shows the full line at once.
- **Timing:** the bubble appears when the line starts, stays through the reading hold, and fades between lines.
- **Docking:** if the stage is narrower than 600 px, if every placement would cover the subject, or if there is no 3D view, it docks as a "Neo" caption strip directly under the canvas.
- **Accessibility:** the bubble is `aria-hidden`, so screen readers hear the line once, from `#tour-line`.
- **Mouth:** Neo's mouth moves only while words are visibly being delivered (audio playing, or the bubble revealing the line). It never moves while paused, inspecting, or waiting at a checkpoint.

**Voice on by default.**
- **Unlocking:** the Explore with Neo or Watch with Neo click unlocks speech inside the gesture (a silent `speak()`), so browsers allow later lines.
- **Sound toggle:** "🔊 Sound on / 🔇 Sound off" sits beside Neo in the view and is mirrored in the control strip. The choice is remembered in `localStorage` under `marsxplore.neoSound`.
- **Voices:** one English voice is chosen once and kept, handling late `voiceschanged` and Chrome's empty first `getVoices()`.
- **Failures:** if speech is unsupported, errors, or never starts within 2.5 s, a one-time note says "Narration audio isn't available in this browser. Neo's words appear in the speech bubble." Timed captions continue. Speech still only holds a cue for a bounded time.

**Required interaction checkpoints.** Five cues now stop the playhead, not as a Pause, after Neo's line, and wait for the visitor indefinitely:

| Cue | Prompt | What the tap does |
| --- | --- | --- |
| `pf-pebble-look` | Tap the pebble! | Close-up inspection, then Continue into the rounded-edge reveal |
| `pf-dust` | Tap the magnet to switch it on! | The magnet switches on and the dust gathers at its poles |
| `sp-rock` | Tap the rock! | Close-up of the altered specimen |
| `op-outcrop` | Tap the outcrop! | Close-up; the shared MER conclusion card appears only afterwards |
| `op-eagle` | Look back at Eagle Crater! | Look-back view from the rim; the drive to Endurance starts only afterwards |

- **While waiting:**
  - Neo points at the object with his mouth closed, and his bubble shows the prompt.
  - The object pulses: an outline glow, emissive pulse, or, for Eagle Crater, a rim ring.
  - A 76 px hotspot with a pulsing ring, a tapping hand and a label follows the object across the view. When the object is off screen or occluded, the hotspot docks as a large labelled button in the view.
  - The canvas shows a pointer cursor over the object.
- **Three ways to act, all running the same action:**
  - tapping the 3D object (raycast against that object's pick proxy only, so globe picking is unchanged)
  - tapping the hotspot
  - Enter or Space on the hotspot, which receives focus when the checkpoint opens; the prompt is announced once
- **After the tap:** inspections show **Continue the tour ▶** inside the view, and dragging to look around is optional. Escape also continues.
- **Skipping:** Previous/Next stop and the scrubber still work. Seeking past a checkpoint counts as skipping it, and seeking back before it asks again.
- **Reduced motion:** a static highlight and still compositions that never reveal a result before the tap.
- **Without WebGL:** the same checkpoint becomes a required "Inspect the pebble" button, with the bubble docked.
- **Gated cues:** the pending `op-outcrop` checkpoint uses its fallback visual.

**Everything to act on is inside the view (the "video player").**
- **Transport bar:** ⏮ Previous stop, ⏸ Pause / ▶ Resume, ⏭ Next stop and ✕ Globe, placed on the side away from Neo.
- **Contextual actions:** the hotspot, any optional Inspect button, Continue the tour, and the sound toggle.
- **Chapter record:** Next rover / Finish the expedition, Explore the globe, and Replay chapter, as a centred card.
- **The strip below:** keeps the full caption, scrubber, stop list (checkpoint stops are marked "👆 your turn"), sources, Replay line and the same transport.

## Model registration (verified)

| Field | Value | Evidence |
| --- | --- | --- |
| `upAxis` / `northAxis` | `+Y` | The north polar cap is at +Y and the south cap at −Y. The bounds are 1000 × 994 × 1000; the shorter Y axis is consistent with Mars' polar flattening. |
| `primeMeridianYawDeg` | `90` | The texture is a cube-map cross. The vertex UVs put areographic 90°E on the model's +Z face, so rotating the model +90° about Y puts 0° at +Z, the canonical frame. |
| `longitudeSense` | `east-positive` | East increases toward +X, matching the runtime frame. |
| `registrationStatus` | `verified` | Seven landmarks, rendered at their published coordinates, appeared centred in their target rings (below). |

Landmarks checked with rings drawn at canonical coordinates (headless Chromium, `?debug`):

- Olympus Mons, 18.65°N 133.8°W
- Hellas basin, 42.4°S 70.5°E
- Syrtis Major, 8.4°N 69.5°E
- Arsia Mons, 8.3°S 120.1°W
- Elysium Mons, 24.8°N 146.9°E
- North polar cap
- South polar cap

All appeared centred in their rings. Valles Marineris (13.9°S 59.2°W) was not conclusive at that zoom. Please re-confirm by eye on the demo machine before sign-off.

After load, the model is centred and uniformly scaled so its largest half-extent is R = 1. Marker anchors use the local surface radius, found by casting a ray toward the origin through the model mesh, plus a 0.004 lift. The **Show reference sphere** toggle switches to an untextured, graticuled unit sphere in the same frame. If `registrationStatus` is set back to `unverified`, the textured view hides markers and routes and offers the reference sphere instead.

## Source and science decisions

- Sources come only from the PRD §2 allowlist. `validate.js` accepts only HTTPS links to `science.nasa.gov` and `nssdc.gsfc.nasa.gov`.
- Pathfinder's ~1 km is shown only as **lander displacement**. No Sojourner odometer is stated.
- Spirit shows both last contact (2010-03-22) and formal closure (2011-05-25). The early plan is a separate dashed toggle and is never merged with the completed sequence.
- Opportunity's record is described as a *former* record. The 750 m Eagle–Endurance separation is shown apart from the 45.16 km odometer.
- The odometer bars use the JSON kilometre values on one linear scale. Nothing is summed or derived.
- Coordinates are shown rounded to 0.1°. The source datum and map-registration differences between NASA products are **not reconciled**. Markers are globe-scale site markers only.
- All journeys are **schematics**: normalized display steps around the real landing anchor, labelled "Schematic · not to scale". They encode no bearings or positions. Geographic rendering turns on only for a `sourcePolyline` path with ≥2 valid samples and a `coordinateFrame`. Anything else is demoted to schematic and noted in the panel.

## QA: results in this environment

I ran an automated Playwright pass in headless Chromium with SwiftShader WebGL, served over `python3 -m http.server`. **29 of 29 checks passed**:

- **Normal run:** the model replaced the fallback sphere; all three missions open from the navigator; HTML marker click and canvas pick resolve to the same mission; a canvas drag does not select.
- **Geometry and picking:** a far-side marker is hidden and cannot be picked; the cardinal mappings and the Opportunity wrap to −5.52583° are correct.
- **Motion:** idle rotation starts after 4 s and pauses while a mission is being inspected. A rapid select → select → select → Escape → Reset sequence leaves controls enabled and no stale panel. Reset returns to the home distance.
- **Zoom and pan limits:** at max zoom the camera stays at a distance of 1.25, outside the globe.
- **Keyboard:** keyboard selection focuses the panel heading; Escape returns focus to the invoking button; the closed panel is removed from the tab order.
- **Reduced motion:** the camera moves straight to its final pose, with no idle rotation and no radar pulse.
- **Fallbacks:** each produced its §9 state:
  - model 404 or invalid glTF
  - missing photo
  - Three.js CDN blocked
  - GSAP blocked
  - WebGL unavailable
  - `rovers.json` returning 500, then retry
  - WebGL context lost, then retry, which restores the selection
- **Layout:** no horizontal overflow on an iPhone 13 viewport or at 320 px.
- **HTTP:** `Mars3dmodel.glb`, `sojourner1.jpeg`, `pathfinder2.jpeg`, `Spirit1.jpeg` and `opportunity1.jpeg` returned 200 with the correct MIME types, and loaded in the panel with `naturalWidth > 0`. There were no failed requests and no console errors.

`node tests/geography.test.mjs` passes, including a 179°E → 179°W seam-crossing line and antipode rejection.

### Version 3 QA (Neo’s expedition)

Exercised with Playwright in headless Chromium (SwiftShader software WebGL), served by `python3 -m http.server` and under a GitHub Pages-style `/Mars_xplore/` subpath. A fake speech engine was installed so speech behaviour could be checked without audio. **Results: 52 of 52 Neo checks passed (run in batches; the only failures seen were test-harness bugs, fixed in the tests, not the site), and the original 29-check globe suite still passes.**

- **Baseline:** the globe still orbits, mission selection works, the model and photos load, and there were no failed requests.
- **Entry:** Explore with Neo is 52 px tall (the secondary button is 44 px) and its description is linked with `aria-describedby`.
- **Full chapter:** one press played the intro and the whole Pathfinder chapter to its record (Next rover / Explore the globe) with no clicks. Next rover starts Spirit. Opportunity's record offers Finish the expedition, and the outro returns to the globe with all three sites highlighted. There were no page errors.
- **Neo:**
  - Rendered in full 3D in a reserved corner and never in a picked scene.
  - Pose checks at their cues: greet (arm raised, smile), ramp point, pebble inspect (lean, thoughtful), upward gaze at the clouds, reflect (quiet face, lowered arms), farewell wave.
  - Front, three-quarter, side and rear renders, plus all expressions, were compared against both sheets.
- **Inspection:** Inspect pebble holds the playhead; dragging orbits the view; closing returns to the same beat and resumes.
- **Speech (fake engine):**
  - Each line is spoken once when its cue begins.
  - Seek, pause, chapter switch and Back each cancel speech, with nothing left lingering.
  - A hidden tab pauses the tour until the visitor resumes.
  - A slow voice holds the cue at the line end, then releases (bounded).
  - A throwing voice and a voice that never starts both fall back to timed captions, and the tour keeps moving.
- **Reduced motion:** still cue compositions, no hover, and auto-advance continues.
- **Keyboard:** Enter starts the tour; a stop seek pauses at the target; Space resumes; Escape exits.
- **Switching:** rapid chapter switching leaves one playhead and one stage. The navigator exits to manual mode, and the panel's Watch with Neo opens that mission's chapter.
- **Gates and endings:**
  - All four gates use their fallbacks; the `op-outcrop` fallback shows the shared conclusion card.
  - Ending cards: Sept 27, 1997, 2.3 billion bits and the uncertainty note; March 22, 2010 and May 25, 2011 as separate cards; June 10, 2018; the 7.73 vs 45.16 km comparison.
- **Failures:**
  - Missing MER model: the procedural twin is used.
  - WebGL lost mid-tour: the HTML tour continues; retry restores the chapter and cue, paused.
  - Three.js blocked: an HTML tour with the same stops, captions and cards, a local photo, and Neo's cropped still.
  - GSAP blocked: the tour plays.
  - Missing photo: an explicit "Image unavailable" state.
- **Layout:** iPhone 13 has no horizontal overflow, a 109 px Neo corner, a visible description and working touch controls. Rotating to landscape keeps the stop.
- **Evidence:** the pebble card seeks its tour cue.
- **Unit tests:** `node tests/tour.test.mjs` passes. It checks that every spoken line is verbatim from the script under the matching cue ID, the gate filtering, contiguous 2–3 minute timelines, and the data-resolved labels. The geography and clock tests also pass.

**Observed timings.**
- **Playhead (silent):** Pathfinder 2:17 (2:32 with the intro), Spirit 2:04, Opportunity 2:02, closing 0:22. With narration on, a cue can extend by up to 60% of its line plus 4 s if the voice runs long.
- **Wall clock:** in this headless software-rendering environment the 152 s Pathfinder run took 302 s. The frame rate is low and the clock advances at most 0.1 s per frame, so this is an environment limit, not the intended pace. Timing on real hardware is still to be measured.

### Version 4 QA (speech bubble, voice, checkpoints, in-view controls)

Exercised with Playwright in headless Chromium (SwiftShader), over HTTP and under the `/Mars_xplore/` subpath, with a fake speech engine standing in for real voices. **37 of 37 version 4 checks passed.** The 29-check globe suite and the still-applicable version 3 groups (35 checks) pass again.

- **Bubble and voice:**
  - The click on Explore with Neo unlocks speech inside the gesture, and sound is on by default.
  - The bubble beside Neo reveals the line progressively. It is `aria-hidden`, and `#tour-line` keeps the full caption.
  - The voice speaks each line once. The mouth moves only while a line is being delivered, and stops when paused or between lines.
  - Mute is mirrored in the strip and remembered after reload.
  - A throwing voice and missing speech support both show the one-time note while the bubble continues.
- **Checkpoints:**
  - The playhead stops (not a Pause) and waits; the timestamp is unchanged after 3.5 s.
  - The hotspot is 76 px, labelled, focused and pulsing. Neo points with his mouth closed and the bubble says "Tap the pebble!". The pebble glows.
  - The reveal does not play while waiting.
  - A pointer cursor appears over the 3D pebble, and tapping it opens the close-up. Continue resumes into the reveal, which then plays.
  - Enter on the focused hotspot switches the magnet on, and 149 particles gather at the poles.
  - Next stop while waiting skips the checkpoint; seeking back asks again. A hotspot click opens the rock close-up, and Escape continues.
- **Full chapter:** one press plus one tap at each of the two checkpoints played the whole Pathfinder chapter (154 s of playhead, 242 s wall clock in software rendering) to the in-view record. Both checkpoints waited until tapped, and there were no page errors.
- **In view:**
  - The transport bar, record, hotspot, Inspect/Continue, sound toggle and bubble are all inside the stage.
  - Next rover from the in-view record starts Spirit, and ✕ Globe returns to the globe.
  - A real bug was found and fixed: the in-view bar covered the "Retry 3D view" button after a WebGL loss. The message now sits mid-view.
- **Reduced motion:** the checkpoint still waits, the hotspot is static, and the full bubble text appears at once.
- **No WebGL:** a required "Inspect the pebble" button and a docked bubble, and pressing the button continues.
- **Phone (iPhone 13):** the bubble docks under the canvas and the transport bar becomes icon-only on the side away from Neo, with Sound above Neo. Touch taps on the hotspot and Continue work, and there is no overflow.
- **Regression:** rapid chapter switching leaves one playhead and one stage. A hidden tab pauses and cancels speech. The subpath loads the v4 modules.

**Still to check on real devices:** real voices in Chrome, Edge, Safari/iOS and Firefox (only a fake engine was used here), the audio unlock on iOS Safari specifically, and the hotspot's tap feel on a physical phone.

**Not yet verified** (needs real hardware or a person):

- Frame rate on the demo laptop and phone (targets: 60 / 30 FPS), especially in the close-up. Record device, browser, asset size and FPS here. The MER GLB is 11.9 MB with 12 PNG textures (~10 MB); a compressed derivative would cut load time, but the original is used unchanged here.
- Real touch-device and screen-reader passes of the tour controls, plus real browser speech voices (only a fake engine was used here).
- Neo's look on real GPUs and phones: the visual comparison with the sheets was done on software-rendered screenshots.
- Content approval of the four source gates, and of the "from orbit" wording in `op-meridiani`.
- Side-by-side feel against the [NASA Mars 3D viewer](https://science.nasa.gov/resource/planet-mars-3d-model/) on mouse and touch.
- Screen-reader pass and 200 % zoom inspection.
- Deployed-subpath run with a clean cache.

## Controls

- **Mouse:** drag to orbit, wheel to zoom, right-drag to pan.
- **Touch:** one finger to orbit, pinch to zoom, two-finger drag to pan.
- **Keyboard:** with the globe focused, arrow keys pan and Shift + arrows orbit. The toolbar has Reset, Zoom ±, Pause motion and the surface toggle.
- **Escape** continues from an inspection, then leaves Neo's tour, then closes the panel.
- **Development only:** `?debug` exposes `window.__globe`, `window.__guide` and `window.__roverReport` for automated checks.

## Hosting

- **GitHub Pages:** serve the repository root from the chosen branch. `.nojekyll` is included. All paths are relative and resolve against `document.baseURI`, so a project subpath works. Smoke-test there with a clean cache.
- **Vercel:** choose "Other", skip build and install, and serve the root.
- No live mission APIs are called.
