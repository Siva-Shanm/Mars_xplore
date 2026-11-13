// Journey drawings on the globe. With the seed data every path is a schematic:
// order and relationships only, laid out from normalized display steps around the
// real landing anchor. Geographic lines are drawn only from validated sourcePolyline
// samples with a documented coordinate frame.

import * as THREE from 'three'
import { coordinatesToUnit, densifyGreatCircle, rad } from './geography.js'

// Display-only layout constants. They carry no mileage, bearing or position meaning.
const SPAN = 0.22 // rad, angular extent of a schematic on the unit globe
const LIFT = 0.004
const STEPS = {
  'gusev-drive': [0, 0.38, 1],
  'early-plan': [0, 0.3, 1],
  'eagle-to-endurance': [0, 0.34, 1],
}
const PLAN_BOW = 0.07 // lateral bow so the plan never overlaps the completed line

const COLORS = {
  roverDrive: 0x56d9ff,
  plannedDrive: 0xffc35c,
  landingBounce: 0xbfefff,
  source: 0x7dffb0,
}

class PolylineCurve extends THREE.Curve {
  constructor(points) {
    super()
    this.points = points
    const lens = [0]
    for (let i = 1; i < points.length; i++) lens.push(lens[i - 1] + points[i].distanceTo(points[i - 1]))
    this.lens = lens
    this.total = lens[lens.length - 1] || 1
  }
  getPoint(t, out = new THREE.Vector3()) {
    const d = THREE.MathUtils.clamp(t, 0, 1) * this.total
    let i = 1
    while (i < this.lens.length - 1 && this.lens[i] < d) i++
    const seg = this.lens[i] - this.lens[i - 1] || 1
    return out.copy(this.points[i - 1]).lerp(this.points[i], (d - this.lens[i - 1]) / seg)
  }
}

export class TraverseRenderer {
  constructor(parent) {
    this.parent = parent
    this.group = null
    this.labels = []
  }

  clear() {
    if (this.group) {
      this.group.traverse((o) => {
        o.geometry?.dispose()
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose())
      })
      this.parent.remove(this.group)
    }
    this.group = null
    this.labels = []
  }

  /**
   * Build the journey for one mission.
   * @param mission validated mission record
   * @param state {show, plan}
   * @param anchorDir THREE.Vector3 unit landing normal in globe-local frame
   * @param radiusAt (unitDir: THREE.Vector3) => local surface radius
   */
  show(mission, state, anchorDir, radiusAt) {
    this.clear()
    if (!state.show && !state.plan) return []
    const group = new THREE.Group()
    group.name = `journey-${mission.id}`
    this.group = group
    const labels = []

    const n = anchorDir.clone().normalize()
    const t = new THREE.Vector3(0, 1, 0).cross(n)
    if (t.lengthSq() < 1e-8) t.set(1, 0, 0)
    t.normalize() // local east: reads left→right when north is up
    const b = new THREE.Vector3().crossVectors(n, t).normalize() // local north
    const r0 = radiusAt(n)

    // h is an illustrative arch height. It is split between the radial direction and
    // local north so the arches read from a top-down fly-to view as well as obliquely.
    const point = (theta, phi = 0, h = 0) => {
      const v = n.clone().multiplyScalar(Math.cos(theta)).addScaledVector(t, Math.sin(theta)).addScaledVector(b, phi).normalize()
      const lift = v.clone().multiplyScalar(r0 * (1 + LIFT) + h * 0.6)
      return h ? lift.addScaledVector(b, h * 0.8) : lift
    }

    let schematicDrawn = false
    for (const path of mission.traversePaths) {
      const isPlan = path.kind === 'plannedDrive'
      if (isPlan ? !state.plan : !state.show) continue

      if (path.geometry === 'sourcePolyline' && !path._rejectedPolyline) {
        this._sourcePolyline(path, radiusAt, group)
        continue
      }
      schematicDrawn = true
      if (path.kind === 'landingBounce') this._bounce(path, point, group, labels)
      else this._drive(path, point, group, labels, isPlan)
    }

    if (schematicDrawn) {
      labels.push({ local: point(SPAN * 0.5, -0.06), text: 'Schematic · not to scale', variant: 'scale' })
    }
    this.parent.add(group)
    this.labels = labels
    return labels
  }

  _tube(points, color, { dashed = false, core = 0.0024 } = {}, group) {
    const chunks = []
    if (dashed) {
      const per = 6
      for (let i = 0; i < points.length - 1; i += per * 2) chunks.push(points.slice(i, Math.min(points.length, i + per + 1)))
    } else chunks.push(points)
    const coreMat = new THREE.MeshBasicMaterial({ color })
    const glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false })
    for (const c of chunks) {
      if (c.length < 2) continue
      const curve = new PolylineCurve(c)
      const segs = Math.min(400, c.length * 2)
      group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, segs, core, 6, false), coreMat))
      const glow = new THREE.Mesh(new THREE.TubeGeometry(curve, segs, core * 2.4, 6, false), glowMat)
      glow.renderOrder = 2
      group.add(glow)
    }
  }

  _node(pos, color, group) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.0085, 16, 12), new THREE.MeshBasicMaterial({ color }))
    m.position.copy(pos)
    group.add(m)
  }

  _bounce(path, point, group, labels) {
    // Curved trace ending at the station: ~N stylized lobes, then a short roll tail.
    const count = path.bounce?.count ?? 1
    const pts = []
    const bounceEnd = 0.86
    const A = 0.032
    const perLobe = 24
    for (let k = 0; k < count; k++) {
      const amp = A * Math.pow(0.84, k)
      const s0 = (k / count) * bounceEnd
      const s1 = ((k + 1) / count) * bounceEnd
      for (let j = (k === 0 ? 0 : 1); j <= perLobe; j++) {
        const lt = j / perLobe
        const s = s0 + (s1 - s0) * lt
        const theta = -SPAN + SPAN * s
        const phi = 0.02 * Math.sin(Math.PI * s) // gentle curve, illustrative
        pts.push(point(theta, phi, amp * Math.sin(Math.PI * lt)))
      }
    }
    for (let j = 1; j <= 16; j++) {
      const s = bounceEnd + (1 - bounceEnd) * (j / 16)
      pts.push(point(-SPAN + SPAN * s, 0.02 * Math.sin(Math.PI * s), 0))
    }
    this._tube(pts, COLORS.landingBounce, { core: 0.0018 }, group)
    const start = point(-SPAN, 0)
    const end = point(0, 0)
    this._node(start, COLORS.landingBounce, group)
    this._node(end, COLORS.landingBounce, group)
    labels.push({ local: start, text: '1', variant: 'step' })
    labels.push({ local: end, text: '2', variant: 'step' })
  }

  _drive(path, point, group, labels, isPlan) {
    const n = path.waypointIds.length
    const steps = STEPS[path.id] ?? path.waypointIds.map((_, i) => i / (n - 1))
    const phiAt = (s) => (isPlan ? PLAN_BOW * Math.sin(Math.PI * s) : 0.012 * Math.sin(Math.PI * s))
    const pts = []
    const samples = 120
    for (let i = 0; i <= samples; i++) {
      const s = i / samples
      pts.push(point(SPAN * s, phiAt(s)))
    }
    const color = isPlan ? COLORS.plannedDrive : COLORS.roverDrive
    this._tube(pts, color, { dashed: isPlan }, group)
    steps.forEach((s, i) => {
      const pos = point(SPAN * s, phiAt(s))
      // Plan endpoints coincide with completed nodes; label only distinct plan steps.
      const shared = isPlan && (s === 0 || s === 1)
      this._node(pos, color, group)
      if (!shared) labels.push({ local: pos, text: isPlan ? `P${i + 1}` : String(i + 1), variant: isPlan ? 'plan' : 'step' })
    })
  }

  _sourcePolyline(path, radiusAt, group) {
    const dirs = path.samples.map((c) => coordinatesToUnit(c))
    let dense
    try { dense = densifyGreatCircle(dirs, rad(0.25)) } catch { return }
    const pts = dense.map(([x, y, z]) => {
      const v = new THREE.Vector3(x, y, z)
      return v.multiplyScalar(radiusAt(v) * (1 + 0.003))
    })
    const capped = pts.length > 2000 ? pts.filter((_, i) => i % Math.ceil(pts.length / 2000) === 0 || i === pts.length - 1) : pts
    this._tube(capped, COLORS.source, { dashed: path.kind === 'plannedDrive', core: 0.0016 }, group)
  }
}
