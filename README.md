# Mars Rover Interactive Globe

A static, no-build educational site for the NASA Space Apps Hackathon. Visitors can orbit a 3D Mars and open the landing sites of **Mars Pathfinder & Sojourner**, **Spirit**, and **Opportunity**. Each site shows dates, distances, discoveries, imagery, a journey schematic, and NASA source links. Visitors can also **watch each rover's journey** in an illustrative surface close-up, step through Pathfinder's landing, compare odometers, and explore the evidence for ancient water. It is built from `Mars Rover Interactive Globe - PRD v0.2.md` plus the replay upgrade brief, which supersedes the PRD's earlier limits on rover models, close-ups and playback.

## Run locally

From the repository root (the static web root):

```bash
python3 -m http.server 8000
```

On Windows use `py -m http.server 8000`. Then open <http://localhost:8000/>. Always use an HTTP server; `file://` will not load the modules or JSON.

Runtime dependencies come from jsDelivr through the import map in `index.html` (`three@0.180.0` and `gsap@3.13.0`). Everything else is local.

**Updating a running copy:** browsers cache JavaScript from simple static servers. `index.html` therefore loads every local module and the stylesheet with a version tag (`?v=2`, applied to all local modules through the import map). When you change any file in `js/` or `css/`, bump that number everywhere it appears in `index.html`, and update the "Version" line in the footer. To check which version a browser is running, read the footer line, for example "Version 2 · rover journey replays".

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
js/replays.js           pure replay definitions (stops, cues, chips from data) + the single PlaybackClock
js/ReplayController.js  replay controls, timeline, scrubber, captions (works without WebGL)
js/RoverModels.js       MER GLB loader/validator/wheel rig + procedural Sojourner, lander, MER fallback
js/SurfaceScene.js      illustrative close-up: terrain, arc-length routes, follow camera, route reveal
js/EvidenceView.js      "Evidence for ancient water" tab view
data/rovers.json        PRD §5 seed, copied verbatim, plus an `evidence` array
data/assets.json        model registration + rover image manifest
tests/geography.test.mjs  dev-only unit tests incl. synthetic seam-crossing line
tests/replays.test.mjs    dev-only unit tests for the clock, keyframes and data-derived captions
Mars3dmodel.glb, Spirit&Opportunity3dmodel.glb, *.jpeg, 24883_MER_static.usdz   supplied assets, original paths and names
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

## Replays (upgrade)

**Watch rover journey** in the mission panel is the primary action. The camera flies down to the landing site (GSAP), fades into an illustrative close-up, and plays once the close-up is on screen. Nothing plays on mission selection. **Back to globe** (or Escape) restores the saved camera pose and keeps the mission selected.

- **One clock per replay** (`PlaybackClock`). Everything is a pure function of the playhead:
  - rover pose: arc-length route sampling, up vector from the surface normal, forward along the tangent
  - wheel angle, lander state and route reveal
  - follow camera: a weighted average of past focus positions, so it is damped but deterministic
  - active stop and caption

  Seeking between stops glides the playhead itself. The clock is ticked by the render loop, or by a fallback animation frame when 3D is unavailable.
- **Controls:** Play/Pause, Replay, Previous/Next stop, a labelled scrubber, and a keyboard-operable stop list. Selecting a stop seeks and pauses. Finishing holds the last frame with Replay available.
- **Callouts:** one at a time, clamped to the stage. It moves to the fixed caption region below the canvas when it would be occluded, would cover the rover, or the stage is narrower than 600 px.
- **Pathfinder & Sojourner (24 s):**
  - Airbag lander descends, first impact, about 15 stylized bounces with "up to 50 ft" and "about 15 bounces" shown at the matching moments, then rolls to rest ("about 1 km from first impact to rest (lander, not a drive)").
  - Airbags retract, petals open, the 20° ramp deploys, Sojourner rolls down and makes a short illustrative drive.
  - The lander trace (pale) and the rover track (cyan) are distinct.
  - Chips for count, max height, displacement and ramp angle seek to their moments; this is the landing step-through.
- **Spirit (22 s):** landing site → leaving the lander → Bonneville Crater stop → Columbia Hills. The early plan is a separate dashed toggle with its own figures. The lifetime odometer is a separate chip.
- **Opportunity (22 s):** landing outcrop inside Eagle Crater → stylized climb → Eagle Crater exit → Endurance Crater. The Eagle–Endurance separation (about 750 m) is distinct from the 45.16 km odometer, and the record is shown as historical.
- **Not to scale:**
  - Terrain, crater shapes, hill heights, spacing, speed, bounce heights and timing are presentation choices, labelled "Schematic · not to scale · Illustrative terrain".
  - No route, speed, slope or crater profile is derived from the mission numbers; caption numbers are read from `data/rovers.json`.
  - On the globe, rovers sit just south of their markers, enlarged and labelled "Rovers enlarged for visibility · not to scale", and are excluded from picking.

Other animated features:

- The odometer bars grow from a shared zero, with values always shown as text.
- A separate SVG graphic shows Pathfinder's first impact to rest, with its own label.
- An **Evidence for ancient water** tab view separates findings from site-selection reasons, with sources. Selecting a card highlights the related landing site, or seeks the replay stop when that replay is open.

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

### Upgrade QA (replays)

An automated Playwright pass in headless Chromium with SwiftShader **passed 59 of 59** checks:

- **Model:** the GLB loads at its real path and every validation check passes.
- **Replays:** all three rovers visibly move with spinning wheels. Stop seeking pauses on the right stop and caption. Scrubbing is deterministic and pauses playback. The final frame holds. Schematic labels and NASA source links stay visible. Back to globe restores the pose, keeps the selection and focuses Watch.
- **Captions:** Pathfinder's 50 ft, 15 bounces, 1 km lander and 20° ramp captions appear at the matching moments. Spirit's plan toggle is separate.
- **Interruptions:** rapid switch/watch/back/reset leaves no stuck state. A hidden tab pauses and holds the frame. Resize keeps the playhead. Closing the panel during the fly-down cancels cleanly.
- **Keyboard:** the timeline, scrubber and evidence tabs all work by keyboard.
- **Evidence and comparison:** evidence cards are distinguished and highlight their site. The bars grow from zero.
- **Rover model failures:**
  - 404, invalid glTF and implausible bounds use the procedural MER.
  - Corrupt textures keep the model and record the failure.
  - A missing wheel primitive keeps the model with whole-model motion.
  - A slow model is promoted only once paused, keeping progress.
- **Platform failures:**
  - GSAP blocked: immediate entry, with playback and scrub working.
  - Three.js blocked: the HTML timeline, captions, stops, evidence and comparison all work.
  - WebGL lost mid-replay: captions stay, and retry restores the close-up at the same stop and playhead.
  - Reduced motion: still poses, Play disabled, Next stop immediate. Changing the preference mid-replay pauses playback.
- **Layout and hosting:** mobile has a fixed caption, touch controls and no overflow. A GitHub Pages-style `/Mars_xplore/` subpath loads both models, the data and the photos with no failed requests.

The original 29-check suite passes again. In one run, its mobile step found the 3D view unavailable (likely WebGL contexts exhausted in the test browser) and the site's fallback correctly disabled globe-only buttons; two re-runs passed 29/29. `node tests/replays.test.mjs` and `node tests/geography.test.mjs` both pass.

**Not yet verified** (needs real hardware or a person):

- Frame rate on the demo laptop and phone (targets: 60 / 30 FPS), especially in the close-up. Record device, browser, asset size and FPS here. The MER GLB is 11.9 MB with 12 PNG textures (~10 MB); a compressed derivative would cut load time, but the original is used unchanged here.
- Real touch-device and screen-reader passes of the replay controls.
- Side-by-side feel against the [NASA Mars 3D viewer](https://science.nasa.gov/resource/planet-mars-3d-model/) on mouse and touch.
- Screen-reader pass and 200 % zoom inspection.
- Deployed-subpath run with a clean cache.

## Controls

- **Mouse:** drag to orbit, wheel to zoom, right-drag to pan.
- **Touch:** one finger to orbit, pinch to zoom, two-finger drag to pan.
- **Keyboard:** with the globe focused, arrow keys pan and Shift + arrows orbit. The toolbar has Reset, Zoom ±, Pause motion and the surface toggle.
- **Escape** closes the panel.
- **Development only:** `?debug` exposes the renderer as `window.__globe`; it was used for the landmark check above.

## Hosting

- **GitHub Pages:** serve the repository root from the chosen branch. `.nojekyll` is included. All paths are relative and resolve against `document.baseURI`, so a project subpath works. Smoke-test there with a clean cache.
- **Vercel:** choose "Other", skip build and install, and serve the root.
- No live mission APIs are called.
