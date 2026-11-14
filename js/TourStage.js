// Illustrative local stages for Neo's guided expedition. "Schematic · distances and
// timing simplified": terrain, spacing, crater shapes, heights and timing are presentation
// choices. The globe stays the geographic reference.
//
// Determinism: apply(fs) derives camera, rover pose, wheels, lander state, route reveal,
// science effects and lighting from the chapter playhead and cue only. Seeking to any
// time reconstructs the same frame without replaying side effects.

import * as THREE from 'three'
import { makeLander, makeSojourner } from './RoverModels.js'

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const span = (t, a, b) => smooth((t - a) / (b - a || 1))
const lerp = THREE.MathUtils.lerp
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) }

const LATE = new THREE.Vector3(0, 0, 900) // separate "Later in the mission" location

// ------------------------------------------------------------------ terrain

const crater = (cx, cz, R, depth, rim) => ({ cx, cz, R, depth, rim })
const hill = (cx, cz, h, sigma) => ({ cx, cz, h, sigma })

const WORLDS = {
  pf: {
    center: [-6, -3], size: 110, noise: 0.28, rocks: 330, flat: [[0, 0, 5], [6, 3, 2.5]], craters: [], hills: [],
    base: 0xa65a36, light: 0xc98a5c, dark: 0x6e3a24,
  },
  sp: {
    center: [16, 4], size: 140, noise: 0.32, rocks: 170, flat: [[0, 0, 3], [32, 12.3, 1.6]],
    craters: [crater(13, -9, 6.5, 2.6, 0.9)], hills: [hill(40, 18, 7, 6), hill(48, 10, 5, 5), hill(35, 26, 4.5, 5)],
    base: 0xa05a3a, light: 0xc48a62, dark: 0x6a3a26, rim: { cx: 16, cz: 4, r: 300, h: 26, w: 45 },
  },
  op: {
    center: [16, -5], size: 120, noise: 0.18, rocks: 70, flat: [[-1.6, 1.2, 1.4]],
    craters: [crater(0, 0, 6, 1.8, 0.5), crater(40, -12, 11, 3, 0.8)], hills: [],
    base: 0x8a4c34, light: 0xa86a4a, dark: 0x5a3224,
  },
}

function makeHeight(w) {
  return (x, z) => {
    let h = w.noise * (Math.sin(x * 0.31 + Math.cos(z * 0.27) * 1.3) * 0.55 + Math.sin(z * 0.19 - x * 0.13) * 0.35 +
      Math.sin((x + z) * 0.71) * 0.12 + Math.sin(x * 1.7 - z * 1.3) * 0.05)
    for (const [fx, fz, fr] of w.flat) h *= 1 - Math.exp(-((x - fx) ** 2 + (z - fz) ** 2) / (2 * fr * fr))
    for (const c of w.craters) {
      const r = Math.hypot(x - c.cx, z - c.cz) / c.R
      h += r < 1 ? -c.depth * (1 - r * r) + c.rim * r ** 6 : c.rim * Math.exp(-(((r - 1) / 0.35) ** 2))
    }
    for (const k of w.hills) h += k.h * Math.exp(-((x - k.cx) ** 2 + (z - k.cz) ** 2) / (2 * k.sigma * k.sigma))
    return h
  }
}

// Late-mission patches (local coordinates around LATE).
const lateHeight = {
  sp: (x, z) => 0.22 * Math.sin(x * 0.35) * Math.cos(z * 0.3) + 0.6 * Math.exp(-((x + 8) ** 2 + (z - 6) ** 2) / 40) - 0.05 * Math.exp(-(x * x + z * z) / 6),
  op: (x, z) => 2.6 * (1 - Math.exp(-(x * x) / 60)) + z * 0.12 + 0.15 * Math.sin(z * 0.6 + x * 0.2),
}

// ------------------------------------------------------------------ routes

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
    this.count = this.segs.length
  }
  _seg(s) { s = clamp(s, 0, this.count); const i = Math.min(this.count - 1, Math.floor(s)); return [i, s - i] }
  pointAt(s, out = new THREE.Vector3()) {
    const [i, f] = this._seg(s)
    const seg = this.segs[i]
    seg.curve.getPointAt(clamp(f, 0, 1), out)
    if (!seg.explicitY) out.y = this.heightAt(out.x, out.z)
    return out
  }
  isExplicit(s) { return this.segs[this._seg(s)[0]].explicitY }
  distanceAt(s) { const [i, f] = this._seg(s); return this.cum[i] + this.segs[i].length * clamp(f, 0, 1) }
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

function revealTube(points, color, radius, opacity = 1) {
  const radial = 6
  const tubular = points.length - 1
  const geo = new THREE.TubeGeometry(new PolylineCurve(points), tubular, radius, radial, false)
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 }))
  mesh.userData.reveal = (f) => geo.setDrawRange(0, Math.floor(clamp(f, 0, 1) * tubular) * radial * 6)
  return mesh
}

function dashedTube(points, color, radius, every = 8, len = 5) {
  const g = new THREE.Group()
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 })
  for (let i = 0; i < points.length - 1; i += every) {
    const chunk = points.slice(i, Math.min(points.length, i + len))
    if (chunk.length >= 2) g.add(new THREE.Mesh(new THREE.TubeGeometry(new PolylineCurve(chunk), chunk.length * 2, radius, 6, false), mat))
  }
  return g
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  draw(c.getContext('2d'), w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// -------------------------------------------------------------------- sky

const SKY = {
  day: { top: [0.5, 0.36, 0.27], hor: [0.86, 0.67, 0.5], sun: [1.0, 0.92, 0.8] },
  dawn: { top: [0.13, 0.1, 0.16], hor: [0.5, 0.6, 0.72], sun: [0.75, 0.88, 1.0] },
  winter: { top: [0.16, 0.12, 0.11], hor: [0.36, 0.27, 0.22], sun: [0.55, 0.48, 0.42] },
  storm: { top: [0.2, 0.13, 0.08], hor: [0.4, 0.27, 0.17], sun: [0.35, 0.25, 0.16] },
}

function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0.5, 0.4, -0.6).normalize() }, sunCol: { value: new THREE.Color() }, sunAmt: { value: 1 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol; uniform float sunAmt; varying vec3 vDir;
      void main(){ float h = clamp(vDir.y, 0.0, 1.0); vec3 c = mix(hor, top, pow(h, 0.55));
        float s = max(dot(normalize(vDir), sunDir), 0.0); c += sunCol * sunAmt * (pow(s, 600.0) * 1.6 + pow(s, 10.0) * 0.22);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(260, 32, 16), mat)
  mesh.frustumCulled = false
  mesh.renderOrder = -10
  return mesh
}

// ------------------------------------------------------------------ the stage

const _v = new THREE.Vector3()
const _f = new THREE.Vector3()
const _u = new THREE.Vector3()
const _x = new THREE.Vector3()
const _m = new THREE.Matrix4()

export class TourStage {
  /**
   * @param {{chapterId, run, library, quality, approvals}} o
   * run: chapterRun() output (cues with absolute start times).
   */
  constructor({ chapterId, run, library, quality = { shadows: true, segments: 170 }, approvals = {} }) {
    this.id = chapterId
    this.run = run
    this.library = library
    this.quality = quality
    this.approvals = approvals
    this.cueStart = Object.fromEntries(run.cues.map((c) => [c.id, c]))
    this.world = WORLDS[chapterId]
    this.h = makeHeight(this.world)
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 600)
    this.pendingSwap = false
    this.planVisible = false
    this.outlines = {}
    this.anchors = {}
    this.proxies = {} // invisible, generous tap targets for required interactions
    this._build()
    this._buildRoverTimeline()
  }

  // ------------------------------------------------------------ construction

  _build() {
    const w = this.world
    const scene = this.scene
    this.sky = makeSky()
    scene.add(this.sky)
    scene.fog = new THREE.Fog(0xd8a77e, 45, 170)
    this.hemi = new THREE.HemisphereLight(0xfbe6d2, 0x5a3424, 1.15)
    scene.add(this.hemi)
    const sun = new THREE.DirectionalLight(0xfff1df, 2.3)
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

    this.terrain = this._terrainMesh(this.h, w.center[0], w.center[1], w.size, this.quality.segments, w)
    scene.add(this.terrain)
    // Distant ground so wide and orbital shots never show the edge of the local patch.
    const far = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshStandardMaterial({ color: w.base, roughness: 1 }))
    far.rotation.x = -Math.PI / 2
    far.position.set(w.center[0], -0.45, w.center[1])
    far.receiveShadow = false
    scene.add(far)
    if (w.rim) scene.add(this._rimMesh(w))

    if (this.id === 'pf') this._buildPF()
    else if (this.id === 'sp') this._buildSP()
    else this._buildOP()

    this._rocks(this.terrain, this.h, w.center, w.size, w.rocks, this.avoid || [])
  }

  _terrainMesh(h, cx, cz, size, n, colors, offset = new THREE.Vector3()) {
    const geo = new THREE.PlaneGeometry(size, size, n, n)
    geo.rotateX(-Math.PI / 2)
    geo.translate(cx, 0, cz)
    const pos = geo.attributes.position
    const col = new Float32Array(pos.count * 3)
    const base = new THREE.Color(colors.base)
    const light = new THREE.Color(colors.light)
    const dark = new THREE.Color(colors.dark)
    const tmp = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const y = h(x, z)
      pos.setY(i, y)
      const k = 0.5 + 0.5 * Math.sin(x * 0.9 + z * 0.4) * Math.cos(z * 0.7 - x * 0.2)
      tmp.copy(base).lerp(k > 0.5 ? light : dark, Math.abs(k - 0.5) * 0.9)
      if (y < -0.3) tmp.lerp(dark, Math.min(0.6, -y * 0.3))
      col.set([tmp.r, tmp.g, tmp.b], i * 3)
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    geo.computeVertexNormals()
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 }))
    mesh.receiveShadow = this.quality.shadows
    mesh.position.copy(offset)
    return mesh
  }

  _rimMesh(w) {
    const { cx, cz, r, h: rh, w: rw } = w.rim
    const geo = new THREE.RingGeometry(68, 470, 96, 14)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const rr = Math.hypot(x, z)
      const a = Math.atan2(z, x)
      pos.setY(i, rh * Math.exp(-(((rr - r) / rw) ** 2)) * (0.75 + 0.25 * Math.sin(a * 7)) - 0.6 + Math.max(0, 1 - (rr - 68) / 30) * 0.6)
    }
    geo.translate(cx, 0, cz)
    geo.computeVertexNormals()
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x8e5236, roughness: 1 }))
  }

  _rocks(mesh, h, center, size, count, avoid) {
    const r = rng(this.id.charCodeAt(0) * 7919 + count)
    const geo = new THREE.DodecahedronGeometry(0.22, 0)
    const mat = new THREE.MeshStandardMaterial({ color: 0x5d3423, roughness: 1, flatShading: true })
    const rocks = new THREE.InstancedMesh(geo, mat, count)
    const q = new THREE.Quaternion()
    let placed = 0
    for (let tries = 0; placed < count && tries < count * 8; tries++) {
      const x = center[0] + (r() - 0.5) * size * 0.85
      const z = center[1] + (r() - 0.5) * size * 0.85
      if (avoid.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 2.4)) continue
      const s = 0.4 + r() ** 2 * 2.2
      q.setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3))
      _m.compose(_v.set(x, h(x, z) + 0.05 * s, z), q, _x.set(s, s * 0.7, s))
      rocks.setMatrixAt(placed++, _m)
    }
    rocks.count = placed
    rocks.castShadow = this.quality.shadows
    this.scene.add(rocks)
  }

  _routePoints(route, lift = 0.05, samples = 360) {
    const pts = []
    for (let i = 0; i <= samples; i++) { const p = route.pointAt((i / samples) * route.count); p.y += lift; pts.push(p) }
    return pts
  }

  /** Invisible pick proxy (material.visible = false still raycasts). */
  _proxy(name, geo, pos, scene = this.scene, scale = null) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false }))
    m.position.copy(pos)
    if (scale) m.scale.copy(scale)
    m.userData.tapTarget = name
    scene.add(m)
    this.proxies[name] = m
    return m
  }

  /** True if the ray hits the named interaction target in the active scene. */
  hitTest(name, raycaster) {
    const m = this.proxies[name]
    if (!m || m.parent !== this.activeScene) return false
    m.updateMatrixWorld(true)
    return raycaster.intersectObject(m, false).length > 0
  }

  /** Highlight shell for the emphasised object: a cyan outline + emissive pulse. */
  _outline(name, mesh, scale = 1.14) {
    const shell = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ color: 0x5ff4ff, side: THREE.BackSide, transparent: true, opacity: 0 }))
    shell.scale.setScalar(scale)
    shell.renderOrder = 2
    mesh.add(shell)
    this.outlines[name] = shell
  }

  _placeRover(inst) {
    if (this.rover) this.roverHolder.remove(this.rover.root)
    this.rover = inst
    inst.root.traverse((o) => { if (o.isMesh) o.castShadow = this.quality.shadows })
    this.roverHolder.add(inst.root)
  }

  // --------------------------------------------------------- Pathfinder world

  _buildPF() {
    const rampFact = 20
    const L = makeLander({ withRamp: true, withAirbags: true, rampDeg: rampFact })
    this.scene.add(L.root)
    this.lander = L
    this.bounceA = new THREE.Vector3(-26, 0, -14)
    this.bounceB = new THREE.Vector3(0, 0, 0)
    const bc = this.cueStart['pf-bounce']
    const count = 15
    const H = []
    const D = []
    for (let k = 0; k < count; k++) { H.push(3.6 * Math.pow(0.8, k)); D.push(Math.sqrt(H[k])) }
    const dSum = D.reduce((a, b) => a + b, 0)
    const t0 = 0.6
    const t1 = 11.5
    this.bounces = []
    let tc = t0
    let f = 0
    for (let k = 0; k < count; k++) {
      const dur = (D[k] / dSum) * (t1 - t0)
      const df = (D[k] / dSum) * 0.86
      this.bounces.push({ t0: tc, t1: tc + dur, f0: f, f1: f + df, h: H[k] })
      tc += dur; f += df
    }
    this.bounceRoll = [t1, 14.2]
    const span2 = this.bounceB.clone().sub(this.bounceA)
    this.bounceDir = span2.clone().setY(0).normalize()
    this.bounceLen = span2.length()
    this.tumble = Math.round(this.bounceLen / (L.airbagRadius * Math.PI * 2)) * Math.PI * 2
    // Lander trace (pale), revealed with the bounce.
    const trace = []
    for (let i = 0; i <= 400; i++) {
      const τ = t0 + (i / 400) * (this.bounceRoll[1] - t0)
      const s = this._landerAt(τ)
      trace.push(new THREE.Vector3(s.x, s.ground + s.lift + 0.06, s.z))
    }
    this.bounceTrace = revealTube(trace, 0xf4fbff, 0.06)
    this.scene.add(this.bounceTrace)
    void bc

    // Sojourner: petal → ramp top → ramp foot → pebbles (s=3) → dust area (s=4).
    const foot = L.rampFoot.clone()
    this.route = new Route([
      { points: [L.petalCenter.clone(), L.rampTop.clone()], explicitY: true },
      { points: [L.rampTop.clone(), foot], explicitY: true },
      { points: [[foot.x, foot.z], [foot.x + 1.0, 0.3], [4.4, 1.5], [5.3, 2.5]] },
      { points: [[5.3, 2.5], [6.6, 3.9], [7.9, 5.6]] },
    ], this.h)
    const pts = this._routePoints(this.route, 0.04)
    this.routeBright = revealTube(pts, 0x56d9ff, 0.035)
    this.scene.add(this.routeBright)
    this.avoid = pts.concat(trace.filter((_, i) => i % 6 === 0))
    this.roverHolder = new THREE.Group()
    this.scene.add(this.roverHolder)
    this._placeRover(makeSojourner())

    // Pebble field: rounded pebbles beside angular rocks; one featured pebble.
    const pebbleMat = new THREE.MeshStandardMaterial({ color: 0xb98466, roughness: 0.55 })
    const r = rng(42)
    const pebGeo = new THREE.SphereGeometry(1, 24, 16)
    for (let i = 0; i < 26; i++) {
      const x = 6.1 + (r() - 0.5) * 2.4
      const z = 2.0 + (r() - 0.5) * 2.0
      if (Math.hypot(x - 5.95, z - 1.95) < 0.35) continue
      const p = new THREE.Mesh(pebGeo, pebbleMat)
      const s = 0.06 + r() * 0.08
      p.scale.set(s * 1.25, s * 0.8, s)
      p.rotation.y = r() * 3
      p.position.set(x, this.h(x, z) + s * 0.6, z)
      p.castShadow = this.quality.shadows
      this.scene.add(p)
    }
    const angular = new THREE.MeshStandardMaterial({ color: 0x5a3324, roughness: 1, flatShading: true })
    for (let i = 0; i < 8; i++) {
      const x = 6.4 + (r() - 0.5) * 3
      const z = 2.5 + (r() - 0.5) * 2.6
      const a = new THREE.Mesh(new THREE.TetrahedronGeometry(0.12 + r() * 0.08, 0), angular)
      a.position.set(x, this.h(x, z) + 0.06, z)
      a.rotation.set(r() * 3, r() * 3, r() * 3)
      this.scene.add(a)
    }
    const peb = new THREE.Mesh(pebGeo, new THREE.MeshStandardMaterial({ color: 0xc89474, roughness: 0.45, emissive: 0x0b2a30, emissiveIntensity: 0 }))
    peb.scale.set(0.2, 0.13, 0.16)
    peb.position.set(5.95, this.h(5.95, 1.95) + 0.11, 1.95)
    peb.castShadow = this.quality.shadows
    this.scene.add(peb)
    this._outline('pebble', peb, 1.18)
    this.pebble = peb
    this.anchors.pebble = peb.position.clone()
    this._proxy('pebble', new THREE.SphereGeometry(0.42, 12, 8), peb.position)

    // Magnified dust sample (separate illustration scene).
    this._buildDustSample()

    // Clouds for the dawn reveal.
    const cloudTex = canvasTexture(256, 128, (g, W, Hh) => {
      for (let i = 0; i < 40; i++) {
        const x = W * (0.1 + Math.random() * 0.8)
        const y = Hh * (0.35 + Math.random() * 0.3)
        const rr = 18 + Math.random() * 30
        const grd = g.createRadialGradient(x, y, 0, x, y, rr)
        grd.addColorStop(0, 'rgba(225,240,255,0.55)'); grd.addColorStop(1, 'rgba(225,240,255,0)')
        g.fillStyle = grd; g.fillRect(0, 0, W, Hh)
      }
    })
    this.clouds = new THREE.Group()
    const cr = rng(7)
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(70, 24), new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false }))
      m.rotation.x = Math.PI / 2
      m.position.set(-20 + (cr() - 0.5) * 120, 34 + cr() * 8, -40 + (cr() - 0.5) * 90)
      m.rotation.z = cr() * 3
      this.clouds.add(m)
    }
    this.scene.add(this.clouds)
    this.anchors.clouds = new THREE.Vector3(-14, 34, -30)

    // Signal pulses toward Earth.
    this.pulses = new THREE.Group()
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 8, 40), new THREE.MeshBasicMaterial({ color: 0x8ff6ff, transparent: true, opacity: 0, fog: false }))
      this.pulses.add(ring)
    }
    this.scene.add(this.pulses)
    this.anchors.site = new THREE.Vector3(0, 0.6, 0)
  }

  _buildDustSample() {
    const s = new THREE.Scene()
    s.background = new THREE.Color(0x160d0b)
    s.add(new THREE.HemisphereLight(0xffe2cc, 0x2a1410, 1.2))
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(2, 3, 4)
    s.add(key)
    const cam = new THREE.PerspectiveCamera(40, 1, 0.05, 60)
    const r = rng(1234)
    const N = 240
    const geo = new THREE.IcosahedronGeometry(1, 0)
    const mat = new THREE.MeshStandardMaterial({ color: 0xc27a52, roughness: 0.8, flatShading: true })
    const inst = new THREE.InstancedMesh(geo, mat, N)
    this.dust = { scene: s, camera: cam, inst, N, base: [], phase: [], size: [], pole: [], magnetic: [] }
    for (let i = 0; i < N; i++) {
      this.dust.base.push(new THREE.Vector3((r() - 0.5) * 3.2 - 0.4, (r() - 0.5) * 1.8, (r() - 0.5) * 1.4))
      this.dust.phase.push(r() * 6.28)
      this.dust.size.push(0.018 + r() * 0.03)
      this.dust.pole.push(r() < 0.5 ? 0 : 1)
      this.dust.magnetic.push(r() < 0.85)
    }
    s.add(inst)
    // Horseshoe magnet: red arc with silver pole tips, opening toward the dust.
    const magnet = new THREE.Group()
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.11, 12, 32, Math.PI), new THREE.MeshStandardMaterial({ color: 0xd8302a, roughness: 0.5 }))
    arc.rotation.z = -Math.PI / 2
    magnet.add(arc)
    for (const y of [0.42, -0.42]) {
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.22), new THREE.MeshStandardMaterial({ color: 0xd9dde3, metalness: 0.6, roughness: 0.3 }))
      tip.position.set(-0.14, y, 0)
      magnet.add(tip)
    }
    magnet.position.set(1.9, 0, 0)
    s.add(magnet)
    this.magnetArc = arc
    this._proxy('magnet', new THREE.SphereGeometry(0.75, 12, 8), magnet.position, s)
    this.dust.magnet = magnet
    this.dust.poles = [new THREE.Vector3(1.62, 0.42, 0), new THREE.Vector3(1.62, -0.42, 0)]
  }

  // --------------------------------------------------------------- Spirit world

  _buildSP() {
    const lander = makeLander({ withRamp: false, withAirbags: false, deckY: 0.32 })
    lander.root.scale.setScalar(1.5)
    lander.root.position.set(0, this.h(0, 0), 0)
    lander.root.rotation.y = -0.4
    this.scene.add(lander.root)
    this.lander = lander
    this.route = new Route([
      { points: [[1.4, 0], [3.2, -1.2]] },
      { points: [[3.2, -1.2], [5.5, -3.6], [7.66, -5.3]] },
      { points: [[7.66, -5.3], [8.4, -1.6], [12, 1.6], [18, 4.6]] },
      { points: [[18, 4.6], [24, 7.8], [29, 10.6]] },
      { points: [[29, 10.6], [30.4, 11.5], [31.4, 12.0]] },
    ], this.h)
    const pts = this._routePoints(this.route)
    this.routeFaint = revealTube(pts, 0xe6f8ff, 0.07, 0.3)
    this.routeBright = revealTube(pts, 0x56d9ff, 0.1)
    this.scene.add(this.routeFaint, this.routeBright)
    this.avoid = pts
    const planPts = this._routePoints(new Route([{ points: [[1.4, 0.8], [5, 0.2], [9.6, -1.6], [16, -2.6], [25, 3.2], [31, 9.4]] }], this.h), 0.08, 300)
    this.planLine = dashedTube(planPts, 0xffc35c, 0.08)
    this.planLine.visible = false
    this.scene.add(this.planLine)
    this.roverHolder = new THREE.Group()
    this.scene.add(this.roverHolder)
    this._placeRover(this.library.createMER())

    // Possible-lake overlay (hypothesis), shown only in the basin establishing shot.
    const lake = new THREE.Mesh(new THREE.CircleGeometry(240, 96), new THREE.MeshBasicMaterial({ color: 0x5aa8d8, transparent: true, opacity: 0, depthWrite: false, fog: false }))
    lake.rotation.x = -Math.PI / 2
    lake.position.set(16, 2.5, 4)
    lake.renderOrder = 3
    this.scene.add(lake)
    const shore = []
    for (let i = 0; i <= 240; i++) { const a = (i / 240) * Math.PI * 2; shore.push(new THREE.Vector3(16 + Math.cos(a) * 240, 3, 4 + Math.sin(a) * 240)) }
    this.shore = dashedTube(shore, 0x9fe8ff, 1.1, 4, 3)
    this.shore.traverse((o) => { if (o.material) { o.material.fog = false; o.material.opacity = 0 } })
    this.scene.add(this.shore)
    this.lake = lake
    this.anchors.lake = new THREE.Vector3(16 - 120, 4, 4 - 90)
    this.anchors.bonneville = new THREE.Vector3(13, this.h(13, -9) + 1.2, -9)
    this.anchors.hills = new THREE.Vector3(40, this.h(40, 18) + 1.2, 18)

    // Columbia Hills specimen: a rock with pale alteration veins (illustration).
    const veins = canvasTexture(256, 256, (g, W, Hh) => {
      g.fillStyle = '#6b4a3a'; g.fillRect(0, 0, W, Hh)
      const r = rng(9)
      for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${90 + r() * 60},${60 + r() * 40},${45 + r() * 30},0.5)`; g.fillRect(r() * W, r() * Hh, 2, 2) }
      g.strokeStyle = 'rgba(236,224,196,0.85)'; g.lineWidth = 3
      for (let i = 0; i < 9; i++) { g.beginPath(); let x = r() * W; let y = 0; g.moveTo(x, y); while (y < Hh) { x += (r() - 0.5) * 40; y += 14; g.lineTo(x, y) } g.stroke() }
    })
    const spec = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55, 1), new THREE.MeshStandardMaterial({ map: veins, roughness: 0.85, emissive: 0x0b2a30, emissiveIntensity: 0 }))
    spec.scale.set(1.1, 0.75, 0.9)
    spec.position.set(32.4, this.h(32.4, 12.6) + 0.32, 12.6)
    spec.castShadow = this.quality.shadows
    this.scene.add(spec)
    this._outline('specimen', spec, 1.1)
    this.anchors.specimen = spec.position.clone()
    this._proxy('specimen', new THREE.SphereGeometry(0.95, 12, 8), spec.position)

    // Later in the mission: soft-soil patch, separate location (no connecting track).
    const lh = (x, z) => lateHeight.sp(x - LATE.x, z - LATE.z)
    this.late = new THREE.Group()
    this.late.add(this._terrainMesh(lh, LATE.x, LATE.z, 70, 90, { base: 0x9a6a4a, light: 0xd9b48a, dark: 0x6a4a36 }))
    const sand = new THREE.Mesh(new THREE.CircleGeometry(2.6, 40), new THREE.MeshStandardMaterial({ color: 0xe2c49c, roughness: 1 }))
    sand.rotation.x = -Math.PI / 2
    sand.position.set(LATE.x, lh(LATE.x, LATE.z) + 0.02, LATE.z)
    this.late.add(sand)
    this.scene.add(this.late)
    this.lateHeight = lh
    this.anchors.wheel = new THREE.Vector3(LATE.x + 0.55, lh(LATE.x, LATE.z) + 0.15, LATE.z + 0.6)
  }

  // ----------------------------------------------------------- Opportunity world

  _buildOP() {
    const lander = makeLander({ withRamp: false, withAirbags: false, deckY: 0.32 })
    lander.root.scale.setScalar(1.5)
    lander.root.position.set(-1.6, this.h(-1.6, 1.2), 1.2)
    lander.root.rotation.y = 0.6
    this.scene.add(lander.root)
    this.lander = lander
    this.route = new Route([
      { points: [[-0.2, 0.6], [1.2, -0.2]] },
      { points: [[1.2, -0.2], [2.5, -0.8], [3.6, -1.4]] },
      { points: [[3.6, -1.4], [4.7, -1.9], [5.6, -2.4]] },
      { points: [[5.6, -2.4], [9, -3.6], [16, -5.6]] },
      { points: [[16, -5.6], [23, -7.6], [29.4, -9.1]] },
    ], this.h)
    const pts = this._routePoints(this.route)
    this.routeFaint = revealTube(pts, 0xe6f8ff, 0.07, 0.3)
    this.routeBright = revealTube(pts, 0x56d9ff, 0.1)
    this.scene.add(this.routeFaint, this.routeBright)
    this.avoid = pts
    this.roverHolder = new THREE.Group()
    this.scene.add(this.roverHolder)
    this._placeRover(this.library.createMER())

    // Landing outcrop: a layered band on Eagle Crater's inner wall.
    const strata = canvasTexture(512, 64, (g, W, Hh) => {
      const r = rng(3)
      for (let y = 0; y < Hh; y += 4) { const v = 150 + r() * 50; g.fillStyle = `rgb(${v},${v * 0.72},${v * 0.55})`; g.fillRect(0, y, W, 4) }
    })
    const pos = []
    const uvs = []
    const idx = []
    const a0 = 1.95
    const a1 = 2.75
    const N = 30
    for (let i = 0; i <= N; i++) {
      const a = a0 + (a1 - a0) * (i / N)
      for (const [rr, dy, v] of [[4.3, 0.15, 0], [5.2, 0.6, 1]]) {
        const x = Math.cos(a) * rr
        const z = Math.sin(a) * rr
        pos.push(x, this.h(x, z) + dy, z)
        uvs.push(i / N, v)
      }
      if (i < N) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3) }
    }
    const og = new THREE.BufferGeometry()
    og.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    og.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    og.setIndex(idx)
    og.computeVertexNormals()
    const outcrop = new THREE.Mesh(og, new THREE.MeshStandardMaterial({ map: strata, roughness: 0.9, side: THREE.DoubleSide, emissive: 0x0b2a30, emissiveIntensity: 0 }))
    this.scene.add(outcrop)
    this.outcrop = outcrop
    const mid = (a0 + a1) / 2
    this.anchors.outcrop = new THREE.Vector3(Math.cos(mid) * 4.8, this.h(Math.cos(mid) * 4.8, Math.sin(mid) * 4.8) + 0.5, Math.sin(mid) * 4.8)
    if (this.approvals.opOutcrop) {
      const sph = new THREE.InstancedMesh(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshStandardMaterial({ color: 0x3a3a48, roughness: 0.4 }), 60)
      const r = rng(11)
      for (let i = 0; i < 60; i++) {
        const a = a0 + r() * (a1 - a0)
        const rr = 4.35 + r() * 0.8
        const x = Math.cos(a) * rr
        const z = Math.sin(a) * rr
        _m.makeTranslation(x, this.h(x, z) + 0.2 + r() * 0.3, z)
        sph.setMatrixAt(i, _m)
      }
      this.scene.add(sph)
    }
    // Mineral clue overlay seen from above (illustration).
    const mineral = new THREE.Mesh(new THREE.CircleGeometry(48, 64), new THREE.MeshBasicMaterial({ color: 0x8a7ad8, transparent: true, opacity: 0, depthWrite: false, fog: false }))
    mineral.rotation.x = -Math.PI / 2
    mineral.position.set(14, 1.2, -6)
    mineral.renderOrder = 3
    this.scene.add(mineral)
    this.mineral = mineral
    this.anchors.plains = new THREE.Vector3(14, 1.5, -6)
    this.anchors.eagleExit = new THREE.Vector3(5.6, this.h(5.6, -2.4) + 1.2, -2.4)
    this.anchors.eagleCrater = new THREE.Vector3(0, this.h(0, 0) + 0.5, 0)
    this.anchors.endurance = new THREE.Vector3(40, this.h(40, -12) + 1.5, -12)
    this._proxy('outcrop', new THREE.SphereGeometry(1.5, 12, 8), this.anchors.outcrop)
    this._proxy('eagleCrater', new THREE.SphereGeometry(1, 16, 8), new THREE.Vector3(0, -0.6, 0), this.scene, new THREE.Vector3(6.6, 1.6, 6.6))
    // Rim highlight shown while the visitor is asked to look back at Eagle Crater.
    const rimPts = []
    for (let i = 0; i <= 120; i++) { const a = (i / 120) * Math.PI * 2; const x = Math.cos(a) * 6; const z = Math.sin(a) * 6; rimPts.push(new THREE.Vector3(x, this.h(x, z) + 0.25, z)) }
    this.rimRing = revealTube(rimPts, 0x5ff4ff, 0.09, 0.9)
    this.rimRing.visible = false
    this.scene.add(this.rimRing)

    // Later: Perseverance Valley (separate location) with an illustrated dust storm.
    const lh = (x, z) => lateHeight.op(x - LATE.x, z - LATE.z)
    this.late = new THREE.Group()
    this.late.add(this._terrainMesh(lh, LATE.x, LATE.z, 80, 90, { base: 0x8c5a3e, light: 0xb07a56, dark: 0x5c3a28 }))
    this.scene.add(this.late)
    this.lateHeight = lh
    const N2 = 700
    const dg = new THREE.BufferGeometry()
    const dp = new Float32Array(N2 * 3)
    const r2 = rng(77)
    this.stormBase = []
    for (let i = 0; i < N2; i++) this.stormBase.push([(r2() - 0.5) * 40, r2() * 12, (r2() - 0.5) * 40])
    dg.setAttribute('position', new THREE.BufferAttribute(dp, 3))
    this.storm = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xd2a070, size: 0.12, transparent: true, opacity: 0, depthWrite: false }))
    this.storm.frustumCulled = false
    this.scene.add(this.storm)
    this.anchors.sky = new THREE.Vector3(LATE.x - 6, 9, LATE.z - 14)
  }

  // ------------------------------------------------------- rover timeline (pure)

  _buildRoverTimeline() {
    const segs = []
    for (const c of this.run.cues) for (const r of c.rover || []) segs.push({ t0: c.start + r.start, t1: c.start + r.end, s0: r.from, s1: r.to })
    segs.sort((a, b) => a.t0 - b.t0)
    this.roverSegs = segs
    this.roverS0 = this.id === 'pf' ? 0 : 0
  }

  roverS(t) {
    let s = this.roverS0
    for (const g of this.roverSegs) {
      if (t < g.t0) break
      s = t >= g.t1 ? g.s1 : lerp(g.s0, g.s1, smooth((t - g.t0) / (g.t1 - g.t0)))
    }
    // Pathfinder: Sojourner rolls down the ramp inside pf-ramp.
    if (this.id === 'pf') {
      const c = this.cueStart['pf-ramp']
      if (c) {
        const τ = t - c.start
        if (τ >= 6.2) s = Math.max(s, τ >= 12 ? 2 : lerp(0, 2, smooth((τ - 6.2) / 5.8)))
        if (t >= c.end) s = Math.max(s, 2)
      }
    }
    return s
  }

  // ---------------------------------------------------------------- lander

  _landerAt(τ) {
    const A = this.bounceA
    let f = 0
    let lift = 0
    const first = this.bounces[0].t0
    const lastB = this.bounces[this.bounces.length - 1].t1
    if (τ < first) { f = 0; lift = 28 * (1 - Math.max(0, τ + 1.5) / (first + 1.5)) ** 2 }
    else if (τ < lastB) {
      const b = this.bounces.find((bb) => τ < bb.t1) ?? this.bounces[this.bounces.length - 1]
      const u = clamp((τ - b.t0) / (b.t1 - b.t0), 0, 1)
      f = b.f0 + (b.f1 - b.f0) * u
      lift = b.h * 4 * u * (1 - u)
    } else f = 0.86 + 0.14 * span(τ, this.bounceRoll[0], this.bounceRoll[1])
    const x = A.x + this.bounceDir.x * this.bounceLen * f
    const z = A.z + this.bounceDir.z * this.bounceLen * f
    return { x, z, f, lift, ground: this.h(x, z) }
  }

  _applyLander(t) {
    const L = this.lander
    const arr = this.cueStart['pf-arrival']
    const bc = this.cueStart['pf-bounce']
    const rc = this.cueStart['pf-ramp']
    // Lander appears in the last seconds of pf-arrival, falls, bounces in pf-bounce.
    const τb = bc ? t - bc.start : 99
    const visible = !arr || t >= arr.end - 1.6
    L.root.visible = visible
    const s = this._landerAt(Math.min(Math.max(τb, -1.5), 20))
    const τr = rc ? t - rc.start : (t > (bc?.end ?? 0) ? 99 : -1)
    const inflate = 1 - span(τr, 0, 1.4)
    L.setAirbags(inflate)
    L.setPetals(span(τr, 1.4, 3.0))
    L.setRamp(span(τr, 3.0, 4.6))
    L.setCoreLift(lerp(-0.25, L.deckY, 1 - inflate))
    L.root.position.set(s.x, s.ground + s.lift + L.airbagRadius * 0.92 * inflate, s.z)
    _x.set(0, 1, 0).cross(this.bounceDir).normalize()
    L.root.quaternion.setFromAxisAngle(_x, τb < this.bounces[0].t0 ? 0 : -this.tumble * s.f)
    this.bounceTrace.userData.reveal((τb - this.bounces[0].t0) / (this.bounceRoll[1] - this.bounces[0].t0))
    // The lander trace belongs to the landing; it is not shown with later beats.
    const late = this.cueStart['pf-pebble-look']
    this.bounceTrace.visible = !late || t < late.start
    this.anchors.lander = L.root.position.clone().add(_v.set(0, 1.4, 0))
    L.ramp.updateMatrixWorld(true)
    this.anchors.ramp = L.ramp.localToWorld(new THREE.Vector3(0.1, 0.15, 0.2))
    return τr
  }

  // --------------------------------------------------------------- rover pose

  _roverPose(s, outPos, outQuat) {
    const route = this.route
    route.pointAt(s, outPos)
    const a = route.pointAt(Math.max(0, s - 0.02), new THREE.Vector3())
    const b = route.pointAt(Math.min(route.count, s + 0.02), new THREE.Vector3())
    _f.subVectors(b, a)
    if (_f.lengthSq() < 1e-10) { route.pointAt(Math.min(route.count, s + 0.15), b); route.pointAt(Math.max(0, s - 0.15), a); _f.subVectors(b, a) }
    if (_f.lengthSq() < 1e-10) _f.set(1, 0, 0)
    _f.normalize()
    if (route.isExplicit(s)) {
      _x.set(0, 1, 0).cross(_f).normalize()
      _u.crossVectors(_f, _x).normalize()
    } else this._groundBasis(outPos, this.h)
    _x.crossVectors(_u, _f).normalize()
    _m.makeBasis(_x, _u, _f)
    outQuat.setFromRotationMatrix(_m)
  }

  /** Up = averaged surface normal; forward = tangent projected onto the ground plane. */
  _groundBasis(p, h) {
    const e = 0.5
    const hx = (h(p.x + e, p.z) - h(p.x - e, p.z)) / (2 * e)
    const hz = (h(p.x, p.z + e) - h(p.x, p.z - e)) / (2 * e)
    _u.set(-hx, 1, -hz).normalize()
    _f.addScaledVector(_u, -_f.dot(_u)).normalize()
  }

  requestModelSwap() { this.pendingSwap = this.id !== 'pf' }
  get roverIsSimplified() { return !!this.rover?.simplified }
  setPlanVisible(v) { this.planVisible = v; if (this.planLine) this.planLine.visible = v }

  resize(w, h) {
    this.aspect = w / h
    for (const cam of [this.camera, this.dust?.camera].filter(Boolean)) {
      cam.aspect = w / h
      cam.fov = w / h < 0.8 ? 58 : 45
      cam.updateProjectionMatrix()
    }
  }

  // --------------------------------------------------------------------- shots

  /** Camera {pos, look} for a cue at cue time τ, given scene state. */
  _shot(c, τ, st) {
    const narrow = (this.aspect ?? 1.6) < 0.8 ? 1.35 : 1
    const P = (x, y, z) => new THREE.Vector3(x, y, z)
    const follow = (dist, height, side, lookY = 0.6) => {
      const s = st.s
      const p = this.route.pointAt(s, new THREE.Vector3())
      const a = this.route.pointAt(Math.max(0, s - 0.3), new THREE.Vector3())
      const b = this.route.pointAt(Math.min(this.route.count, s + 0.3), new THREE.Vector3())
      const dir = b.sub(a).setY(0)
      if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0)
      dir.normalize()
      const lat = new THREE.Vector3(0, 1, 0).cross(dir).normalize()
      const pos = p.clone().addScaledVector(dir, -dist * narrow).addScaledVector(lat, side).add(P(0, height, 0))
      return { pos, look: p.clone().add(P(0, lookY, 0)) }
    }
    switch (c.shot) {
      case 'establish': return { pos: P(lerp(-46, -38, τ / c.duration), 24, 34), look: P(-10, 0, -6) }
      case 'followLander': {
        const L = this.lander.root.position
        return { pos: P(L.x - 6, 9, L.z + 19), look: P(L.x + 4, Math.min(L.y, 3) + 0.5, L.z + 1) }
      }
      case 'ramp': {
        const k = span(τ, 5.5, 11)
        return { pos: P(lerp(4.6, 4.2, k), lerp(2.6, 1.5, k), lerp(3.8, 3.4, k)), look: P(lerp(0.9, 2.0, k), 0.35, lerp(0, 0.4, k)) }
      }
      case 'driveToPebble': {
        if (τ < 7.0) return follow(3.6, 1.8, 2.0, 0.3)
        const k = span(τ, 7.0, 8.6)
        const f = follow(3.6, 1.8, 2.0, 0.3)
        const low = { pos: P(6.95, 0.6, 1.15), look: this.anchors.pebble.clone() }
        return { pos: f.pos.lerp(low.pos, k), look: f.look.lerp(low.look, k) }
      }
      case 'pebble': {
        // From the far side of the pebble so Sojourner never blocks it.
        const a = -0.55 - 0.2 * smooth(τ / c.duration)
        const p = this.anchors.pebble
        return { pos: P(p.x + Math.cos(a) * 1.1, p.y + 0.42, p.z + Math.sin(a) * 1.1), look: p.clone() }
      }
      case 'dust': {
        if (τ < (c.cutAt ?? 4.5)) {
          const f = follow(3.2, 1.6, 1.8, 0.4)
          const k = span(τ, 3.0, c.cutAt ?? 4.5)
          const haze = this.route.pointAt(st.s, new THREE.Vector3()).add(P(0.8, 0.9, 0.8))
          return { pos: f.pos.lerp(haze.clone().add(P(-0.4, 0.1, 0.6)), k * 0.85), look: f.look.lerp(haze, k) }
        }
        const z = lerp(4.4, 3.4, span(τ, c.cutAt ?? 4.5, c.duration))
        return { pos: P(0.2, 0.25, z), look: P(0.4, 0, 0), scene: 'dust' }
      }
      case 'dawn': {
        const k = span(τ, 0.3, 3.4)
        const R = this.route.pointAt(st.s, new THREE.Vector3())
        return { pos: P(R.x - 3, R.y + 1.6, R.z + 4), look: P(lerp(R.x, -14, k), lerp(R.y + 0.4, 34, k), lerp(R.z, -30, k)) }
      }
      case 'landerFinal': {
        const a = 0.9 + 0.12 * (τ / c.duration)
        return { pos: P(Math.cos(a) * 6.5, 2.6, Math.sin(a) * 6.5), look: P(-0.6, 2.4, 0) }
      }
      case 'basin': {
        // Hold the wide basin view while Neo speaks about the lake hypothesis, then descend.
        const k = span(τ, 16, c.duration - 1)
        return { pos: P(lerp(-120, -8, k), lerp(150, 6, k), lerp(260, 12, k)), look: P(lerp(16, 3, k), 0, lerp(4, -2, k)) }
      }
      case 'followDrive': return follow(8.2, 3.6, 4.4)
      case 'rock': {
        const f = follow(8.2, 3.6, 4.4)
        const p = this.anchors.specimen
        const close = { pos: P(p.x + 1.5, p.y + 0.85, p.z + 1.35), look: p.clone() }
        const k = span(τ, 0.3, 3.2)
        return { pos: f.pos.lerp(close.pos, k), look: f.look.lerp(close.look, k) }
      }
      case 'lateSpirit': {
        const a = -0.5 + 0.1 * (τ / c.duration)
        return { pos: P(LATE.x + Math.cos(a) * 5.6, this.lateHeight(LATE.x, LATE.z) + 2.2, LATE.z + Math.sin(a) * 5.6 + 2.5), look: P(LATE.x, this.lateHeight(LATE.x, LATE.z) + 0.6, LATE.z) }
      }
      case 'orbital': {
        const k = span(τ, 15, c.duration - 1.5)
        return { pos: P(lerp(14, -6, k), lerp(170, 4.5, k), lerp(40, 8, k)), look: P(lerp(14, -2.5, k), lerp(0, 0.4, k), lerp(-6, 2, k)) }
      }
      case 'outcrop': {
        const p = this.anchors.outcrop
        return { pos: P(p.x + 2.6, p.y + 0.9, p.z - 1.0), look: p.clone() }
      }
      case 'climb': return follow(7.2, 3.4, -4.0)
      case 'compare': {
        const f = follow(9.5, 4.6, -5.0)
        return f
      }
      case 'lateOpp': {
        const a = 0.35 - 0.08 * (τ / c.duration)
        return { pos: P(LATE.x + Math.sin(a) * 7, this.lateHeight(LATE.x, LATE.z) + 2.4, LATE.z + Math.cos(a) * 7), look: P(LATE.x, this.lateHeight(LATE.x, LATE.z) + 0.8, LATE.z) }
      }
      default: return follow(6, 3, 3)
    }
  }

  // --------------------------------------------------------------- apply

  /**
   * fs = {t (chapter time), cue, τ (cue time), reduced, inspect:{target, yaw, pitch}|null, playing}
   */
  apply(fs) {
    if (this.pendingSwap && !fs.playing) {
      this.pendingSwap = false
      if (this.library?.merReady) this._placeRover(this.library.createMER())
    }
    const c = fs.cue
    // Reduced motion: each cue shows its still composition (its settled end state).
    // Reduced motion: still compositions. Before a checkpoint is passed, the still shows the
    // checkpoint moment so no result is revealed ahead of the visitor's action.
    let τ = fs.τ
    if (fs.reduced) τ = c.checkpoint && fs.τ <= c.checkpoint.atRel + 1e-3 ? c.checkpoint.atRel : Math.max(0, c.duration - 0.05)
    const t = c.start + τ
    const st = { s: this.roverS(t) }

    // Actors
    let τr = 99
    if (this.id === 'pf') τr = this._applyLander(t)
    const late = !!c.late
    const rp = this.rover.root.position
    if (late) {
      const lh = this.lateHeight
      rp.set(LATE.x, lh(LATE.x, LATE.z), LATE.z)
      _f.set(this.id === 'sp' ? 0.6 : 0, 0, this.id === 'sp' ? 0.8 : 1).normalize()
      this._groundBasis(rp, lh)
      _x.crossVectors(_u, _f).normalize()
      this.rover.root.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _u, _f))
      if (this.id === 'sp') {
        // Wheels settle into soft soil, then everything is still.
        const sink = span(τ, 0.8, 4.2)
        rp.y -= 0.1 * sink
        this.rover.root.rotateZ(0.05 * sink)
      }
      this.rover.setWheelAngle(this.id === 'sp' ? span(τ, 0.8, 4.2) * 1.2 : 0)
    } else {
      this._roverPose(st.s, rp, this.rover.root.quaternion)
      this.rover.setWheelAngle(this.route.distanceAt(st.s) / this.rover.wheelRadius)
    }
    this.rover.root.visible = true
    if (this.id === 'pf') {
      // Hidden inside the closed lander until the petals open; no precise final placement.
      const vis = τr > 2.4 && c.id !== 'pf-final' && c.id !== 'pf-record'
      this.rover.root.visible = vis
    }
    if (this.routeBright) this.routeBright.userData.reveal(late ? 0 : st.s / this.route.count)
    if (this.routeFaint) this.routeFaint.visible = !late
    if (this.routeBright) this.routeBright.visible = !late && !(this.id === 'pf' && c.id === 'pf-final')
    if (this.planLine) this.planLine.visible = this.planVisible && !late
    this.anchors.rover = rp.clone().add(_v.set(0, (this.rover.dims.height || 0.5) + 0.25, 0))

    // Emphasis outlines: brief pulse, then a steady highlight.
    // While a required interaction waits, its target pulses (static in reduced motion).
    const waitT = fs.waiting?.target
    const pulse = fs.reduced ? 1 : 0.5 + 0.5 * Math.sin(performance.now() / 1000 * 5)
    for (const [name, shell] of Object.entries(this.outlines)) {
      const on = c.emphasis?.target === name && τ >= (c.emphasis.at ?? 0)
      const k = on ? (fs.reduced ? 1 : 0.55 + 0.45 * Math.cos((τ - c.emphasis.at) * 4) * Math.exp(-(τ - c.emphasis.at) * 0.6)) : 0
      if (waitT === name) {
        shell.material.opacity = 0.45 + 0.5 * pulse
        shell.parent.material.emissiveIntensity = 0.35 + 0.6 * pulse
        continue
      }
      shell.material.opacity = on ? clamp(0.35 + 0.45 * k, 0, 0.85) : 0
      shell.parent.material.emissiveIntensity = on ? 0.6 * k : 0
    }
    if (this.outcrop) {
      const on = c.emphasis?.target === 'outcrop' || c.id === 'op-outcrop'
      this.outcrop.material.emissiveIntensity = waitT === 'outcrop' ? 0.3 + 0.7 * pulse : on ? (fs.reduced ? 0.5 : 0.35 + 0.25 * Math.sin(τ * 3)) : 0
    }
    if (this.rimRing) {
      this.rimRing.visible = waitT === 'eagleCrater'
      this.rimRing.material.opacity = 0.45 + 0.5 * pulse
    }
    if (this.magnetArc) {
      this.magnetArc.material.emissive?.setHex(0x5ff4ff)
      this.magnetArc.material.emissiveIntensity = waitT === 'magnet' ? 0.15 + 0.45 * pulse : 0
    }

    // Lighting / sky mood
    let mood = 'day'
    let moodK = 0
    if (c.id === 'pf-cloud') { mood = 'dawn'; moodK = span(τ, 0.3, 3.0) }
    if (c.id === 'sp-final' || c.id === 'sp-troy') { mood = 'winter'; moodK = span(τ, 1.0, c.duration * 0.8) }
    if (c.id === 'op-final' || c.id === 'op-image') { mood = 'storm'; moodK = span(τ, 0.5, c.duration * 0.6) }
    this._mood(mood, moodK)

    // Science effects
    if (this.clouds) for (const [i, m] of this.clouds.children.entries()) m.material.opacity = c.id === 'pf-cloud' ? 0.85 * span(τ, 2.6 + i * 0.12, 4.6 + i * 0.12) : 0
    if (this.pulses) {
      const on = c.id === 'pf-final' || c.id === 'pf-record'
      this.pulses.children.forEach((ring, i) => {
        const ph = ((τ + i * 0.55) % 2.2) / 2.2
        const vis = on && τ > 1.5 && !fs.reduced
        ring.material.opacity = vis ? 0.9 * (1 - ph) : (on && fs.reduced && i === 0 ? 0.7 : 0)
        ring.position.set(-ph * 2.2, 1.6 + ph * 5.5, -ph * 1.5)
        ring.scale.setScalar(0.6 + ph * 2.2)
        ring.rotation.x = Math.PI / 2 - 0.4
      })
    }
    if (this.lake) {
      const g = c.globeLead ?? 0
      const k = c.id === 'sp-gusev' ? span(τ, g + 1.0, g + 3.0) * (1 - span(τ, 16, 18)) : 0
      this.lake.material.opacity = 0.28 * k
      this.shore.traverse((o) => { if (o.material) o.material.opacity = 0.95 * k })
    }
    if (this.mineral) {
      const g = c.globeLead ?? 0
      this.mineral.material.opacity = c.id === 'op-meridiani' ? 0.4 * span(τ, g + 0.8, g + 2.6) * (1 - span(τ, 15, 17)) : 0
    }
    if (this.storm) {
      const on = c.id === 'op-final' || c.id === 'op-image'
      this.storm.material.opacity = on ? 0.75 * moodK : 0
      if (on) {
        const arr = this.storm.geometry.attributes.position.array
        const tt = fs.reduced ? 0 : τ
        this.stormBase.forEach(([x, y, z], i) => {
          arr[i * 3] = LATE.x + ((x + tt * 3.2 + 20) % 40 + 40) % 40 - 20
          arr[i * 3 + 1] = this.lateHeight(LATE.x, LATE.z) + y + Math.sin(tt + i) * 0.2
          arr[i * 3 + 2] = LATE.z + z
        })
        this.storm.geometry.attributes.position.needsUpdate = true
      }
    }
    if (this.dust) this._applyDust(c, τ, fs.reduced)

    // Camera: blend from the previous cue's final shot unless the cue cuts.
    let shot = this._shot(c, τ, st)
    if (fs.inspect) shot = this._inspectShot(fs.inspect)
    else {
      const prev = this.run.cues[c.index - 1]
      const blend = c.cut || fs.reduced ? 0 : 1.4
      if (prev && prev.view !== 'globe' && τ < blend && !shot.scene && !prev.late === !c.late && !(c.globeLead && τ < c.globeLead + blend)) {
        const pst = { s: this.roverS(prev.end - 0.01) }
        const from = this._shot(prev, prev.duration - 0.01, pst)
        if (!from.scene) {
          const k = smooth(τ / blend)
          shot = { pos: from.pos.lerp(shot.pos, k), look: from.look.lerp(shot.look, k) }
        }
      }
    }
    this.activeScene = shot.scene === 'dust' ? this.dust.scene : this.scene
    const cam = shot.scene === 'dust' ? this.dust.camera : this.camera
    cam.position.copy(shot.pos)
    if (shot.scene !== 'dust' && !late) cam.position.y = Math.max(cam.position.y, this.h(cam.position.x, cam.position.z) + 0.35)
    cam.lookAt(shot.look)
    cam.updateMatrixWorld()
    this.activeCamera = cam
    this.sky.position.copy(this.camera.position)
    // High establishing shots see far: open the fog with altitude (storm keeps its own).
    const alt = cam.position.y - (late ? 0 : this.h(cam.position.x, cam.position.z))
    if (shot.scene !== 'dust' && mood !== 'storm' && alt > 12) { this.scene.fog.near = 60 + alt; this.scene.fog.far = 260 + alt * 3 }

    if (this.sun.castShadow) {
      const focus = late ? rp : (this.id === 'pf' && τr < 5 ? this.lander.root.position : rp)
      this.sun.target.position.copy(focus)
      this.sun.position.copy(focus).add(_v.set(14, 22, 10))
      this.sun.target.updateMatrixWorld()
    }
  }

  _applyDust(c, τ, reduced) {
    const d = this.dust
    const on = c.id === 'pf-dust'
    // The magnet switches on only after the visitor taps it (the checkpoint), else 2 s into the line.
    const magnetAt = c.checkpoint ? c.checkpoint.atRel + 0.25 : (c.speakStart ?? 0) - c.start + 2.0
    const k = on ? (reduced ? (τ >= magnetAt ? 1 : 0) : span(τ, magnetAt, magnetAt + 3.0)) : 0
    d.magnet.scale.setScalar(on ? Math.max(0.001, reduced ? (τ >= magnetAt - 1.6 ? 1 : 0.001) : span(τ, magnetAt - 1.6, magnetAt - 0.6)) : 0.001)
    for (let i = 0; i < d.N; i++) {
      const b = d.base[i]
      const ph = d.phase[i]
      const tt = reduced ? 0 : τ
      _v.set(b.x + Math.sin(tt * 0.5 + ph) * 0.15, b.y + Math.sin(tt * 0.7 + ph * 1.3) * 0.12, b.z + Math.cos(tt * 0.4 + ph) * 0.1)
      if (d.magnetic[i]) {
        const pole = d.poles[d.pole[i]]
        _f.copy(pole).add(_x.set(-Math.abs(Math.sin(ph)) * 0.35 - 0.05, Math.cos(ph * 2) * 0.12, Math.sin(ph * 3) * 0.12))
        _v.lerp(_f, k * (0.6 + 0.4 * Math.abs(Math.sin(ph))))
      }
      _m.compose(_v, new THREE.Quaternion().setFromEuler(new THREE.Euler(ph, ph * 2, tt * 0.3)), _x.setScalar(d.size[i]))
      d.inst.setMatrixAt(i, _m)
    }
    d.inst.instanceMatrix.needsUpdate = true
    this.anchors.dustSample = new THREE.Vector3(-0.4, 0.4, 0)
    this.anchors.magnet = new THREE.Vector3(1.9, 0.6, 0)
  }

  _mood(mood, k) {
    const a = SKY.day
    const b = SKY[mood]
    const mix = (x, y) => new THREE.Color(lerp(x[0], y[0], k), lerp(x[1], y[1], k), lerp(x[2], y[2], k))
    const u = this.sky.material.uniforms
    u.top.value.copy(mix(a.top, b.top))
    u.hor.value.copy(mix(a.hor, b.hor))
    u.sunCol.value.copy(mix(a.sun, b.sun))
    u.sunAmt.value = mood === 'storm' ? 1 - 0.85 * k : mood === 'winter' ? 1 - 0.6 * k : 1
    u.sunDir.value.set(0.5, mood === 'dawn' ? lerp(0.4, 0.08, k) : mood === 'winter' ? lerp(0.4, 0.12, k) : 0.4, -0.6).normalize()
    this.scene.fog.color.copy(u.hor.value)
    this.scene.fog.near = mood === 'storm' ? lerp(45, 6, k) : 45
    this.scene.fog.far = mood === 'storm' ? lerp(170, 40, k) : 170
    const dim = mood === 'storm' ? 1 - 0.7 * k : mood === 'winter' ? 1 - 0.6 * k : mood === 'dawn' ? 1 - 0.45 * k : 1
    this.sun.intensity = 2.3 * dim
    this.hemi.intensity = 1.15 * (0.55 + 0.45 * dim)
    this.sun.color.copy(mood === 'dawn' ? new THREE.Color(0xfff1df).lerp(new THREE.Color(0xbcd6ff), k) : new THREE.Color(0xfff1df))
  }

  _inspectShot(ins) {
    const p = this.anchor(ins.target)
    const dist = ins.target === 'eagleCrater' ? 9 : ins.target === 'outcrop' ? 3.2 : 1.5
    if (ins.target === 'eagleCrater') {
      // Look back from the rim into Eagle Crater.
      const rimPos = this.anchors.eagleExit.clone()
      const yaw = ins.yaw ?? 0
      const dir = p.clone().sub(rimPos).setY(0).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
      return { pos: rimPos.clone().add(new THREE.Vector3(0, 1.8 + (ins.pitch ?? 0) * 2, 0)).addScaledVector(dir, -1.5), look: rimPos.clone().addScaledVector(dir, 8).setY(p.y) }
    }
    const yaw = 0.7 + (ins.yaw ?? 0)
    const pitch = clamp(0.45 + (ins.pitch ?? 0), 0.12, 1.2)
    const pos = p.clone().add(new THREE.Vector3(Math.cos(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.sin(yaw) * Math.cos(pitch) * dist))
    return { pos, look: p.clone() }
  }

  // ------------------------------------------------------------ queries

  anchor(name, out = new THREE.Vector3()) {
    const a = this.anchors[name]
    if (a) return out.copy(a)
    if (name === 'site') return out.set(0, 0.5, 0)
    return out.copy(this.rover.root.position)
  }

  occluded(p) {
    if (this.activeScene !== this.scene) return false
    const c = this.activeCamera.position
    for (let i = 1; i < 24; i++) {
      const k = i / 24
      const x = c.x + (p.x - c.x) * k
      const y = c.y + (p.y - c.y) * k
      const z = c.z + (p.z - c.z) * k
      if (Math.abs(z - LATE.z) < 200 ? y < this.lateHeight?.(x, z) - 0.05 : y < this.h(x, z) - 0.05) return true
    }
    return false
  }

  roverScreen(size) {
    const cam = this.activeCamera
    if (!this.rover.root.visible || this.activeScene !== this.scene) return { x: -1e4, y: -1e4, r: 0 }
    const r = this.rover.root.position
    _v.copy(r).setY(r.y + (this.rover.dims.height || 0.5) * 0.5).project(cam)
    const d = cam.position.distanceTo(r)
    const px = (Math.max(this.rover.dims.width, this.rover.dims.height, this.rover.dims.length) * 0.6 / (d * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)))) * size.h * 0.5
    return { x: (_v.x + 1) * 0.5 * size.w, y: (1 - _v.y) * 0.5 * size.h, r: px }
  }

  get camera_() { return this.activeCamera }

  dispose() {
    for (const s of [this.scene, this.dust?.scene].filter(Boolean)) {
      s.traverse((o) => {
        if (o.userData.shared) return
        if (o.isInstancedMesh) o.dispose()
        o.geometry?.dispose()
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []
        for (const m of mats) {
          if (m.userData?.shared) continue
          if (m.map && !m.map.userData?.shared) m.map.dispose()
          m.dispose()
        }
      })
    }
  }
}
