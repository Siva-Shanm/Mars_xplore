// Replay definitions and the single playback clock. Pure JavaScript (no Three.js),
// so stops, captions and scrubbing keep working when the 3D layer is unavailable.
//
// All numbers shown in captions are read from data/rovers.json. Timing, spacing,
// heights and terrain are presentation choices and carry no mission meaning.

import { formatDistance } from './MissionPanel.js'

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

// ------------------------------------------------------------------ builders

const wpName = (m, id, fallback) => m.waypoints.find((w) => w.id === id)?.name ?? fallback

function pathfinderReplay(m) {
  const bouncePath = m.traversePaths.find((p) => p.kind === 'landingBounce')
  const disp = m.distanceTraveled.find((d) => d.kind === 'landerDisplacement')
  const rampFact = m.facts.find((f) => /ramp/i.test(f.text))
  const rampDeg = rampFact ? Number((rampFact.text.match(/(\d+(?:\.\d+)?)\s*°/) || [])[1]) || null : null
  const b = bouncePath?.bounce
  const countText = b ? `${b.approximate ? 'About ' : ''}${b.count} bounces` : 'Bounces'
  const heightText = b ? `Up to ${b.maxHeight.value} ${b.maxHeight.unit} high` : 'Bounce height'
  const dispText = disp ? `${formatDistance(disp).replace(/^about/, 'About')} from first impact to rest` : 'Rolling to rest'
  const station = wpName(m, 'station', 'Landing station')
  const rampText = rampDeg ? `${rampDeg}° deployment ramp` : 'Deployment ramp'
  const pfSrc = bouncePath?.sourceIds ?? m.sourceIds
  const rampSrc = rampFact?.sourceIds ?? m.sourceIds

  const T = { impact: 1.2, bouncesEnd: 9.0, rest: 11.0, bagsEnd: 12.4, petalsEnd: 13.8, rampEnd: 15.2, descentEnd: 18.6, driveEnd: 23.0, end: 24 }
  return {
    missionId: m.id,
    title: 'Pathfinder landing and Sojourner’s first drive',
    duration: T.end,
    timing: { ...T, rampDeg: rampDeg ?? 20, bounceCount: b?.count ?? 15 },
    stops: [
      { id: 'impact', t: T.impact, label: 'First surface impact', sourceIds: pfSrc },
      { id: 'high', t: 2.3, label: 'Highest bounces', sourceIds: pfSrc },
      { id: 'bounces', t: 5.6, label: countText, sourceIds: pfSrc },
      { id: 'rest', t: 10.4, label: 'Roll to rest', sourceIds: disp?.sourceIds ?? pfSrc },
      { id: 'station', t: 13.4, label: station, sourceIds: m.sourceIds },
      { id: 'ramp', t: T.rampEnd, label: 'Ramp deployed', sourceIds: rampSrc },
      { id: 'descent', t: 17.4, label: 'Sojourner descends', sourceIds: rampSrc },
      { id: 'drive', t: 21.8, label: 'Short illustrative drive', sourceIds: m.sourceIds },
    ],
    cues: [
      { t0: 0, t1: 1.0, text: 'Airbag-wrapped lander arrives', anchor: 'lander', sourceIds: pfSrc },
      { t0: 1.0, t1: 1.9, text: 'First surface impact', anchor: 'lander', sourceIds: pfSrc },
      { t0: 1.9, t1: 3.8, text: `${heightText} · drawn heights not to scale`, anchor: 'lander', sourceIds: pfSrc },
      { t0: 3.8, t1: T.bouncesEnd, text: countText, anchor: 'lander', sourceIds: pfSrc },
      { t0: T.bouncesEnd, t1: T.rest, text: `${dispText} (lander, not a drive)`, anchor: 'lander', sourceIds: disp?.sourceIds ?? pfSrc },
      { t0: T.rest, t1: T.petalsEnd, text: `${station} · airbags retract, petals open`, anchor: 'lander', sourceIds: m.sourceIds },
      { t0: T.petalsEnd, t1: T.rampEnd + 0.4, text: rampText, anchor: 'ramp', sourceIds: rampSrc },
      { t0: T.rampEnd + 0.4, t1: T.descentEnd, text: `Sojourner rolls down the ${rampDeg ? `${rampDeg}° ` : ''}ramp`, anchor: 'rover', sourceIds: rampSrc },
      { t0: T.descentEnd, t1: T.end, text: 'Short illustrative drive · Sojourner’s odometer is not in this dataset', anchor: 'rover', sourceIds: m.sourceIds },
    ],
    chips: [
      { label: 'Bounces', value: b ? `${b.approximate ? 'about ' : ''}${b.count}` : '—', stopId: 'bounces', sourceIds: pfSrc },
      { label: 'Max height', value: b ? `up to ${b.maxHeight.value} ${b.maxHeight.unit}` : '—', stopId: 'high', sourceIds: pfSrc },
      { label: 'Lander displacement', value: disp ? formatDistance(disp) : '—', stopId: 'rest', sourceIds: disp?.sourceIds ?? pfSrc },
      { label: 'Ramp angle', value: rampDeg ? `${rampDeg}°` : '—', stopId: 'ramp', sourceIds: rampSrc },
    ],
    sequenceLabel: 'Landing sequence',
    notes: ['Lander motion (pale trace) and Sojourner’s drive (cyan) are separate. The 1 km is the lander’s displacement while bouncing and rolling, not a rover driving distance.'],
    motion: {
      // Rover route parameter s in waypoint units: 0 petal, 1 ramp top, 2 ramp foot, 3 drive end.
      rover: [{ t: 0, s: 0 }, { t: T.rampEnd + 0.3, s: 0 }, { t: 16.2, s: 1 }, { t: T.descentEnd, s: 2 }, { t: T.driveEnd, s: 3 }],
    },
  }
}

function spiritReplay(m) {
  const odo = m.distanceTraveled.find((d) => d.kind === 'roverOdometer')
  const plan = m.traversePaths.find((p) => p.kind === 'plannedDrive')
  const planDist = (plan?.distanceIds ?? []).map((id) => m.distanceTraveled.find((d) => d.id === id)).filter(Boolean)
  const landing = wpName(m, 'gusev-landing', 'Landing site')
  const bonn = wpName(m, 'bonneville', 'Bonneville Crater')
  const hills = wpName(m, 'columbia-hills', 'Columbia Hills')
  const drive = m.traversePaths.find((p) => p.kind === 'roverDrive')
  const src = drive?.sourceIds ?? m.sourceIds
  return {
    missionId: m.id,
    title: `${landing} → ${bonn} → ${hills}`,
    duration: 22,
    stops: [
      { id: 'landing', t: 0.4, label: landing, sourceIds: src },
      { id: 'leave', t: 3.6, label: 'Leaving the lander', sourceIds: src },
      { id: 'bonneville', t: 10.2, label: bonn, sourceIds: src },
      { id: 'onward', t: 15.6, label: `Toward ${hills}`, sourceIds: src },
      { id: 'hills', t: 21.4, label: hills, sourceIds: src },
    ],
    cues: [
      { t0: 0, t1: 2.2, text: `${landing}`, anchor: 'rover', sourceIds: src },
      { t0: 2.2, t1: 7.6, text: 'Leaving the landing site', anchor: 'rover', sourceIds: src },
      { t0: 7.6, t1: 12.4, text: `${bonn} stop`, anchor: 'landmark:bonneville', sourceIds: src },
      { t0: 12.4, t1: 19.6, text: `Heading toward ${hills}`, anchor: 'rover', sourceIds: src },
      { t0: 19.6, t1: 22, text: `${hills} · an early portion of a much longer mission`, anchor: 'landmark:hills', sourceIds: src },
    ],
    chips: [
      odo && { label: 'Lifetime odometer (not this replay)', value: formatDistance(odo), sourceIds: odo.sourceIds },
      ...planDist.map((d) => ({ label: `Early plan · ${{ plannedLeg: 'planned leg', craterDiameter: 'crater width', landmarkSeparation: 'hills estimate' }[d.kind] ?? d.kind}`, value: formatDistance(d), sourceIds: d.sourceIds, plan: true })),
    ].filter(Boolean),
    hasPlan: !!plan,
    planLabel: plan ? `${plan.name} (dashed, never driven as drawn)` : null,
    notes: ['This replay covers the early part of Spirit’s mission. The lifetime odometer is a separate figure and is not shown as a route.'],
    motion: {
      // s: 0 landing, 1 off lander, 2 Bonneville rim, 3 past the crater, 4 Columbia Hills base
      rover: [{ t: 0, s: 0 }, { t: 1.4, s: 0 }, { t: 4.4, s: 1 }, { t: 9.4, s: 2 }, { t: 11.6, s: 2 }, { t: 15.6, s: 3 }, { t: 21.0, s: 4 }],
    },
  }
}

function opportunityReplay(m) {
  const odo = m.distanceTraveled.find((d) => d.kind === 'roverOdometer')
  const sep = m.distanceTraveled.find((d) => d.kind === 'landmarkSeparation')
  const record = m.facts.find((f) => /record/i.test(f.text))
  const landing = wpName(m, 'eagle-landing', 'Landing site')
  const exit = wpName(m, 'eagle-exit', 'Crater exit')
  const endurance = wpName(m, 'endurance', 'Endurance Crater')
  const drive = m.traversePaths.find((p) => p.kind === 'roverDrive')
  const src = drive?.sourceIds ?? m.sourceIds
  return {
    missionId: m.id,
    title: `${landing} → ${exit} → ${endurance}`,
    duration: 22,
    stops: [
      { id: 'landing', t: 0.4, label: landing, sourceIds: src },
      { id: 'climb', t: 6.0, label: 'Climbing out', sourceIds: src },
      { id: 'exit', t: 9.0, label: exit, sourceIds: src },
      { id: 'plains', t: 15.0, label: 'Across Meridiani Planum', sourceIds: src },
      { id: 'endurance', t: 21.4, label: endurance, sourceIds: src },
    ],
    cues: [
      { t0: 0, t1: 3.6, text: landing, anchor: 'rover', sourceIds: src },
      { t0: 3.6, t1: 8.2, text: 'Stylized climb up the crater wall', anchor: 'rover', sourceIds: src },
      { t0: 8.2, t1: 10.6, text: exit, anchor: 'landmark:eagleExit', sourceIds: src },
      { t0: 10.6, t1: 19.4, text: `Toward ${endurance}`, anchor: 'rover', sourceIds: src },
      { t0: 19.4, t1: 22, text: `${endurance} · ${sep ? `${formatDistance(sep)} from Eagle (landmark separation)` : 'next destination'}`, anchor: 'landmark:endurance', sourceIds: sep?.sourceIds ?? src },
    ],
    chips: [
      sep && { label: 'Eagle → Endurance separation', value: formatDistance(sep), stopId: 'endurance', sourceIds: sep.sourceIds },
      odo && { label: 'Lifetime odometer (not this replay)', value: formatDistance(odo), sourceIds: odo.sourceIds },
      record && { label: 'Distance record', value: 'Historical — formerly held', sourceIds: record.sourceIds },
    ].filter(Boolean),
    notes: ['The separation between the two craters is not the rover’s total distance driven. The early segment shown is a small part of the mission.'],
    motion: {
      // s: 0 landing outcrop, 1 off lander, 2 crater wall, 3 rim exit, 4 plains, 5 Endurance rim
      rover: [{ t: 0, s: 0 }, { t: 1.4, s: 0 }, { t: 3.6, s: 1 }, { t: 6.4, s: 2 }, { t: 8.6, s: 3 }, { t: 10.2, s: 3 }, { t: 15.2, s: 4 }, { t: 21.0, s: 5 }],
    },
  }
}

const BUILDERS = { sojourner: pathfinderReplay, spirit: spiritReplay, opportunity: opportunityReplay }

/** Returns a replay definition for a validated mission, or null if unsupported. */
export function buildReplay(mission) {
  const fn = BUILDERS[mission.id]
  if (!fn) return null
  try { return fn(mission) } catch (err) { console.warn('[replay] could not build', mission.id, err); return null }
}
