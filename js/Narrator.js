// Optional narration via the browser's speech synthesis (progressive enhancement).
// Narration is never required for progress: the tour has a timed caption path, never
// waits indefinitely for voices or end events, and cancels speech on pause, seek,
// inspection, mission switch or a hidden tab.

const PREFERRED = [/en-US/i, /en-GB/i, /^en/i]

export class Narrator {
  constructor() {
    this.supported = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function'
    this.enabled = false
    this.voiceName = null
    this.current = null // {utterance, cueId, token, started, ended, failed}
    this.token = 0
    if (this.supported) {
      try { window.speechSynthesis.addEventListener?.('voiceschanged', () => this._pickVoice()) } catch { /* optional */ }
      this._pickVoice()
    }
  }

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
    if (!this.voiceName) return null
    try { return window.speechSynthesis.getVoices().find((v) => v.name === this.voiceName) || null } catch { return null }
  }

  setEnabled(v) {
    this.enabled = !!v && this.supported
    if (!this.enabled) this.cancel()
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
      return null
    }
    const rec = { utterance: u, cueId, token, started: false, ended: false, failed: false, at: performance.now() }
    u.onstart = () => { if (rec.token === this.token) rec.started = true }
    u.onend = () => { rec.ended = true }
    u.onerror = () => { rec.failed = true; rec.ended = true }
    this.current = rec
    try { window.speechSynthesis.speak(u) } catch { rec.failed = true; rec.ended = true }
    return rec
  }

  /** True while the active line for this cue is still being spoken. */
  speakingFor(cueId) {
    const c = this.current
    if (!c || c.cueId !== cueId || c.ended || c.failed) return false
    // Some browsers never fire onstart (no voices / blocked audio): treat as silent after 1.5 s.
    if (!c.started && performance.now() - c.at > 1500) return false
    return true
  }

  cancel() {
    this.token++
    this.current = null
    if (!this.supported) return
    try { window.speechSynthesis.cancel() } catch { /* ignore */ }
  }
}
