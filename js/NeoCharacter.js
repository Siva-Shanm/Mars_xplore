// Neo: the fictional hovering guide, built entirely in Three.js from simple meshes.
// Design references: Neospritesheet2.jpeg (front / side / back turnaround) and
// Neospritesheet1.jpeg (gestures and expressions). No runtime image or clip files.
//
// Local frame: +Y up, +Z forward (the face looks toward +Z). The main body (helmet top to
// base, excluding the antenna) is 1.0 unit tall; the base floats above the glow.
//
// Rig: holder → glow (static) + float (hover) → yaw → lean → { torso, head pivot, arm pivots }.
// Pose is composed once per frame from a single pose object, so animations never fight
// over the same property. Expressions draw to one CanvasTexture, redrawn only on change.

import * as THREE from 'three'

const COLORS = {
  blue: 0x3f84d6,
  deep: 0x2b63b4,
  pale: 0xe9f2fc,
  trim: 0xc3d1e2,
  outline: 0x12284a,
  visor: '#0b1a33',
  visorRim: '#5d7fae',
  cyan: '#5ff4ff',
  red: '#ff5a4a',
}

// ------------------------------------------------------------------ helpers

function toonGradient() {
  const data = new Uint8Array([90, 170, 255])
  const t = new THREE.DataTexture(data, 3, 1, THREE.RedFormat)
  t.minFilter = t.magFilter = THREE.NearestFilter
  t.needsUpdate = true
  return t
}

/** Inverted-hull outline: same geometry pushed out along normals, back faces only. */
function outlineMaterial(width) {
  const m = new THREE.MeshBasicMaterial({ color: COLORS.outline, side: THREE.BackSide })
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n transformed += normal * ${width.toFixed(4)};`)
  }
  m.customProgramCacheKey = () => `neo-outline-${width}`
  return m
}

function lathe(profile, segments = 48, phiStart = 0, phiLength = Math.PI * 2) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments, phiStart, phiLength)
}

/** Resample a profile between y0 and y1 (assumes y increasing along the list) with a radial offset. */
function band(profile, y0, y1, offset, steps = 10) {
  const radiusAt = (y) => {
    for (let i = 1; i < profile.length; i++) {
      const [r0, a] = profile[i - 1]
      const [r1, b] = profile[i]
      if ((y >= a && y <= b) || (y >= b && y <= a)) return r0 + (r1 - r0) * ((y - a) / (b - a || 1))
    }
    return profile[profile.length - 1][0]
  }
  const out = []
  for (let i = 0; i <= steps; i++) {
    const y = y0 + (y1 - y0) * (i / steps)
    out.push([radiusAt(y) + offset, y])
  }
  return out
}

// Profiles (radius, y). Torso is in torso-local y (0 = base tip, 0.59 = neck seam).
const TORSO = [[0.0, 0.0], [0.09, 0.006], [0.15, 0.025], [0.195, 0.06], [0.225, 0.11], [0.248, 0.19], [0.262, 0.29], [0.266, 0.38], [0.264, 0.47], [0.258, 0.54], [0.24, 0.575], [0.2, 0.59]]
// Head is in head-local y (0 = neck seam, 0.4 = dome top).
const HEAD = [[0.19, 0.0], [0.232, 0.013], [0.252, 0.056], [0.26, 0.146], [0.259, 0.246], [0.252, 0.314], [0.236, 0.37], [0.205, 0.409], [0.155, 0.435], [0.09, 0.446], [0.0, 0.448]]

// ----------------------------------------------------------- face drawing

const FACE_W = 512
const FACE_H = 320

function roundRect(g, x, y, w, h, r) {
  g.beginPath()
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r)
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r)
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath()
}

function star(g, cx, cy, r) {
  g.beginPath()
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2
    const rr = i % 2 === 0 ? r : r * 0.32
    g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
  }
  g.closePath(); g.fill()
}

/** Draw an expression. Eyes ~ vertical rounded bars like the happy front view. */
function drawFace(g, expr, mouth, blink) {
  g.clearRect(0, 0, FACE_W, FACE_H)
  const err = expr === 'error'
  // Visor plate with a readable border.
  roundRect(g, 10, 10, FACE_W - 20, FACE_H - 20, 92)
  g.fillStyle = err ? '#2a0d0c' : COLORS.visor
  g.fill()
  g.lineWidth = 14
  g.strokeStyle = err ? '#7a2a22' : COLORS.visorRim
  g.stroke()
  const c = err ? COLORS.red : COLORS.cyan
  g.fillStyle = c
  g.strokeStyle = c
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.shadowColor = c
  g.shadowBlur = 18
  const L = FACE_W * 0.36
  const R = FACE_W * 0.64
  const EY = FACE_H * 0.42
  const eye = (x, kind) => {
    if (blink && kind !== 'star' && kind !== 'x') { g.lineWidth = 16; g.beginPath(); g.moveTo(x - 22, EY + 8); g.lineTo(x + 22, EY + 8); g.stroke(); return }
    if (kind === 'bar') { roundRect(g, x - 20, EY - 46, 40, 92, 20); g.fill() }
    else if (kind === 'round') { g.beginPath(); g.arc(x, EY, 34, 0, Math.PI * 2); g.fill() }
    else if (kind === 'up') { g.lineWidth = 12; g.beginPath(); g.arc(x, EY, 30, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(x, EY - 14, 13, 0, Math.PI * 2); g.fill() }
    else if (kind === 'soft') { roundRect(g, x - 22, EY - 16, 44, 32, 16); g.fill() }
    else if (kind === 'wink') { g.lineWidth = 15; g.beginPath(); g.arc(x, EY + 18, 30, Math.PI * 1.15, Math.PI * 1.85); g.stroke() }
    else if (kind === 'star') star(g, x, EY, 52)
    else if (kind === 'x') { g.lineWidth = 16; g.beginPath(); g.moveTo(x - 28, EY - 28); g.lineTo(x + 28, EY + 28); g.moveTo(x + 28, EY - 28); g.lineTo(x - 28, EY + 28); g.stroke() }
  }
  const MY = FACE_H * 0.74
  const M = FACE_W / 2
  const smile = (w, d) => { g.lineWidth = 14; g.beginPath(); g.moveTo(M - w, MY - d * 0.3); g.quadraticCurveTo(M, MY + d, M + w, MY - d * 0.3); g.stroke() }
  const squiggle = () => { g.lineWidth = 11; g.beginPath(); for (let i = 0; i <= 6; i++) g.lineTo(M - 48 + i * 16, MY + (i % 2 ? -8 : 8)); g.stroke() }
  switch (expr) {
    case 'smile': eye(L, 'bar'); eye(R, 'bar'); break
    case 'surprised': eye(L, 'round'); eye(R, 'round'); break
    case 'thoughtful': eye(L, 'up'); eye(R, 'up'); break
    case 'quiet': eye(L, 'soft'); eye(R, 'soft'); break
    case 'wink': eye(L, 'bar'); eye(R, 'wink'); break
    case 'star': eye(L, 'star'); eye(R, 'star'); break
    case 'concerned': eye(L, 'bar'); eye(R, 'soft'); break
    case 'error': eye(L, 'x'); eye(R, 'x'); break
    default: eye(L, 'bar'); eye(R, 'bar')
  }
  // Mouth: speaking shapes override the resting mouth.
  if (mouth === 'open') { g.beginPath(); g.ellipse(M, MY, 26, 22, 0, 0, Math.PI * 2); g.fill() }
  else if (mouth === 'mid') { g.beginPath(); g.ellipse(M, MY, 32, 12, 0, 0, Math.PI * 2); g.fill() }
  else if (mouth === 'closed') smile(30, 10)
  else if (expr === 'smile' || expr === 'wink') smile(42, 22)
  else if (expr === 'surprised' || expr === 'star') { g.lineWidth = 11; g.beginPath(); g.ellipse(M, MY, 16, 20, 0, 0, Math.PI * 2); g.stroke() }
  else if (expr === 'thoughtful') { g.lineWidth = 12; g.beginPath(); g.moveTo(M - 30, MY + 6); g.quadraticCurveTo(M, MY - 8, M + 28, MY - 2); g.stroke() }
  else if (expr === 'quiet') smile(22, 6)
  else if (expr === 'concerned' || expr === 'error') squiggle()
  else smile(30, 10)
}

// ------------------------------------------------------------- character

export class NeoCharacter {
  /** @param {{simple?: boolean}} opts simple → reduced fallback geometry */
  constructor({ simple = false } = {}) {
    this.simple = simple
    this.disposables = []
    this.faceKey = ''
    this.root = new THREE.Group()
    this.root.name = 'NeoCharacter'
    this._build()
    this.setExpression('smile', null, false)
  }

  _mat(color) {
    const m = new THREE.MeshToonMaterial({ color, gradientMap: this.gradient })
    this.disposables.push(m)
    return m
  }

  _mesh(geo, mat, outline = 0) {
    this.disposables.push(geo)
    const m = new THREE.Mesh(geo, mat)
    if (outline && !this.simple) {
      const o = new THREE.Mesh(geo, this.outline)
      o.renderOrder = -1
      m.add(o)
    }
    return m
  }

  _build() {
    this.gradient = toonGradient()
    this.disposables.push(this.gradient)
    this.outline = outlineMaterial(0.008)
    this.disposables.push(this.outline)
    const blue = this._mat(COLORS.blue)
    const deep = this._mat(COLORS.deep)
    const pale = this._mat(COLORS.pale)
    const trim = this._mat(COLORS.trim)
    const cyanMat = new THREE.MeshBasicMaterial({ color: 0x5ff4ff })
    this.disposables.push(cyanMat)

    // Floating root and static glow ellipse.
    this.float = new THREE.Group()
    this.root.add(this.float)
    const glowGeo = new THREE.CircleGeometry(0.24, 40)
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x5ff4ff, transparent: true, opacity: 0.55, depthWrite: false })
    this.disposables.push(glowGeo, glowMat)
    this.glow = new THREE.Mesh(glowGeo, glowMat)
    this.glow.rotation.x = -Math.PI / 2
    this.glow.scale.set(1, 0.42, 1)
    this.glow.position.y = -0.17
    this.root.add(this.glow)

    this.yaw = new THREE.Group()
    this.float.add(this.yaw)
    this.lean = new THREE.Group()
    this.yaw.add(this.lean)

    // Torso: blue capsule, pale lower shell, pale trim band, deeper chest plates.
    const torso = this._mesh(lathe(TORSO, this.simple ? 24 : 48), blue, 1)
    this.lean.add(torso)
    if (!this.simple) {
      this.lean.add(this._mesh(lathe(band(TORSO, 0.0, 0.2, 0.004, 8)), pale))
      this.lean.add(this._mesh(lathe(band(TORSO, 0.465, 0.56, 0.006, 6)), trim))
      // Two deeper-blue chest plates either side of a central seam, below the band.
      const plate = (a0, a1) => this.lean.add(this._mesh(lathe(band(TORSO, 0.25, 0.44, 0.005, 6), 16, a0, a1 - a0), deep))
      plate(-0.95, -0.06); plate(0.06, 0.95)
      // Small blue tabs on the band, like the sheet's upper armour segments.
      for (const a of [-0.75, 0.75]) this.lean.add(this._mesh(lathe(band(TORSO, 0.48, 0.545, 0.011, 3), 10, a - 0.32, 0.64), blue))
      // Rear inset panel and seams (back view).
      this.lean.add(this._mesh(lathe(band(TORSO, 0.2, 0.42, 0.005, 6), 16, Math.PI - 0.5, 1.0), deep))
      for (const y of [0.27, 0.31, 0.35]) {
        const seam = this._mesh(new THREE.BoxGeometry(0.05, 0.006, 0.01), trim)
        seam.position.set(0.0, y, -0.267)
        this.lean.add(seam)
      }
      const hatch = this._mesh(new THREE.BoxGeometry(0.11, 0.035, 0.012), trim)
      hatch.position.set(0, 0.53, -0.262)
      this.lean.add(hatch)
    }
    // Chest light: cyan disc with concentric rings.
    const chest = new THREE.Group()
    chest.position.set(0, 0.44, 0.284)
    chest.add(this._mesh(new THREE.CircleGeometry(0.036, 28), cyanMat))
    if (!this.simple) {
      const r1 = this._mesh(new THREE.TorusGeometry(0.047, 0.009, 8, 32), trim)
      const r2 = this._mesh(new THREE.TorusGeometry(0.063, 0.007, 8, 32), deep)
      chest.add(r1, r2)
      const halo = new THREE.Mesh(new THREE.CircleGeometry(0.075, 28), new THREE.MeshBasicMaterial({ color: 0x5ff4ff, transparent: true, opacity: 0.18, depthWrite: false }))
      this.disposables.push(halo.geometry, halo.material)
      halo.position.z = -0.002
      chest.add(halo)
    }
    this.lean.add(chest)

    // Head with independent neck pivot.
    this.head = new THREE.Group()
    this.head.position.y = 0.6
    this.lean.add(this.head)
    this.head.add(this._mesh(lathe(HEAD, this.simple ? 24 : 48), blue, 1))
    // Visor: a curved patch hugging the helmet front, carrying the face texture.
    this.faceCanvas = document.createElement('canvas')
    this.faceCanvas.width = FACE_W
    this.faceCanvas.height = FACE_H
    this.faceCtx = this.faceCanvas.getContext('2d')
    this.faceTex = new THREE.CanvasTexture(this.faceCanvas)
    this.faceTex.colorSpace = THREE.SRGBColorSpace
    this.faceTex.anisotropy = 4
    this.disposables.push(this.faceTex)
    const visorMat = new THREE.MeshBasicMaterial({ map: this.faceTex, transparent: true, alphaTest: 0.05 })
    this.disposables.push(visorMat)
    const visorGeo = lathe(band(HEAD, 0.075, 0.37, 0.004, 14), 40, -1.12, 2.24)
    // Lathe UVs: u increases with phi (viewer's left → right), v increases upward.
    this.visor = this._mesh(visorGeo, visorMat)
    this.head.add(this.visor)
    // Antenna with a small round blue tip.
    const stem = this._mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.1, 8), trim)
    stem.position.y = 0.5
    const tip = this._mesh(new THREE.SphereGeometry(0.026, 16, 12), blue, 1)
    tip.position.y = 0.56
    this.head.add(stem, tip)

    // Paddle arms: blue outer shell, pale inner face, pivoted at the shoulder edge.
    this.arms = {}
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group()
      pivot.position.set(side * 0.318, 0.53, 0.0)
      const shell = this._mesh(new THREE.SphereGeometry(1, 24, 16), blue, 1)
      shell.scale.set(0.05, 0.215, 0.036)
      shell.position.y = -0.2
      pivot.add(shell)
      if (!this.simple) {
        const inner = this._mesh(new THREE.SphereGeometry(1, 20, 14), pale)
        inner.scale.set(0.03, 0.19, 0.03)
        inner.position.set(-side * 0.026, -0.2, 0.002)
        pivot.add(inner)
      }
      pivot.userData.side = side
      this.lean.add(pivot)
      this.arms[side > 0 ? 'right' : 'left'] = pivot
    }
    this.root.traverse((o) => { o.userData.neo = true })
  }

  /** Redraws the face only when expression, mouth or blink changes. */
  setExpression(expr, mouth = null, blink = false) {
    const key = `${expr}|${mouth}|${blink}`
    if (key === this.faceKey) return
    this.faceKey = key
    drawFace(this.faceCtx, expr, mouth, blink)
    this.faceTex.needsUpdate = true
  }

  /**
   * Apply a full pose. Every property is written once here.
   * pose = {hover, yaw, lean, headYaw, headPitch, arms:{left: Quaternion, right: Quaternion}, expr, mouth, blink, glow}
   */
  applyPose(p) {
    this.float.position.y = p.hover ?? 0
    this.yaw.rotation.y = p.yaw ?? 0
    this.lean.rotation.x = p.lean ?? 0
    this.head.rotation.set(p.headPitch ?? 0, p.headYaw ?? 0, 0, 'YXZ')
    for (const side of ['left', 'right']) {
      const q = p.arms?.[side]
      if (q) this.arms[side].quaternion.copy(q)
    }
    this.glow.material.opacity = 0.35 + 0.2 * (p.glow ?? 1)
    this.setExpression(p.expr ?? 'smile', p.mouth ?? null, !!p.blink)
  }

  dispose() {
    for (const d of this.disposables) d.dispose?.()
    this.disposables = []
  }
}

// ------------------------------------------------------- deterministic actions

const DOWN = new THREE.Vector3(0, -1, 0)
const _q = new THREE.Quaternion()
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))
const span = (t, a, b) => ease((t - a) / (b - a))

/** Rest pose of each arm: hanging with a slight outward tilt (front sheet). */
export function restArm(side) {
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), side * 0.13)
}

/** Arm quaternion pointing along dir (Neo body frame), clamped to stay outside the body. */
export function pointArm(side, dir) {
  const d = dir.clone().normalize()
  // Keep the paddle on its own side of the body and not straight into it.
  d.x = side > 0 ? Math.max(d.x, 0.22) : Math.min(d.x, -0.22)
  d.y = Math.max(d.y, -0.6)
  d.normalize()
  return new THREE.Quaternion().setFromUnitVectors(DOWN, d)
}

function slerpArm(side, target, k) {
  return restArm(side).slerp(target, Math.max(0, Math.min(1, k)))
}

/**
 * Compute Neo's pose from the active cue's action, cue-relative time τ and context.
 * ctx = {target: Vector3 (Neo frame; +Z toward viewer), speaking, mouthPhase, t (decorative clock),
 *        reduced, lineStart, lineEnd, duration, nodAt, idleOk}
 * Pure function of its inputs: seeking reconstructs the same pose.
 */
export function neoPose(action, expr, τ, ctx) {
  const reduced = !!ctx.reduced
  const tgt = (ctx.target ?? new THREE.Vector3(0, 0, 1)).clone()
  const T = reduced ? 1e4 : τ // reduced motion: hold each action's settled pose
  const pose = {
    hover: 0, yaw: 0, lean: 0, headYaw: 0, headPitch: 0,
    arms: { left: restArm(-1), right: restArm(1) },
    expr: expr || 'smile', mouth: null, blink: false, glow: 1,
  }
  // Facing: turn the body part-way toward the target and the head the rest.
  const look = (amount = 1, bodyShare = 0.55) => {
    // A three-quarter turn at most, so the face stays readable to the viewer.
    const total = Math.max(-1.0, Math.min(1.0, Math.atan2(tgt.x, 0.9 + Math.max(tgt.z, 0)))) * amount
    const pitchT = Math.atan2(tgt.y, Math.hypot(tgt.x, 0.9 + Math.abs(tgt.z))) * amount
    pose.yaw = total * bodyShare
    pose.headYaw = Math.max(-0.5, Math.min(0.5, total - pose.yaw))
    pose.headPitch = Math.max(-0.35, Math.min(0.4, -pitchT))
  }
  const nearSide = () => (tgt.x >= 0 ? 1 : -1)
  // Express the pointing direction in the body frame after body yaw.
  const bodyDir = () => tgt.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -pose.yaw)

  switch (action) {
    case 'greet': {
      // Face the viewer, smile, raise an arm, wave once, then turn toward the target.
      pose.expr = 'smile'
      const raise = span(T, 0.2, 0.8) * (1 - span(T, 2.6, 3.2))
      const wave = T > 0.8 && T < 2.6 ? Math.sin(((T - 0.8) / 1.8) * Math.PI * 2) * 0.35 : 0
      const up = pointArm(1, new THREE.Vector3(0.75, 0.75, 0.25))
      _q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), wave)
      pose.arms.right = slerpArm(1, up.premultiply(_q), reduced ? 0 : raise)
      const turn = span(T, 3.2, 4.4)
      if (turn > 0) { const keep = tgt.clone(); look(turn); tgt.copy(keep) }
      break
    }
    case 'present': case 'point': {
      // Head first, then the nearest arm; hold, then ease back.
      look(span(T, 0, 0.45))
      const side = nearSide()
      const k = span(T, 0.35, 0.95) * (1 - span(T, (ctx.duration ?? 6) - 1.2, (ctx.duration ?? 6) - 0.4))
      const holdK = reduced ? 0.0 : k
      pose.arms[side > 0 ? 'right' : 'left'] = slerpArm(side, pointArm(side, bodyDir()), holdK)
      break
    }
    case 'pointHold': {
      // Point and keep pointing (deployment hinge, dust close-up), head keeps tracking.
      look(span(T, 0, 0.4))
      const side = nearSide()
      pose.arms[side > 0 ? 'right' : 'left'] = slerpArm(side, pointArm(side, bodyDir()), reduced ? 1 : span(T, 0.3, 0.9))
      break
    }
    case 'track': {
      look(1)
      break
    }
    case 'inspect': {
      // Lean toward the specimen; small nod at the explanation.
      look(1, 0.45)
      pose.lean = 0.16 * span(T, 0, 0.8)
      const nod = ctx.nodAt != null && !reduced ? Math.sin(Math.max(0, Math.min(1, (T - ctx.nodAt) / 0.7)) * Math.PI) * 0.14 : 0
      pose.headPitch += nod
      pose.arms.right = slerpArm(1, pointArm(1, new THREE.Vector3(0.5, -0.2, 0.5)), 0.25)
      pose.arms.left = slerpArm(-1, pointArm(-1, new THREE.Vector3(-0.5, -0.2, 0.5)), 0.25)
      break
    }
    case 'gazeUp': {
      tgt.y = Math.max(tgt.y, 1.4)
      look(span(T, 0, 0.6))
      break
    }
    case 'reflect': {
      // Lowered arms, quiet face, slow turn toward the rover or record; mostly still.
      look(span(T, 0, 2.5) * 0.85, 0.7)
      const low = (s) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), s * 0.03)
      pose.arms.left = low(-1); pose.arms.right = low(1)
      pose.glow = 0.6
      break
    }
    case 'farewell': {
      // Back to the viewer: warm smile and a small wave.
      pose.expr = 'smile'
      const raise = span(T, 0.6, 1.1) * (1 - span(T, 2.8, 3.3))
      const wave = T > 1.1 && T < 2.8 ? Math.sin(((T - 1.1) / 1.7) * Math.PI * 2) * 0.25 : 0
      const up = pointArm(1, new THREE.Vector3(0.8, 0.45, 0.3))
      _q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), wave)
      pose.arms.right = slerpArm(1, up.premultiply(_q), reduced ? 0 : raise)
      break
    }
    case 'error': {
      pose.expr = 'error'
      pose.arms.left = slerpArm(-1, pointArm(-1, new THREE.Vector3(-0.6, 0.8, 0.1)), 1)
      pose.arms.right = slerpArm(1, pointArm(1, new THREE.Vector3(0.6, 0.8, 0.1)), 1)
      break
    }
    default:
      look(0.4)
  }
  // Brief expression accents at cue start (surprise, wide eyes) unless reduced.
  if (ctx.accent && !reduced && τ < ctx.accent.until) pose.expr = ctx.accent.expr
  // Speaking mouth: a restrained cycle, no lip-sync implied.
  if (ctx.speaking) pose.mouth = ['closed', 'mid', 'open', 'mid'][Math.floor((ctx.mouthPhase ?? 0) * 7) % 4]
  // Decorative idle: slow hover and an occasional blink, frozen when paused or reduced.
  if (ctx.idleOk && !reduced) {
    const t = ctx.t ?? 0
    pose.hover = Math.sin((t / 3.2) * Math.PI * 2) * 0.025
    pose.blink = t % 4.7 < 0.13 && pose.expr !== 'error'
  }
  return pose
}
