# Mars Rover Interactive Globe

A static, no-build educational site for the NASA Space Apps Hackathon. Visitors can orbit a 3D Mars and open the landing sites of **Mars Pathfinder & Sojourner**, **Spirit**, and **Opportunity**. Each site shows dates, distances, discoveries, imagery, a journey schematic, and NASA source links. It is built from `Mars Rover Interactive Globe - PRD v0.2.md`.

## Run locally

From the repository root (the static web root):

```bash
python3 -m http.server 8000
```

On Windows use `py -m http.server 8000`. Then open <http://localhost:8000/>. Always use an HTTP server; `file://` will not load the modules or JSON.

Runtime dependencies come from jsDelivr through the import map in `index.html` (`three@0.180.0` and `gsap@3.13.0`). Everything else is local.

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
data/rovers.json        PRD §5 seed, copied verbatim
data/assets.json        model registration + rover image manifest
tests/geography.test.mjs  dev-only unit tests incl. synthetic seam-crossing line
Mars3dmodel.glb, *.jpeg   supplied assets, left at their original paths and names
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

**Not yet verified** (needs real hardware or a person):

- Frame rate on the demo laptop and phone (targets: 60 / 30 FPS). Record device, browser, asset size and FPS here.
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
