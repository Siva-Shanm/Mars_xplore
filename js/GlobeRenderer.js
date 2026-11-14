// Renderer, controls, model lifecycle, marker projection and picking.
// Loaded via dynamic import so a CDN or WebGL failure never blocks mission content.

import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CameraFlight } from './CameraFlight.js'
import { TraverseRenderer } from './TraverseRenderer.js'
import { coordinatesToUnit, latLonToUnit } from './geography.js'
import { resolveLocal } from './validate.js'
import { RoverLibrary, makeLander, makeSojourner } from './RoverModels.js'
import { TourStage } from './TourStage.js'
import { NeoView } from './NeoView.js'

export { RoverLibrary, TourStage }

const PICK_LAYER = 1
const MARKER_LIFT = 0.004
const IDLE_DELAY_MS = 4000
const IDLE_SPEED = 0.045 // rad/s
const LOAD_DEADLINE_MS = 10000
const HOME_LATLON = [12, -18] // frames Ares Vallis (19°N 33.5°W) and Meridiani (2°S 5.5°W)
const FLY_RADIUS = 2.6
const FACING_TOLERANCE = 0.08
const ROVER_OFFSET = 0.05 // rad south of the marker, so the enlarged rover never hides it
const ROVER_DISPLAY = 0.03 // globe units per rover height: enlarged for visibility
const FADE_MS = 240
const CLOSE_RADIUS = 1.32

const _v = new THREE.Vector3()
const _n = new THREE.Vector3()
const _c = new THREE.Vector3()
const _p = new THREE.Vector3()
const _ndc = new THREE.Vector2()

function disposeObject(root) {
  root?.traverse((o) => {
    if (o.userData.shared) return // rover library template parts are reused
    o.geometry?.dispose()
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []
    for (const m of mats) {
      if (m.userData.shared) continue
      for (const v of Object.values(m)) if (v && v.isTexture) v.dispose()
      m.dispose()
    }
  })
}

export function webglAvailable() {
  try {
    const c = document.createElement('canvas')
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2')) || !!c.getContext('webgl')
  } catch { return false }
}

export class GlobeRenderer {
  constructor({ stage, canvasHost, poiLayer, missions, model, gsap, reducedMotion, callbacks, roverLibrary }) {
    this.library = roverLibrary
    this.view = 'globe' // 'globe' | 'tour'
    this.tourStage = null
    this.tourFS = null
    this.neoView = null
    this.playhead = 0
    this.playing = false
    this.viewToken = 0
    this.globeRovers = new Map()
    this.callout = null
    this.calloutMode = null
    this.stage = stage
    this.canvasHost = canvasHost
    this.poiLayer = poiLayer
    this.missions = missions
    this.modelInfo = model
    this.gsap = gsap
    this.cb = callbacks
    this.reducedMotion = reducedMotion
    this.motionPaused = false
    this.selectedId = null
    this.lastInput = performance.now()
    this.gesture = false
    this.surface = 'reference'
    this.modelVerified = false
    this.modelReady = false
    this.markers = new Map()
    this.journeyLabels = []
    this.journeyState = null
    this.size = { w: 1, h: 1 }
    this.loadToken = 0
    this.disposed = false
  }

  init() {
    if (!webglAvailable()) throw new Error('WebGL is unavailable in this browser')
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    renderer.domElement.setAttribute('aria-hidden', 'true')
    renderer.domElement.style.touchAction = 'none'
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.canvasHost.append(renderer.domElement)
    this.renderer = renderer

    const scene = new THREE.Scene()
    this.scene = scene
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 40)
    camera.layers.set(0)
    this.camera = camera

    scene.add(new THREE.HemisphereLight(0xfff3ea, 0x1a1012, 0.9))
    const key = new THREE.DirectionalLight(0xffffff, 2.1)
    key.position.set(-3, 2, 4)
    const fill = new THREE.DirectionalLight(0x9fc7ff, 0.45)
    fill.position.set(4, -1, -2)
    // Lights follow the camera so the side being inspected is always lit.
    camera.add(key, fill)
    scene.add(camera)

    // globeRoot: +Y is Mars north. Everything that must rotate together lives here.
    const globeRoot = new THREE.Group()
    globeRoot.name = 'globeRoot'
    scene.add(globeRoot)
    this.globeRoot = globeRoot

    const fallback = new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 48),
      new THREE.MeshStandardMaterial({ color: 0xb4532f, roughness: 0.95, metalness: 0 }),
    )
    fallback.name = 'referenceSphere'
    globeRoot.add(fallback)
    this.fallback = fallback
    this.graticule = this._graticule()
    globeRoot.add(this.graticule)

    this.modelOrient = new THREE.Group() // calibration (prime meridian yaw)
    this.modelNorm = new THREE.Group() // centring and uniform scale
    this.modelOrient.add(this.modelNorm)
    this.modelOrient.visible = false
    globeRoot.add(this.modelOrient)

    // Interaction proxy for the globe surface (pick layer only, never drawn).
    const proxyMat = new THREE.MeshBasicMaterial({ visible: false })
    this.globeProxy = new THREE.Mesh(new THREE.SphereGeometry(0.99, 48, 32), proxyMat)
    this.globeProxy.layers.set(PICK_LAYER)
    globeRoot.add(this.globeProxy)

    const controls = new OrbitControls(camera, renderer.domElement)
    Object.assign(controls, {
      enableRotate: true, enableZoom: true, enablePan: true, enableDamping: true, screenSpacePanning: true,
      autoRotate: false, dampingFactor: 0.075, rotateSpeed: 0.65, zoomSpeed: 0.9, panSpeed: 0.65,
      minDistance: 1.25, maxDistance: 8, minPolarAngle: 0.01, maxPolarAngle: Math.PI - 0.01,
      minAzimuthAngle: -Infinity, maxAzimuthAngle: Infinity,
    })
    controls.cursor.set(0, 0, 0)
    controls.maxTargetRadius = 0.15
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }
    controls.keyPanSpeed = 12
    controls.listenToKeyEvents(this.stage)
    controls.addEventListener('start', () => { this.gesture = true; this.markInput() })
    controls.addEventListener('end', () => { this.gesture = false; this.markInput() })
    this.controls = controls

    this.flight = new CameraFlight({ camera, controls, gsap: this.gsap })
    this.traverse = new TraverseRenderer(globeRoot)
    this.raycaster = new THREE.Raycaster()
    this.raycaster.layers.set(PICK_LAYER)

    this._buildMarkers()
    this._buildRovers()
    this._unsubLibrary = this.library?.onReady(() => this._onRoverModelReady())
    this._buildCallout()
    this._bindInput()

    this.resizeObserver = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      this._resize(r.width, r.height)
    })
    this.resizeObserver.observe(this.stage)
    const rect = this.stage.getBoundingClientRect()
    this._resize(rect.width, rect.height)
    this._setHomePose()

    this._onVisibility = () => {
      if (document.hidden) this.renderer.setAnimationLoop(null)
      else this._start()
    }
    document.addEventListener('visibilitychange', this._onVisibility)

    this._onContextLost = (e) => {
      e.preventDefault()
      this.renderer.setAnimationLoop(null)
      this.cb.onFatal?.(new Error('The 3D view lost its graphics context'))
    }
    renderer.domElement.addEventListener('webglcontextlost', this._onContextLost)

    this._applySurface()
    this._start()
    this.cb.onStatus?.('globe', 'Simplified globe', 'info')
    this._roverStatus()
    this.loadModel()
    return this
  }

  // ---------------------------------------------------------------- lifecycle

  _start() {
    this.lastFrame = performance.now()
    this.renderer.setAnimationLoop((t) => this._frame(t))
  }

  dispose() {
    this.disposed = true
    this.loadToken++
    this.flight?.cancel()
    this.renderer?.setAnimationLoop(null)
    this.resizeObserver?.disconnect()
    document.removeEventListener('visibilitychange', this._onVisibility)
    this.controls?.dispose()
    this.traverse?.clear()
    this._unsubLibrary?.()
    this.viewToken++
    this.tourStage?.dispose()
    this.tourStage = null
    this.neoView?.dispose()
    this.callout?.remove()
    this.stage.classList.remove('is-fading', 'is-surface')
    for (const m of this.markers.values()) m.button.remove()
    for (const l of this.journeyLabels) l.el.remove()
    disposeObject(this.scene)
    this.renderer?.dispose()
    this.renderer?.domElement.remove()
  }

  _resize(w, h) {
    if (!(w > 0 && h > 0)) return
    this.size = { w, h }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.tourStage?.resize(w, h)
    this.homeDistance = this._fitDistance() * 1.12
    this.controls.maxDistance = Math.max(8, this.homeDistance * 1.2)
  }

  _fitDistance() {
    const v = THREE.MathUtils.degToRad(this.camera.fov / 2)
    const h = Math.atan(Math.tan(v) * this.camera.aspect)
    return 1 / Math.sin(Math.min(v, h))
  }

  _homeDirWorld() {
    const [x, y, z] = latLonToUnit(...HOME_LATLON)
    return this.globeRoot.localToWorld(new THREE.Vector3(x, y, z)).normalize()
  }

  _setHomePose() {
    this.globeRoot.updateMatrixWorld(true)
    this.camera.position.copy(this._homeDirWorld()).multiplyScalar(this.homeDistance)
    this.controls.target.set(0, 0, 0)
    this.camera.lookAt(0, 0, 0)
    this.controls.update()
  }

  // -------------------------------------------------------------------- model

  async loadModel() {
    const info = this.modelInfo
    if (!info) {
      this.cb.onStatus?.('globe', 'Simplified globe · no model supplied', 'info')
      return
    }
    const token = ++this.loadToken
    let foreign = false
    const manager = new THREE.LoadingManager()
    manager.setURLModifier((url) => {
      if (/^(data|blob):/i.test(url)) return url
      const u = new URL(url, document.baseURI)
      if (u.origin !== location.origin) { foreign = true; return 'data:application/octet-stream,' }
      return url
    })
    const loader = new GLTFLoader(manager)
    let timer
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Model load timed out')), LOAD_DEADLINE_MS) })
    let gltf
    try {
      gltf = await Promise.race([loader.loadAsync(resolveLocal(info.src)), deadline])
    } catch (err) {
      clearTimeout(timer)
      if (token === this.loadToken && !this.disposed) {
        console.warn('[globe] model load failed:', err)
        this.cb.onStatus?.('globe', 'Simplified globe · model unavailable', 'warn')
      }
      // A late success after timeout is discarded by the token check below.
      return
    }
    clearTimeout(timer)
    if (token !== this.loadToken || this.disposed) { disposeObject(gltf.scene); return }

    const root = gltf.scene
    try {
      if (foreign) throw new Error('Model references non-local resources')
      root.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(root)
      const size = box.getSize(new THREE.Vector3())
      if (![size.x, size.y, size.z].every((s) => Number.isFinite(s) && s > 0)) throw new Error('Model has empty or non-finite bounds')
      const maxS = Math.max(size.x, size.y, size.z)
      const minS = Math.min(size.x, size.y, size.z)
      if (minS / maxS < 0.9) throw new Error('Model silhouette is not approximately spherical')
      const center = box.getCenter(new THREE.Vector3())
      root.position.sub(center)
      this.modelNorm.scale.setScalar(2 / maxS)
      this.modelNorm.add(root)
      this.modelOrient.rotation.y = THREE.MathUtils.degToRad(info.primeMeridianYawDeg || 0)
      this.modelOrient.updateMatrixWorld(true)
      this.modelMeshes = []
      root.traverse((o) => { if (o.isMesh) this.modelMeshes.push(o) })
      if (!this.modelMeshes.length) throw new Error('Model contains no meshes')
    } catch (err) {
      console.warn('[globe] model rejected:', err)
      this.modelNorm.remove(root)
      disposeObject(root)
      this.cb.onStatus?.('globe', 'Simplified globe · model invalid', 'warn')
      return
    }

    this.modelReady = true
    this.modelVerified = info.registrationStatus === 'verified'
    this.surface = 'model'
    this._applySurface()
    this.cb.onModelReady?.({ verified: this.modelVerified })
  }

  /** 'model' (textured asset) or 'reference' (oriented unit sphere). */
  setSurface(mode) {
    if (mode === 'model' && !this.modelReady) return
    this.surface = mode
    this._applySurface()
  }

  _applySurface() {
    const textured = this.surface === 'model' && this.modelReady
    this.modelOrient.visible = textured
    this.fallback.visible = !textured
    this.graticule.visible = !textured
    this._surfaceRadius = new Map()
    this.markersSuppressed = textured && !this.modelVerified
    for (const m of this.markers.values()) this._placeMarker(m)
    if (this.roverRoot) this.roverRoot.visible = !this.markersSuppressed
    if (textured && !this.modelVerified) {
      this.cb.onStatus?.('globe', 'Textured model · surface alignment unverified · markers and routes hidden', 'warn',
        { label: 'Use reference sphere', run: () => this.cb.onRequestSurface?.('reference') })
    } else if (textured) {
      this.cb.onStatus?.('globe', 'Textured Mars model', 'ok')
    } else if (this.modelReady) {
      this.cb.onStatus?.('globe', 'Reference sphere (oriented, untextured)', 'info')
    }
    this._refreshJourney()
    this.cb.onSurfaceChange?.(this.surface, { modelReady: this.modelReady, verified: this.modelVerified })
  }

  /** Local surface radius along a unit direction in globeRoot space. */
  radiusAt(dir) {
    if (!(this.surface === 'model' && this.modelReady)) return 1
    const key = `${dir.x.toFixed(4)},${dir.y.toFixed(4)},${dir.z.toFixed(4)}`
    if (this._surfaceRadius.has(key)) return this._surfaceRadius.get(key)
    this.globeRoot.updateMatrixWorld(true)
    const origin = this.globeRoot.localToWorld(dir.clone().normalize().multiplyScalar(2))
    const center = this.globeRoot.localToWorld(new THREE.Vector3())
    const rc = new THREE.Raycaster(origin, center.sub(origin).normalize(), 0, 2)
    const hit = rc.intersectObjects(this.modelMeshes, false)[0]
    const r = hit ? THREE.MathUtils.clamp(2 - hit.distance, 0.9, 1.1) : 1
    this._surfaceRadius.set(key, r)
    return r
  }

  _graticule() {
    const pts = []
    const seg = 96
    const ring = (fn) => { for (let i = 0; i < seg; i++) { pts.push(fn(i / seg), fn((i + 1) / seg)) } }
    const at = (lat, lon) => { const [x, y, z] = latLonToUnit(lat, lon); return new THREE.Vector3(x, y, z).multiplyScalar(1.0015) }
    for (let lat = -60; lat <= 60; lat += 30) ring((t) => at(lat, -180 + 360 * t))
    for (let lon = -180; lon < 180; lon += 30) ring((t) => at(-90 + 180 * t, lon))
    const g = new THREE.BufferGeometry().setFromPoints(pts)
    return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffd2b8, transparent: true, opacity: 0.16, depthWrite: false }))
  }

  // ------------------------------------------------------------------ markers

  _buildMarkers() {
    for (const m of this.missions) {
      const landing = m.waypoints.find((w) => w.id === m.site.landingWaypointId)
      if (!landing?.coordinates) continue
      const [x, y, z] = coordinatesToUnit(landing.coordinates)
      const dir = new THREE.Vector3(x, y, z)
      const anchor = new THREE.Object3D()
      anchor.name = `anchor-${m.id}`
      this.globeRoot.add(anchor)
      const proxy = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ visible: false }))
      proxy.layers.set(PICK_LAYER)
      proxy.userData.missionId = m.id
      anchor.add(proxy)

      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'poi'
      button.dataset.missionId = m.id
      button.setAttribute('aria-label', `${m.name}: ${m.site.name} landing site`)
      const ring = document.createElement('span'); ring.className = 'poi-ring'; ring.setAttribute('aria-hidden', 'true')
      const dot = document.createElement('span'); dot.className = 'poi-dot'; dot.setAttribute('aria-hidden', 'true')
      const label = document.createElement('span'); label.className = 'poi-label'; label.textContent = m.id === 'sojourner' ? 'Pathfinder' : m.name
      label.setAttribute('aria-hidden', 'true')
      button.append(ring, dot, label)
      button.hidden = true
      button.addEventListener('click', (e) => this._onMarkerClick(e, m.id))
      this.poiLayer.append(button)
      this.markers.set(m.id, { id: m.id, dir, anchor, proxy, button, visible: false })
    }
  }

  _placeMarker(m) {
    const r = this.radiusAt(m.dir)
    m.anchor.position.copy(m.dir).multiplyScalar(r + MARKER_LIFT)
    m.proxy.layers.set(this.markersSuppressed ? 31 : PICK_LAYER)
    this._placeGlobeRover(m.id)
  }

  // ------------------------------------------------------------ globe rovers

  _buildRovers() {
    this.roverRoot = new THREE.Group()
    this.roverRoot.name = 'globeRovers'
    this.globeRoot.add(this.roverRoot)
    for (const m of this.markers.values()) this._makeGlobeRover(m.id)
  }

  _makeGlobeRover(id) {
    const old = this.globeRovers.get(id)
    if (old) { this.roverRoot.remove(old.holder); disposeObject(old.holder) }
    const holder = new THREE.Group()
    holder.name = `globe-rover-${id}`
    let height
    let simplified
    if (id === 'sojourner') {
      const lander = makeLander({ withRamp: true, withAirbags: false })
      lander.setAirbags(0); lander.setPetals(1); lander.setRamp(1)
      const rover = makeSojourner()
      rover.root.position.set(lander.rampFoot.x + 0.45, 0, 0.2)
      rover.root.rotation.y = Math.PI / 2
      holder.add(lander.root, rover.root)
      height = 0.9
      simplified = true
    } else {
      const inst = this.library ? this.library.createMER() : null
      if (!inst) return
      holder.add(inst.root)
      height = inst.dims.height || 1.5
      simplified = inst.simplified
    }
    holder.scale.setScalar(ROVER_DISPLAY / height)
    // Rovers render on the default layer only, so they never intercept picking.
    this.roverRoot.add(holder)
    this.globeRovers.set(id, { holder, simplified })
    this._placeGlobeRover(id)
  }

  _placeGlobeRover(id) {
    const gr = this.globeRovers.get(id)
    const m = this.markers.get(id)
    if (!gr || !m || !this.roverRoot) return
    const n = m.dir.clone().normalize()
    const east = new THREE.Vector3(0, 1, 0).cross(n).normalize()
    const north = new THREE.Vector3().crossVectors(n, east).normalize()
    const at = n.clone().multiplyScalar(Math.cos(ROVER_OFFSET)).addScaledVector(north, -Math.sin(ROVER_OFFSET)).normalize()
    const r = this.radiusAt(at)
    const up = at.clone()
    const fwd = north.clone().addScaledVector(up, -north.dot(up)).normalize()
    const right = new THREE.Vector3().crossVectors(up, fwd)
    gr.holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, fwd))
    gr.holder.position.copy(at).multiplyScalar(r)
    gr.holder.visible = !this.markersSuppressed
  }

  _onRoverModelReady() {
    for (const id of ['spirit', 'opportunity']) if (this.markers.has(id)) this._makeGlobeRover(id)
    this.tourStage?.requestModelSwap()
    this._roverStatus()
  }

  _roverStatus() {
    const simplified = this.library && !this.library.merReady
    this.cb.onStatus?.('rovers', `Rovers enlarged for visibility · not to scale${simplified ? ' · Simplified rover model' : ''}`, 'info')
  }

  // ------------------------------------------------------------ surface view

  _buildCallout() {
    const el = document.createElement('div')
    el.className = 'callout'
    el.hidden = true
    el.setAttribute('aria-hidden', 'true') // the caption region carries the accessible text
    this.poiLayer.append(el)
    this.callout = el
  }

  // ------------------------------------------------------------ guided tour

  /** Enter tour mode: OrbitControls off, camera driven by the tour playhead. */
  beginTour() {
    if (this.view !== 'tour') this.savedPose = { pos: this.camera.position.clone(), target: this.controls.target.clone() }
    this.flight.cancel()
    this.view = 'tour'
    this.controls.enabled = false
    if (!this.neoView) {
      try { this.neoView = new NeoView() } catch (err) { console.warn('[neo] unavailable', err); this.neoView = null }
    }
    this.cb.onNeoStatus?.(this.neoView ? this.neoView.status : 'none')
  }

  /** Leave tour mode and restore the globe pose saved on entry. */
  endTour() {
    if (this.view !== 'tour') return
    this.view = 'globe'
    this.tourFS = null
    this.setCallout(null)
    this.tourStage?.dispose()
    this.tourStage = null
    this.stage.classList.remove('is-surface', 'is-fading')
    for (const m of this.markers.values()) m.button.classList.remove('is-tour-highlight')
    if (this.savedPose) {
      this.camera.position.copy(this.savedPose.pos)
      this.controls.target.copy(this.savedPose.target)
      this.camera.lookAt(this.controls.target)
      const d = this.controls.enableDamping
      this.controls.enableDamping = false
      this.controls.update()
      this.controls.enableDamping = d
    }
    this.controls.enabled = true
    this.markInput()
  }

  /** Build (or reuse) the illustrative stage for a chapter. Old stages are disposed. */
  loadTourStage(chapterId, run, approvals) {
    if (this.tourStage && this.tourStage.id === chapterId && this.tourStage.run === run) return this.tourStage
    this.tourStage?.dispose()
    this.tourStage = null
    if (!['pf', 'sp', 'op'].includes(chapterId)) return null
    const small = Math.min(this.size.w, this.size.h) < 560
    this.tourStage = new TourStage({ chapterId, run, library: this.library, approvals, quality: { shadows: !small, segments: small ? 110 : 170 } })
    this.tourStage.resize(this.size.w, this.size.h)
    return this.tourStage
  }

  /** Per-frame state from the tour controller (single playhead). */
  setTourFrame(fs) {
    const prev = this.tourFS
    this.tourFS = fs
    if (fs && prev && fs.view !== prev.view && fs.playing && !this.reducedMotion) {
      this.stage.classList.add('is-fading')
      clearTimeout(this._fadeTimer)
      this._fadeTimer = setTimeout(() => this.stage.classList.remove('is-fading'), FADE_MS)
    }
    if (fs) this.stage.classList.toggle('is-surface', fs.view === 'surface')
  }

  get inSurface() { return this.view === 'tour' }

  get roverSimplified() { return this.tourStage ? this.tourStage.roverIsSimplified : !this.library?.merReady }

  setPlanVisible(v) { this.tourStage?.setPlanVisible(v) }

  _siteDir(id) {
    if (id === 'home' || !id) return new THREE.Vector3(...latLonToUnit(...HOME_LATLON))
    const m = this.markers.get(id)
    return m ? m.dir.clone() : new THREE.Vector3(...latLonToUnit(...HOME_LATLON))
  }

  /** Globe camera for tour beats: slerp between site directions (globe-local). */
  _tourGlobeCamera(g) {
    const from = g.from === 'current' ? (this._lastGlobeDir ?? this._siteDir('home')) : this._siteDir(g.from)
    const to = this._siteDir(g.to)
    const k = g.k
    const q = new THREE.Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize())
    const dir = from.clone().normalize().applyQuaternion(new THREE.Quaternion().slerp(q, k))
    const rFar = this.homeDistance
    const r = g.to === 'home' ? THREE.MathUtils.lerp(1.9, rFar, k) : THREE.MathUtils.lerp(g.from === 'home' ? rFar : 2.4, 1.65, k)
    this.globeRoot.updateMatrixWorld(true)
    const world = this.globeRoot.localToWorld(dir.clone())
    this.camera.position.copy(world.normalize().multiplyScalar(r))
    this.camera.lookAt(0, 0, 0)
    this.camera.updateMatrixWorld()
  }

  _tourFrame(fs) {
    const stage = this.tourStage
    let mainCam = this.camera
    if (fs.view === 'surface' && stage) {
      stage.apply(fs)
      mainCam = stage.activeCamera
      this._projectOverlays()
      this._projectCallout(stage)
      this.renderer.render(stage.activeScene, mainCam)
    } else {
      if (fs.globe) this._tourGlobeCamera(fs.globe)
      if (fs.globe && fs.globe.k >= 1) this._lastGlobeDir = this._siteDir(fs.globe.to)
      for (const m of this.markers.values()) m.button.classList.toggle('is-tour-highlight', !!fs.highlightSites)
      this.globeRoot.updateMatrixWorld()
      this._projectOverlays()
      this._projectCallout(null)
      this.renderer.render(this.scene, this.camera)
    }
    // Neo in his reserved corner.
    const nv = this.neoView
    if (nv && fs.neo) {
      nv.layout(this.size, fs.neo.side)
      let target
      const tn = fs.neo.target
      if (tn === 'viewer' || tn === 'sky') target = nv.targetFromWorld(tn, mainCam, this.size)
      else if (tn === 'card') target = nv.targetFromScreen(0.7, 0.55, this.size)
      else if (fs.view === 'surface' && stage) target = nv.targetFromWorld(stage.anchor(tn), mainCam, this.size)
      else {
        const m = this.markers.get(tn === 'site' ? fs.mission : tn)
        target = m ? nv.targetFromWorld(m.anchor.getWorldPosition(new THREE.Vector3()), mainCam, this.size) : nv.targetFromScreen(0, 0, this.size)
      }
      nv.update({ ...fs.neo, target })
      nv.render(this.renderer, this.size)
    }
    // Screen positions for the HTML layer: the waiting target's hotspot, and the
    // subject (rover / label anchor / target) the speech bubble must not cover.
    const subjects = []
    let hotspot = null
    if (fs.view === 'surface' && stage) {
      const project = (p, radius) => {
        _c.copy(p).applyMatrix4(mainCam.matrixWorldInverse)
        if (_c.z > -mainCam.near) return null
        _p.copy(p).project(mainCam)
        const on = Math.abs(_p.x) <= 0.92 && Math.abs(_p.y) <= 0.92
        return { x: (_p.x + 1) * 0.5 * this.size.w, y: (1 - _p.y) * 0.5 * this.size.h, r: radius, on }
      }
      const rv = stage.roverScreen(this.size)
      if (rv.r > 0) subjects.push(rv)
      const focus = fs.waiting?.target || fs.label?.anchor || (fs.neo?.target !== 'viewer' && fs.neo?.target !== 'card' ? fs.neo?.target : null)
      if (focus) {
        const sp = project(stage.anchor(focus, new THREE.Vector3()), 36)
        if (sp?.on) subjects.push(sp)
      }
      if (fs.waiting && !fs.inspect) {
        const a = stage.anchor(fs.waiting.target, new THREE.Vector3())
        const sp = project(a, 0)
        hotspot = { x: sp?.x ?? 0, y: sp?.y ?? 0, visible: !!(sp && sp.on && !stage.occluded(a)) }
      }
    }
    this.cb.onTourLayout?.({ neoRect: nv && fs.neo ? nv.rect : null, subjects, hotspot, size: this.size })
  }

  /** Did a canvas tap hit the target the tour is waiting for? */
  _stageHit(clientX, clientY) {
    const stage = this.tourStage
    const target = this.tourFS?.waiting?.target
    if (!stage || !target || this.tourFS.view !== 'surface') return false
    const rect = this.renderer.domElement.getBoundingClientRect()
    _ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    this._stageRay = this._stageRay || new THREE.Raycaster()
    this._stageRay.setFromCamera(_ndc, stage.activeCamera)
    return stage.hitTest(target, this._stageRay)
  }

  /** Active callout: {text, anchor} or null. */
  setCallout(cue) {
    if (cue === this.calloutCue || (cue && this.calloutCue && cue.text === this.calloutCue.text && cue.anchor === this.calloutCue.anchor)) return
    this.calloutCue = cue
    if (this.callout) this.callout.textContent = cue ? cue.text : ''
    if (!cue) this._setCalloutMode(null)
  }

  _setCalloutMode(mode) {
    if (mode === this.calloutMode) return
    this.calloutMode = mode
    if (this.callout) this.callout.hidden = mode !== 'float'
    this.cb.onCalloutMode?.(mode)
  }

  _projectCallout(stage) {
    const cue = this.calloutCue
    if (!cue) { this._setCalloutMode(null); return }
    let p
    let cam = this.camera
    if (stage) { p = stage.anchor(cue.anchor, _v); cam = stage.activeCamera }
    else {
      const m = this.markers.get(cue.anchor)
      if (!m) { this._setCalloutMode('fixed'); return }
      p = m.anchor.getWorldPosition(_v)
      if (!this._visibleAt(p.clone())) { this._setCalloutMode('fixed'); return }
    }
    const { w, h } = this.size
    _c.copy(p).applyMatrix4(cam.matrixWorldInverse)
    const behind = _c.z > -cam.near
    _p.copy(p).project(cam)
    const off = behind || Math.abs(_p.x) > 1 || Math.abs(_p.y) > 1 || (stage && stage.occluded(p))
    if (off || w < 600) { this._setCalloutMode('fixed'); return }
    const el = this.callout
    const cw = el.offsetWidth || 180
    const ch = el.offsetHeight || 32
    let x = (_p.x + 1) * 0.5 * w - cw / 2
    let y = (1 - _p.y) * 0.5 * h - ch - 14
    x = Math.min(Math.max(8, x), w - cw - 8)
    y = Math.min(Math.max(8, y), h - ch - 8)
    const overlaps = (r) => x < r.x + r.w && x + cw > r.x && y < r.y + r.h && y + ch > r.y
    // Never cover the rover, the clue itself, or Neo: use the caption region instead.
    if (stage) {
      const rv = stage.roverScreen(this.size)
      const nx = Math.max(x, Math.min(rv.x, x + cw))
      const ny = Math.max(y, Math.min(rv.y, y + ch))
      if ((nx - rv.x) ** 2 + (ny - rv.y) ** 2 < rv.r * rv.r * 0.8) { this._setCalloutMode('fixed'); return }
    }
    const ax = (_p.x + 1) * 0.5 * w
    const ay = (1 - _p.y) * 0.5 * h
    if (overlaps({ x: ax - 12, y: ay - 12, w: 24, h: 24 })) { this._setCalloutMode('fixed'); return }
    if (this.neoView?.rect?.w && overlaps(this.neoView.rect)) { this._setCalloutMode('fixed'); return }
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
    this._setCalloutMode('float')
  }

  highlightSite(id) {
    const m = this.markers.get(id)
    if (!m) return
    m.button.classList.remove('is-highlight')
    void m.button.offsetWidth
    m.button.classList.add('is-highlight')
    clearTimeout(m.hlTimer)
    m.hlTimer = setTimeout(() => m.button.classList.remove('is-highlight'), 2600)
  }

  _visibleAt(world) {
    // Outward-hemisphere test at the anchor for the spherical proxy.
    _n.copy(world).normalize()
    _c.copy(this.camera.position).sub(world).normalize()
    if (_n.dot(_c) < FACING_TOLERANCE) return false
    _c.copy(world).applyMatrix4(this.camera.matrixWorldInverse)
    if (_c.z > -this.camera.near) return false
    _p.copy(world).project(this.camera)
    return Math.abs(_p.x) <= 1.05 && Math.abs(_p.y) <= 1.05
  }

  _toStage() {
    return [(_p.x + 1) * 0.5 * this.size.w, (1 - _p.y) * 0.5 * this.size.h]
  }

  _projectOverlays() {
    for (const m of this.markers.values()) {
      m.anchor.getWorldPosition(_v)
      const show = (this.view === 'globe' || (this.view === 'tour' && this.tourFS?.view === 'globe')) && !this.markersSuppressed && this._visibleAt(_v)
      if (show) {
        const [x, y] = this._toStage()
        m.x = x; m.y = y
        m.button.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
      }
      if (show !== m.visible) {
        if (!show && document.activeElement === m.button) this.cb.onMarkerFocusLost?.(m.id)
        m.button.hidden = !show
        m.visible = show
      }
    }
    for (const l of this.journeyLabels) {
      _v.copy(l.local)
      this.globeRoot.localToWorld(_v)
      const show = this.view === 'globe' && this._visibleAt(_v)
      if (show) {
        const [x, y] = this._toStage()
        l.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
      }
      if (show !== l.visible) { l.el.hidden = !show; l.visible = show }
    }
  }

  // -------------------------------------------------------------------- input

  markInput() { this.lastInput = performance.now() }

  _bindInput() {
    const canvas = this.renderer.domElement
    const pointers = new Map()
    let multi = false
    canvas.addEventListener('pointerdown', (e) => {
      this.markInput()
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, primary: e.isPrimary && e.button === 0, moved: 0 })
      if (pointers.size > 1) multi = true
    })
    canvas.addEventListener('pointermove', (e) => {
      if (this.view === 'tour' && this.tourFS?.inspect && pointers.has(e.pointerId)) {
        const p0 = pointers.get(e.pointerId)
        this.cb.onInspectDrag?.((e.clientX - (p0.lx ?? p0.x)) / this.size.w, (e.clientY - (p0.ly ?? p0.y)) / this.size.h)
        p0.lx = e.clientX; p0.ly = e.clientY
      }
      const p = pointers.get(e.pointerId)
      if (p) p.moved = Math.max(p.moved, Math.hypot(e.clientX - p.x, e.clientY - p.y))
      // Pointer cursor over the object the tour is waiting for (throttled raycast).
      if (!p && this.view === 'tour' && this.tourFS?.waiting && !this.tourFS.inspect) {
        const now = performance.now()
        if (now - (this._hoverAt || 0) > 80) {
          this._hoverAt = now
          canvas.style.cursor = this._stageHit(e.clientX, e.clientY) ? 'pointer' : ''
        }
      } else if (!p && canvas.style.cursor === 'pointer') canvas.style.cursor = ''
    })
    const end = (e, cancelled) => {
      const p = pointers.get(e.pointerId)
      pointers.delete(e.pointerId)
      const tapped = p && !cancelled && p.primary && !multi && p.moved < 6 && !this.flight.active
      if (pointers.size === 0) multi = false
      if (tapped && this.view === 'globe') {
        const id = this.pickAt(e.clientX, e.clientY)
        if (id) this.cb.onSelect?.(id, 'pointer', null)
      } else if (tapped && this.view === 'tour' && this.tourFS?.waiting && !this.tourFS.inspect && this._stageHit(e.clientX, e.clientY)) {
        canvas.style.cursor = ''
        this.cb.onStageTap?.()
      }
    }
    canvas.addEventListener('pointerup', (e) => end(e, false))
    canvas.addEventListener('pointercancel', (e) => end(e, true))
    canvas.addEventListener('wheel', () => this.markInput(), { passive: true })
    this.stage.addEventListener('keydown', () => this.markInput())
  }

  /** Closest POI proxy in front of the first globe hit, or null. */
  pickAt(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    _ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    this.globeRoot.updateMatrixWorld(true)
    this.raycaster.setFromCamera(_ndc, this.camera)
    const hits = this.raycaster.intersectObject(this.globeRoot, true)
    for (const h of hits) {
      if (h.object === this.globeProxy) return null
      const id = h.object.userData.missionId
      if (id && this.markers.get(id)?.visible) return id
    }
    return null
  }

  _onMarkerClick(e, id) {
    e.stopPropagation()
    this.markInput()
    if (e.detail === 0) { this.cb.onSelect?.(id, 'keyboard', e.currentTarget); return }
    const m = this.markers.get(id)
    if (!m?.visible) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    const picked = this.pickAt(rect.left + m.x, rect.top + m.y)
    if (picked === id) this.cb.onSelect?.(id, 'pointer', e.currentTarget)
  }

  // --------------------------------------------------------------- selection

  setSelected(id) {
    this.selectedId = id
    for (const m of this.markers.values()) m.button.classList.toggle('is-selected', m.id === id)
    if (!id) { this.setJourney(null, null); this.markInput() }
  }

  flyTo(id) {
    const m = this.markers.get(id)
    if (!m) return
    this.globeRoot.updateMatrixWorld(true)
    const dir = m.anchor.getWorldPosition(new THREE.Vector3()).normalize()
    const radius = THREE.MathUtils.clamp(Math.max(FLY_RADIUS, Math.min(this._fitDistance() * 0.95, 3.4)), this.controls.minDistance + 0.2, this.controls.maxDistance)
    this.flight.fly({ toDir: dir, toRadius: radius, immediate: this.reducedMotion || !this.gsap })
  }

  resetView() {
    this.markInput()
    this.globeRoot.updateMatrixWorld(true)
    this.flight.fly({ toDir: this._homeDirWorld(), toRadius: this.homeDistance, immediate: this.reducedMotion || !this.gsap })
  }

  cancelFlight() { this.flight.cancel() }

  zoom(factor) {
    this.markInput()
    this.flight.cancel()
    const c = this.controls
    const off = this.camera.position.clone().sub(c.target)
    const d = THREE.MathUtils.clamp(off.length() * factor, c.minDistance, c.maxDistance)
    this.camera.position.copy(c.target).add(off.setLength(d))
    c.update()
  }

  setJourney(id, state) {
    this.journeyState = id && state ? { id, state } : null
    this._refreshJourney()
  }

  _refreshJourney() {
    if (!this.traverse) return
    for (const l of this.journeyLabels) l.el.remove()
    this.journeyLabels = []
    this.traverse.clear()
    this.poiLayer.classList.remove('has-journey')
    const js = this.journeyState
    if (!js || js.id !== this.selectedId || this.markersSuppressed) return
    const mission = this.missions.find((m) => m.id === js.id)
    const marker = this.markers.get(js.id)
    if (!mission || !marker) return
    const labels = this.traverse.show(mission, js.state, marker.dir, (d) => this.radiusAt(d))
    this.poiLayer.classList.toggle('has-journey', labels.length > 0)
    for (const l of labels) {
      const el = document.createElement('span')
      el.className = `journey-label journey-label--${l.variant}`
      el.textContent = l.text
      el.setAttribute('aria-hidden', 'true')
      el.hidden = true
      this.poiLayer.append(el)
      this.journeyLabels.push({ local: l.local, el, visible: false })
    }
  }

  setMotion({ reducedMotion, paused }) {
    if (reducedMotion !== undefined) this.reducedMotion = reducedMotion
    if (paused !== undefined) this.motionPaused = paused
  }

  // ---------------------------------------------------------------- the loop

  _idleEligible(now) {
    return this.view === 'globe' && !this.reducedMotion && !this.motionPaused && !this.selectedId && !this.gesture &&
      !this.flight.active && now - this.lastInput > IDLE_DELAY_MS
  }

  _frame(now) {
    const dt = Math.min(Math.max((now - this.lastFrame) / 1000, 0), 0.1)
    this.lastFrame = now
    this.cb.onFrame?.(dt)
    if (this.view === 'tour') {
      if (this.tourFS) this._tourFrame(this.tourFS)
      return
    }
    if (this._idleEligible(now)) this.globeRoot.rotation.y += IDLE_SPEED * dt
    if (!this.flight.active && this.view === 'globe') this.controls.update(dt)
    this.globeRoot.updateMatrixWorld()
    this.camera.updateMatrixWorld()
    this._projectOverlays()
    this._projectCallout(null)
    this.renderer.render(this.scene, this.camera)
  }
}
