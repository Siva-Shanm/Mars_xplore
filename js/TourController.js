// Neo's guided expedition: one authoritative playhead per chapter.
// Camera, Neo, rover, wheels, route reveal, captions, cards, science effects and stops
// are all derived from (chapter, playhead). Speech is optional and can only *hold* a cue
// for a bounded time; it never drives progress. No Three.js import: when 3D is
// unavailable the same stops, captions, cards and sources run as an HTML tour.

import { PlaybackClock, formatClock } from './replays.js'
import { chapterRun, cueAt, activeLabel, activeCards } from './tour.js'
import { isSafeSourceUrl, resolveLocal } from './validate.js'
import { Narrator } from './Narrator.js'

const SEEK_GLIDE = 0.45
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

export class TourController {
  constructor({ root, overlays, tour, data, assets, announce, getGlobe, onExit, onExploreGlobe }) {
    this.root = root
    this.ov = overlays // {cards, banner, neoTag, stageBadge}
    this.tour = tour
    this.data = data
    this.assets = assets
    this.announce = announce
    this.getGlobe = getGlobe
    this.onExit = onExit
    this.onExploreGlobe = onExploreGlobe
    this.narrator = new Narrator()
    this.run = null
    this.clock = null
    this.token = 0
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    this.inspect = null
    this.heldFor = 0
    this.lastCueId = null
    this.lastFrameFromGlobe = 0
    this.planVisible = false
    this.stageError = false
    this.q = (s) => root.querySelector(s)
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
    q('#tour-back').addEventListener('click', () => this.exit())
    q('#tour-play').addEventListener('click', () => (this.clock?.playing ? this.pause() : this.play()))
    q('#tour-prev').addEventListener('click', () => this.step(-1))
    q('#tour-next').addEventListener('click', () => this.step(1))
    q('#tour-replay').addEventListener('click', () => { this.seek(0, false); this.play() })
    q('#tour-listen').addEventListener('click', () => this.setListen(!this.narrator.enabled))
    q('#tour-replay-line').addEventListener('click', () => this.replayLine())
    q('#tour-inspect').addEventListener('click', () => this.openInspect())
    q('#tour-inspect-close').addEventListener('click', () => this.closeInspect())
    q('#tour-plan').addEventListener('click', () => {
      this.planVisible = !this.planVisible
      this.getGlobe()?.setPlanVisible(this.planVisible)
      this._syncPlan()
    })
    q('#tour-end-next').addEventListener('click', () => this._endNext())
    q('#tour-end-globe').addEventListener('click', () => { this.exit({ silent: true }); this.onExploreGlobe?.() })
    q('#tour-end-replay').addEventListener('click', () => { this.seek(0, false); this.play() })
    const scrub = q('#tour-scrub')
    scrub.addEventListener('input', () => {
      if (!this.clock) return
      this.seek((Number(scrub.value) / 1000) * this.clock.duration, false)
    })
    q('#tour-listen').hidden = !this.narrator.supported
    q('#tour-replay-line').hidden = !this.narrator.supported
  }

  // --------------------------------------------------------------- lifecycle

  startExpedition() { this.start('pf', { withIntro: true, expedition: true }) }

  start(chapterId, { withIntro = false, expedition = false, autoplay = true, at = 0 } = {}) {
    const run = chapterRun(this.tour, chapterId, { withIntro })
    if (!run) return
    const token = ++this.token
    this.narrator.cancel()
    this.run = run
    this.expedition = expedition || this.expedition
    this.clock = new PlaybackClock(run.duration)
    this.clock.seek(at)
    this.inspect = null
    this.heldFor = 0
    this.lastCueId = null
    this.planVisible = false
    this.stageError = false
    this._renderChapter()
    this.root.hidden = false
    this.root.classList.add('is-active')
    const globe = this.getGlobe()
    if (globe) {
      globe.beginTour()
      try { globe.loadTourStage(chapterId, run, this.tour.approvals) } catch (err) {
        console.error('[tour] stage failed', err)
        this.stageError = true
      }
    }
    this._ensureLoop()
    if (autoplay) this.play()
    this._sync(true)
    this.q('#tour-play').focus({ preventScroll: true })
    this.announce(`${run.title}. ${run.cues.length} stops. ${globe ? '' : '3D view unavailable; captions continue.'}`)
    void token
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
    this.root.hidden = true
    this.root.classList.remove('is-active')
    this.ov.cards.replaceChildren()
    this.ov.banner.hidden = true
    this.ov.neoTag.hidden = true
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

  play() {
    if (!this.clock) return
    if (this.clock.time >= this.clock.duration - 1e-3) this.clock.seek(0)
    this.clock.play()
    this.heldFor = 0
    // Restart only the active line if we resume inside it (speech cannot resume reliably).
    const c = cueAt(this.run, this.clock.time)
    if (c.text && this.clock.time >= c.speakStart && this.clock.time < c.speakEnd) this.narrator.speak(c.text, c.id)
    this._sync(true)
  }

  pause() {
    if (!this.clock) return
    this.clock.pause()
    this.narrator.cancel()
    this._sync(true)
  }

  /** Seek pauses at the target; the visitor resumes explicitly. */
  seek(t, glide = true) {
    if (!this.clock) return
    this.narrator.cancel()
    this.heldFor = 0
    this.inspect = null
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
    this.clock.seek(c.text ? c.speakStart : c.start)
    this.play()
  }

  setListen(on) {
    this.narrator.setEnabled(on)
    const b = this.q('#tour-listen')
    b.setAttribute('aria-pressed', String(this.narrator.enabled))
    b.textContent = this.narrator.enabled ? 'Mute Neo' : 'Listen to Neo'
    if (this.narrator.enabled && this.clock?.playing) {
      const c = cueAt(this.run, this.clock.time)
      if (c.text && this.clock.time >= c.speakStart && this.clock.time < c.speakEnd) this.narrator.speak(c.text, c.id)
    }
    this.announce(this.narrator.enabled ? 'Narration on.' : 'Narration muted. Captions continue.')
  }

  openInspect() {
    if (!this.run) return
    const c = cueAt(this.run, this.clock.time)
    if (!c.inspect) return
    this.inspect = { target: c.inspect.target, label: c.inspect.label, yaw: 0, pitch: 0, wasPlaying: this.clock.playing, cueId: c.id }
    this.clock.pause()
    this.narrator.cancel()
    this._sync(true)
    this.q('#tour-inspect-close').focus()
    this.announce(`${c.inspect.label}. Drag to look around. Close to return to the same moment.`)
  }

  closeInspect() {
    if (!this.inspect) return
    const was = this.inspect.wasPlaying
    this.inspect = null
    this._sync(true)
    if (was) this.play()
    this.q('#tour-inspect').focus()
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
    // Speech may hold the cue at the end of its line, for a bounded time only.
    let hold = false
    if (clock.playing && !clock.seekTween && cur.text && before >= cur.speakEnd - 1e-3 && this.narrator.speakingFor(cur.id)) {
      this.heldFor += dt
      hold = this.heldFor < cur.speakDur * 0.6 + 4
    } else if (before < cur.speakEnd - 1e-3) this.heldFor = 0
    if (!hold) clock.tick(dt)
    const t = clock.time
    // One-shot side effect: speak a line only when forward playback crosses its start.
    if (clock.playing && t > before) {
      for (const c of this.run.cues) if (c.text && before < c.speakStart && c.speakStart <= t) this.narrator.speak(c.text, c.id)
    }
    this._sync(false)
  }

  _frameState() {
    const run = this.run
    const t = this.clock.time
    const c = cueAt(run, t)
    const τ = t - c.start
    const playing = this.clock.playing && !this.inspect
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
    if (this.stageError) { action = 'error'; target = 'viewer' }
    const accentOn = n.accent && τ >= (n.accentFrom ?? 0) && τ < n.accent.until
    const speaking = playing && (this.narrator.enabled ? this.narrator.speakingFor(c.id) : (c.text && t >= c.speakStart && t < c.speakEnd))
    const held = speaking && t >= c.speakEnd - 1e-3
    const label = activeLabel(c, τ)
    return {
      t, cue: c, τ, view, globe, playing, reduced: this.reduced, inspect: this.inspect, mission: run.mission,
      highlightSites: !!c.highlightSites,
      label: label && !(view === 'globe' && !['sojourner', 'spirit', 'opportunity'].includes(label.anchor)) ? label : null,
      neo: {
        action, target, expr: this.stageError ? 'error' : (n.expr || 'smile'), τ: nτ, side: n.side || 'right',
        speaking, mouthPhase: held ? performance.now() / 1000 : t, t, reduced: this.reduced, idleOk: playing && !this.reduced,
        nodAt: n.nodAt != null ? (c.speakStart - c.start) + n.nodAt : null, accent: accentOn ? { expr: n.accent.expr, until: Infinity } : null,
        duration: c.duration,
      },
    }
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
      globe.setCallout(fs.label && fs.view === 'surface' ? { text: fs.label.text, anchor: fs.label.anchor } : null)
    }
    const c = fs.cue
    const t = fs.t
    const q = this.q

    const scrub = q('#tour-scrub')
    if (document.activeElement !== scrub || force) scrub.value = String(Math.round((t / run.duration) * 1000))
    scrub.setAttribute('aria-valuetext', `${formatClock(t)} of ${formatClock(run.duration)}, stop ${c.index + 1}: ${c.title}`)
    const timeText = `${formatClock(t)} / ${formatClock(run.duration)}`
    if (q('#tour-time').textContent !== timeText) q('#tour-time').textContent = timeText
    const play = q('#tour-play')
    const label = clock.playing ? 'Pause' : clock.ended ? 'Play again' : 'Resume'
    if (play.textContent !== label) play.textContent = label
    play.setAttribute('aria-pressed', String(clock.playing))
    q('.tour-progress-fill').style.width = `${((t / run.duration) * 100).toFixed(2)}%`

    if (c.id !== this.lastCueId || force) {
      const changed = c.id !== this.lastCueId
      this.lastCueId = c.id
      q('#tour-stop').textContent = `Stop ${c.index + 1} of ${run.cues.length}: ${c.title}`
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

    // Object label: floats in the canvas when clear, else shown here.
    const lab = fs.label
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

    // One contextual inspection affordance at a time.
    const canInspect = !!(c.inspect && fs.τ >= (c.inspect.at ?? 0) && globe && fs.view === 'surface' && !this.stageError)
    const ib = q('#tour-inspect')
    ib.hidden = !canInspect || !!this.inspect
    if (canInspect && ib.textContent !== c.inspect.label) ib.textContent = c.inspect.label
    q('#tour-inspect-close').hidden = !this.inspect
    q('#tour-inspect-note').hidden = !this.inspect
    this.root.classList.toggle('is-inspecting', !!this.inspect)

    this._syncPlan(c)
    this.ov.neoTag.hidden = !globe || !globe.neoView
    q('#tour-error').hidden = !this.stageError

    // End-of-chapter record.
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
        el('span', { class: 'stop-label', text: c.title })))))
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
    const end = this.q('#tour-end')
    this.q('#tour-end-title').textContent = run.id === 'outro' ? 'Expedition complete' : `${run.title}: chapter record`
    const nb = this.q('#tour-end-next')
    if (run.id === 'outro') nb.hidden = true
    else {
      nb.hidden = false
      nb.textContent = next === 'outro' ? 'Finish the expedition' : `Next rover: ${nextCh?.title ?? ''}`
    }
    this.q('#tour-end-replay').textContent = run.id === 'outro' ? 'Hear the closing again' : 'Replay chapter'
    end.querySelector('button:not([hidden])')?.focus({ preventScroll: true })
    this.announce(`${this.q('#tour-end-title').textContent}. ${nb.hidden ? '' : nb.textContent + ', or '}explore the globe.`)
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
