// Rover and lander representations.
//  - Supplied MER model (Spirit & Opportunity are identical twins) loaded with GLTFLoader,
//    wrapped by an asset-specific normalizer (orientation, contact height, metric scale)
//    and validated. Wheels baked into one primitive are separated into an axle rig only
//    when six wheel-shaped parts are found; otherwise the whole model translates.
//  - Procedural, simplified illustrations: Sojourner, the Pathfinder lander (airbags,
//    petals, ramp) and a shared MER fallback.
// Conventions for every instance: metres, +Y up, +Z forward, wheels touching y = 0.

import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { resolveLocal } from './validate.js'

const LOAD_DEADLINE_MS = 30000

function disposeTree(root) {
  root?.traverse((o) => {
    if (o.userData.shared) return
    o.geometry?.dispose()
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []
    for (const m of mats) { for (const v of Object.values(m)) if (v && v.isTexture) v.dispose(); m.dispose() }
  })
}

// ------------------------------------------------------------ procedural parts

function cellTexture(color = '#1d2c52', line = '#6c84b8') {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  g.fillStyle = color; g.fillRect(0, 0, 128, 128)
  g.strokeStyle = line; g.lineWidth = 2
  for (let i = 0; i <= 128; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke() }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

const MAT = {}
function mats() {
  if (MAT.ready) return MAT
  MAT.metal = new THREE.MeshStandardMaterial({ color: 0xb9bcc2, metalness: 0.6, roughness: 0.45 })
  MAT.dark = new THREE.MeshStandardMaterial({ color: 0x3a3d44, metalness: 0.3, roughness: 0.7 })
  MAT.gold = new THREE.MeshStandardMaterial({ color: 0xc9a34f, metalness: 0.7, roughness: 0.35 })
  MAT.white = new THREE.MeshStandardMaterial({ color: 0xe6e3dc, roughness: 0.6 })
  MAT.wheel = new THREE.MeshStandardMaterial({ color: 0x8d9097, metalness: 0.5, roughness: 0.5 })
  MAT.cleat = new THREE.MeshStandardMaterial({ color: 0x55585e, metalness: 0.4, roughness: 0.6 })
  MAT.solar = new THREE.MeshStandardMaterial({ map: cellTexture(), metalness: 0.4, roughness: 0.35 })
  MAT.airbag = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.85 })
  for (const m of Object.values(MAT)) m.userData.shared = true
  MAT.ready = true
  return MAT
}

/** A wheel with cleats so rotation is visible. Axle along X. */
function makeWheel(radius, width) {
  const m = mats()
  const pivot = new THREE.Group()
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 20), m.wheel)
  tire.rotation.z = Math.PI / 2
  pivot.add(tire)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const cleat = new THREE.Mesh(new THREE.BoxGeometry(width * 1.04, radius * 0.16, radius * 0.08), m.cleat)
    cleat.position.set(0, Math.cos(a) * radius, Math.sin(a) * radius)
    cleat.rotation.x = -a
    pivot.add(cleat)
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.35, radius * 0.35, width * 1.1, 12), m.dark)
  hub.rotation.z = Math.PI / 2
  pivot.add(hub)
  return pivot
}

function rockerBogie(group, wheelX, wheelZ, wheelR, bodyY, thick) {
  const m = mats()
  for (const side of [-1, 1]) {
    const x = side * wheelX
    const pts = wheelZ.map((z) => new THREE.Vector3(x, wheelR, z))
    const top = new THREE.Vector3(x, bodyY, 0)
    for (const p of pts) {
      const len = p.distanceTo(top)
      const leg = new THREE.Mesh(new THREE.BoxGeometry(thick, thick, len), m.metal)
      leg.position.copy(p).add(top).multiplyScalar(0.5)
      leg.lookAt(top)
      group.add(leg)
    }
  }
}

function instance(root, wheels, wheelRadius, { kind, simplified, label }) {
  const box = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())
  return {
    root, wheels, wheelRadius, kind, simplified, label,
    dims: { width: size.x, height: size.y, length: size.z },
    setWheelAngle(a) { for (const w of wheels) w.rotation.x = a },
  }
}

/** Sojourner: low chassis, flat solar deck, six small wheels. Simplified illustration. */
export function makeSojourner() {
  const m = mats()
  const g = new THREE.Group()
  g.name = 'sojourner-procedural'
  const R = 0.065
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.46), m.gold)
  chassis.position.y = 0.19
  g.add(chassis)
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.02, 0.62), m.solar)
  deck.position.y = 0.265
  g.add(deck)
  const rim = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.012, 0.64), m.white)
  rim.position.y = 0.252
  g.add(rim)
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.26, 6), m.metal)
  ant.position.set(0.12, 0.4, -0.12)
  g.add(ant)
  const cam = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.04), m.dark)
  cam.position.set(0, 0.17, 0.25)
  g.add(cam)
  const wheels = []
  const zs = [0.22, 0, -0.22]
  for (const x of [-0.235, 0.235]) for (const z of zs) {
    const w = makeWheel(R, 0.05)
    w.position.set(x, R, z)
    g.add(w)
    wheels.push(w)
  }
  rockerBogie(g, 0.235, zs, R, 0.17, 0.018)
  g.traverse((o) => { if (o.isMesh) o.castShadow = true })
  return instance(g, wheels, R, { kind: 'sojourner', simplified: true, label: 'Sojourner · simplified illustration' })
}

/** Shared MER fallback: taller body, wide solar wings, camera mast. Simplified illustration. */
export function makeMERFallback() {
  const m = mats()
  const g = new THREE.Group()
  g.name = 'mer-procedural'
  const R = 0.13
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.32, 1.0), m.white)
  body.position.y = 0.5
  g.add(body)
  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.03, 1.1), m.solar)
  deck.position.y = 0.68
  g.add(deck)
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.025, 0.85), m.solar)
    wing.position.set(side * 0.82, 0.68, -0.1)
    g.add(wing)
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.86, 10), m.metal)
  mast.position.set(-0.05, 1.12, 0.36)
  g.add(mast)
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.12), m.dark)
  head.position.set(-0.05, 1.56, 0.38)
  g.add(head)
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.05), m.metal)
  arm.position.set(0, 0.36, 0.55)
  g.add(arm)
  const wheels = []
  const zs = [0.606, -0.105, -0.606]
  for (const x of [-0.53, 0.53]) for (const z of zs) {
    const w = makeWheel(R, 0.16)
    w.position.set(x, R, z)
    g.add(w)
    wheels.push(w)
  }
  rockerBogie(g, 0.46, zs, R, 0.42, 0.04)
  g.traverse((o) => { if (o.isMesh) o.castShadow = true })
  return instance(g, wheels, R, { kind: 'mer', simplified: true, label: 'Simplified rover model' })
}

/**
 * Pathfinder-style lander: core, three petals, rear ramp, airbag clusters.
 * Local frame: centre at origin on the ground, rover petal and ramp toward +X.
 * Controls: setAirbags(0..1 inflation), setPetals(0 closed..1 open), setRamp(0 stowed..1 deployed).
 */
export function makeLander({ withRamp = true, withAirbags = true, rampDeg = 20, deckY = null } = {}) {
  const m = mats()
  const root = new THREE.Group()
  root.name = 'lander-procedural'
  const rampLen = 1.0
  const deck = deckY ?? rampLen * Math.sin(THREE.MathUtils.degToRad(rampDeg))
  const core = new THREE.Group()
  root.add(core)
  const hingeR = 0.32
  const petalLen = 0.75
  const base = new THREE.Mesh(new THREE.CylinderGeometry(hingeR * 1.15, hingeR * 1.15, 0.06, 3), m.solar)
  base.rotation.y = Math.PI / 6
  core.add(base)
  const box = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.32, 6), m.gold)
  box.position.y = 0.18
  core.add(box)
  const mastPole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 6), m.metal)
  mastPole.position.y = 0.55
  core.add(mastPole)
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.08), m.white)
  head.position.y = 0.82
  core.add(head)
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.02, 0.04, 14), m.white)
  dish.position.set(0.12, 0.42, 0.1)
  dish.rotation.z = 0.6
  core.add(dish)

  const shape = new THREE.Shape()
  shape.moveTo(0, -0.47); shape.lineTo(petalLen, -0.18); shape.lineTo(petalLen, 0.18); shape.lineTo(0, 0.47); shape.closePath()
  const petalGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false })
  petalGeo.rotateX(Math.PI / 2) // lie in XZ, thickness downward
  petalGeo.translate(0, 0.03, 0)
  const petals = []
  for (let i = 0; i < 3; i++) {
    const yaw = (i / 3) * Math.PI * 2
    const hinge = new THREE.Group()
    hinge.rotation.y = yaw
    const pivot = new THREE.Group()
    pivot.position.x = hingeR
    hinge.add(pivot)
    pivot.add(new THREE.Mesh(petalGeo, m.solar))
    core.add(hinge)
    petals.push(pivot)
  }

  let ramp = null
  if (withRamp) {
    ramp = new THREE.Group()
    ramp.position.set(hingeR + petalLen, 0.02, 0)
    const plank = new THREE.Mesh(new THREE.BoxGeometry(rampLen, 0.02, 0.34), m.metal)
    plank.position.x = rampLen / 2
    ramp.add(plank)
    for (const z of [-0.17, 0.17]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(rampLen, 0.04, 0.015), m.dark)
      rail.position.set(rampLen / 2, 0.02, z)
      ramp.add(rail)
    }
    petals[0].add(ramp)
  }

  const bags = new THREE.Group()
  if (withAirbags) {
    const lobes = [[0, -1, 0], [0.94, 0.33, 0], [-0.47, 0.33, 0.82], [-0.47, 0.33, -0.82]]
    const geo = new THREE.SphereGeometry(0.42, 16, 12)
    for (const [x, y, z] of lobes) {
      const dir = new THREE.Vector3(x, y, z).normalize()
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2
        const tA = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize()
        const tB = new THREE.Vector3().crossVectors(dir, tA)
        const s = new THREE.Mesh(geo, m.airbag)
        s.position.copy(dir).multiplyScalar(0.72).addScaledVector(tA, Math.cos(a) * 0.38).addScaledVector(tB, Math.sin(a) * 0.38)
        bags.add(s)
      }
    }
    root.add(bags)
  }
  root.traverse((o) => { if (o.isMesh) o.castShadow = true })

  const rampRad = THREE.MathUtils.degToRad(rampDeg)
  const api = {
    root, core, petals, ramp, bags,
    kind: 'lander', simplified: true, label: 'Lander · simplified illustration',
    deckY: deck, rampLen, hingeR, petalLen, rampDeg,
    airbagRadius: 1.35,
    /** World-local (lander frame) points for the rover route. */
    rampTop: new THREE.Vector3(hingeR + petalLen, deck + 0.03, 0),
    rampFoot: new THREE.Vector3(hingeR + petalLen + rampLen * Math.cos(rampRad), deck + 0.03 - rampLen * Math.sin(rampRad), 0),
    petalCenter: new THREE.Vector3(hingeR + 0.32, deck + 0.03, 0),
    setAirbags(k) {
      bags.visible = k > 0.02
      bags.scale.set(Math.max(k, 0.02), Math.max(k * 0.8 + 0.2 * k, 0.02), Math.max(k, 0.02))
    },
    setPetals(k) {
      // Closed petals fold up around the core; open petals lie level at deck height.
      for (const p of petals) p.rotation.z = (1 - k) * 1.9
    },
    setRamp(k) {
      if (!ramp) return
      ramp.rotation.z = THREE.MathUtils.lerp(2.6, -rampRad, k)
    },
    setCoreLift(y) { core.position.y = y },
  }
  api.setAirbags(withAirbags ? 1 : 0)
  api.setPetals(1)
  api.setRamp(1)
  api.setCoreLift(deck)
  return api
}

// --------------------------------------------------------- supplied MER model

/** Union-find connected components of an indexed geometry, welding equal positions. */
function components(geometry) {
  const pos = geometry.attributes.position
  const idx = geometry.index
  const n = pos.count
  const parent = new Int32Array(n)
  for (let i = 0; i < n; i++) parent[i] = i
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b }
  const weld = new Map()
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`
    const j = weld.get(k)
    if (j === undefined) weld.set(k, i); else union(i, j)
  }
  const tri = idx.count / 3
  for (let t = 0; t < tri; t++) { union(idx.getX(t * 3), idx.getX(t * 3 + 1)); union(idx.getX(t * 3 + 1), idx.getX(t * 3 + 2)) }
  const comps = new Map()
  for (let t = 0; t < tri; t++) {
    const r = find(idx.getX(t * 3))
    let c = comps.get(r)
    if (!c) { c = { tris: [], box: new THREE.Box3() }; comps.set(r, c) }
    c.tris.push(t)
    for (let k = 0; k < 3; k++) {
      const v = idx.getX(t * 3 + k)
      c.box.expandByPoint(new THREE.Vector3(pos.getX(v), pos.getY(v), pos.getZ(v)))
    }
  }
  return [...comps.values()]
}

/**
 * Separate baked-in wheels into axle pivots when the geometry clearly supports it.
 * Returns {ok, wheels:[pivot], radius, reason}.
 */
function buildWheelRig(mesh, cfg) {
  const g = mesh.geometry
  if (!g?.index) return { ok: false, reason: 'suspension primitive is not indexed' }
  const comps = components(g)
  const size = new THREE.Vector3()
  const center = new THREE.Vector3()
  const wheels = comps.filter((c) => {
    c.box.getSize(size)
    const r = (size.y + size.z) / 4
    return Math.abs(size.y - size.z) / Math.max(size.y, size.z) < 0.1 && size.x < 0.85 * Math.max(size.y, size.z) &&
      r >= cfg.radiusRange[0] && r <= cfg.radiusRange[1]
  })
  if (wheels.length !== cfg.count) return { ok: false, reason: `found ${wheels.length} wheel-shaped parts, expected ${cfg.count}` }
  const left = wheels.filter((w) => w.box.getCenter(center).x < 0).length
  if (left !== cfg.count / 2) return { ok: false, reason: 'wheels are not split evenly between sides' }
  const radii = wheels.map((w) => { w.box.getSize(size); return (size.y + size.z) / 4 })
  const med = radii.slice().sort((a, b) => a - b)[radii.length >> 1]
  if (radii.some((r) => Math.abs(r - med) / med > 0.1)) return { ok: false, reason: 'wheel radii differ by more than 10%' }

  // Hub parts that sit entirely inside a wheel volume turn with that wheel.
  const owned = new Set(wheels)
  const groups = wheels.map((w) => ({ wheel: w, tris: [...w.tris], box: w.box.clone() }))
  for (const c of comps) {
    if (owned.has(c)) continue
    const host = groups.find((gr) => gr.box.clone().expandByScalar(0.005).containsBox(c.box))
    if (host) { host.tris.push(...c.tris); owned.add(c) }
  }
  const moving = new Set()
  for (const gr of groups) for (const t of gr.tris) moving.add(t)
  const idx = g.index
  const IndexArray = g.attributes.position.count > 65535 ? Uint32Array : Uint16Array
  const bodyIdx = []
  for (let t = 0; t < idx.count / 3; t++) if (!moving.has(t)) bodyIdx.push(idx.getX(t * 3), idx.getX(t * 3 + 1), idx.getX(t * 3 + 2))

  const pivots = []
  groups.forEach((gr, i) => {
    const sub = new THREE.BufferGeometry()
    for (const [name, attr] of Object.entries(g.attributes)) sub.setAttribute(name, attr) // shared, no copy
    const arr = []
    for (const t of gr.tris) arr.push(idx.getX(t * 3), idx.getX(t * 3 + 1), idx.getX(t * 3 + 2))
    sub.setIndex(new THREE.BufferAttribute(new IndexArray(arr), 1))
    sub.computeBoundingSphere()
    const c = gr.wheel.box.getCenter(new THREE.Vector3())
    const pivot = new THREE.Group()
    pivot.name = `wheel-pivot-${i}`
    pivot.position.copy(c)
    const wm = new THREE.Mesh(sub, mesh.material)
    wm.position.copy(c).negate()
    wm.castShadow = true
    pivot.add(wm)
    mesh.add(pivot)
    pivots.push(pivot)
  })
  const body = new THREE.BufferGeometry()
  for (const [name, attr] of Object.entries(g.attributes)) body.setAttribute(name, attr)
  body.setIndex(new THREE.BufferAttribute(new IndexArray(bodyIdx), 1))
  body.computeBoundingSphere()
  mesh.geometry = body
  return { ok: true, wheels: pivots, radius: med }
}

/**
 * Loads the shared MER asset once, validates it and prepares a normalized template.
 * report = {asset, used:'model'|'fallback', wheelRig, checks:[{name, pass, detail}], warnings:[]}
 */
export class RoverLibrary {
  constructor({ merConfig }) {
    this.cfg = merConfig
    this.template = null
    this.report = { asset: merConfig?.src ?? null, used: 'fallback', wheelRig: false, checks: [], warnings: [] }
    this.listeners = new Set()
    this.loading = null
  }

  onReady(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  get merReady() { return !!this.template }

  load() {
    if (this.loading) return this.loading
    if (!this.cfg) { this.report.checks.push({ name: 'manifest', pass: false, detail: 'no MER model in asset manifest' }); return (this.loading = Promise.resolve(false)) }
    this.loading = this._load().catch((err) => {
      console.warn('[rover] MER model unavailable:', err)
      this.report.checks.push({ name: 'load', pass: false, detail: String(err.message || err) })
      return false
    })
    return this.loading
  }

  async _load() {
    const cfg = this.cfg
    let foreign = false
    const manager = new THREE.LoadingManager()
    manager.setURLModifier((url) => {
      if (/^(data|blob):/i.test(url)) return url
      if (new URL(url, document.baseURI).origin !== location.origin) { foreign = true; return 'data:application/octet-stream,' }
      return url
    })
    const loader = new GLTFLoader(manager)
    let timer
    const deadline = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('MER model load timed out')), LOAD_DEADLINE_MS) })
    let gltf
    try { gltf = await Promise.race([loader.loadAsync(resolveLocal(cfg.src)), deadline]) } finally { clearTimeout(timer) }
    const checks = this.report.checks
    const fail = (name, detail) => { checks.push({ name, pass: false, detail }); disposeTree(gltf.scene); throw new Error(`${name}: ${detail}`) }
    if (foreign) fail('local resources', 'model references non-local URLs')
    checks.push({ name: 'load', pass: true, detail: `${cfg.src} decoded (${gltf.parser.json.meshes?.length ?? 0} mesh, ${gltf.parser.json.images?.length ?? 0} images)` })

    // Textures: keep the model even if some textures failed, but record it.
    const json = gltf.parser.json
    let missing = 0
    let expected = 0
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return
      const assoc = gltf.parser.associations.get(o.material)
      const def = assoc && json.materials?.[assoc.materials]
      if (def?.pbrMetallicRoughness?.baseColorTexture) { expected++; if (!o.material.map) missing++ }
    })
    if (missing) this.report.warnings.push(`${missing} of ${expected} base-colour textures failed to load; untextured materials kept`)
    checks.push({ name: 'textures', pass: missing === 0, detail: `${expected - missing}/${expected} base-colour textures` })

    // Wrapper: orientation, metric scale, contact height.
    const wrapper = new THREE.Group()
    wrapper.name = 'mer-wrapper'
    const orient = new THREE.Group()
    orient.rotation.y = THREE.MathUtils.degToRad(cfg.yawDeg || 0)
    orient.scale.setScalar(1 / (cfg.unitsPerMeter || 1))
    wrapper.add(orient)
    orient.add(gltf.scene)
    gltf.scene.updateMatrixWorld(true)

    let rig = { ok: false, reason: 'no wheel configuration' }
    if (cfg.wheelRig) {
      let suspension = null
      gltf.scene.traverse((o) => {
        if (o.isMesh && !suspension) {
          const assoc = gltf.parser.associations.get(o.material)
          const name = json.materials?.[assoc?.materials]?.name
          if (name === cfg.wheelRig.material) suspension = o
        }
      })
      rig = suspension ? buildWheelRig(suspension, cfg.wheelRig) : { ok: false, reason: `no primitive with material ${cfg.wheelRig.material}` }
    }
    checks.push({ name: 'wheel rig', pass: rig.ok, detail: rig.ok ? `${rig.wheels.length} wheels on X axles, radius ${rig.radius.toFixed(3)} m` : `${rig.reason}; whole model will translate` })

    wrapper.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(wrapper)
    const size = box.getSize(new THREE.Vector3())
    const okNum = [size.x, size.y, size.z].every((v) => Number.isFinite(v) && v > 0)
    const [hMin, hMax] = cfg.expectedHeightM ?? [1.2, 2.0]
    if (!okNum || size.y < hMin || size.y > hMax || size.x < size.y * 0.8 || size.x > size.y * 2.5) {
      fail('bounds', `implausible size ${size.x.toFixed(2)}×${size.y.toFixed(2)}×${size.z.toFixed(2)} m`)
    }
    checks.push({ name: 'bounds', pass: true, detail: `${size.x.toFixed(2)} W × ${size.y.toFixed(2)} H × ${size.z.toFixed(2)} L m` })

    // Contact: the lowest wheel point sits on y = 0; centre the footprint on the origin.
    let contact = box.min.y
    if (rig.ok) {
      contact = Infinity
      for (const p of rig.wheels) contact = Math.min(contact, new THREE.Box3().setFromObject(p).min.y)
    }
    const c = box.getCenter(new THREE.Vector3())
    orient.position.set(-c.x, -contact, -c.z)
    checks.push({ name: 'contact', pass: Math.abs(contact - box.min.y) < 0.05, detail: `wheel contact ${contact.toFixed(3)} m, lowest point ${box.min.y.toFixed(3)} m` })

    // Forward check (asset specific): mast and arm sit toward the front (+Z after wrapper).
    if (cfg.frontMaterial) {
      let front = null
      gltf.scene.traverse((o) => {
        const assoc = o.isMesh && gltf.parser.associations.get(o.material)
        if (assoc && json.materials?.[assoc.materials]?.name === cfg.frontMaterial) front = o
      })
      wrapper.updateMatrixWorld(true)
      const z = front ? new THREE.Box3().setFromObject(front).getCenter(new THREE.Vector3()).z : 0
      checks.push({ name: 'forward axis', pass: z > 0, detail: front ? `${cfg.frontMaterial} centre at z=${z.toFixed(2)} (front is +Z)` : 'front part not found' })
      if (front && z <= 0) fail('forward axis', 'front parts are not on +Z after wrapper yaw')
    }

    wrapper.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.userData.shared = true } })
    this.template = { root: wrapper, wheelCount: rig.ok ? rig.wheels.length : 0, wheelRadius: rig.ok ? rig.radius : 0.13 }
    this.report.used = 'model'
    this.report.wheelRig = rig.ok
    for (const fn of this.listeners) fn(this)
    return true
  }

  /** New MER instance: supplied model when ready, otherwise the procedural fallback. */
  createMER() {
    if (!this.template) return makeMERFallback()
    const root = this.template.root.clone(true)
    const wheels = []
    root.traverse((o) => { if (o.name.startsWith('wheel-pivot-')) wheels.push(o) })
    return instance(root, wheels, this.template.wheelRadius, {
      kind: 'mer', simplified: false,
      label: wheels.length ? 'Supplied MER model' : 'Supplied MER model (wheels move with body)',
    })
  }
}
