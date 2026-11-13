// Renders Neo through the existing renderer in a reserved corner (scissored viewport),
// on the side of the shot that leaves the rover and clue clear. Neo has his own small
// scene, camera and lights, so he never enters globe or stage picking, and never covers
// the subject. Viewport, scissor and autoClear state are restored after each draw.

import * as THREE from 'three'
import { NeoCharacter, neoPose } from './NeoCharacter.js'

const _v = new THREE.Vector3()
const _size = new THREE.Vector2()
const _vp = new THREE.Vector4()

export class NeoView {
  constructor() {
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(28, 0.78, 0.1, 20)
    this.camera.position.set(0, 0.62, 3.5)
    this.camera.lookAt(0, 0.5, 0)
    this.scene.add(new THREE.HemisphereLight(0xf2f6ff, 0x6a4a3a, 1.5))
    const key = new THREE.DirectionalLight(0xffffff, 2.0)
    key.position.set(1.6, 2.4, 3)
    const rim = new THREE.DirectionalLight(0x9fdcff, 1.2)
    rim.position.set(-2.5, 1.5, -2)
    this.scene.add(key, rim)
    this.status = 'full'
    try {
      this.neo = new NeoCharacter()
    } catch (err) {
      console.warn('[neo] detailed model failed, using simplified Neo', err)
      this.neo = new NeoCharacter({ simple: true })
      this.status = 'simple'
    }
    this.scene.add(this.neo.root)
    this.rect = { x: 0, y: 0, w: 0, h: 0 }
    this.visible = false
  }

  /** Corner rectangle (CSS px, top-left origin) on the requested side. */
  layout(size, side) {
    const narrow = size.w < 600
    const w = Math.round(Math.min(narrow ? size.w * 0.3 : Math.max(130, size.w * 0.17), 230))
    const h = Math.round(w * 1.28)
    const m = 10
    const x = side === 'left' ? m : size.w - w - m
    const y = size.h - h - m
    this.rect = { x, y, w, h, side }
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    return this.rect
  }

  /**
   * Convert a world target seen by mainCam into Neo's frame (+Z toward the viewer):
   * the direction from Neo's corner to the target's screen point, pushed into the scene.
   */
  targetFromWorld(world, mainCam, size) {
    if (!world) return new THREE.Vector3(0, 0, 1)
    if (world === 'viewer') return new THREE.Vector3(0, 0.05, 1)
    if (world === 'sky') return new THREE.Vector3(this.rect.side === 'left' ? 0.6 : -0.6, 1.6, -0.6)
    _v.copy(world).applyMatrix4(mainCam.matrixWorldInverse)
    const behind = _v.z > 0
    _v.copy(world).project(mainCam)
    const sx = behind ? (this.rect.side === 'left' ? 1 : -1) : THREE.MathUtils.clamp(_v.x, -1.5, 1.5)
    const sy = behind ? 0 : THREE.MathUtils.clamp(_v.y, -1.5, 1.5)
    return this.targetFromScreen(sx, sy, size)
  }

  targetFromScreen(sx, sy, size) {
    const r = this.rect
    const nx = ((r.x + r.w / 2) / size.w) * 2 - 1
    const ny = -(((r.y + r.h * 0.45) / size.h) * 2 - 1)
    return new THREE.Vector3((sx - nx) * (size.w / size.h) * 1.1, (sy - ny) * 1.1, -0.9)
  }

  /** Pose Neo from cue state. ns = {action, expr, τ, target, speaking, mouthPhase, t, reduced, idleOk, nodAt, accent, duration} */
  update(ns) {
    const pose = neoPose(ns.action, ns.expr, ns.τ, ns)
    this.neo.applyPose(pose)
    this.lastPose = pose
  }

  render(renderer, size) {
    const r = this.rect
    if (!r.w) return
    renderer.getSize(_size)
    renderer.getViewport(_vp)
    const prevAuto = renderer.autoClear
    const y = size.h - r.y - r.h // WebGL viewport origin is bottom-left
    renderer.setScissorTest(true)
    renderer.setScissor(r.x, y, r.w, r.h)
    renderer.setViewport(r.x, y, r.w, r.h)
    renderer.autoClear = false
    renderer.clearDepth()
    renderer.render(this.scene, this.camera)
    renderer.autoClear = prevAuto
    renderer.setScissorTest(false)
    renderer.setScissor(0, 0, _size.x, _size.y)
    renderer.setViewport(_vp)
  }

  dispose() {
    this.neo.dispose()
  }
}
