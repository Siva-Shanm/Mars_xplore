// Bootstrap, data, state and selection orchestration.
// Static imports are local only, so mission content works even if the CDN,
// Three.js, GSAP or WebGL fail. The 3D stack is loaded with dynamic import().

import { MissionPanel } from './MissionPanel.js'
import { validateRovers, validateAssets } from './validate.js'
import { TourController } from './TourController.js'
import { EvidenceView } from './EvidenceView.js'
import { buildTour } from './tour.js'

const $ = (sel) => document.querySelector(sel)
const els = {
  layout: $('#layout'),
  nav: $('#mission-nav'),
  stage: $('#globe-stage'),
  canvas: $('#globe-canvas'),
  poi: $('#poi-layer'),
  status: $('#globe-status'),
  stageMsg: $('#stage-message'),
  panel: $('#mission-panel'),
  announcer: $('#announcer'),
  dataError: $('#data-error'),
  btnReset: $('#btn-reset'),
  btnZoomIn: $('#btn-zoom-in'),
  btnZoomOut: $('#btn-zoom-out'),
  btnPause: $('#btn-pause'),
  btnSurface: $('#btn-surface'),
  tour: $('#tour'),
  evidence: $('#evidence'),
  btnNeo: $('#btn-neo'),
  btnFree: $('#btn-free'),
  overlays: { cards: $('#tour-cards'), banner: $('#tour-banner'), neoTag: $('#neo-tag') },
}

const reducedMQ = matchMedia('(prefers-reduced-motion: reduce)')
const state = {
  data: null,
  assets: { model: null, roverImages: { sojourner: [], spirit: [], opportunity: [] } },
  panel: null,
  globe: null,
  globeModule: null,
  gsap: null,
  selectedId: null,
  invoker: null,
  motionPaused: false,
  reducedMotion: reducedMQ.matches,
  guide: null,
  tourData: null,
  library: null,
}

// ---------------------------------------------------------------- utilities

let announceTimer
function announce(text) {
  clearTimeout(announceTimer)
  els.announcer.textContent = ''
  announceTimer = setTimeout(() => { els.announcer.textContent = text }, 60)
}

const statuses = new Map()
function setStatus(key, text, level = 'info', action = null) {
  if (!text) statuses.delete(key)
  else statuses.set(key, { text, level, action })
  els.status.replaceChildren()
  for (const [k, s] of statuses) {
    const item = document.createElement('div')
    item.className = `status status--${s.level}`
    item.dataset.key = k
    const t = document.createElement('span')
    t.textContent = s.text
    item.append(t)
    if (s.action) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'btn btn-small'
      b.textContent = s.action.label
      b.addEventListener('click', s.action.run)
      item.append(b)
    }
    els.status.append(item)
  }
}

async function fetchJson(rel) {
  const res = await fetch(new URL(rel, import.meta.url), { cache: 'no-cache' })
  if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`)
  return res.json()
}

// --------------------------------------------------------------------- data

async function loadData() {
  els.dataError.hidden = true
  const [rovers, assets, tourJson] = await Promise.allSettled([fetchJson('../data/rovers.json'), fetchJson('../data/assets.json'), fetchJson('../data/tour.json')])
  try {
    if (rovers.status === 'rejected') throw rovers.reason
    state.data = validateRovers(rovers.value)
  } catch (err) {
    console.error('[data]', err)
    state.data = null
    els.dataError.hidden = false
    renderNav()
    announce('Mission data unavailable.')
    return false
  }
  for (const ex of state.data.excluded) {
    console.warn('[data] excluded mission', ex.id, ex.reasons)
    setStatus(`excluded-${ex.id}`, `Mission “${ex.id}” excluded: data failed validation`, 'warn')
  }
  if (assets.status === 'fulfilled') {
    const { assets: a, warnings } = validateAssets(assets.value)
    state.assets = a
    warnings.forEach((w) => console.warn('[assets]', w))
  } else {
    console.warn('[assets] manifest unavailable; using reference sphere and no photos', assets.reason)
  }
  state.panel = new MissionPanel({
    root: els.panel,
    data: state.data,
    assets: state.assets,
    onClose: () => closePanel(),
    onJourneyChange: (id, st) => state.globe?.setJourney(id, st),
    onWatch: (id) => watchWithNeo(id),
    canWatch: (id) => !!chapterFor(id),
  })
  // Neo's tour: cue metadata kept separately from historical mission data.
  state.guide?.exit({ silent: true })
  state.tourData = null
  try {
    if (tourJson.status === 'rejected') throw tourJson.reason
    state.tourData = buildTour(tourJson.value, state.data, { assets: {} })
    for (const sk of state.tourData.skipped) console.info('[tour] optional cue', sk.id, '→', sk.fallback, '·', sk.reason)
  } catch (err) {
    console.error('[tour]', err)
    setStatus('tour', 'Neo’s tour is unavailable · the globe and mission details still work', 'warn')
  }
  els.btnNeo.disabled = !state.tourData
  state.guide = state.tourData ? new TourController({
    root: els.tour,
    overlays: els.overlays,
    tour: state.tourData,
    data: state.data,
    assets: state.assets,
    announce,
    getGlobe: () => state.globe,
    onExit: (chapterId, { silent }) => {
      const mid = state.tourData.chapters.get(chapterId)?.mission
      if (mid) state.globe?.highlightSite(mid)
      if (!silent) (els.panel.querySelector('#btn-watch') || els.btnNeo).focus()
    },
    onExploreGlobe: () => exploreGlobe(),
  }) : null
  if (new URLSearchParams(location.search).has('debug')) window.__guide = state.guide
  new EvidenceView({ root: els.evidence, data: state.data, onShow: showEvidence })
  state.panel.setGlobeAvailable(!!state.globe)
  renderNav()
  return true
}

function renderNav() {
  els.nav.replaceChildren()
  if (!state.data) return
  for (const m of state.data.missions) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'nav-btn'
    b.dataset.missionId = m.id
    b.setAttribute('aria-pressed', String(state.selectedId === m.id))
    const name = document.createElement('span'); name.className = 'nav-name'; name.textContent = m.name
    const site = document.createElement('span'); site.className = 'nav-site'; site.textContent = m.site.name
    b.append(name, site)
    b.addEventListener('click', (e) => {
      if (state.selectedId === m.id && state.panel?.isOpen) { closePanel(); return }
      selectMission(m.id, e.detail === 0 ? 'keyboard' : 'pointer', b)
    })
    els.nav.append(b)
  }
}

const navButton = (id) => els.nav.querySelector(`[data-mission-id="${id}"]`)

// ---------------------------------------------------------------- selection

function selectMission(id, trigger, invoker) {
  const mission = state.data?.missions.find((m) => m.id === id)
  if (!mission) return
  // Only one playhead: leave Neo's tour before manual selection.
  if (state.guide?.active) state.guide.exit({ silent: true })
  state.selectedId = id
  state.invoker = invoker || navButton(id)
  for (const b of els.nav.querySelectorAll('.nav-btn')) b.setAttribute('aria-pressed', String(b.dataset.missionId === id))
  els.layout.dataset.panel = 'open'
  state.panel.open(mission, { focusHeading: trigger === 'keyboard' })
  state.globe?.setSelected(id)
  state.globe?.flyTo(id)
  announce(`${mission.name} selected. ${mission.site.name}. Details panel open.`)
}

function closePanel() {
  if (!state.panel?.isOpen) return
  const id = state.selectedId
  state.guide?.exit({ silent: true })
  state.selectedId = null
  state.panel.close()
  state.globe?.cancelFlight()
  state.globe?.setSelected(null)
  for (const b of els.nav.querySelectorAll('.nav-btn')) b.setAttribute('aria-pressed', 'false')
  els.layout.dataset.panel = 'closed'
  const back = state.invoker && state.invoker.isConnected && !state.invoker.hidden ? state.invoker : navButton(id)
  back?.focus()
  announce('Details panel closed.')
}

// ------------------------------------------------------------------ replays

function chapterFor(missionId) {
  if (!state.tourData) return null
  for (const [id, ch] of state.tourData.chapters) if (ch.mission === missionId) return id
  return null
}

function watchWithNeo(missionId) {
  const ch = chapterFor(missionId)
  if (!ch || !state.guide) return
  state.globe?.cancelFlight()
  state.guide.start(ch, { withIntro: false })
  els.stage.scrollIntoView({ block: 'start', behavior: state.reducedMotion ? 'auto' : 'smooth' })
}

function startExpedition() {
  if (!state.guide) return
  if (state.panel?.isOpen) closePanel()
  state.globe?.cancelFlight()
  state.guide.startExpedition()
  els.stage.scrollIntoView({ block: 'start', behavior: state.reducedMotion ? 'auto' : 'smooth' })
}

function exploreGlobe() {
  if (state.guide?.active) state.guide.exit({ silent: true })
  els.stage.scrollIntoView({ block: 'start', behavior: state.reducedMotion ? 'auto' : 'smooth' })
  els.stage.focus({ preventScroll: true })
  announce('Exploring the globe. Drag to orbit, or choose a mission.')
}

function showEvidence(card, missionId, { soft = false } = {}) {
  if (!missionId) return
  if (state.guide?.active) {
    if (state.guide.missionId === missionId && card.stopId) state.guide.seekCue(card.stopId)
    return
  }
  if (!soft && state.selectedId !== missionId) selectMission(missionId, 'pointer', navButton(missionId))
  state.globe?.highlightSite(missionId)
}

// -------------------------------------------------------------------- globe

function stageMessage(text, action) {
  els.stageMsg.replaceChildren()
  els.stageMsg.hidden = !text
  if (!text) return
  const p = document.createElement('p'); p.textContent = text
  els.stageMsg.append(p)
  if (action) {
    const b = document.createElement('button')
    b.type = 'button'; b.className = 'btn'; b.textContent = action.label
    b.addEventListener('click', action.run)
    els.stageMsg.append(b)
  }
}

function setGlobeControlsEnabled(on) {
  for (const b of [els.btnReset, els.btnZoomIn, els.btnZoomOut]) b.disabled = !on
  state.panel?.setGlobeAvailable(on)
}

function startGlobe() {
  const mod = state.globeModule
  if (!mod) return
  if (state.globe) { state.globe.dispose(); state.globe = null; els.poi.replaceChildren() }
  try {
    const globe = new mod.GlobeRenderer({
      stage: els.stage,
      canvasHost: els.canvas,
      poiLayer: els.poi,
      missions: state.data?.missions ?? [],
      model: state.assets.model,
      gsap: state.gsap,
      reducedMotion: state.reducedMotion,
      roverLibrary: state.library,
      callbacks: {
        onFrame: (dt) => { if (state.guide?.active) state.guide.tickFromGlobe(dt) },
        onCalloutMode: (mode) => els.tour.classList.toggle('label-floating', mode === 'float'),
        onInspectDrag: (dx, dy) => state.guide?.inspectDrag(dx, dy),
        onTourLayout: (l) => state.guide?.layout(l),
        onStageTap: () => state.guide?.satisfyCheckpoint('canvas'),
        onNeoStatus: (s) => { if (s !== 'full') console.warn('[neo] rendering:', s) },
        onSelect: (id, trigger, el) => selectMission(id, trigger, el),
        onStatus: (key, text, level, action) => setStatus(key, text, level, action),
        onMarkerFocusLost: (id) => navButton(id)?.focus(),
        onFatal: (err) => globeFailed(err, true),
        onRequestSurface: (mode) => state.globe?.setSurface(mode),
        onSurfaceChange: (surface, info) => syncSurfaceButton(surface, info),
      },
    })
    state.globe = globe
    globe.init()
    // Development hook for landmark/registration checks: ?debug exposes the renderer.
    if (new URLSearchParams(location.search).has('debug')) window.__globe = globe
    globe.setMotion({ reducedMotion: state.reducedMotion, paused: state.motionPaused })
    stageMessage(null)
    setGlobeControlsEnabled(true)
    if (state.guide?.active) {
      state.guide.resume3D()
    } else if (state.selectedId) {
      globe.setSelected(state.selectedId)
      globe.flyTo(state.selectedId)
    }
  } catch (err) {
    globeFailed(err, true)
  }
}

function globeFailed(err, canRetry) {
  console.error('[globe]', err)
  try { state.globe?.dispose() } catch { /* already torn down */ }
  state.globe = null
  els.poi.replaceChildren()
  els.stage.classList.remove('is-surface', 'is-fading')
  // A running replay keeps its playhead and stop; captions continue in the HTML.
  // Neo's tour keeps its chapter, cue and playhead; captions continue as HTML.
  els.tour.classList.remove('label-floating')
  els.overlays.cards.replaceChildren()
  setGlobeControlsEnabled(false)
  syncSurfaceButton(null, { modelReady: false })
  setStatus('globe', '3D view unavailable · mission details still work', 'error')
  stageMessage(`3D globe unavailable: ${err.message}. Use the mission buttons above; all details, dates, distances and NASA links remain available.`,
    canRetry ? { label: 'Retry 3D view', run: () => { setStatus('globe', 'Retrying 3D view…', 'info'); startGlobe() } } : { label: 'Reload page', run: () => location.reload() })
  announce('3D globe unavailable. Mission details remain available.')
}

function syncSurfaceButton(surface, info) {
  const b = els.btnSurface
  b.hidden = !info?.modelReady
  if (!info?.modelReady) return
  const ref = surface === 'reference'
  b.setAttribute('aria-pressed', String(ref))
  b.textContent = ref ? 'Show textured model' : 'Show reference sphere'
}

// ------------------------------------------------------------------- motion

function applyMotion() {
  document.documentElement.classList.toggle('motion-paused', state.motionPaused)
  els.btnPause.setAttribute('aria-pressed', String(state.motionPaused))
  els.btnPause.textContent = state.motionPaused ? 'Resume motion' : 'Pause motion'
  state.globe?.setMotion({ reducedMotion: state.reducedMotion, paused: state.motionPaused })
}

reducedMQ.addEventListener('change', (e) => {
  state.reducedMotion = e.matches
  applyMotion()
})

// ------------------------------------------------------------------- wiring

els.btnReset.addEventListener('click', () => {
  if (state.guide?.active) state.guide.exit({ silent: true })
  state.globe?.resetView()
})
els.btnZoomIn.addEventListener('click', () => { if (!state.globe?.inSurface) state.globe?.zoom(0.8) })
els.btnZoomOut.addEventListener('click', () => { if (!state.globe?.inSurface) state.globe?.zoom(1.25) })
els.btnPause.addEventListener('click', () => { state.motionPaused = !state.motionPaused; applyMotion() })
els.btnSurface.addEventListener('click', () => {
  const g = state.globe
  if (!g) return
  g.setSurface(g.surface === 'reference' ? 'model' : 'reference')
})
els.btnNeo.addEventListener('click', startExpedition)
els.btnFree.addEventListener('click', exploreGlobe)
$('#btn-data-retry').addEventListener('click', async () => {
  if (await loadData()) startGlobe()
})
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (state.guide?.inspect) { e.preventDefault(); state.guide.closeInspect(); return }
  if (state.guide?.active) { e.preventDefault(); state.guide.exit(); return }
  if (state.panel?.isOpen) { e.preventDefault(); closePanel() }
})

// --------------------------------------------------------------------- boot

async function boot() {
  applyMotion()
  setGlobeControlsEnabled(false)
  const modules = Promise.allSettled([import('./GlobeRenderer.js'), import('gsap')])
  await loadData()
  const [globeResult, animationResult] = await modules
  if (animationResult.status === 'fulfilled') state.gsap = animationResult.value.gsap
  else console.warn('[gsap] unavailable; camera moves will be immediate', animationResult.reason)
  if (globeResult.status === 'rejected') {
    globeFailed(new Error('3D libraries could not be loaded'), false)
    return
  }
  state.globeModule = globeResult.value
  // Rover models: procedural first, the validated supplied model is promoted when ready.
  state.library = new state.globeModule.RoverLibrary({ merConfig: state.assets.roverModels?.mer ?? null })
  state.library.load().then((ok) => {
    const r = state.library.report
    console.info('[rover] MER model report', JSON.stringify(r))
    if (!ok) setStatus('rover-model', 'Simplified rover model (supplied MER model unavailable)', 'warn')
    if (new URLSearchParams(location.search).has('debug')) { window.__roverReport = r; window.__guide = state.guide }
  })
  // The globe stays interactive even if mission data failed; markers arrive on data retry.
  startGlobe()
}

boot()
