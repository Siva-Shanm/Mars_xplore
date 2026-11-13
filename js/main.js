// Bootstrap, data, state and selection orchestration.
// Static imports are local only, so mission content works even if the CDN,
// Three.js, GSAP or WebGL fail. The 3D stack is loaded with dynamic import().

import { MissionPanel } from './MissionPanel.js'
import { validateRovers, validateAssets } from './validate.js'
import { ReplayController } from './ReplayController.js'
import { EvidenceView } from './EvidenceView.js'
import { buildReplay } from './replays.js'

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
  replay: $('#replay'),
  evidence: $('#evidence'),
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
  replay: null,
  library: null,
  replayDefs: new Map(),
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
  const [rovers, assets] = await Promise.allSettled([fetchJson('../data/rovers.json'), fetchJson('../data/assets.json')])
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
    onWatch: (id) => watchJourney(id),
    canWatch: (id) => state.replayDefs.has(id),
  })
  state.replayDefs.clear()
  for (const m of state.data.missions) { const def = buildReplay(m); if (def) state.replayDefs.set(m.id, def) }
  state.replay?.exit({ silent: true })
  if (state.replay) state.replay.sources = state.data.sources
  else state.replay = new ReplayController({
    root: els.replay,
    sources: state.data.sources,
    announce,
    getGlobe: () => state.globe,
    getLibrary: () => state.library,
    reducedMotion: state.reducedMotion,
    onStop: () => els.layout.classList.remove('is-replay'),
    onExit: () => {
      // Back to globe: the mission stays selected; focus returns to the action that started it.
      const btn = els.panel.querySelector('#btn-watch')
      if (btn) btn.focus(); else navButton(state.selectedId)?.focus()
    },
  })
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
  // Only the active mission may drive the scene: leave any other replay first.
  if (state.replay?.active) state.replay.exit({ silent: true })
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
  state.replay?.exit({ silent: true })
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

function watchJourney(id) {
  const mission = state.data?.missions.find((m) => m.id === id)
  const def = state.replayDefs.get(id)
  if (!mission || !def) return
  if (state.selectedId !== id) selectMission(id, 'pointer', navButton(id))
  state.globe?.cancelFlight()
  els.layout.classList.add('is-replay')
  state.replay.start(mission, def)
  els.stage.scrollIntoView({ block: 'start', behavior: state.reducedMotion ? 'auto' : 'smooth' })
}

function showEvidence(card, missionId, { soft = false } = {}) {
  if (!missionId) return
  if (state.replay?.active && state.replay.missionId === missionId) {
    if (card.stopId) state.replay.seekStop(card.stopId)
    return
  }
  if (!soft && state.selectedId !== missionId) selectMission(missionId, 'pointer', navButton(missionId))
  if (!state.replay?.active) state.globe?.highlightSite(missionId)
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
        onFrame: (dt) => state.replay?.tickFromGlobe(dt),
        onCalloutMode: (mode) => state.replay?.setCalloutMode(mode),
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
    if (state.replay?.active) {
      globe.setSelected(state.selectedId)
      state.replay.resume3D()
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
  if (state.replay?.active) { state.replay.setCalloutMode('fixed'); state.replay.refreshModelBadge() }
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
  state.replay?.setReducedMotion(e.matches)
})

// ------------------------------------------------------------------- wiring

els.btnReset.addEventListener('click', () => {
  if (state.replay?.active) state.replay.exit({ silent: true })
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
$('#btn-data-retry').addEventListener('click', async () => {
  if (await loadData()) startGlobe()
})
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (state.replay?.active) { e.preventDefault(); state.replay.exit(); return }
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
  state.library.onReady(() => state.replay?.refreshModelBadge())
  state.library.load().then((ok) => {
    const r = state.library.report
    console.info('[rover] MER model report', JSON.stringify(r))
    if (!ok) setStatus('rover-model', 'Simplified rover model (supplied MER model unavailable)', 'warn')
    if (new URLSearchParams(location.search).has('debug')) { window.__roverReport = r; window.__replay = state.replay }
  })
  // The globe stays interactive even if mission data failed; markers arrive on data retry.
  startGlobe()
}

boot()
