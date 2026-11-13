// The single playback clock and small timing helpers, shared by Neo's tour.
// Pure JavaScript (no Three.js), so playback keeps working without the 3D layer.


export const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

/** Ease between keyframes [{t, s}] with zero velocity at each key (no abrupt starts/stops). */
export function sampleKeys(keys, t) {
  if (t <= keys[0].t) return keys[0].s
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]
    const b = keys[i]
    if (t <= b.t) return a.s + (b.s - a.s) * smooth((t - a.t) / (b.t - a.t || 1))
  }
  return keys[keys.length - 1].s
}

/** Linear ramp of t between t0 and t1, eased. */
export const phase = (t, t0, t1) => smooth((t - t0) / (t1 - t0))

/**
 * One clock per active replay. The playhead is the single source of truth for rover
 * pose, camera, route reveal, active stop and caption. Seeking between stops animates
 * the playhead itself, so nothing else needs its own timer.
 */
export class PlaybackClock {
  constructor(duration) {
    this.duration = duration
    this.time = 0
    this.playing = false
    this.ended = false
    this.seekTween = null
  }

  play() {
    if (this.time >= this.duration - 1e-3) this.time = 0
    this.seekTween = null
    this.ended = false
    this.playing = true
  }

  pause() { this.playing = false }

  /** Jump (or glide over `glide` seconds) to t and hold there. */
  seek(t, glide = 0) {
    t = clamp(t, 0, this.duration)
    this.playing = false
    this.ended = t >= this.duration
    if (glide > 0 && Math.abs(t - this.time) > 1e-3) this.seekTween = { from: this.time, to: t, elapsed: 0, dur: glide }
    else { this.seekTween = null; this.time = t }
  }

  tick(dt) {
    if (this.seekTween) {
      const s = this.seekTween
      s.elapsed += dt
      const k = smooth(s.elapsed / s.dur)
      this.time = s.from + (s.to - s.from) * k
      if (s.elapsed >= s.dur) { this.time = s.to; this.seekTween = null }
      return
    }
    if (!this.playing) return
    this.time += dt
    if (this.time >= this.duration) {
      this.time = this.duration
      this.playing = false
      this.ended = true
    }
  }
}

export function activeStopIndex(def, t) {
  let idx = 0
  for (let i = 0; i < def.stops.length; i++) if (t >= def.stops[i].t - 1e-3) idx = i
  return idx
}

export function activeCue(def, t) {
  for (let i = def.cues.length - 1; i >= 0; i--) {
    const c = def.cues[i]
    if (t >= c.t0 - 1e-3 && t < c.t1 + (i === def.cues.length - 1 ? 1e-3 : 0)) return c
  }
  return null
}

export function formatClock(t) {
  const s = Math.max(0, Math.round(t))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
