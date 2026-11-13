# Mars Rover Interactive Globe

**Product requirements document for Claude Code · v0.2 · 13 November 2026**  
**Status** Working draft for user review before implementation  
**Deliverable** A static, educational 3D website for a NASA Space Apps Hackathon prototype

## 1. Implementation brief

Build a single-page experience in which visitors orbit Mars, select the landing sites of Mars Pathfinder & Sojourner, Spirit, and Opportunity, and inspect each mission’s journey, discoveries, and NASA references. The primary experience is a manipulable Three.js globe. Use semantic HTML, CSS, and vanilla JavaScript for the UI. Use GSAP for camera interpolation and CSS for panel, image, and marker animations.

**MVP scope**

- Render the supplied local Mars glTF asset, with an interactive colored sphere available from the first rendered frame.
- Provide three surface POIs and a persistent three-mission navigator. Every mission can be opened without having to rotate the globe first.
- Provide mission-specific fly-to, a responsive details panel, historical milestones, discoveries, local imagery, and a journey visualization with explicit provenance and scale.
- Show route geometry only at its supported level of certainty. A measured distance, a planned segment, and a sequence of named destinations are three different types of evidence.
- Ship a no-build static site. Exclude platforming, avatars, character movement, objectives, scoring, levels, and other game mechanics. Exclude accounts, APIs, databases, and live telemetry.

**Demo outcome** A judge can orbit, pan, and zoom the globe, select each mission, identify one discovery and one journey milestone, and tell whether the route shown is schematic or sourced. The same content remains usable if the local model or WebGL fails.

**Agent operating instructions** Inspect the repository and asset inventory first. Reuse compatible existing files. Implement in the order in §10, serve over HTTP, and run the acceptance checks. Report what was implemented, actual smoke-test results, and unresolved asset, provenance, or viewer checks. Treat file names and display copy in this draft as defaults where expressly marked. Public deployment and final source approval belong to the user review.

## 2. Source control and scientific decisions

The brief names NASA as the sole authority for mission data but supplies one explicit URL, the viewer reference. The following NASA pages are the **proposed source allowlist** for this draft. Confirm the allowlist at handoff. Use only the approved subset for the submitted site and keep the viewer reference separate from mission evidence.

| ID | Evidence | NASA reference |
| --- | --- | --- |
| `pathfinder` | Dates, landing mechanics, data return, rover dimensions, deployment, science | [Mars Pathfinder](https://science.nasa.gov/mission/mars-pathfinder/) |
| `pathfinderCoords` | Published Pathfinder landing-position estimate and its reference context | [Mars Pathfinder Landing Ellipses](https://science.nasa.gov/photojournal/mars-pathfinder-landing-ellipses/) |
| `spirit` | Landing coordinates and PST date, final contact, formal closure, odometer, Bonneville visit | [Spirit](https://science.nasa.gov/mission/mer-spirit/) |
| `mer` | Geological setting, early Spirit plan, MER science synthesis, Opportunity sequence | [Mars Exploration Rovers](https://science.nasa.gov/mission/mars-exploration-rovers-spirit-and-opportunity/) |
| `spiritMap` | Completed route to Columbia Hills and distinction between completed and planned lines | [Spirit’s Trip to the Hills](https://science.nasa.gov/photojournal/spirits-trip-to-the-hills/) |
| `opportunity` | Dates, landing coordinates, odometer, crater sequence and separation, historical record | [Opportunity](https://science.nasa.gov/mission/mer-opportunity/) |
| `marsRadius` | Mean Mars radius for prototype scale calculations | [NASA Mars Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html) |

**Copy and data decisions for review**

- **Pathfinder** Use Sept. 27, 1997 as “Final transmission,” the date labeled “End of Mission” on the mission overview. Use “about 15 bounces,” “up to 50 ft,” and “about 1 km from first impact to rest.” The 1 km is lander displacement and belongs to the airbag landing event. Sojourner’s driving odometer is unspecified in this dataset.
- **Spirit** Use Jan. 3, 2004 PST for landing. Distinguish last contact on March 22, 2010 from formal mission closure on May 25, 2011. Use NASA’s 4.8 mi / 7.73 km for the odometer. Attribute the 250 m northeast leg, roughly 200 m crater width and 3 km hills estimate to the early plan. The completed route sequence is landing site → Bonneville Crater → Columbia Hills. Keep the plan and odometer visually distinct.
- **Opportunity** Use Jan. 24, 2004 PST for landing and June 10, 2018 for last communication. Use 28.06 mi / 45.16 km for the odometer and describe it as a former off-Earth distance record. The Eagle-to-Endurance separation of about 750 m is distinct from the total distance driven.
- The MER overview’s long-standing-water conclusion is a joint mission finding. In each rover panel attribute it to the pair, and keep Gusev’s possible former lake and Meridiani’s wet-history indicators separate from that conclusion.
- Preserve NASA coordinate values and hemisphere directions in JSON. Pathfinder’s anchor uses the published tracking estimate, not the image center or the planned target. Treat all three POIs as globe-scale site markers. Unknown source datums or map-registration differences must stay visible in the implementation notes. Display rounded site coordinates, if displayed at all. No browser scraping or synthesis of historical coordinates from mileage.

## 3. Repository structure

Paths are relative to the static web root. Keep directory and file case exact on both Windows and the host.

```text
/
├── .nojekyll                    # empty, for branch-based GitHub Pages
├── index.html                   # shell, import map, semantic controls and templates
├── README.md                    # run, asset manifest, source decisions, QA and hosting
├── css/
│   └── styles.css               # layout, imagery, focus and reduced motion
├── js/
│   ├── main.js                  # bootstrap, data, state and selection orchestration
│   ├── GlobeRenderer.js         # renderer, controls, model, projection and picking
│   ├── CameraFlight.js          # single cancellable GSAP camera transition
│   ├── geography.js             # pure coordinate and spherical sampling helpers
│   ├── TraverseRenderer.js      # spherical lines and local schematic geometry
│   └── MissionPanel.js          # safe DOM rendering, credits and focus
├── data/
│   ├── rovers.json               # sole runtime store for mission history
│   └── assets.json               # asset paths, media metadata, and model registration
└── assets/
    └── mars/
        └── mars.glb              # preferred; mars.gltf plus referenced sidecars accepted
```

Rover images may be anywhere in the repository under their original filenames. Discover them during implementation and map their actual paths in `assets.json` as described in §4.2. An absent asset is represented by `null` for the model or an empty photo array. Keep assets local, including glTF textures and buffers. Leave user originals intact.

## 4. Static runtime and asset ingestion

### 4.1 Browser imports

Use the following pinned baseline in `index.html` before the entry module runs. Keep Three.js core and add-ons on the same host and version. Confirm all module responses, including transitive dependencies, in the browser network panel on the deployed origin.

```html
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/",
    "gsap": "https://cdn.jsdelivr.net/npm/gsap@3.13.0/index.js"
  }
}
</script>
<script type="module" src="./js/main.js"></script>
```

```js
// main.js: data and DOM can load even if the 3D dependency graph fails.
const [globeResult, animationResult] = await Promise.allSettled([
  import('./GlobeRenderer.js'),
  import('gsap'),
])

// GlobeRenderer.js
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
```

Use named `gsap` export. A GSAP failure falls back to immediate camera framing. A Three.js or add-on import failure leaves the mission navigator, content, and a status message usable. Keep the entry module and panel’s static dependency graph free of remote imports. Load and validate `rovers.json` independently from 3D and media. Use `new URL('../data/rovers.json', import.meta.url)` for fetches from `js/` and resolve manifest asset paths against `document.baseURI`. Check HTTP status before parsing. Use HTTPS, exact-version URLs, and local relative paths. A production rehearsal must include a fresh cache, since the CDN is a runtime network dependency. [Three.js CDN setup](https://threejs.org/manual/pages/installation.html) · [GSAP installation](https://gsap.com/docs/v3/Installation/)

### 4.2 Asset manifest and model lifecycle

`assets.json` contains `model` (`null` or an object with `src`, `credit`, `upAxis`, `northAxis`, `primeMeridianYawDeg`, `longitudeSense`, and `registrationStatus`) and `roverImages` (object keyed by mission ID, each value an array of zero to two `{src, alt, credit}` records). `registrationStatus` is `"unverified"` or `"verified"`. Use `"east-positive"` or `"west-positive"` for `longitudeSense`. Derive orientation from the supplied asset or documented reference landmarks. If the source longitude sense is reversed, correct the source UV mapping or export before marking the model verified. Keep runtime geodata east-positive. Record transform and reference landmarks in README. Treat missing registration fields as unverified. Example initial manifest when media have yet to arrive:

```json
{"model": null, "roverImages": {"sojourner": [], "spirit": [], "opportunity": []}}
```

- Start with a lit rust-colored `SphereGeometry(1, 64, 48)`. Give it the same globe center, unit radius, and canonical axes as the loaded model. Keep it available for model failure and show a small status such as “Simplified globe.”
- Load via `new GLTFLoader(manager).loadAsync(url)`. Accept glTF 2.0. Preserve relative sidecars for `.gltf`, case included. Inspect required compression extensions. Prefer a supplied uncompressed export, or configure the matching pinned Draco, Meshopt, or KTX2 decoder if the asset requires it. Check texture dependencies and reject nonlocal resource URLs except embedded data/object URLs generated by the loader. [GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html)
- After decode, update world matrices, compute mesh bounds, and center and uniformly scale the model to radius `R = 1` using separate orientation and normalization groups. Validate finite nonzero bounds and an approximately spherical outer silhouette. Keep author materials and texture colors. Use neutral key/fill lighting, and confirm color-space handling for any color texture assigned manually.
- Set a 10 s initial load deadline after the request starts. If a usable asset finishes within the active load, swap the visual mesh atomically and keep camera pose, selection, and anchors. On timeout, error, or invalid geometry, retain the sphere and report status. Ignore stale callbacks and dispose resources from discarded loads. An unverified textured model may be shown with “Surface alignment unverified” and mission access through the navigator. Suppress registered markers and routes on that textured view and offer a switch to the correctly oriented reference sphere. Verify at least two identifiable landmarks and the north/south orientation before final demo sign-off.
- **Discover rover images during implementation.** Inventory the repository recursively for PNG, JPG, and JPEG files, including uppercase extensions and paths ignored by normal search. Skip Git internals and generated dependencies. Use filenames, directory context, available credits or metadata, and visual inspection to identify the intended images for Sojourner, Spirit, and Opportunity. If multiple plausible files remain and their mission identity cannot be verified, leave the ambiguous files unassigned and report them for review.
- Select one verified hero per mission and an optional second image. The first manifest entry is the hero. Use each file’s actual case-sensitive, URL-safe path relative to the static web root in `roverImages`. Preserve the original filenames and directories. If an image is outside the published web root, copy it into the published tree and map that copy. Verify the paths over HTTP, including any spaces and the GitHub Pages project subpath. The static site reads the manifest at runtime. Discovery happens in the local repository during implementation.
- If a rover image fails, keep the panel layout and show a quiet CSS frame with “Image unavailable.” Use the supplied photo’s descriptive alt text and credited caption. Do not fetch replacement photos. Use a fixed media aspect ratio, responsive `object-fit: cover`, per-image focal point via CSS, and lazy loading for optional detail imagery.

## 5. Data contract and canonical seed

Copy this valid JSON block to `data/rovers.json` after source approval. JSON uses UTF-8. All IDs are stable and lowercase. `landingWaypointId`, `waypointIds`, and `distanceIds` resolve within the same mission. `sourceIds` resolve to the root `sources` dictionary. Mission `sourceIds` back `site.context`; all claims in `facts`, `discoveries`, and other evidence records have their own source IDs.

- `coordinates` is `null` or a `{latDeg, latHemisphere, lonDeg, lonHemisphere}` object. Values are unsigned source magnitudes with latitude `0..90`, longitude `0..360`, and hemisphere enums `N/S`, `E/W`. Runtime conversion applies signs and wraps longitude to `[-180, 180)`.
- `dates` has `{event, date, basis, sourceIds}` records. `date` is an ISO calendar date. Format without local-time rollover, using UTC only for formatting and the explicit source basis for display.
- `distanceTraveled` has `{id, kind, values, approximate, sourceIds}` records. `values` entries are `{value, unit}` and units are `m`, `km`, `mi`, or `ft`. A record can carry equivalent units. `kind` is `roverOdometer`, `landerDisplacement`, `plannedLeg`, `landmarkSeparation`, or `craterDiameter`. Never sum records or equivalents to derive an odometer.
- `waypoints` records have `{id, name, kind, coordinates, sourceIds}`. A null position still renders as a named step in the panel.
- `traversePaths` records have `{id, name, kind, geometry, waypointIds, distanceIds, sourceIds, bounce}`. `kind` is `landingBounce`, `plannedDrive`, or `roverDrive`. `geometry` is `schematic` or `sourcePolyline`. `bounce` is `null` or `{count, approximate, maxHeight}` where `maxHeight` is `{value, unit}`. A future `sourcePolyline` adds `samples`, an ordered array of two or more sourced coordinates in the same shape as waypoint coordinates, and `coordinateFrame`, the NASA dataset’s documented coordinate frame. The sample array traces the measured or map-derived line, and the source entry identifies the dataset and any transformation. Use separate path records for disconnected sections. Reject geographic lines with missing samples, provenance, or frame. Use the panel and schematic treatment until validated samples are available.
- Check schema version, mission IDs, finite coordinate and metric ranges, enums, URL safety, and references at load. A malformed mission record is excluded with a status. A malformed root or empty valid mission list shows a data-load error and retry. Avoid creating synthetic values in either case.

```json
{
  "schemaVersion": 1,
  "mars": {"meanRadiusKm": 3389.5, "sourceIds": ["marsRadius"]},
  "sources": {
    "pathfinder": {"title": "Mars Pathfinder", "url": "https://science.nasa.gov/mission/mars-pathfinder/"},
    "pathfinderCoords": {"title": "Mars Pathfinder Landing Ellipses", "url": "https://science.nasa.gov/photojournal/mars-pathfinder-landing-ellipses/"},
    "spirit": {"title": "Spirit", "url": "https://science.nasa.gov/mission/mer-spirit/"},
    "mer": {"title": "Mars Exploration Rovers", "url": "https://science.nasa.gov/mission/mars-exploration-rovers-spirit-and-opportunity/"},
    "spiritMap": {"title": "Spirit’s Trip to the Hills", "url": "https://science.nasa.gov/photojournal/spirits-trip-to-the-hills/"},
    "opportunity": {"title": "Opportunity", "url": "https://science.nasa.gov/mission/mer-opportunity/"},
    "marsRadius": {"title": "Mars Fact Sheet", "url": "https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html"}
  },
  "rovers": [
    {
      "id": "sojourner",
      "name": "Mars Pathfinder & Sojourner",
      "designation": "The Pioneers",
      "missionType": "Lander & Rover",
      "sourceIds": ["pathfinder"],
      "site": {
        "name": "Ares Vallis",
        "context": "A rocky ancient flood plain in Mars’ northern hemisphere.",
        "landingWaypointId": "station"
      },
      "dates": [
        {"event": "Launch", "date": "1996-12-04", "basis": "UTC", "sourceIds": ["pathfinder"]},
        {"event": "Landing", "date": "1997-07-04", "basis": null, "sourceIds": ["pathfinder"]},
        {"event": "Final transmission", "date": "1997-09-27", "basis": null, "sourceIds": ["pathfinder"]}
      ],
      "facts": [
        {"text": "Sojourner stood 1 ft tall and weighed 23 lb.", "sourceIds": ["pathfinder"]},
        {"text": "Sojourner deployed down a ramp tilted 20° from the surface.", "sourceIds": ["pathfinder"]},
        {"text": "Pathfinder returned 2.3 billion bits of information.", "sourceIds": ["pathfinder"]}
      ],
      "discoveries": [
        {"text": "Rounded pebbles suggested flowing water during a warmer period of Mars’ past.", "sourceIds": ["pathfinder"]},
        {"text": "Airborne dust showed magnetic properties.", "sourceIds": ["pathfinder"]},
        {"text": "The mission observed early-morning clouds of water ice.", "sourceIds": ["pathfinder"]}
      ],
      "distanceTraveled": [
        {"id": "landing-displacement", "kind": "landerDisplacement", "values": [{"value": 1, "unit": "km"}], "approximate": true, "sourceIds": ["pathfinder"]}
      ],
      "waypoints": [
        {"id": "first-impact", "name": "First surface impact", "kind": "impact", "coordinates": null, "sourceIds": ["pathfinder"]},
        {"id": "station", "name": "Carl Sagan Memorial Station", "kind": "landingSite", "coordinates": {"latDeg": 19.30, "latHemisphere": "N", "lonDeg": 33.52, "lonHemisphere": "W"}, "sourceIds": ["pathfinder", "pathfinderCoords"]}
      ],
      "traversePaths": [
        {"id": "airbag-landing", "name": "Pathfinder airbag landing", "kind": "landingBounce", "geometry": "schematic", "waypointIds": ["first-impact", "station"], "distanceIds": ["landing-displacement"], "sourceIds": ["pathfinder"], "bounce": {"count": 15, "approximate": true, "maxHeight": {"value": 50, "unit": "ft"}}}
      ]
    },
    {
      "id": "spirit",
      "name": "Spirit",
      "designation": "MER-A",
      "missionType": "Rover",
      "sourceIds": ["spirit", "mer"],
      "site": {
        "name": "Gusev Crater",
        "context": "A giant impact crater that may once have contained a lake.",
        "landingWaypointId": "gusev-landing"
      },
      "dates": [
        {"event": "Landing", "date": "2004-01-03", "basis": "PST", "sourceIds": ["spirit"]},
        {"event": "Last contact", "date": "2010-03-22", "basis": null, "sourceIds": ["spirit"]},
        {"event": "Formal mission closure", "date": "2011-05-25", "basis": null, "sourceIds": ["spirit"]}
      ],
      "facts": [
        {"text": "Spirit was designed as a robotic field geologist.", "sourceIds": ["mer"]}
      ],
      "discoveries": [
        {"text": "Together, Spirit and Opportunity found evidence that water persisted on the Martian surface in ancient times.", "sourceIds": ["mer"]}
      ],
      "distanceTraveled": [
        {"id": "mission-total", "kind": "roverOdometer", "values": [{"value": 7.73, "unit": "km"}, {"value": 4.8, "unit": "mi"}], "approximate": true, "sourceIds": ["spirit"]},
        {"id": "early-ne-leg", "kind": "plannedLeg", "values": [{"value": 250, "unit": "m"}, {"value": 820, "unit": "ft"}], "approximate": true, "sourceIds": ["mer"]},
        {"id": "early-crater-width", "kind": "craterDiameter", "values": [{"value": 200, "unit": "m"}], "approximate": true, "sourceIds": ["mer"]},
        {"id": "early-hills-estimate", "kind": "landmarkSeparation", "values": [{"value": 3, "unit": "km"}], "approximate": true, "sourceIds": ["mer"]}
      ],
      "waypoints": [
        {"id": "gusev-landing", "name": "Gusev landing site", "kind": "landingSite", "coordinates": {"latDeg": 14.5692, "latHemisphere": "S", "lonDeg": 175.4729, "lonHemisphere": "E"}, "sourceIds": ["spirit"]},
        {"id": "early-crater", "name": "Crater northeast of the lander (early plan)", "kind": "crater", "coordinates": null, "sourceIds": ["mer"]},
        {"id": "bonneville", "name": "Bonneville Crater", "kind": "crater", "coordinates": null, "sourceIds": ["spirit", "spiritMap"]},
        {"id": "columbia-hills", "name": "Columbia Hills", "kind": "hills", "coordinates": null, "sourceIds": ["mer", "spiritMap"]}
      ],
      "traversePaths": [
        {"id": "early-plan", "name": "Early route plan", "kind": "plannedDrive", "geometry": "schematic", "waypointIds": ["gusev-landing", "early-crater", "columbia-hills"], "distanceIds": ["early-ne-leg", "early-crater-width", "early-hills-estimate"], "sourceIds": ["mer"], "bounce": null},
        {"id": "gusev-drive", "name": "Landing site to Columbia Hills", "kind": "roverDrive", "geometry": "schematic", "waypointIds": ["gusev-landing", "bonneville", "columbia-hills"], "distanceIds": [], "sourceIds": ["spirit", "spiritMap"], "bounce": null}
      ]
    },
    {
      "id": "opportunity",
      "name": "Opportunity",
      "designation": "MER-B",
      "missionType": "Rover",
      "sourceIds": ["opportunity", "mer"],
      "site": {
        "name": "Meridiani Planum",
        "context": "Mineral deposits in these plains pointed to a wet history.",
        "landingWaypointId": "eagle-landing"
      },
      "dates": [
        {"event": "Landing", "date": "2004-01-24", "basis": "PST", "sourceIds": ["opportunity"]},
        {"event": "Last communication", "date": "2018-06-10", "basis": null, "sourceIds": ["opportunity"]}
      ],
      "facts": [
        {"text": "Opportunity formerly held the off-Earth rover distance record.", "sourceIds": ["opportunity"]}
      ],
      "discoveries": [
        {"text": "Together, Spirit and Opportunity found evidence that water persisted on the Martian surface in ancient times.", "sourceIds": ["mer"]}
      ],
      "distanceTraveled": [
        {"id": "mission-total", "kind": "roverOdometer", "values": [{"value": 45.16, "unit": "km"}, {"value": 28.06, "unit": "mi"}], "approximate": false, "sourceIds": ["opportunity"]},
        {"id": "crater-separation", "kind": "landmarkSeparation", "values": [{"value": 750, "unit": "m"}], "approximate": true, "sourceIds": ["opportunity"]}
      ],
      "waypoints": [
        {"id": "eagle-landing", "name": "Landing outcrop, Eagle Crater", "kind": "landingSite", "coordinates": {"latDeg": 1.9483, "latHemisphere": "S", "lonDeg": 354.47417, "lonHemisphere": "E"}, "sourceIds": ["opportunity", "mer"]},
        {"id": "eagle-exit", "name": "Eagle Crater exit", "kind": "craterExit", "coordinates": null, "sourceIds": ["opportunity"]},
        {"id": "endurance", "name": "Endurance Crater", "kind": "crater", "coordinates": null, "sourceIds": ["opportunity"]}
      ],
      "traversePaths": [
        {"id": "eagle-to-endurance", "name": "Eagle Crater to Endurance Crater", "kind": "roverDrive", "geometry": "schematic", "waypointIds": ["eagle-landing", "eagle-exit", "endurance"], "distanceIds": ["crater-separation"], "sourceIds": ["opportunity", "mer"], "bounce": null}
      ]
    }
  ]
}
```


## 6. Rendering and interaction contract

### 6.1 Scene, layers, and resize

- `#globe-stage` is a positioned container. Append one renderer canvas to `#globe-canvas`. Place `#poi-layer` as an absolutely positioned sibling inside the stage, sized to the same CSS box. Keep the mission navigator and the panel in HTML outside that stage. Never mount panel UI inside the canvas, put the panel in the raycast scene, or pass a page-level wrapper to OrbitControls.
- Canvas fills the stage. Overlay container uses `pointer-events: none`. Visible native POI buttons use `pointer-events: auto`. Controls bind only to `renderer.domElement`; decorative layers never intercept canvas input.
- Use a `PerspectiveCamera` with initial FOV `40`, near `0.01`, and far `40` in unit-radius space. Compute the home distance for a sphere using `R / sin(min(verticalHalfFov, horizontalHalfFov))`, add framing margin, and keep within the control limits. Use an initial view that shows Ares Vallis and Meridiani where the aspect ratio allows. Provide Reset view and Pause motion controls.
- Observe actual stage dimensions with `ResizeObserver`, update camera aspect and projection, and resize the renderer using CSS dimensions and pixel ratio capped at `1.5`. Guard against zero-size stages. When a panel changes the desktop grid width, recompute framing bounds and project against the resulting canvas rect. Avoid layout reads for each individual POI.
- Keep an origin-centered `globeRoot` with its local +Y as Mars north. Children are the oriented visual mesh or fallback, unit-sphere interaction proxy, landing anchors, and route group. Normalize and calibrate only the visual mesh. Apply idle rotation to `globeRoot`, so the POIs, route geometry, and terrain rotate together.

### 6.2 Coordinates and marker projection

Use this mapping for unit vectors in the canonical globe frame. `rad` converts degrees to radians. Use the published coordinates as globe-scale spherical anchors and document the source reference-frame limitations in §2.

```js
const latitude = rad(latHemisphere === 'S' ? -latDeg : latDeg)
const signedLongitude = lonHemisphere === 'W' ? -lonDeg : lonDeg
const wrapped = ((signedLongitude + 180) % 360 + 360) % 360 - 180
const longitude = rad(wrapped)
const cosLatitude = Math.cos(latitude)

return new THREE.Vector3(
  Math.sin(longitude) * cosLatitude,
  Math.sin(latitude),
  Math.cos(longitude) * cosLatitude,
)
```

Unit checks are north pole → `+Y`, `(0°, 0°)` → `+Z`, and `(0°, 90°E)` → `+X`. Opportunity’s longitude wraps to `−5.52583°`. For each mission, multiply the unit vector by the local surface radius plus a small lift, initially `0.004`. On the textured model, if its radius deviates materially from 1, determine the local radius by casting toward the origin through the registered visual mesh or keep the reference sphere active until a usable asset is supplied. Cache these samples. Use the same surface reference for depth and picking.

Every rendered frame, update world matrices before projection. Convert the local anchor using `globeRoot.localToWorld`, transform into camera space to reject points behind the camera, and call `project(camera)` on a copy. Convert NDC to stage-local CSS pixels using the canvas rect, subtracting the overlay rect origin when required. Hide offscreen and occluded markers. For a spherical proxy, require the camera to lie in the surface normal’s outward hemisphere at the surface anchor, then verify no nearer globe intersection before the anchor where needed for irregular terrain. A tangent/horizon tolerance can hide flicker. Set `hidden` on the DOM button and remove it from tab order when occluded. If a focused marker is about to be hidden, transfer focus to its stable mission navigator button. Update marker transforms with `translate3d`, and apply radar keyframes to a nested ring or pseudo-element so its animation cannot overwrite projection.

### 6.3 Pointer picking and accessible selection

Use a single `selectMission(id, trigger)` command for POI clicks, canvas picks, and the mission navigator. Store `missionId` on each marker button and on the corresponding pick proxy. Raycast only against the globe surface and explicit POI proxies. Keep proxies on a dedicated layer excluded from the camera, included in the raycaster, and sized to a small accessible tolerance near each anchor.

- For pointer activation on an HTML marker, pick using the projected center of that same marker and verify that the hit proxy corresponds to its ID and is visible ahead of the first globe hit. This preserves the whole HTML button as a tap target. For keyboard-generated button clicks, use the visible marker’s ID directly. Keep DOM and raycast selection in the same handler flow.
- For canvas taps, derive NDC from the actual pointer client coordinates and the canvas `getBoundingClientRect()`, then call `raycaster.setFromCamera(ndc, camera)`. Take the closest POI proxy before the globe intersection. A globe hit without a POI is a no-op. Require primary pointer, movement under about `6` CSS px, and no pinch, cancellation, or active orbit gesture. Track pointer down/up independently so OrbitControls’ `start` and `end` on an ordinary tap do not swallow the tap. An HTML button click never bubbles into the canvas tap path.
- Use real HTML buttons, native activation, descriptive labels, and visible focus rings. The three navigator buttons are always reachable and expose selection using `aria-pressed`. Give the region an accessible label and include a short help line for orbit, zoom, and pan. Provide keyboard zoom and view-reset buttons and scope arrow-key pan/orbit shortcuts to the focused stage to preserve normal page scrolling elsewhere.

### 6.4 NASA viewer behavior and idle state

Use the official viewer as the manual interaction reference. Before sign-off, compare drag direction, drag response, rotation limits, wheel and pinch feel, panning behavior, and inertia on a mouse and touch device. NASA’s resource page documents drag interaction. Exact input feel requires direct side-by-side rehearsal, including any interaction the reference does not expose on a particular device. Meet the explicit orbit, zoom, pan, and damping requirements regardless. [NASA Planet Mars 3D model](https://science.nasa.gov/resource/planet-mars-3d-model/)

- Set `enableRotate`, `enableZoom`, `enablePan`, `enableDamping`, and `screenSpacePanning` to `true`, and `autoRotate` to `false`. Start with `dampingFactor = 0.075`, `rotateSpeed = 0.65`, `zoomSpeed = 0.9`, `panSpeed = 0.65`, and unrestricted azimuth. Set polar limits a small epsilon inside `0..π`. Map left drag/one finger to orbit, wheel/pinch to zoom, right drag/two-finger translation to pan. Tune against the viewer. [OrbitControls](https://threejs.org/docs/pages/OrbitControls.html)
- Use `cursor` at the globe center and bound pan target magnitude, initially `maxTargetRadius = 0.15R`. Start with `minDistance = 1.25R`, `maxDistance = 8R`. Keep `minDistance - maxTargetRadius` safely above the normalized surface extent plus the near plane. Recheck limits against the actual asset envelope and tablet/mobile aspect ratios. For keyboard control, use the same camera/target constraints.
- Use a single render loop with clamped elapsed time. Track actual wheel, pointer, keyboard, or button input, whether a gesture is active, and whether a flight is active. During idle overview, after `4 s` without input, turn `globeRoot.rotation.y` at `0.045 rad/s` with elapsed-time integration. Pause on interaction, focus on a POI, panel inspection, hidden tab, reduced-motion preference, or user pause. Keep the current rotation angle when pausing. Resume after the next idle interval on return to overview. OrbitControls `change` alone does not count as user input.
- In ordinary frames run `controls.update(deltaSeconds)` before projection and render. During a fly-to, skip normal control updates. Suspend or throttle work in hidden tabs and reset the frame-time origin on resume.

### 6.5 Cinematic selection and interruption

1. Set selected mission, active trigger, and a monotonically increasing flight token. Stop idle rotation, cancel the previous tween, and start the panel transition. Freeze the current globe angle. Compute the target landing direction from the anchor’s world position.
2. Freeze and clear residual OrbitControls damping, disable controls, and capture the current pose. GSAP tweens a single progress object over about `1.1 s` with `power2.inOut`. Interpolate orbit direction around the globe by shortest-arc spherical interpolation and independently interpolate radial distance. Handle nearly identical directions with normalized lerp and antipodal directions with a deterministic perpendicular axis. Never interpolate a Cartesian line through the sphere.
3. Aim at the globe center for the default fly-to, bringing the selected landing marker to the front and near the stage center. Blend the current panned target back to the globe center and use `camera.lookAt()` throughout. Use a final radius near `2.6R`, adjusted for stage aspect and controls bounds. Ensure path radius stays above the surface envelope. A dedicated close-up camera mode is outside MVP.
4. On completion, set the exact final camera and controls target, synchronize controls once with damping temporarily off, then restore damping and input. Close, reset, or new selection cancels from the current pose. Only the current token may restore or change controls, panel selection, or route state. Ensure controls are restored when cancelled without a replacement. Reduced motion and GSAP failure both use the same finalization flow with an immediate camera update.

## 7. Traverse rendering and truthful scale

### 7.1 Sourced line support

`TraverseRenderer` consumes only the active mission’s approved `sourcePolyline` samples, when available. Convert each sample to a unit direction. Densify consecutive points with shortest-arc spherical interpolation using `atan2(length(cross(a,b)), dot(a,b))`; clamp dot products and handle coincident points. Reject ambiguous antipodal route samples until an intermediate point is supplied. Handle the longitude seam naturally through vectors. Choose angular subdivision and shell lift together so each rendered chord stays outside the mesh. On the calibrated model, project samples to the radial surface and lift just enough to avoid depth fighting. Never join distant or broken tracks across a gap the source marks as unknown.

Use `THREE.BufferGeometry` plus `THREE.LineBasicMaterial` for a simple core or `TubeGeometry` with a piecewise spherical curve for consistent thickness. Do not rely on `LineBasicMaterial.linewidth` for the WebGL line thickness. If using tubes, apply a bright narrow core and subdued transparent outer layer. Keep depth testing enabled, disable depth writes on the translucent layer, and keep the selected journey visible only on the near side. Preserve any dataset-described difference between planned and completed tracks. Cap samples for rendering, retaining turns and waypoints, and dispose geometry/materials when replacing routes.

### 7.2 Required visuals with the seed dataset

The proposed seed has landing coordinates but lacks route samples. Build an explicit “Show journey” action in each panel. It opens a **schematic on the globe** near the selected anchor and an ordered HTML waypoint sequence in the panel. Label both “Schematic · not to scale,” and give the globe drawing a persistent adjacent label while shown. The globe drawing depicts order and relationships only. Store its visual layout in code as normalized steps and display offsets, without invented historical latitude, longitude, bearings, times, or sample heights. Do not attach feature labels to positions that imply mapped crater locations. Numbered schematic nodes correspond to the ordered panel steps.

To build the schematic, obtain the landing unit normal `n`. Compute a stable perpendicular visual axis `t`, oriented for readability from the initial framed pose, then map symbolic offset angle `θ` to `n cos(θ) + t sin(θ)` on the unit sphere. Use a default angular span of about `0.22 rad` for legibility, with depth testing and a small shell lift. Center or end the diagram at the actual landing POI as appropriate. The span is a display constant and carries no mileage meaning. Keep the graphic as a child of the globe with rotation paused during inspection. Offer a Show/Hide control and legend.

| Mission | Required schematic | Required distance treatment |
| --- | --- | --- |
| Pathfinder & Sojourner | Curved landing trace ending at the station, with about 15 stylized bounce lobes and a brief roll-to-stop tail. Use an illustrative radial envelope, with smooth local arches such as `sin(π * localT)` and zero height at contact points. Label the max observed height separately. | Show about 1 km from first impact to rest, up to 50 ft high. Assign no driving distance to Sojourner from these values. |
| Spirit | Completed sequence from the landing site through Bonneville Crater to Columbia Hills. Offer the early route plan as a separately labeled toggle with dashed styling; never combine it with the completed route. | Show lifetime odometer in the header and the early-plan figures in their own section. The displayed journey covers an early portion of the mission. |
| Opportunity | Ordered trace from landing outcrop to Eagle Crater exit to Endurance Crater. | Show Eagle-to-Endurance separation next to the early segment and the lifetime odometer in the header. The early segment represents only part of the mission. |

Show a common linear-scale HTML distance comparison for the two sourced rover odometers, with visible numbers and a shared maximum equal to the greater odometer. Report Pathfinder’s landing displacement separately. Derive bars from the JSON kilometre values and provide labels readable without color. Reported distances remain legible even when the route is offscreen or the 3D layer is unavailable.

On a unit globe, the 1 km landing displacement subtends about `0.017°`, a 250 m segment about `0.0042°`, and 750 m about `0.0127°`. Scale a geographic route using actual coordinates, without stretching it to match a reported odometer. Lifetime distance along a traveled route cannot determine its geographic endpoints. If approved, georeferenced NASA tracks are provided during refinement, enable actual route rendering and preserve the schematic as an explicitly labeled overview if useful.

## 8. Interface and visual specification

- Design as a restrained futuristic mission console. Use a near-black background, warm rust Mars, a cool cyan accent, and a light neutral text palette. Use a restrained glow on frames, route highlights, and controls. Use a clean system sans stack and tabular numerals for metrics; avoid runtime font requests. Make mission identity, landing site, distance, and discovery the main visual hierarchy.
- The desktop layout has the globe and a right-side panel in a CSS grid; the panel becomes a slide-up, in-flow region under the globe at narrow widths. Preserve navigation and reset controls at 320 CSS px and during device rotation. The panel is a non-modal region with its own desktop scroll when needed. Keep the globe available while inspecting mission details. Use a `280–340 ms` translate/opacity entry and exit; do not leave closed content focusable. Keep panel translation separate from grid sizing.
- Panel reading order is mission name and site, dates and metrics, image, discoveries, journey controls and ordered steps, facts, and NASA source links. Use semantic headings, lists, `<time>`, and figure captions. Use `textContent` for data, validated local image URLs, and allowlisted HTTPS NASA links. Announce selection and fallback status in an unobtrusive live region. Move focus to the panel heading for keyboard selection. Close with an explicit button or Escape and return focus to the invoking button or its persistent mission equivalent.
- For the rover hero, use a clipped aspect-ratio frame with a slow CSS Ken Burns animation on the image only, around `24–32 s` alternate from `scale(1.03)` to `scale(1.13)` with a `2–3%` shift. Reserve safe crop around the rover, test both endpoints, and keep text/caption static. Use a thin gradient frame, subtle outer shadow, and corner accents via pseudo-elements; keep the original photo color and avoid filters that obscure science imagery. With two images, render the second as an optional still or selectable detail. Animate only the visible hero.
- The radar marker uses an inner high-contrast dot and a pseudo-element ring scaling and fading over about `2.4 s` on repeat. Keep a target near `44 × 44` CSS px where possible and a persistent visual state for selected and focused markers. Use text and line pattern as well as color for journey types.
- Respect `prefers-reduced-motion` in CSS and JS, including changes during a session. Disable radar pulses, Ken Burns, idle rotation, and fly-to movement in that mode. The panel switches immediately. Use the Pause motion control to pause idle rotation, radar, and Ken Burns effects for any visitor. Preserve keyboard, touch, and normal scroll behavior. Check contrast at `4.5:1` for normal body text, and inspect the design at 200% zoom.

## 9. Resilience, performance, and hosting

| Condition | Required behavior |
| --- | --- |
| Local Mars model missing, late, invalid, or missing a sidecar | Reference sphere stays usable with POIs, controls, and journey mode. Report simplified globe status. |
| Texture registration unverified | Clearly label the textured view and make the reference sphere available for geographic markers and route mode. |
| Three.js/CDN error, unavailable WebGL, or context lost | Preserve all mission details, dates, metrics, waypoint lists, and NASA references. Show status with a retry action when applicable. Reinitialize once per retry and retain selection. |
| GSAP import fails | Apply final camera state immediately and preserve CSS panel behavior. |
| Image fails | Preserve frame size and credit where applicable. Use the local CSS placeholder treatment. |
| JSON fetch/parse fails | Show “Mission data unavailable” with retry. Keep an otherwise working globe interactive. |
| JavaScript disabled | Provide a short `<noscript>` message with the approved NASA mission links. |

Aim for responsive orbit on the demo hardware. As initial targets, keep the model around 5 MB where the supplied asset allows, each photo around 500 KB, total static media around 8 MB, and sustained orbit near 60 FPS on the demo laptop and at least 30 FPS on the demo phone. Record the device, browser, asset size, and observed frame rate. Reduce texture size or pixel ratio before sacrificing readable markers. Reuse vectors in the render loop, avoid unnecessary allocations and post-processing passes, and dispose Three.js resources on replacement or teardown. Keep renderer failure and data failure isolated.

Run locally with `py -m http.server 8000` on Windows or `python3 -m http.server 8000`, from the web root. Visit `http://localhost:8000/`. Use a normal static HTTP server for all testing. GitHub Pages is the default submission target. Serve the repository root from the chosen branch with `.nojekyll`; smoke-test under the real project subpath. For Vercel, select Other, skip build and install, and serve the project root. Verify case-sensitive asset links, CDN CORS/MIME, and no requests to live mission APIs. Rehearse once with the deployed site and once with the local static server on the presentation machine. [GitHub Pages publishing](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) · [Vercel static configuration](https://vercel.com/docs/builds/configure-a-build)

## 10. Build order and acceptance

1. **Data and shell.** Add the no-build page, versioned JSON, schema checks, responsive DOM panel, and source links. Verify mission details with renderer imports blocked.
2. **Globe and assets.** Add fallback sphere, controls, renderer, model manifest, local load, and orientation validation. Implement the resize and failure states.
3. **Selection and motion.** Project, occlude, and pick POIs. Connect navigator and panel, add camera flight, idle rotation, cancellation, and reduced motion.
4. **Journeys and polish.** Add the three schematics and route renderer for validated samples, the odometer comparison, image effects, and responsive layout.
5. **Rehearse and hand off.** Exercise failures, confirm source wording and geometry, compare NASA viewer interaction, and record readiness in README.

| Check | Pass condition |
| --- | --- |
| Normal run | All three missions open from navigator and visible globe markers. A supplied valid model replaces the fallback with no pose jump. |
| Controls | Mouse and touch orbit, zoom, and pan respond smoothly. Azimuth can pass through a complete revolution. Globe remains outside the camera near plane at maximum zoom and pan. Reset returns to the defined overview. |
| Geodesy and alignment | Cardinal mappings and signed longitudes match §6.2. Supplied texture matches two independently identified landmarks and north/south orientation before verified status. Markers move with the same rotating surface and cannot activate through the far side. |
| Picking and layering | An HTML POI click and a canvas proxy tap invoke the same mission. Canvas drag and pinch do not select. Panel buttons and scrolling do not move the camera. Resize keeps projection aligned. |
| Motion | Idle rotation starts after the defined delay and pauses on input. A rapid sequence of selection, new selection, close, and reset produces no stuck controls or stale panel state. Reduced motion disables continuous effects and moves directly to the final pose. |
| Science | Each quantitative claim resolves to its NASA source. Pathfinder’s 1 km is lander displacement; Spirit’s 2010 last contact and 2011 closure both appear; the early plan is distinct from the completed sequence; Opportunity’s record is historical. |
| Routes | Pathfinder shows landing arcs, Spirit offers separate plan and completed sequence, and Opportunity shows Eagle to Endurance. Each schematic has an adjacent scale label. Runtime geographic rendering rejects unsourced samples. Exercise spherical line handling with a synthetic seam-crossing test input in development only. |
| Fallbacks | Simulate model 404, invalid glTF, missing photo, blocked Three.js, blocked GSAP, unavailable/lost WebGL, and failed JSON fetch. Each produces the corresponding §9 state. |
| Accessibility | Keyboard-only users can read all missions, open and close the panel, and recover focus. Mobile portrait has usable targets, no accidental page overflow, and readable journey data. |
| Static release | Clean-cache run on the deployed subpath produces no unexpected failed requests or uncaught errors. Source links, relative paths, and credits work. Rover images load from discovered paths, including a photo with a nonstandard filename or folder. Record the public URL when deployment is performed. |

## 11. Decisions for the next PRD revision

- Confirm the proposed NASA allowlist, date labels, coordinate anchors, and use of NASA’s more precise Spirit odometer figure.
- Approve the schematic journey treatment for the prototype or supply approved georeferenced NASA tracks and coordinate-frame documentation.
- Supply the Mars model and rover photos in the repository with available credits, usage terms, and any model orientation or registration metadata. Claude discovers the rover photo paths during implementation.
- Confirm the target demo browser/device, viewer parity observations, and final static hosting choice.
