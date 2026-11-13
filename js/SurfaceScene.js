// Illustrative surface close-up for a replay. The globe remains the geographic
// reference: terrain, spacing, crater shapes and heights here are presentation
// choices, labelled "Schematic · not to scale".
//
// Everything (rover pose, lander state, camera, route reveal, active callout anchor)
// is a pure function of the playhead passed to apply(t), so scrubbing is deterministic.

import * as THREE from 'three'
import { makeLander, makeSojourner } from './RoverModels.js'
import { sampleKeys, phase, smooth, clamp } from './replays.js'

// ---------------------------------------------------------------- terrain

const crater = (cx, cz, R, depth, rim) => ({ cx, cz, R, depth, rim })
const hill = (cx, cz, h, sigma) => ({ cx, cz, h, sigma })

const SETTINGS = {
  sojourner: {
    center: [-10, -5], size: 90, noise: 0.28, rocks: 360, flat: [[0, 0, 5]],
    craters: [], hills: [],
    sky: 0xc79a74,
    landmarks: {},
  },
  spirit: {
    center: [16, 4], size: 110, noise: 0.32, rocks: 180, flat: [[0, 0, 3]],
    craters: [crater(13, -9, 6.5, 2.6, 0.9)],
    hills: [hill(38, 16, 7, 6), hill(46, 9, 5, 5), hill(33, 24, 4.5, 5)],
    sky: 0xc59a78,
    landmarks: { bonneville: [13, -9], hills: [38, 16] },
    route: [
      [[1.4, 0], [3.2, -1.2]],
      [[3.2, -1.2], [5.5, -3.6], [7.66, -5.3]],
      [[7.66, -5.3], [8.4, -1.6], [12, 1.6], [18, 4.6]],
      [[18, 4.6], [24, 7.8], [30, 11]],
    ],
    plan: [[1.4, 0.8], [5, 0.2], [9.6, -1.6], [16, -2.6], [25, 3.2], [31, 9.4]],
    lander: [0, 0, -0.4],
  },
  opportunity: {
    center: [16, -5], size: 110, noise: 0.22, rocks: 90, flat: [[-1.6, 1.2, 1.6]],
    craters: [crater(0, 0, 6, 1.8, 0.5), crater(40, -12, 11, 3, 0.8)],
    hills: [],
    sky: 0xc9a07c,
    landmarks: { eagleExit: [5.6, -2.4], endurance: [40, -12] },
    route: [
      [[-0.2, 0.6], [1.2, -0.2]],
      [[1.2, -0.2], [2.5, -0.8], [3.6, -1.4]],
      [[3.6, -1.4], [4.7, -1.9], [5.6, -2.4]],
      [[5.6, -2.4], [9, -3.6], [16, -5.6]],
      [[16, -5.6], [23, -7.6], [29.4, -9.1]],
    ],
    lander: [-1.6, 1.2, 0.6],
  },
}

function makeHeight(cfg) {
  return (x, z) => {
    let h = cfg.noise * (Math.sin(x * 0.31 + Math.cos(z * 0.27) * 1.3) * 0.55 + Math.sin(z * 0.19 - x * 0.13) * 0.35 +
      Math.sin((x + z) * 0.71) * 0.12 + Math.sin(x * 1.7 - z * 1.3) * 0.05)
    for (const [fx, fz, fr] of cfg.flat) {
      const d2 = (x - fx) ** 2 + (z - fz) ** 2
      h *= 1 - Math.exp(-d2 / (2 * fr * fr))
    }
    for (const c of cfg.craters) {
      const r = Math.hypot(x - c.cx, z - c.cz) / c.R
      h += r < 1 ? -c.depth * (1 - r * r) + c.rim * r ** 6 : c.rim * Math.exp(-(((r - 1) / 0.35) ** 2))
    }
    for (const k of cfg.hills) h += k.h * Math.exp(-((x - k.cx) ** 2 + (z - k.cz) ** 2) / (2 * k.sigma * k.sigma))
    return h
  }
}

// Seeded random for stable rock placement.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) }

// ------------------------------------------------------------------ routes

/** Route of segments between waypoints. s is in waypoint units (segment i spans s∈[i, i+1]). */
class Route {
  constructor(segments, heightAt) {
    this.heightAt = heightAt
    this.segs = segments.map((seg) => {
      const pts = seg.points.map((p) => (p.isVector3 ? p.clone() : new THREE.Vector3(p[0], 0, p[1])))
      const curve = pts.length === 2 ? new THREE.LineCurve3(pts[0], pts[1]) : new THREE.CatmullRomCurve3(pts, false, 'centripetal')
      return { curve, explicitY: !!seg.explicitY, length: curve.getLength() }
    })
    this.cum = [0]
    for (const s of this.segs) this.cum.push(this.cum[this.cum.length - 1] + s.length)
    this.total = this.cum[this.cum.length - 1]
    this.count = this.segs.length
  }

  _seg(s) {
    s = clamp(s, 0, this.count)
    const i = Math.min(this.count - 1, Math.floor(s))
    return [i, s - i]
  }

  pointAt(s, out = new THREE.Vector3()) {
    const [i, f] = this._seg(s)
    const seg = this.segs[i]
    seg.curve.getPointAt(clamp(f, 0, 1), out)
    if (!seg.explicitY) out.y = this.heightAt(out.x, out.z)
    return out
  }

  isExplicit(s) { return this.segs[this._seg(s)[0]].explicitY }

  distanceAt(s) {
    const [i, f] = this._seg(s)
    return this.cum[i] + this.segs[i].length * clamp(f, 0, 1)
  }
}

class PolylineCurve extends THREE.Curve {
  constructor(points) {
    super()
    this.points = points
    this.lens = [0]
    for (let i = 1; i < points.length; i++) this.lens.push(this.lens[i - 1] + points[i].distanceTo(points[i - 1]))
    this.total = this.lens[this.lens.length - 1] || 1
  }
  getPoint(t, out = new THREE.Vector3()) {
    const d = clamp(t, 0, 1) * this.total
    let i = 1
    while (i < this.lens.length - 1 && this.lens[i] < d) i++
    const seg = this.lens[i] - this.lens[i - 1] || 1
    return out.copy(this.points[i - 1]).lerp(this.points[i], (d - this.lens[i - 1]) / seg)
  }
}

/** Tube along points; revealFraction sets the visible prefix via drawRange. */
function revealTube(points, color, radius, opacity = 1, radial = 6) {
  const tubular = points.length - 1
  const geo = new THREE.TubeGeometry(new PolylineCurve(points), tubular, radius, radial, false)
  const mat = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.userData.reveal = (f) => geo.setDrawRange(0, Math.floor(clamp(f, 0, 1) * tubular) * radial * 6)
  return mesh
}

function dashedTube(points, color, radius) {
  const g = new THREE.Group()
  const mat = new THREE.MeshBasicMaterial({ color })
  for (let i = 0; i < points.length - 1; i += 8) {
    const chunk = points.slice(i, Math.min(points.length, i + 5))
    if (chunk.length < 2) continue
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new PolylineCurve(chunk), chunk.length * 2, radius, 6, false), mat))
  }
  return g
}

// ------------------------------------------------------------- scene class

const _v = new THREE.Vector3()
const _f = new THREE.Vector3()
const _u = new THREE.Vector3()
const _x = new THREE.Vector3()
const _m = new THREE.Matrix4()

export class SurfaceScene {
  constructor({ def, library, quality = { shadows: true, segments: 180 } }) {
    this.def = def
    this.library = library
    this.quality = quality
    this.cfg = SETTINGS[def.missionId]
    this.h = makeHeight(this.cfg)
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 400)
    this.pendingSwap = false
    this.planVisible = false
    this._build()
  }

  _build() {
    const { cfg, scene } = this
    scene.background = new THREE.Color(cfg.sky)
    scene.fog = new THREE.Fog(cfg.sky, 35, 120)
    scene.add(new THREE.HemisphereLight(0xfbe6d2, 0x5a3424, 1.1))
    const sun = new THREE.DirectionalLight(0xfff1df, 2.2)
    sun.position.set(20, 30, 14)
    sun.castShadow = this.quality.shadows
    if (sun.castShadow) {
      sun.shadow.mapSize.set(1024, 1024)
      const c = sun.shadow.camera
      c.left = c.bottom = -14; c.right = c.top = 14; c.near = 1; c.far = 90
      sun.shadow.bias = -0.0006
    }
    scene.add(sun, sun.target)
    this.sun = sun

    // Terrain
    const n = this.quality.segments
    const geo = new THREE.PlaneGeometry(cfg.size, cfg.size, n, n)
    geo.rotateX(-Math.PI / 2)
    geo.translate(cfg.center[0], 0, cfg.center[1])
    const pos = geo.attributes.position
    const colors = new Float32Array(pos.count * 3)
    const base = new THREE.Color(0xa65a36)
    const dark = new THREE.Color(0x6e3a24)
    const light = new THREE.Color(0xc98a5c)
    const tmp = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const y = this.h(x, z)
      pos.setY(i, y)
      const k = 0.5 + 0.5 * Math.sin(x * 0.9 + z * 0.4) * Math.cos(z * 0.7 - x * 0.2)
      tmp.copy(base).lerp(k > 0.5 ? light : dark, Math.abs(k - 0.5) * 0.9)
      if (y < -0.3) tmp.lerp(dark, Math.min(0.6, -y * 0.3))
      colors.set([tmp.r, tmp.g, tmp.b], i * 3)
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.computeVertexNormals()
    const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 }))
    terrain.receiveShadow = this.quality.shadows
    scene.add(terrain)
    this.terrain = terrain

    // Actors and routes
    if (this.def.missionId === 'sojourner') this._buildPathfinder()
    else this._buildMER()

    // Rocks, kept off the routes.
    const r = rng(this.def.missionId.length * 7919)
    const rockGeo = new THREE.DodecahedronGeometry(0.22, 0)
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x5d3423, roughness: 1, flatShading: true })
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, cfg.rocks)
    const avoid = this.routeSamples
    const q = new THREE.Quaternion()
    let placed = 0
    for (let tries = 0; placed < cfg.rocks && tries < cfg.rocks * 6; tries++) {
      const x = cfg.center[0] + (r() - 0.5) * cfg.size * 0.8
      const z = cfg.center[1] + (r() - 0.5) * cfg.size * 0.8
      if (avoid.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 2.2)) continue
      const s = 0.4 + r() ** 2 * 2.2
      q.setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3))
      _m.compose(_v.set(x, this.h(x, z) + 0.05 * s, z), q, _x.set(s, s * 0.7, s))
      rocks.setMatrixAt(placed++, _m)
    }
    rocks.count = placed
    rocks.castShadow = this.quality.shadows
    scene.add(rocks)

    // Stop markers on the ground (no text: one callout at a time is shown in HTML).
    const ringGeo = new THREE.RingGeometry(0.45, 0.62, 32)
    ringGeo.rotateX(-Math.PI / 2)
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x56d9ff, transparent: true, opacity: 0.75, depthWrite: false })
    for (const p of this.stopPoints) {
      const ring = new THREE.Mesh(ringGeo, ringMat)
      ring.position.set(p.x, this.h(p.x, p.z) + 0.03, p.z)
      scene.add(ring)
    }
  }

  _routePoints(route, lift = 0.05, samples = 360) {
    const pts = []
    for (let i = 0; i <= samples; i++) {
      const p = route.pointAt((i / samples) * route.count)
      p.y += lift
      pts.push(p)
    }
    return pts
  }

  _buildMER() {
    const cfg = this.cfg
    const [lx, lz, yaw] = cfg.lander
    const lander = makeLander({ withRamp: false, withAirbags: false, deckY: 0.32 })
    lander.root.scale.setScalar(1.5)
    lander.root.position.set(lx, this.h(lx, lz), lz)
    lander.root.rotation.y = yaw
    this.scene.add(lander.root)
    this.lander = lander

    this.route = new Route(cfg.route.map((points) => ({ points })), this.h)
    const pts = this._routePoints(this.route)
    this.routeSamples = pts
    this.routeFaint = revealTube(pts, 0xe6f8ff, 0.07, 0.35)
    this.routeBright = revealTube(pts, 0x56d9ff, 0.1)
    this.scene.add(this.routeFaint, this.routeBright)
    this.stopPoints = cfg.route.map((seg) => new THREE.Vector3(seg[0][0], 0, seg[0][1]))
      .concat([new THREE.Vector3(...[cfg.route.at(-1).at(-1)[0], 0, cfg.route.at(-1).at(-1)[1]])])

    if (cfg.plan) {
      const planRoute = new Route([{ points: cfg.plan }], this.h)
      this.planLine = dashedTube(this._routePoints(planRoute, 0.08, 300), 0xffc35c, 0.08)
      this.planLine.visible = false
      this.scene.add(this.planLine)
    }
    this._placeRover(this.library.createMER())
  }

  _buildPathfinder() {
    const t = this.def.timing
    const lander = makeLander({ withRamp: true, withAirbags: true, rampDeg: t.rampDeg })
    this.scene.add(lander.root)
    this.lander = lander
    // Lander bounces from first impact A to rest at the station (origin).
    this.bounceA = new THREE.Vector3(-26, 0, -14)
    this.bounceB = new THREE.Vector3(0, 0, 0)
    const n = t.bounceCount
    const H = []
    const D = []
    for (let k = 0; k < n; k++) { H.push(3.6 * Math.pow(0.8, k)); D.push(Math.sqrt(H[k])) }
    const dSum = D.reduce((a, b) => a + b, 0)
    this.bounces = []
    let tc = t.impact
    let f = 0
    for (let k = 0; k < n; k++) {
      const dur = (D[k] / dSum) * (t.bouncesEnd - t.impact)
      const df = (D[k] / dSum) * 0.86
      this.bounces.push({ t0: tc, t1: tc + dur, f0: f, f1: f + df, h: H[k] })
      tc += dur; f += df
    }
    const span = this.bounceB.clone().sub(this.bounceA)
    span.y = 0
    this.bounceDir = span.clone().normalize()
    this.bounceLen = span.length()
    this.tumbleTotal = Math.round(this.bounceLen / (lander.airbagRadius * Math.PI * 2)) * Math.PI * 2

    // Bounce trace (contact-point arcs), revealed by time.
    const trace = []
    const samples = 420
    for (let i = 0; i <= samples; i++) {
      const tt = t.impact + (i / samples) * (t.rest - t.impact)
      const s = this._landerState(tt)
      trace.push(new THREE.Vector3(s.x, s.ground + s.lift + 0.06, s.z))
    }
    this.traceTimes = [t.impact, t.rest]
    this.bounceTrace = revealTube(trace, 0xf4fbff, 0.06)
    this.scene.add(this.bounceTrace)

    // Sojourner route: petal → ramp top → ramp foot (explicit heights) → short drive.
    const L = lander
    const foot = L.rampFoot.clone()
    this.route = new Route([
      { points: [L.petalCenter.clone(), L.rampTop.clone()], explicitY: true },
      { points: [L.rampTop.clone(), foot], explicitY: true },
      { points: [[foot.x, foot.z], [foot.x + 1.0, 0.3], [foot.x + 2.4, 1.5], [foot.x + 3.1, 3.1]] },
    ], this.h)
    const pts = this._routePoints(this.route, 0.04)
    this.routeSamples = pts.concat(trace.filter((_, i) => i % 6 === 0))
    this.routeBright = revealTube(pts, 0x56d9ff, 0.035)
    this.scene.add(this.routeBright)
    this.stopPoints = [this.bounceA.clone(), new THREE.Vector3(foot.x + 3.1, 0, 3.1)]
    this._placeRover(makeSojourner())
  }

  _placeRover(inst) {
    if (this.rover) { this.scene.remove(this.rover.root) }
    this.rover = inst
    inst.root.traverse((o) => { if (o.isMesh) o.castShadow = this.quality.shadows })
    this.scene.add(inst.root)
    this._lastT = null
  }

  /** Swap the MER fallback for the validated model at a stable point. */
  requestModelSwap() { this.pendingSwap = this.def.missionId !== 'sojourner' }

  get roverIsSimplified() { return !!this.rover?.simplified }

  setPlanVisible(v) {
    this.planVisible = v
    if (this.planLine) this.planLine.visible = v
  }

  resize(w, h) {
    this.camera.aspect = w / h
    this.camera.fov = w / h < 0.8 ? 55 : 42
    this.camera.updateProjectionMatrix()
  }

  // --------------------------------------------------------- deterministic pose

  _landerState(t) {
    const T = this.def.timing
    const A = this.bounceA
    let f = 0
    let lift = 0
    if (t < T.impact) { f = 0; lift = 28 * (1 - (t / T.impact) ** 2) }
    else if (t < T.bouncesEnd) {
      const b = this.bounces.find((bb) => t < bb.t1) ?? this.bounces[this.bounces.length - 1]
      const u = clamp((t - b.t0) / (b.t1 - b.t0), 0, 1)
      f = b.f0 + (b.f1 - b.f0) * u
      lift = b.h * 4 * u * (1 - u)
    } else f = 0.86 + 0.14 * phase(t, T.bouncesEnd, T.rest)
    const x = A.x + this.bounceDir.x * this.bounceLen * f
    const z = A.z + this.bounceDir.z * this.bounceLen * f
    return { x, z, f, lift, ground: this.h(x, z) }
  }

  _applyLander(t) {
    const T = this.def.timing
    const L = this.lander
    const s = this._landerState(t)
    const inflate = 1 - phase(t, T.rest, T.bagsEnd)
    L.setAirbags(inflate)
    L.setPetals(phase(t, T.bagsEnd, T.petalsEnd))
    L.setRamp(phase(t, T.petalsEnd, T.rampEnd))
    L.setCoreLift(THREE.MathUtils.lerp(-0.25, L.deckY, 1 - inflate))
    L.root.position.set(s.x, s.ground + s.lift + L.airbagRadius * 0.92 * inflate, s.z)
    _x.set(0, 1, 0).cross(this.bounceDir).normalize()
    L.root.quaternion.setFromAxisAngle(_x, -this.tumbleTotal * s.f * (t < T.impact ? 0 : 1))
    this.landerPos = L.root.position
    return s
  }

  _roverPose(s, outPos, outQuat) {
    const route = this.route
    route.pointAt(s, outPos)
    const ds = 0.02
    const a = route.pointAt(Math.max(0, s - ds), new THREE.Vector3())
    const b = route.pointAt(Math.min(route.count, s + ds), new THREE.Vector3())
    _f.subVectors(b, a)
    if (_f.lengthSq() < 1e-10) {
      route.pointAt(Math.min(route.count, s + 0.15), b)
      route.pointAt(Math.max(0, s - 0.15), a)
      _f.subVectors(b, a)
    }
    if (_f.lengthSq() < 1e-10) _f.set(1, 0, 0)
    _f.normalize()
    if (route.isExplicit(s)) {
      _x.set(0, 1, 0).cross(_f).normalize()
      _u.crossVectors(_f, _x).normalize()
    } else {
      // Average the surface normal over the rover footprint to avoid jitter.
      const e = 0.5
      const hx = (this.h(outPos.x + e, outPos.z) - this.h(outPos.x - e, outPos.z)) / (2 * e)
      const hz = (this.h(outPos.x, outPos.z + e) - this.h(outPos.x, outPos.z - e)) / (2 * e)
      _u.set(-hx, 1, -hz).normalize()
      _f.addScaledVector(_u, -_f.dot(_u)).normalize()
    }
    _x.crossVectors(_u, _f).normalize()
    _m.makeBasis(_x, _u, _f)
    outQuat.setFromRotationMatrix(_m)
    return _f
  }

  /** Focus point (camera target) and framing for a playhead, before smoothing. */
  _focus(t, out) {
    const T = this.def.timing
    if (this.def.missionId === 'sojourner') {
      const s = this._landerState(Math.min(t, T.rest + 0.01))
      const lp = _v.set(s.x, s.ground + Math.min(s.lift, 4) * 0.5 + 1.2, s.z)
      const rs = sampleKeys(this.def.motion.rover, t)
      const rp = this.route.pointAt(rs, new THREE.Vector3())
      const k = phase(t, T.rest + 0.4, T.petalsEnd + 0.4)
      out.pos.copy(lp).lerp(rp, k)
      out.dir.copy(this.bounceDir).lerp(_f.set(0.85, 0, 0.5).normalize(), k).normalize()
      out.frame = 1 - k
      return out
    }
    const s = sampleKeys(this.def.motion.rover, t)
    this.route.pointAt(s, out.pos)
    const a = this.route.pointAt(Math.max(0, s - 0.25), new THREE.Vector3())
    const b = this.route.pointAt(Math.min(this.route.count, s + 0.25), new THREE.Vector3())
    out.dir.subVectors(b, a).setY(0)
    if (out.dir.lengthSq() < 1e-8) out.dir.set(1, 0, 0)
    out.dir.normalize()
    out.frame = 0
    return out
  }

  /** Apply the full scene state for playhead t. Deterministic. */
  apply(t, { playing = false } = {}) {
    if (this.pendingSwap && !playing) {
      this.pendingSwap = false
      if (this.library.merReady) this._placeRover(this.library.createMER())
    }
    const T = this.def.timing
    const pathfinder = this.def.missionId === 'sojourner'
    if (pathfinder) this._applyLander(t)

    const s = sampleKeys(this.def.motion.rover, t)
    const pos = this.rover.root.position
    this._roverPose(s, pos, this.rover.root.quaternion)
    this.rover.setWheelAngle(this.route.distanceAt(s) / this.rover.wheelRadius)
    if (pathfinder) this.rover.root.visible = t >= (T.bagsEnd + T.petalsEnd) / 2

    // Progressive route reveal.
    if (this.routeBright) this.routeBright.userData.reveal(s / this.route.count)
    if (this.bounceTrace) this.bounceTrace.userData.reveal((t - this.traceTimes[0]) / (this.traceTimes[1] - this.traceTimes[0]))

    // Damped follow camera: a weighted average of focus over the recent past,
    // computed from the playhead only, so scrubbing gives the same frame.
    const acc = { pos: new THREE.Vector3(), dir: new THREE.Vector3(), frame: 0 }
    const tmp = { pos: new THREE.Vector3(), dir: new THREE.Vector3(), frame: 0 }
    let wsum = 0
    for (let k = 0; k < 8; k++) {
      const w = 8 - k
      this._focus(Math.max(0, t - k * 0.16), tmp)
      acc.pos.addScaledVector(tmp.pos, w)
      acc.dir.addScaledVector(tmp.dir, w)
      acc.frame += tmp.frame * w
      wsum += w
    }
    acc.pos.divideScalar(wsum)
    acc.dir.setY(0).normalize()
    acc.frame /= wsum
    const narrow = this.camera.aspect < 0.8
    const near = pathfinder ? { dist: 3.6, height: 1.8, side: 2.0 } : { dist: 8.2, height: 3.6, side: 4.4 }
    const far = { dist: 22, height: 6.5, side: 12 }
    const dist = THREE.MathUtils.lerp(near.dist, far.dist, acc.frame) * (narrow ? 1.35 : 1)
    const height = THREE.MathUtils.lerp(near.height, far.height, acc.frame)
    const side = THREE.MathUtils.lerp(near.side, far.side, acc.frame)
    _x.set(0, 1, 0).cross(acc.dir).normalize()
    const cam = this.camera.position.copy(acc.pos).addScaledVector(acc.dir, -dist).addScaledVector(_x, side)
    cam.y = Math.max(acc.pos.y + height, this.h(cam.x, cam.z) + 1.2)
    this.camera.lookAt(acc.pos.x, acc.pos.y + (pathfinder ? 0.4 : 0.7), acc.pos.z)
    this.camera.updateMatrixWorld()

    if (this.sun.castShadow) {
      this.sun.target.position.copy(pos)
      this.sun.position.copy(pos).add(_v.set(14, 22, 10))
      this.sun.target.updateMatrixWorld()
    }
    this._t = t
  }

  /** World anchor for a cue (callout target). */
  anchor(name, out = new THREE.Vector3()) {
    if (name === 'rover') return out.copy(this.rover.root.position).add(_v.set(0, (this.rover.dims.height || 0.5) + 0.25, 0))
    if (name === 'lander' && this.lander) return out.copy(this.lander.root.position).add(_v.set(0, 1.0, 0))
    if (name === 'ramp' && this.lander?.ramp) {
      this.lander.ramp.updateMatrixWorld(true)
      return this.lander.ramp.localToWorld(out.set(this.lander.rampLen * 0.5, 0.15, 0))
    }
    const lm = name.startsWith('landmark:') && this.cfg.landmarks[name.slice(9)]
    if (lm) return out.set(lm[0], this.h(lm[0], lm[1]) + 1.2, lm[1])
    return out.copy(this.rover.root.position)
  }

  /** True when terrain blocks the line of sight from the camera to p (ray-marched). */
  occluded(p) {
    const c = this.camera.position
    for (let i = 1; i < 24; i++) {
      const k = i / 24
      const x = c.x + (p.x - c.x) * k
      const y = c.y + (p.y - c.y) * k
      const z = c.z + (p.z - c.z) * k
      if (y < this.h(x, z) - 0.05) return true
    }
    return false
  }

  /** Screen-space radius (px) and centre of the rover, for callout placement. */
  roverScreen(size) {
    const r = this.rover.root.position
    const h = (this.rover.dims.height || 0.5) * 0.5
    _v.copy(r).setY(r.y + h).project(this.camera)
    const cx = (_v.x + 1) * 0.5 * size.w
    const cy = (1 - _v.y) * 0.5 * size.h
    const d = this.camera.position.distanceTo(r)
    const px = (Math.max(this.rover.dims.width, this.rover.dims.height, this.rover.dims.length) * 0.6 / (d * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)))) * size.h * 0.5
    return { x: cx, y: cy, r: px }
  }

  dispose() {
    this.scene.traverse((o) => {
      // Geometry and materials shared with the rover library template stay alive.
      if (o.userData.shared) return
      if (o.isInstancedMesh) o.dispose()
      o.geometry?.dispose()
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []
      for (const m of mats) if (!m.userData.shared) m.dispose()
    })
  }
}

export { smooth }
