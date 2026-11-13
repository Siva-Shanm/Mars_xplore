// Replay orchestration and controls. Owns the single PlaybackClock for the active
// replay. No Three.js import: when the 3D view is unavailable, the timeline, stop list,
// scrubber and captions still work, driven by a fallback animation-frame loop.

import { PlaybackClock, activeCue, activeStopIndex, formatClock } from './replays.js'
import { isSafeSourceUrl } from './validate.js'

const SEEK_GLIDE = 0.55

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue
    if (k === 'class') n.className = v
    else if (k === 'text') n.textContent = v
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v)
    else n.setAttribute(k, v === true ? '' : String(v))
  }
  for (const c of children.flat()) if (c) n.append(c)
  return n
}

export class ReplayController {
  constructor({ root, sources, announce, getGlobe, getLibrary, reducedMotion, onExit, onStop }) {
    this.onStop = onStop
    this.root = root
    this.sources = sources
    this.announce = announce
    this.getGlobe = getGlobe
    this.getLibrary = getLibrary
    this.reducedMotion = reducedMotion
    this.onExit = onExit
    this.def = null
    this.clock = null
    this.token = 0
    this.lastGlobeFrame = 0
    this.lastStop = -1
    this.lastCue = null
    this.calloutMode = null
    this.planVisible = false
    this.q = (sel) => root.querySelector(sel)
    this._wire()
    document.addEventListener('visibilitychange', () => {
      // Hold the same frame while hidden; the visitor resumes explicitly.
      if (document.hidden && this.clock?.playing) { this.clock.pause(); this._sync(true) }
    })
  }

  get active() { return !!this.def }
  get missionId() { return this.def?.missionId ?? null }

  _wire() {
    const q = this.q
    q('#replay-back').addEventListener('click', () => this.exit())
    q('#replay-play').addEventListener('click', () => this.togglePlay())
    q('#replay-restart').addEventListener('click', () => this.restart())
    q('#replay-prev').addEventListener('click', () => this.step(-1))
    q('#replay-next').addEventListener('click', () => this.step(1))
    const scrub = q('#replay-scrub')
    scrub.addEventListener('input', () => {
      if (!this.clock) return
      this.clock.seek((Number(scrub.value) / 1000) * this.clock.duration)
      this._sync(true)
    })
    q('#replay-plan').addEventListener('click', () => {
      this.planVisible = !this.planVisible
      this.getGlobe()?.setPlanVisible(this.planVisible)
      this._syncPlan()
    })
  }

  // ----------------------------------------------------------------- lifecycle

  start(mission, def) {
    const token = ++this.token
    this.def = def
    this.clock = new PlaybackClock(def.duration)
    this.lastStop = -1
    this.lastCue = null
    this.planVisible = false
    this._render(mission, def)
    this.root.hidden = false
    this._sync(true)
    this._syncPlan()
    const globe = this.getGlobe()
    if (globe) {
      globe.setPlayhead(0, false)
      globe.enterSurface(def, {
        onArrive: () => {
          if (token !== this.token) return
          this._syncModelBadge()
          // The visitor asked to watch: start once the close-up is on screen.
          if (!this.reducedMotion) { this.clock.play(); this._sync(true) }
          this.q('#replay-play').focus({ preventScroll: true })
        },
      })
    } else {
      this.q('#replay-play').focus({ preventScroll: true })
    }
    this._ensureLoop()
    this.announce(`Journey replay: ${def.title}. ${def.stops.length} stops. ${globe ? '' : '3D view unavailable; captions and stops remain.'}`)
  }

  /** Re-enter the close-up after the 3D view was re-created, keeping the playhead. */
  resume3D() {
    const globe = this.getGlobe()
    if (!globe || !this.def) return
    const token = this.token
    this.clock.pause()
    globe.setPlayhead(this.clock.time, false)
    globe.enterSurface(this.def, { onArrive: () => { if (token === this.token) this._sync(true) } })
    globe.setPlanVisible(this.planVisible)
    this._sync(true)
  }

  exit({ silent = false } = {}) {
    if (!this.def) return
    const id = this.def.missionId
    this.token++
    this.def = null
    this.clock = null
    this.root.hidden = true
    this.onStop?.()
    this.getGlobe()?.exitSurface()
    if (!silent) {
      this.announce('Back to the globe.')
      this.onExit?.(id)
    }
  }

  setReducedMotion(v) {
    this.reducedMotion = v
    if (v && this.clock?.playing) this.clock.pause()
    this._sync(true)
  }

  setCalloutMode(mode) {
    this.calloutMode = mode
    const cap = this.q('#replay-caption')
    cap.classList.toggle('is-floating', mode === 'float')
  }

  // ------------------------------------------------------------------ controls

  togglePlay() {
    if (!this.clock) return
    if (this.clock.playing) this.clock.pause()
    else if (!this.reducedMotion) this.clock.play()
    this._sync(true)
  }

  restart() {
    if (!this.clock) return
    this.clock.seek(0)
    if (!this.reducedMotion) this.clock.play()
    this._sync(true)
  }

  step(dir) {
    if (!this.def) return
    const t = this.clock.time
    const stops = this.def.stops
    let i = activeStopIndex(this.def, t)
    if (dir > 0) i = stops.findIndex((s) => s.t > t + 0.05)
    else { const prev = stops.map((s) => s.t).filter((st) => st < t - 0.05); i = prev.length ? stops.findIndex((s) => s.t === prev[prev.length - 1]) : 0 }
    if (i < 0) i = stops.length - 1
    this.seekStop(stops[i].id)
  }

  /** Seek to a stop and pause so the visitor can read. */
  seekStop(id) {
    if (!this.def) return false
    const stop = this.def.stops.find((s) => s.id === id)
    if (!stop) return false
    this.clock.seek(stop.t, this.reducedMotion ? 0 : SEEK_GLIDE)
    this._sync(true)
    return true
  }

  // --------------------------------------------------------------------- frame

  /** Called by the globe render loop (one clock, one tick per frame). */
  tickFromGlobe(dt) {
    this.lastGlobeFrame = performance.now()
    this._tick(dt)
  }

  _tick(dt) {
    if (!this.clock) return
    this.clock.tick(dt)
    this._sync(false)
  }

  _ensureLoop() {
    if (this._loopRunning) return
    this._loopRunning = true
    let last = performance.now()
    const loop = (now) => {
      if (!this.def) { this._loopRunning = false; return }
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      // Only drive the clock when the 3D render loop is not doing so.
      if (now - this.lastGlobeFrame > 250) this._tick(dt)
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  }

  _sync(force) {
    const def = this.def
    const clock = this.clock
    if (!def || !clock) return
    const t = clock.time
    const globe = this.getGlobe()
    globe?.setPlayhead(t, clock.playing)

    const scrub = this.q('#replay-scrub')
    if (document.activeElement !== scrub || force) scrub.value = String(Math.round((t / def.duration) * 1000))
    const si = activeStopIndex(def, t)
    const stop = def.stops[si]
    scrub.setAttribute('aria-valuetext', `${formatClock(t)} of ${formatClock(def.duration)}, stop ${si + 1}: ${stop.label}`)
    this.q('#replay-time').textContent = `${formatClock(t)} / ${formatClock(def.duration)}`
    const play = this.q('#replay-play')
    const label = clock.playing ? 'Pause' : clock.ended ? 'Play again' : 'Play'
    if (play.textContent !== label) play.textContent = label
    play.setAttribute('aria-pressed', String(clock.playing))
    play.disabled = this.reducedMotion
    this.q('#replay-motion-note').hidden = !this.reducedMotion
    const pct = `${((t / def.duration) * 100).toFixed(2)}%`
    this.q('.replay-progress-fill').style.width = pct

    if (si !== this.lastStop || force) {
      for (const [i, li] of [...this.q('#replay-stops').children].entries()) {
        const b = li.querySelector('button')
        const on = i === si
        if (on) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current')
        li.classList.toggle('is-past', i < si)
      }
      for (const chip of this.root.querySelectorAll('.chip[data-stop]')) chip.classList.toggle('is-active', chip.dataset.stop === stop.id)
      if (si !== this.lastStop && this.lastStop !== -1) this.announce(`Stop ${si + 1}: ${stop.label}`)
      this.lastStop = si
    }

    const cue = activeCue(def, t)
    if (cue !== this.lastCue || force) {
      this.lastCue = cue
      const cap = this.q('#replay-caption-text')
      cap.textContent = cue ? cue.text : ''
      const src = this.q('#replay-caption-src')
      src.replaceChildren(...this._links(cue?.sourceIds))
      globe?.setCallout(cue)
      if (!globe) this.setCalloutMode('fixed')
    }
  }

  _syncPlan() {
    const b = this.q('#replay-plan')
    b.hidden = !this.def?.hasPlan
    b.setAttribute('aria-pressed', String(this.planVisible))
    b.textContent = this.planVisible ? 'Hide early route plan' : 'Show early route plan (dashed)'
    this.root.querySelectorAll('.chip.is-plan').forEach((c) => c.classList.toggle('is-shown', this.planVisible))
  }

  _syncModelBadge() {
    const badge = this.q('#replay-model')
    if (!this.def) return
    if (this.def.missionId === 'sojourner') badge.textContent = 'Sojourner and lander: simplified illustrations'
    else {
      const globe = this.getGlobe()
      const simplified = globe ? globe.roverSimplified : !this.getLibrary()?.merReady
      badge.textContent = simplified ? 'Simplified rover model' : 'Supplied MER model (Spirit and Opportunity were identical twins)'
    }
  }

  refreshModelBadge() { this._syncModelBadge() }

  _links(ids) {
    const out = []
    for (const id of ids || []) {
      const s = this.sources[id]
      if (!s || !isSafeSourceUrl(s.url)) continue
      if (out.length) out.push(document.createTextNode(' · '))
      out.push(el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', text: s.title }))
    }
    if (out.length) out.unshift(document.createTextNode('Source: '))
    return out
  }

  _render(mission, def) {
    this.q('#replay-title').textContent = `${mission.name}: ${def.title}`
    const list = this.q('#replay-stops')
    list.replaceChildren(...def.stops.map((s, i) => el('li', {},
      el('button', { type: 'button', class: 'stop-btn', onclick: () => this.seekStop(s.id) },
        el('span', { class: 'stop-idx', 'aria-hidden': 'true', text: String(i + 1) }),
        el('span', { class: 'stop-label', text: s.label })))))
    const chips = this.q('#replay-chips')
    chips.replaceChildren(...def.chips.map((c) => {
      const body = [el('span', { class: 'chip-label', text: c.label }), el('span', { class: 'chip-value num', text: c.value }), el('span', { class: 'chip-src' }, ...this._links(c.sourceIds))]
      const cls = `chip${c.plan ? ' is-plan' : ''}`
      return c.stopId
        ? el('button', { type: 'button', class: `${cls} chip-btn`, 'data-stop': c.stopId, 'aria-label': `${c.label}: ${c.value}. Go to this moment.`, onclick: () => this.seekStop(c.stopId) }, ...body.slice(0, 2))
        : el('div', { class: cls }, ...body)
    }))
    // Seekable chips keep their sources visible beside the group.
    const seekSrc = def.chips.filter((c) => c.stopId).flatMap((c) => c.sourceIds)
    this.q('#replay-chips-src').replaceChildren(...this._links([...new Set(seekSrc)]))
    this.q('#replay-seq').textContent = def.sequenceLabel ? `${def.sequenceLabel}: select a step to see it, or use Previous/Next stop.` : 'Select a stop to jump there and pause.'
    this.q('#replay-notes').replaceChildren(...def.notes.map((n) => el('p', { class: 'note', text: n })))
    this.q('#replay-plan-label').textContent = def.planLabel ?? ''
    this._syncModelBadge()
  }
}
