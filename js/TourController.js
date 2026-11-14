// Neo's guided expedition: one authoritative playhead per chapter.
// Camera, Neo, rover, wheels, route reveal, captions, the speech bubble, cards, science
// effects and stops are all derived from (chapter, playhead).
//
// Version 4:
// - Neo's words appear in a speech bubble beside him (docked under the canvas on narrow
//   screens or when it would cover the subject), revealed in step with the line.
// - Narration is on by default: the click that starts the tour unlocks speech. Speech can
//   only hold a cue for a bounded time; it never drives progress.
// - Required interaction checkpoints stop the playhead (not a Pause) until the visitor taps
//   the highlighted object, its in-view hotspot, or presses Enter/Space on the hotspot.
// - Everything the visitor must act on (hotspot, Continue, Next rover, transport) lives
//   inside the stage, the "video player".
// No Three.js import: without WebGL the same tour runs with HTML overlays.

import { PlaybackClock, formatClock } from './replays.js'
import { chapterRun, cueAt, activeLabel, activeCards, checkpoints } from './tour.js'
import { isSafeSourceUrl, resolveLocal } from './validate.js'
import { Narrator } from './Narrator.js'

const SEEK_GLIDE = 0.45
const SOUND_KEY = 'marsxplore.neoSound'
const AUDIO_NOTE = 'Narration audio isn’t available in this browser. Neo’s words appear in the speech bubble.'
const span = (t, a, b) => { const x = (t - a) / (b - a || 1); return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x) }

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

function readSoundPref() {
  try { return localStorage.getItem(SOUND_KEY) !== 'off' } catch { return true }
}
function writeSoundPref(on) {
  try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off') } catch { /* private mode */ }
}

export class TourController {
  constructor({ root, overlays, tour, data, assets, announce, getGlobe, onExit, onExploreGlobe }) {
    this.root = root
    this.ov = overlays // {cards, banner, neoTag}
    this.tour = tour
    this.data = data
    this.assets = assets
    this.announce = announce
    this.getGlobe = getGlobe
    this.onExit = onExit
    this.onExploreGlobe = onExploreGlobe
    this.narrator = new Narrator()
    this.soundOn = readSoundPref()
    this.run = null
    this.clock = null
    this.token = 0
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    this.inspect = null
    this.waiting = null // the checkpoint the playhead is stopped at
    this.done = new Set() // checkpoints passed (acted on or skipped by seeking)
    this.heldFor = 0
    this.lastCueId = null
    this.lastFrameFromGlobe = 0
    this.planVisible = false
    this.stageError = false
    this.audioNoteShown = false
    this.bubble = { text: '', shown: -1, mode: null }
    // Elements live both in the strip (#tour) and in the stage; ids are unique.
    this.q = (s) => document.querySelector(s)
    this._wire()
    document.addEventListener('visibilitychange', () => {
      // Pause on hide; the visitor resumes explicitly.
      if (document.hidden && this.clock?.playing) { this.pause(); this.announce('Tour paused.') }
    })
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => { this.reduced = e.matches; this._sync(true) })
  }

  get active() { return !!this.run }
  get chapterId() { return this.run?.id ?? null }
  get missionId() { return this.run?.mission ?? null }

  // ------------------------------------------------------------------ wiring

  _wire() {
    const q = this.q
    const on = (sel, fn) => q(sel)?.addEventListener('click', fn)
    on('#hud-back', () => this.exit())
    on('#hud-play', () => this.togglePlay())
    on('#hud-tools', () => this.togglePanel())
    on('#tour-panel-close', () => this.togglePanel(false))
    on('#tour-prev', () => this.step(-1))
    on('#tour-next', () => this.step(1))
    on('#tour-replay', () => { this.seek(0, false); this.play() })
    on('#tour-listen', () => this.setSound(!this.soundOn))
    on('#neo-sound', () => this.setSound(!this.soundOn))
    on('#tour-replay-line', () => this.replayLine())
    on('#tour-inspect-close', () => this.closeInspect())
    on('#tour-hotspot', () => this.actOnOffer('hotspot'))
    on('#tour-plan', () => {
      this.planVisible = !this.planVisible
      this.getGlobe()?.setPlanVisible(this.planVisible)
      this._syncPlan()
    })
    on('#tour-end-next', () => this._endNext())
    on('#tour-end-globe', () => { this.exit({ silent: true }); this.onExploreGlobe?.() })
    on('#tour-end-replay', () => { this.seek(0, false); this.play() })
    const scrub = q('#tour-scrub')
    scrub.addEventListener('input', () => {
      if (!this.clock) return
      this.seek((Number(scrub.value) / 1000) * this.clock.duration, false)
    })
    this._syncSoundButtons()
  }

  // --------------------------------------------------------------- lifecycle

  startExpedition() { this.start('pf', { withIntro: true, expedition: true }) }

  /** Call from a click/tap handler: the gesture unlocks speech in strict browsers. */
  start(chapterId, { withIntro = false, expedition = false, autoplay = true, at = 0 } = {}) {
    const run = chapterRun(this.tour, chapterId, { withIntro })
    if (!run) return
    this.token++
    this.narrator.cancel()
    if (this.soundOn) { this.narrator.setEnabled(true); this.narrator.unlock() }
    this.run = run
    this.cps = checkpoints(run)
    this.expedition = expedition || this.expedition
    this.clock = new PlaybackClock(run.duration)
    this.clock.seek(at)
    this.inspect = null
    this.waiting = null
    this.done = new Set(this.cps.filter((c) => c.t < at - 1e-6).map((c) => c.id))
    this.heldFor = 0
    this.lastCueId = null
    this.planVisible = false
    this.stageError = false
    this.bubble = { text: '', shown: -1, mode: null }
    this._renderChapter()
    this.root.hidden = false
    this.root.classList.add('is-active')
    this.q('#stage-hud').hidden = false
    this.q('#layout')?.classList.add('is-touring')
    this.togglePanel(false, { focus: false })
    const globe = this.getGlobe()
    if (globe) {
      globe.beginTour()
      try { globe.loadTourStage(chapterId, run, this.tour.approvals) } catch (err) {
        console.error('[tour] stage failed', err)
        this.stageError = true
      }
    }
    if (!this.narrator.supported && this.soundOn) this._showAudioNote()
    this._ensureLoop()
    if (autoplay) this.play()
    this._sync(true)
    this.q('#hud-play').focus({ preventScroll: true })
    this.announce(`${run.title}. ${run.cues.length} stops. ${globe ? '' : '3D view unavailable; Neo’s words continue as captions.'}`)
  }

  /** Re-create the 3D side after a renderer loss: same chapter, cue and playhead, paused. */
  resume3D() {
    const globe = this.getGlobe()
    if (!globe || !this.run) return
    this.pause()
    globe.beginTour()
    try { globe.loadTourStage(this.run.id, this.run, this.tour.approvals); this.stageError = false } catch { this.stageError = true }
    this._sync(true)
  }

  exit({ silent = false } = {}) {
    if (!this.run) return
    const id = this.run.id
    this.token++
    this.narrator.cancel()
    this.run = null
    this.clock = null
    this.inspect = null
    this.waiting = null
    this.root.hidden = true
    this.root.classList.remove('is-active')
    this.ov.cards.replaceChildren()
    this.ov.banner.hidden = true
    this.ov.neoTag.hidden = true
    for (const s of ['#stage-hud', '#neo-bubble', '#neo-dock', '#neo-sound', '#tour-hotspot', '#stage-action', '#tour-end', '#neo-audio-note', '#tour-panel']) this.q(s).hidden = true
    this.q('#hud-tools').setAttribute('aria-expanded', 'false')
    this.panelOpen = false
    this.q('#layout')?.classList.remove('is-touring')
    this.getGlobe()?.endTour()
    if (!silent) this.announce('Tour closed. Back to the globe.')
    this.onExit?.(id, { silent })
  }

  _endNext() {
    const next = this.tour.chapters.get(this.run?.id)?.next
    if (next) this.start(next, { expedition: true })
    else { this.exit({ silent: true }); this.onExploreGlobe?.() }
  }

  // ---------------------------------------------------------------- controls

  togglePlay() { if (this.clock?.playing) this.pause(); else this.play() }

  play() {
    if (!this.clock) return
    if (this.clock.time >= this.clock.duration - 1e-3) { this.clock.seek(0); this.done.clear() }
    this.clock.play()
    this.heldFor = 0
    // Restart only the active line if we resume inside it (speech cannot resume reliably).
    const c = cueAt(this.run, this.clock.time)
    if (!this.waiting && c.text && this.clock.time >= c.speakStart && this.clock.time < c.speakEnd) this.narrator.speak(c.text, c.id)
    this._sync(true)
  }

  pause() {
    if (!this.clock) return
    this.clock.pause()
    this.narrator.cancel()
    this._sync(true)
  }

  /** Seek pauses at the target. Checkpoints before the target count as passed (skipped). */
  seek(t, glide = true) {
    if (!this.clock) return
    this.narrator.cancel()
    this.heldFor = 0
    this.inspect = null
    this.waiting = null
    this.done = new Set(this.cps.filter((c) => c.t < t - 1e-6).map((c) => c.id))
    this.clock.seek(t, glide && !this.reduced ? SEEK_GLIDE : 0)
    this._sync(true)
  }

  step(dir) {
    if (!this.run) return
    const t = this.clock.time
    const cues = this.run.cues
    let i = cueAt(this.run, t).index
    if (dir > 0) i = Math.min(cues.length - 1, i + 1)
    else i = t - cues[i].start > 1.0 ? i : Math.max(0, i - 1)
    this.seek(cues[i].start)
  }

  seekCue(id) {
    const c = this.run?.cues.find((x) => x.id === id)
    if (!c) return false
    this.seek(c.start)
    return true
  }

  replayLine() {
    if (!this.run) return
    const c = cueAt(this.run, this.clock.time)
    this.seek(c.text ? c.speakStart : c.start, false)
    this.play()
  }

  setSound(on) {
    this.soundOn = !!on
    writeSoundPref(this.soundOn)
    this.narrator.setEnabled(this.soundOn)
    if (this.soundOn) {
      this.narrator.unlock()
      if (!this.narrator.supported) this._showAudioNote()
      if (this.clock?.playing && !this.waiting) {
        const c = cueAt(this.run, this.clock.time)
        if (c.text && this.clock.time >= c.speakStart && this.clock.time < c.speakEnd) this.narrator.speak(c.text, c.id)
      }
    }
    this._syncSoundButtons()
    this.announce(this.soundOn ? 'Sound on.' : 'Sound off. Neo’s words stay in the speech bubble.')
  }

  _syncSoundButtons() {
    const label = this.soundOn ? '🔊 Sound on' : '🔇 Sound off'
    for (const s of ['#tour-listen', '#neo-sound']) {
      const b = this.q(s)
      if (!b) continue
      b.textContent = label
      b.setAttribute('aria-pressed', String(this.soundOn))
      b.setAttribute('aria-label', this.soundOn ? 'Sound on. Press to mute Neo' : 'Sound off. Press to hear Neo')
    }
  }

  _showAudioNote() {
    if (this.audioNoteShown) return
    this.audioNoteShown = true
    const n = this.q('#neo-audio-note')
    n.textContent = AUDIO_NOTE
    n.hidden = false
    const strip = this.q('#tour-audio-note')
    strip.textContent = AUDIO_NOTE
    strip.hidden = false
    clearTimeout(this._noteTimer)
    this._noteTimer = setTimeout(() => { n.hidden = true }, 9000)
  }

  // -------------------------------------------------------------- checkpoints

  /** The visitor acted on the waiting target (canvas tap, hotspot, keyboard). */
  satisfyCheckpoint(source = 'hotspot') {
    const cp = this.waiting
    if (!cp || !this.run) return
    if (cp.kind === 'activate' || !this.getGlobe() || this.stageError) {
      this.done.add(cp.id)
      this.waiting = null
      this.announce(cp.kind === 'activate' ? 'Done. Watch what happens.' : 'Thanks. Continuing.')
      this.clock.play()
      this._sync(true)
      this.q('#hud-play').focus({ preventScroll: true })
      return
    }
    // Inspect: close-up and free look; Continue resumes into the reveal.
    this.inspect = { target: cp.target, label: cp.label, yaw: 0, pitch: 0, wasPlaying: true, checkpoint: cp, source }
    this._sync(true)
    this.q('#tour-inspect-close').focus({ preventScroll: true })
    this.announce(`${cp.label.replace(/^Tap /, '')}. Drag to look around, then choose Continue the tour.`)
  }

  /** Inspection: hold the current moment; Close restores it and the prior play intent. */
  openInspect(o) {
    if (!this.run || !o) return
    this.inspect = { target: o.target, label: o.label, yaw: 0, pitch: 0, wasPlaying: this.clock.playing, cueId: o.id }
    this.clock.pause()
    this.narrator.cancel()
    this._sync(true)
    this.q('#tour-inspect-close').focus({ preventScroll: true })
    this.announce(`${o.aria || o.label}. Drag to look around, then continue.`)
  }

  closeInspect() {
    if (!this.inspect) return
    const ins = this.inspect
    this.inspect = null
    if (ins.checkpoint) {
      this.done.add(ins.checkpoint.id)
      this.waiting = null
      this.clock.play()
    } else if (ins.wasPlaying) this.clock.play()
    this._sync(true)
    const hs = this.q('#tour-hotspot')
    ;(hs.hidden ? this.q('#hud-play') : hs).focus({ preventScroll: true })
  }

  /** "Tour controls" disclosure inside the view. */
  togglePanel(open = !this.panelOpen, { focus = true } = {}) {
    this.panelOpen = !!open
    const panel = this.q('#tour-panel')
    const btn = this.q('#hud-tools')
    panel.hidden = !this.panelOpen
    btn.setAttribute('aria-expanded', String(this.panelOpen))
    if (!focus) return
    if (this.panelOpen) this.q('#tour-scrub').focus({ preventScroll: true })
    else btn.focus({ preventScroll: true })
  }

  inspectDrag(dx, dy) {
    if (!this.inspect) return
    this.inspect.yaw += dx * 3
    this.inspect.pitch = Math.max(-0.4, Math.min(0.8, this.inspect.pitch - dy * 2))
  }

  // -------------------------------------------------------------------- frame

  tickFromGlobe(dt) {
    this.lastFrameFromGlobe = performance.now()
    this._tick(dt)
  }

  _ensureLoop() {
    if (this._loop) return
    this._loop = true
    let last = performance.now()
    const loop = (now) => {
      if (!this.run) { this._loop = false; return }
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      if (now - this.lastFrameFromGlobe > 250) this._tick(dt)
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  }

  _tick(dt) {
    const clock = this.clock
    if (!clock) return
    const before = clock.time
    const cur = cueAt(this.run, before)
    let hold = !!this.waiting || !!this.inspect
    // Speech may hold the cue at the end of its line, for a bounded time only.
    if (!hold && clock.playing && !clock.seekTween && cur.text && before >= cur.speakEnd - 1e-3 && this.narrator.speakingFor(cur.id)) {
      this.heldFor += dt
      hold = this.heldFor < cur.speakDur * 0.6 + 4
    } else if (before < cur.speakEnd - 1e-3) this.heldFor = 0
    if (!hold) clock.tick(dt)
    let t = clock.time
    // Required checkpoint: stop exactly there and wait for the visitor (not a Pause).
    if (clock.playing && !this.waiting) {
      const cp = this.cps.find((c) => c.required && !this.done.has(c.id) && before <= c.t + 1e-6 && t >= c.t - 1e-6)
      if (cp) {
        clock.time = cp.t
        t = cp.t
        this.waiting = cp
        this.waitStart = performance.now()
        this.narrator.cancel()
        this._sync(true)
        this.announce(`${cp.prompt} ${cp.label}, or press the button in the view.`)
        const hs = this.q('#tour-hotspot')
        if (!hs.hidden) hs.focus({ preventScroll: true })
        return
      }
    }
    // One-shot side effect: speak a line only when forward playback crosses its start.
    if (clock.playing && t > before) {
      for (const c of this.run.cues) if (c.text && before < c.speakStart && c.speakStart <= t) this.narrator.speak(c.text, c.id)
    }
    if (this.soundOn && this.narrator.failure) this._showAudioNote()
    this._sync(false)
  }

  _frameState() {
    const run = this.run
    const t = this.clock.time
    const c = cueAt(run, t)
    const τ = t - c.start
    const playing = this.clock.playing && !this.inspect && !this.waiting
    let view = 'surface'
    let globe = null
    if (c.view === 'globe' || (c.globeLead && τ < c.globeLead) || this.stageError) {
      view = 'globe'
      const g = c.globe || { from: 'current', to: run.mission }
      let k
      if (c.id === 'intro') k = span(τ, g.flyStart ?? 0, c.duration - 0.6)
      else if (c.globeLead) k = span(τ, 0, c.globeLead - 0.3)
      else k = span(τ, 0, 4)
      globe = { from: g.from, to: g.to, k: this.reduced ? 1 : k }
    }
    const n = c.neo || {}
    let action = n.action || 'track'
    let target = n.target || 'viewer'
    let nτ = τ
    if (n.followAfter != null && τ >= n.followAfter) { action = 'track'; target = n.followTarget || 'rover' }
    if (n.farewellAt != null) { if (τ < n.farewellAt) { action = 'track'; target = 'viewer' } else nτ = τ - n.farewellAt }
    const wallT = performance.now() / 1000
    if (this.waiting) { action = 'pointHold'; target = this.waiting.target; nτ = (performance.now() - (this.waitStart || 0)) / 1000 }
    if (this.stageError) { action = 'error'; target = 'viewer' }
    const accentOn = !this.waiting && n.accent && τ >= (n.accentFrom ?? 0) && τ < n.accent.until
    // Mouth moves only while words are visibly being delivered: audio playing, or the
    // bubble revealing the line. Never while paused, inspecting or waiting.
    const audio = this.narrator.speakingFor(c.id)
    const revealing = !!c.text && t >= c.speakStart && t < c.speakEnd
    const speaking = playing && (audio || revealing)
    const held = speaking && t >= c.speakEnd - 1e-3
    const label = activeLabel(c, τ)
    const offer = this._offer(c, τ, view)
    return {
      t, cue: c, τ, view, globe, playing, reduced: this.reduced, inspect: this.inspect, mission: run.mission,
      // 'waiting' drives the highlight, hotspot projection and canvas tap for both a
      // required checkpoint and an optional offer.
      waiting: this.waiting || offer, offer, highlightSites: !!c.highlightSites,
      label: label && !(view === 'globe' && !['sojourner', 'spirit', 'opportunity'].includes(label.anchor)) ? label : null,
      neo: {
        action, target, expr: this.stageError ? 'error' : (this.waiting ? 'smile' : (n.expr || 'smile')), τ: nτ, side: n.side || 'right',
        speaking, mouthPhase: held ? wallT : t, t: this.waiting ? wallT : t, reduced: this.reduced,
        idleOk: (playing || !!this.waiting) && !this.reduced,
        nodAt: n.nodAt != null ? (c.speakStart - c.start) + n.nodAt : null, accent: accentOn ? { expr: n.accent.expr, until: Infinity } : null,
        duration: c.duration,
      },
    }
  }

  /** The one contextual action offered right now (optional inspection/activation), or null. */
  _offer(c, τ, view) {
    if (this.waiting || this.inspect || this.stageError) return null
    const cp = c.checkpoint
    if (cp && !cp.required && τ >= cp.atRel - 1e-6 && τ < c.duration - 0.05) {
      if (cp.kind === 'activate' && τ > cp.atRel + 0.25) return null // the magnet is already on
      return { ...cp, source: 'interaction' }
    }
    if (c.inspect && τ >= (c.inspect.at ?? 0) && view === 'surface') {
      return { id: c.id, kind: 'inspect', target: c.inspect.target, label: c.inspect.label, aria: c.inspect.label, source: 'inspect' }
    }
    return null
  }

  /** Visitor used the offered action (hotspot, canvas tap on the feature, or keyboard). */
  actOnOffer(source = 'hotspot') {
    if (!this.run) return
    if (this.waiting) { this.satisfyCheckpoint(source); return }
    const fs = this._frameState()
    const o = fs.offer
    if (!o) return
    if (o.kind === 'activate') {
      // Switch on now: jump to the activation moment and keep playing.
      this.clock.time = Math.max(this.clock.time, o.t + 0.3)
      if (!this.clock.playing) this.clock.play()
      this.announce('Magnet on. Watch the dust.')
      this._sync(true)
      return
    }
    this.openInspect(o)
  }

  /** Bubble content for the current frame: {text, chars, kind} or null. */
  _bubbleContent(fs) {
    const c = fs.cue
    if (this.inspect) {
      // On phones the in-view Continue + note already say this; keep the view clear.
      if ((this._lastLayout?.size?.w ?? 1000) < 600) return null
      return { text: 'Take a close look. Continue when you’re ready.', chars: Infinity, kind: 'prompt' }
    }
    if (this.waiting) return { text: this.waiting.prompt, chars: Infinity, kind: 'prompt' }
    if (!c.text || fs.t < c.speakStart - 1e-6 || fs.t >= c.end - 1e-6) return null
    if (this.reduced) return { text: c.text, chars: Infinity, kind: 'line' }
    // Reveal in step with the line; never show less than the voice has reached.
    const est = Math.ceil(c.text.length * Math.min(1, (fs.t - c.speakStart) / (c.speakDur * 0.92)))
    const spoken = this.narrator.spokenChars(c.id)
    return { text: c.text, chars: Math.max(est, spoken), kind: 'line' }
  }

  /** Called by the renderer each frame with Neo's rect (+ head), the subject and the action anchor. */
  layout({ neoRect, subjects = [], hotspot, size }) {
    if (!this.run) return
    this._lastLayout = { neoRect, subjects, hotspot, size }
    const narrow = (size?.w ?? 0) < 600
    // Where the action would float (beside the feature), so the bubble can avoid it.
    const hs = this.q('#tour-hotspot')
    const actionAtFeature = !hs.hidden && hotspot?.visible && !narrow
    this._actionRect = actionAtFeature ? { x: hotspot.x - 30, y: hotspot.y - 30, w: 220, h: 60 } : null
    this._placeBubble()
    // Neo tag and sound toggle sit by Neo's corner.
    const tag = this.ov.neoTag
    const snd = this.q('#neo-sound')
    if (neoRect?.w) {
      tag.style.transform = `translate(${neoRect.x}px, ${Math.max(0, neoRect.y - 20)}px)`
      tag.style.width = `${neoRect.w}px`
      snd.hidden = false
      tag.classList.toggle('is-narrow', narrow)
      // Bottom edge of Neo's corner, on the inward side, clear of the bubble and the bar.
      const sw = snd.offsetWidth || 104
      const sx = neoRect.side === 'left' ? neoRect.x + neoRect.w - sw * (narrow ? 0.9 : 0.4) : neoRect.x - sw * (narrow ? 0.1 : 0.6)
      snd.style.transform = `translate(${Math.max(6, Math.min((size?.w ?? 0) - sw - 6, sx)).toFixed(0)}px, ${(neoRect.y + neoRect.h - 44).toFixed(0)}px)`
    } else snd.hidden = true
    // Action: beside the highlighted feature, or by Neo's dialogue on phones / when off screen.
    if (!hs.hidden && !hs.classList.contains('is-docked')) {
      if (actionAtFeature) {
        hs.classList.remove('is-by-neo')
        hs.style.transform = `translate(${hotspot.x.toFixed(0)}px, ${hotspot.y.toFixed(0)}px)`
      } else {
        hs.classList.add('is-by-neo')
        const br = this._bubbleRect
        const r = neoRect
        const hw = hs.offsetWidth || 160
        let x
        let y
        const hh = hs.offsetHeight || 46
        if (br) {
          x = r?.side === 'left' ? br.x + br.w - hw : br.x
          // Immediately below the dialogue, unless that is Neo's head: then just above it.
          y = br.y + br.h + 10
          const headY = r?.head?.y ?? r?.y ?? Infinity
          if (br.kind === 'above' || y + hh > headY - 4) y = br.y - hh - 8
          if (y < 8) y = br.y + br.h + 10
        }
        else if (r?.w) { x = r.side === 'left' ? r.x + r.w + 8 : r.x - hw - 8; y = r.y + r.h * 0.3 }
        else { x = 12; y = (size?.h ?? 300) - 130 }
        x = Math.max(8, Math.min((size?.w ?? 0) - hw - 8, x))
        y = Math.max(8, Math.min(y, (size?.h ?? 0) - 120))
        hs.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`
      }
    }
    // Cards, the bar and the tools panel take the side away from Neo.
    const side = neoRect?.side || 'right'
    this.ov.cards.dataset.side = side
    this.q('#stage-hud').dataset.side = side
    this.q('#tour-panel').dataset.side = side
  }

  /**
   * Speech bubble beside Neo, tail anchored to his head (projected through his own
   * camera and corner viewport). Tries above-head and inward-side placements in normal
   * and compact widths, keeps inside the stage, and avoids covering the rover, the clue
   * and the action. Without Neo or WebGL, a compact "Neo" dialogue box is used instead.
   */
  _placeBubble() {
    const b = this.bubble
    const bubble = this.q('#neo-bubble')
    const dock = this.q('#neo-dock')
    const L = this._lastLayout
    if (!b.text) { bubble.hidden = true; dock.hidden = true; this._bubbleRect = null; return }
    const r = L?.neoRect
    const W = L?.size?.w ?? 0
    const H = L?.size?.h ?? 0
    let mode = !this.getGlobe() || !r?.w ? 'dock' : 'float'
    this._bubbleRect = null
    if (mode === 'float') {
      const narrow = W < 600
      bubble.classList.toggle('is-compact', narrow)
      const head = r.head || { x: r.x + r.w / 2, y: r.y + r.h * 0.12 }
      const avoid = [...L.subjects.map((s) => ({ x: s.x - Math.max(20, s.r), y: s.y - Math.max(20, s.r), w: 2 * Math.max(20, s.r), h: 2 * Math.max(20, s.r) }))]
      if (this._actionRect) avoid.push(this._actionRect)
      const overlap = (x, y, w, h) => avoid.reduce((a, o) => a + Math.max(0, Math.min(x + w, o.x + o.w) - Math.max(x, o.x)) * Math.max(0, Math.min(y + h, o.y + o.h) - Math.max(y, o.y)), 0)
      const widths = narrow ? [Math.min(250, W * 0.68), Math.min(200, W * 0.56)] : [Math.min(340, W * 0.4), 260]
      let best = null
      for (const maxW of widths) {
        bubble.style.maxWidth = `${maxW}px`
        const bw = Math.min(maxW, bubble.offsetWidth || maxW)
        const bh = bubble.offsetHeight || 90
        const inward = r.side === 'left' ? 1 : -1
        const cands = [
          // Above the head, extending toward the centre of the stage.
          { kind: 'above', x: inward > 0 ? head.x - 34 : head.x - bw + 34, y: head.y - 14 - bh },
          // Beside Neo, toward the centre, vertically around the head.
          { kind: 'side', x: inward > 0 ? r.x + r.w + 4 : r.x - bw - 4, y: head.y - bh * 0.35 },
        ]
        for (const c of cands) {
          c.x = Math.max(8, Math.min(W - bw - 8, c.x))
          c.y = Math.max(8, Math.min(H - bh - 66, c.y))
          c.w = bw; c.h = bh
          c.cost = overlap(c.x, c.y, bw, bh) + (c.kind === 'side' ? 1 : 0)
          if (!best || c.cost < best.cost) best = { ...c, maxW }
        }
        if (best.cost <= 1) break
      }
      bubble.style.maxWidth = `${best.maxW}px`
      bubble.dataset.tail = best.kind
      bubble.dataset.side = r.side
      // Tail: x offset (above) or y offset (side) toward Neo's head, clamped inside the bubble.
      bubble.style.setProperty('--tail-x', `${Math.max(16, Math.min(best.w - 30, head.x - best.x - 9)).toFixed(0)}px`)
      bubble.style.setProperty('--tail-y', `${Math.max(14, Math.min(best.h - 30, head.y - best.y - 9)).toFixed(0)}px`)
      bubble.style.transform = `translate(${best.x.toFixed(0)}px, ${best.y.toFixed(0)}px)`
      this._bubbleRect = best
    }
    if (mode !== b.mode) {
      b.mode = mode
      bubble.hidden = mode !== 'float'
      dock.hidden = mode !== 'dock'
    }
    this.ov.neoTag.classList.toggle('is-covered', mode === 'float')
  }

  _syncBubble(fs) {
    const content = this._bubbleContent(fs)
    const b = this.bubble
    const text = content?.text ?? ''
    const chars = content ? Math.min(text.length, content.chars) : 0
    if (text !== b.text || chars !== b.shown || (content?.kind ?? '') !== b.kind) {
      // Cut at a word end so the reveal never shows half a word.
      let cut = chars
      if (cut < text.length) { const sp = text.indexOf(' ', cut); cut = sp === -1 ? text.length : sp }
      const shown = text.slice(0, cut)
      for (const sel of ['#neo-bubble .neo-bubble-text', '#neo-dock .neo-dock-text']) this.q(sel).textContent = shown
      this.q('#neo-bubble').classList.toggle('is-prompt', content?.kind === 'prompt')
      this.q('#neo-dock').classList.toggle('is-prompt', content?.kind === 'prompt')
      const appear = !b.text && text
      b.text = text
      b.shown = chars
      b.kind = content?.kind ?? ''
      if (!text) { b.mode = null; this.q('#neo-bubble').hidden = true; this.q('#neo-dock').hidden = true }
      else if (appear) b.mode = null
    }
    this._placeBubble()
  }

  // --------------------------------------------------------------------- UI

  _sync(force) {
    const run = this.run
    const clock = this.clock
    if (!run || !clock) return
    const fs = this._frameState()
    const globe = this.getGlobe()
    if (globe) {
      globe.setTourFrame(fs)
      globe.setCallout(fs.label && fs.view === 'surface' && !this.waiting ? { text: fs.label.text, anchor: fs.label.anchor } : null)
    }
    const c = fs.cue
    const t = fs.t
    const q = this.q

    const scrub = q('#tour-scrub')
    if (document.activeElement !== scrub || force) scrub.value = String(Math.round((t / run.duration) * 1000))
    scrub.setAttribute('aria-valuetext', `${formatClock(t)} of ${formatClock(run.duration)}, stop ${c.index + 1}: ${c.title}`)
    const timeText = `${formatClock(t)} / ${formatClock(run.duration)}`
    if (q('#tour-time').textContent !== timeText) q('#tour-time').textContent = timeText
    const label = clock.playing ? 'Pause' : clock.ended ? 'Play again' : 'Resume'
    const hp = q('#hud-play')
    if (hp.getAttribute('aria-label') !== label) {
      hp.setAttribute('aria-label', label)
      hp.querySelector('.hud-ico').textContent = clock.playing ? '⏸' : '▶'
      hp.querySelector('.hud-txt').textContent = ` ${label}`
    }
    hp.setAttribute('aria-pressed', String(clock.playing))
    q('.tour-progress-fill').style.width = `${((t / run.duration) * 100).toFixed(2)}%`

    if (c.id !== this.lastCueId || force) {
      const changed = c.id !== this.lastCueId
      this.lastCueId = c.id
      q('#tour-stop').textContent = `Stop ${c.index + 1} of ${run.cues.length}: ${c.title}`
      const ci = ['pf', 'sp', 'op'].indexOf(run.id)
      q('#hud-stop').textContent = `${ci >= 0 ? `Ch ${ci + 1}/3 · ` : ''}Stop ${c.index + 1}/${run.cues.length}`
      q('#tour-line').textContent = c.text ?? (c.fallbackActive ? '(No narration for this beat: the approved fallback is shown.)' : '')
      q('#tour-sources-list').replaceChildren(...this._sourceItems(c.sourceIds))
      for (const [i, li] of [...q('#tour-stops').children].entries()) {
        const b = li.querySelector('button')
        if (i === c.index) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current')
        li.classList.toggle('is-past', i < c.index)
      }
      const banner = c.banner ?? (c.view === 'globe' ? null : 'Mission replay')
      this.ov.banner.hidden = !banner || fs.view === 'globe'
      this.ov.banner.textContent = banner ?? ''
      if (changed && clock.playing) this.announce(`Stop ${c.index + 1}: ${c.title}`)
      this._renderStill(c)
    }
    if (this.ov.banner.dataset.view !== fs.view) { this.ov.banner.dataset.view = fs.view; this.ov.banner.hidden = !this.ov.banner.textContent || fs.view === 'globe' }

    // Object label (fixed copy in the strip when it can't float in the view).
    const lab = this.waiting ? null : fs.label
    const fixed = q('#tour-label')
    const labelText = lab ? lab.text : ''
    if (fixed.dataset.text !== labelText) {
      fixed.dataset.text = labelText
      fixed.replaceChildren(...(lab ? [el('span', { class: 'tour-label-text', text: lab.text }), ' ', ...this._links(lab.sourceIds)] : []))
    }

    // Cards (record cards, comparison bars), rebuilt only when the visible set changes.
    const cards = activeCards(c, fs.τ)
    const key = `${c.id}:${cards.map((k) => k.key).join(',')}`
    if (this.ov.cards.dataset.key !== key) {
      this.ov.cards.dataset.key = key
      this.ov.cards.replaceChildren(...cards.map((k) => this._card(k)))
      requestAnimationFrame(() => this.ov.cards.querySelectorAll('.cmp-fill[data-w]').forEach((b) => { b.style.width = `${b.dataset.w}%` }))
    }

    // Speech bubble (Neo's words) and mouth come from the same playhead.
    this._syncBubble(fs)

    // One contextual action at a time: beside the highlighted feature, or by Neo's dialogue.
    // Expired actions leave the screen and the tab order.
    const hs = q('#tour-hotspot')
    const act = this.waiting || fs.offer
    const noGL = !globe || this.stageError
    const showHot = !!act && !this.inspect && !(noGL && !this.waiting && act.kind === 'inspect')
    if (hs.hidden === showHot) {
      if (!showHot && document.activeElement === hs) q('#hud-play').focus({ preventScroll: true })
      hs.hidden = !showHot
      if (showHot) this.announce(`${act.aria || act.label} available.`)
    }
    if (showHot) {
      const lbl = act.label
      if (hs.dataset.label !== lbl) {
        hs.dataset.label = lbl
        hs.querySelector('.hotspot-label').textContent = lbl
        hs.setAttribute('aria-label', act.aria || lbl)
      }
      if (noGL) hs.classList.add('is-docked')
    }
    q('#tour-inspect-close').hidden = !this.inspect
    q('#tour-inspect-close').textContent = this.inspect?.wasPlaying || this.inspect?.checkpoint ? 'Continue the tour ▶' : 'Close'
    q('#tour-inspect-note').hidden = !this.inspect
    q('#stage-action').hidden = !this.inspect
    this.root.classList.toggle('is-inspecting', !!this.inspect)
    document.querySelector('#globe-stage').classList.toggle('is-waiting', !!this.waiting && !this.inspect)

    this._syncPlan(c)
    this.ov.neoTag.hidden = !globe || !globe.neoView
    q('#tour-error').hidden = !this.stageError

    // End-of-chapter record, inside the view.
    const end = q('#tour-end')
    const atEnd = clock.ended && t >= run.duration - 1e-3
    if (end.hidden === atEnd) {
      end.hidden = !atEnd
      if (atEnd) this._renderEnd()
    }
  }

  _syncPlan(c = this.run && cueAt(this.run, this.clock.time)) {
    const b = this.q('#tour-plan')
    const show = !!(c && c.plan && this.getGlobe())
    b.hidden = !show
    this.q('#tour-plan-note').hidden = !(show && this.planVisible)
    b.setAttribute('aria-pressed', String(this.planVisible))
    b.textContent = this.planVisible ? 'Hide early route plan' : 'Show early route plan (dashed)'
  }

  _renderChapter() {
    const run = this.run
    const idx = ['pf', 'sp', 'op'].indexOf(run.id)
    this.q('#tour-chapter').textContent = idx >= 0 ? `Chapter ${idx + 1} of 3 · ${run.title}` : run.title
    this.q('#tour-stops').replaceChildren(...run.cues.map((c, i) => el('li', {},
      el('button', { type: 'button', class: 'stop-btn', onclick: () => this.seek(c.start) },
        el('span', { class: 'stop-idx', 'aria-hidden': 'true', text: String(i + 1) }),
        el('span', { class: 'stop-label', text: c.title }),
        c.checkpoint ? el('span', { class: 'stop-tap', text: c.checkpoint.required ? '👆 your turn' : '🔍 look closer' }) : null))))
    this.q('#tour-end').hidden = true
    this.ov.cards.replaceChildren()
    this.ov.cards.dataset.key = ''
    const skipped = this.tour.skipped.filter((s) => this.tour.byId.get(s.id)?.chapter === run.id)
    this.q('#tour-skipped').replaceChildren(...skipped.map((s) => el('li', { text: `${s.id}: ${s.fallback} — ${s.reason}` })))
    this.q('#tour-skipped-wrap').hidden = skipped.length === 0
    const mi = this.data.missions.find((m) => m.id === run.mission)
    const plan = mi?.traversePaths.find((p) => p.kind === 'plannedDrive')
    const planDist = (plan?.distanceIds ?? []).map((id) => mi.distanceTraveled.find((d) => d.id === id)).filter(Boolean)
    this.q('#tour-plan-note').textContent = plan ? `${plan.name} (dashed, never driven as drawn): ${planDist.map((d) => `${({ plannedLeg: 'planned leg', craterDiameter: 'crater width', landmarkSeparation: 'hills estimate' })[d.kind]} ${d.values.map((v) => `${d.approximate ? 'about ' : ''}${v.value} ${v.unit}`)[0]}`).join(' · ')}` : ''
  }

  _renderEnd() {
    const run = this.run
    const next = this.tour.chapters.get(run.id)?.next
    const nextCh = next && this.tour.chapters.get(next)
    this.q('#tour-end-title').textContent = run.id === 'outro' ? 'Expedition complete' : `${run.title}: chapter record`
    const nb = this.q('#tour-end-next')
    if (run.id === 'outro') nb.hidden = true
    else {
      nb.hidden = false
      nb.textContent = next === 'outro' ? 'Finish the expedition ▶' : `Next rover: ${nextCh?.title ?? ''} ▶`
    }
    this.q('#tour-end-replay').textContent = run.id === 'outro' ? 'Hear the closing again' : 'Replay chapter'
    this.q('#tour-end').querySelector('button:not([hidden])')?.focus({ preventScroll: true })
    this.announce(`${this.q('#tour-end-title').textContent}. ${nb.hidden ? '' : nb.textContent.replace(' ▶', '') + ', or '}explore the globe.`)
  }

  _renderStill(c) {
    const fig = this.q('#tour-still')
    const noGL = !this.getGlobe()
    const img = c.still && this.assets.roverImages?.[c.still.mission]?.[c.still.index]
    fig.hidden = !(noGL && img)
    this.q('#tour-neo-still').hidden = !noGL
    if (!noGL || !img) return
    const im = fig.querySelector('img')
    if (im.dataset.src !== img.src) {
      im.dataset.src = img.src
      im.alt = img.alt
      im.src = resolveLocal(img.src)
      im.onerror = () => { fig.querySelector('.tour-still-ph').hidden = false; im.hidden = true }
      im.hidden = false
      fig.querySelector('.tour-still-ph').hidden = true
      fig.querySelector('figcaption').textContent = [img.caption, img.credit].filter(Boolean).join(' · ')
    }
  }

  _card(k) {
    const src = el('p', { class: 'card-src' }, ...this._links(k.sourceIds))
    if (k.bars) {
      return el('section', { class: 'tour-card is-compare', 'aria-label': k.title },
        el('h3', { text: k.title }),
        el('ul', { class: 'cmp' }, k.bars.map((b) => {
          const fill = el('span', { class: 'cmp-fill', 'data-w': b.pct.toFixed(2) })
          if (this.reduced) fill.style.width = `${b.pct.toFixed(2)}%`
          return el('li', {}, el('span', { class: 'cmp-name', text: b.name }), el('span', { class: 'cmp-track', 'aria-hidden': 'true' }, fill), el('span', { class: 'cmp-val num', text: b.value }))
        })), src)
    }
    return el('section', { class: `tour-card${k.emphasis ? ' is-date' : ''}` },
      k.title ? el('h3', { text: k.title }) : null, el('p', { class: 'card-text', text: k.text }), src)
  }

  _links(ids) {
    const out = []
    for (const id of ids || []) {
      const s = this.tour.sources[id]
      if (!s || !isSafeSourceUrl(s.url)) continue
      if (out.length) out.push(document.createTextNode(' · '))
      out.push(el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', text: s.title }))
    }
    if (out.length) out.unshift(document.createTextNode('Source: '))
    return out
  }

  _sourceItems(ids) {
    return (ids || []).filter((id) => this.tour.sources[id]).map((id) => {
      const s = this.tour.sources[id]
      return el('li', {}, el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', text: s.title }))
    })
  }
}
