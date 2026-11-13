// A single cancellable camera transition around the globe centre. Orbit direction
// uses shortest-arc spherical interpolation and radius is interpolated separately,
// so the camera never cuts a Cartesian line through Mars.

import * as THREE from 'three'

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _axis = new THREE.Vector3()
const _tmp = new THREE.Vector3()

function slerpDir(from, to, t, out) {
  const d = THREE.MathUtils.clamp(from.dot(to), -1, 1)
  const omega = Math.acos(d)
  if (omega < 1e-5) return out.copy(from).lerp(to, t).normalize()
  if (Math.PI - omega < 1e-4) {
    // Antipodal: rotate about a deterministic perpendicular axis.
    _axis.set(0, 1, 0).cross(from)
    if (_axis.lengthSq() < 1e-8) _axis.set(1, 0, 0).cross(from)
    _axis.normalize()
    return out.copy(from).applyAxisAngle(_axis, omega * t).normalize()
  }
  const s = Math.sin(omega)
  return out.copy(from).multiplyScalar(Math.sin((1 - t) * omega) / s)
    .add(_tmp.copy(to).multiplyScalar(Math.sin(t * omega) / s)).normalize()
}

export class CameraFlight {
  constructor({ camera, controls, gsap = null }) {
    this.camera = camera
    this.controls = controls
    this.gsap = gsap
    this.tween = null
    this.token = 0
    this.active = false
    this.currentTarget = new THREE.Vector3()
  }

  /** Stop residual OrbitControls damping so the captured pose is final. */
  freezeControls() {
    const c = this.controls
    c._sphericalDelta?.set(0, 0, 0)
    c._panOffset?.set(0, 0, 0)
    if ('_scale' in c) c._scale = 1
  }

  /**
   * Fly to look at the globe centre from direction toDir (world, unit) at radius toRadius.
   * Returns a promise resolving to true when this flight completed, false if superseded.
   */
  fly({ toDir, toRadius, immediate = false, onDone }) {
    const token = ++this.token
    this._kill()
    const { camera, controls } = this
    // A flight interrupted by this one is looking at its interpolated target.
    const fromTarget = (this.active ? this.currentTarget : controls.target).clone()
    this.freezeControls()
    controls.enabled = false
    this.active = true

    const fromDir = camera.position.clone().normalize()
    const fromR = camera.position.length()
    const target = new THREE.Vector3()
    const dir = toDir.clone().normalize()

    const apply = (t) => {
      slerpDir(fromDir, dir, t, _a)
      const r = THREE.MathUtils.lerp(fromR, toRadius, t)
      target.copy(fromTarget).lerp(_b.set(0, 0, 0), t)
      camera.position.copy(_a).multiplyScalar(r)
      camera.lookAt(target)
      this.currentTarget.copy(target)
    }

    const finish = () => {
      if (token !== this.token) return
      apply(1)
      controls.target.set(0, 0, 0)
      const damping = controls.enableDamping
      controls.enableDamping = false
      controls.update()
      controls.enableDamping = damping
      controls.enabled = true
      this.active = false
      this.tween = null
      onDone?.(true)
    }

    if (immediate || !this.gsap) { finish(); return }
    const progress = { t: 0 }
    this.tween = this.gsap.to(progress, {
      t: 1,
      duration: 1.1,
      ease: 'power2.inOut',
      onUpdate: () => { if (token === this.token) apply(progress.t) },
      onComplete: finish,
    })
  }

  /** Cancel from the current pose. Controls are always restored. */
  cancel() {
    this.token++
    this._kill()
    if (this.active) {
      const { camera, controls } = this
      // Keep the current pose: the camera is looking exactly at the interpolated target.
      controls.target.copy(this.currentTarget)
      const damping = controls.enableDamping
      controls.enableDamping = false
      controls.update()
      controls.enableDamping = damping
      controls.enabled = true
      this.active = false
    }
  }

  _kill() {
    if (this.tween) { this.tween.kill(); this.tween = null }
  }
}
