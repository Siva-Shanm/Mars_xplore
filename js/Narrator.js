// Narration via the browser's speech synthesis. On by default once the visitor starts
// the tour (that click is the user gesture browsers require), but never required for
// progress: the tour has a timed caption path, never waits indefinitely for voices or
// end events, and cancels speech on pause, seek, inspection, chapter switch or a hidden tab.

const PREFERRED = [/en-US/i, /en-GB/i, /^en/i]
const START_TIMEOUT_MS = 2500

export class Narrator {
  constructor() {
    this.supported = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function'
    this.enabled = false
    this.voiceName = null
    this.current = null // {cueId, token, started, ended, failed, at, charIndex}
    this.token = 0
    this.failure = this.supported ? null : 'unsupported'
    if (this.supported) {
      try {
        window.speechSynthesis.addEventListener?.('voiceschanged', () => this._pickVoice())
        if ('onvoiceschanged' in window.speechSynthesis && !window.speechSynthesis.onvoiceschanged) window.speechSynthesis.onvoiceschanged = () => this._pickVoice()
      } catch { /* optional */ }
      this._pickVoice()
    }
  }

  /** Choose one English voice and keep it (Chrome's first getVoices() call is often empty). */
  _pickVoice() {
    if (!this.supported || this.voiceName) return
    let voices = []
    try { voices = window.speechSynthesis.getVoices() || [] } catch { voices = [] }
    for (const re of PREFERRED) {
      const v = voices.find((x) => re.test(x.lang) && x.localService) || voices.find((x) => re.test(x.lang))
      if (v) { this.voiceName = v.name; return }
    }
  }

  _voice() {
    this._pickVoice()
    if (!this.voiceName) return null
    try { return window.speechSynthesis.getVoices().find((v) => v.name === this.voiceName) || null } catch { return null }
  }

  setEnabled(v) {
    this.enabled = !!v && this.supported
    if (!this.enabled) this.cancel()
  }

  /**
   * Must be called synchronously inside a click/tap handler: some browsers (Safari/iOS,
   * Chrome's autoplay policy) only allow speech after speak() runs within a user gesture.
   */
  unlock() {
    if (!this.supported || this._unlocked) return
    try {
      const u = new window.SpeechSynthesisUtterance(' ')
      u.volume = 0
      window.speechSynthesis.speak(u)
      this._unlocked = true
    } catch (err) {
      this._fail('exception')
    }
  }

  _fail(reason) {
    if (!this.failure) this.failure = reason
  }

  /** Speak a cue line. Returns immediately; never blocks the tour. */
  speak(text, cueId) {
    if (!this.enabled || !text) return null
    this.cancel()
    const token = ++this.token
    let u
    try {
      u = new window.SpeechSynthesisUtterance(text)
      const v = this._voice()
      if (v) { u.voice = v; u.lang = v.lang } else u.lang = 'en-US'
      u.rate = 1
      u.pitch = 1.05
    } catch {
      this._fail('exception')
      return null
    }
    const rec = { cueId, token, started: false, ended: false, failed: false, at: performance.now(), charIndex: 0, text }
    u.onstart = () => { if (rec.token === this.token) rec.started = true }
    u.onboundary = (e) => { if (rec.token === this.token && Number.isFinite(e.charIndex)) rec.charIndex = Math.max(rec.charIndex, e.charIndex + (e.charLength || 0)) }
    u.onend = () => { rec.ended = true; rec.charIndex = text.length }
    u.onerror = (e) => {
      rec.ended = true
      // Our own cancel() produces 'interrupted' / 'canceled'; those are not failures.
      if (rec.token === this.token && e && e.error && !['interrupted', 'canceled'].includes(e.error)) { rec.failed = true; this._fail(e.error) }
    }
    this.current = rec
    try { window.speechSynthesis.speak(u) } catch { rec.failed = true; rec.ended = true; this._fail('exception') }
    return rec
  }

  /** True while the active line for this cue is audibly being spoken. */
  speakingFor(cueId) {
    const c = this.current
    if (!c || c.cueId !== cueId || c.ended || c.failed) return false
    if (!c.started) {
      // Blocked or voiceless browsers may never fire onstart: treat as silent.
      if (performance.now() - c.at > START_TIMEOUT_MS) { this._fail('blocked'); return false }
      return false
    }
    return true
  }

  /** Characters of the active line the voice has reached (from boundary events). */
  spokenChars(cueId) {
    const c = this.current
    return c && c.cueId === cueId && c.started ? c.charIndex : 0
  }

  cancel() {
    this.token++
    this.current = null
    if (!this.supported) return
    try { window.speechSynthesis.cancel() } catch { /* ignore */ }
  }
}
