// Neo's guided expedition: cue data → chapter timelines. Pure JavaScript (no Three.js),
// shared by the 3D view and the HTML-only tour, so stops, captions, labels and sources
// are identical in both. Spoken lines come verbatim from data/tour.json (copied from the
// narration script); on-screen numbers are resolved from data/rovers.json by key.

import { formatDistance } from './MissionPanel.js'
import { isSafeSourceUrl } from './validate.js'

const fmtDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' })

/** Label/card resolvers: every number shown on screen comes from rovers.json. */
export function makeResolvers(data) {
  const M = Object.fromEntries(data.missions.map((m) => [m.id, m]))
  const dist = (mid, kind, id) => M[mid]?.distanceTraveled.find((d) => (id ? d.id === id : d.kind === kind))
  const date = (mid, ev) => M[mid]?.dates.find((d) => d.event === ev)
  const fact = (mid, re) => M[mid]?.facts.find((f) => re.test(f.text))
  const disc = (mid, re) => M[mid]?.discoveries.find((f) => re.test(f.text))
  const bounce = M.sojourner?.traversePaths.find((p) => p.bounce)
  const out = {
    pfMaxHeight: () => bounce && { text: `Up to ${bounce.bounce.maxHeight.value} ${bounce.bounce.maxHeight.unit} high (lander bounce; heights not to scale)`, sourceIds: bounce.sourceIds },
    pfBounceCount: () => bounce && { text: `${bounce.bounce.approximate ? 'About ' : ''}${bounce.bounce.count} bounces`, sourceIds: bounce.sourceIds },
    pfDisplacement: () => { const d = dist('sojourner', 'landerDisplacement'); return d && { text: `${formatDistance(d).replace(/^about/, 'About')} from first impact to rest (lander, not a drive)`, sourceIds: d.sourceIds } },
    pfRamp: () => { const f = fact('sojourner', /ramp/i); const deg = f && (f.text.match(/(\d+)\s*°/) || [])[1]; return deg && { text: `${deg}° ramp`, sourceIds: f.sourceIds } },
    sojournerSize: () => { const f = fact('sojourner', /tall/i); return f && { title: 'Sojourner', text: f.text, sourceIds: f.sourceIds } },
    pfPebbleInference: () => { const d = disc('sojourner', /pebbles/i); return d && { text: 'Rounded edges → water once flowed here (inference)', sourceIds: d.sourceIds } },
    pfDustMagnetic: () => { const d = disc('sojourner', /magnetic/i); return d && { text: 'Magnetic dust drawn toward the magnet (illustration)', sourceIds: d.sourceIds } },
    pfClouds: () => { const d = disc('sojourner', /clouds/i); return d && { text: 'Illustration · early-morning clouds of water ice', sourceIds: d.sourceIds } },
    pfFinalDate: () => { const d = date('sojourner', 'Final transmission'); return d && { title: 'Final transmission', text: fmtDate(d.date), sourceIds: d.sourceIds, emphasis: true } },
    pfBits: () => { const f = fact('sojourner', /billion bits/i); return f && { title: 'Mars Pathfinder mission total', text: '2.3 billion bits of information returned', sourceIds: f.sourceIds, check: /2\.3 billion bits/.test(f.text) } },
    pfUncertain: () => ({ title: 'Sojourner after contact ended', text: 'Unknown. No precise final rover position is shown here.', sourceIds: M.sojourner?.ending?.sourceIds ?? ['pathfinder'] }),
    spLakeHypothesis: () => ({ text: 'Possible ancient lake — hypothesis (illustration)', sourceIds: M.spirit?.sourceIds ?? ['mer'] }),
    spOdometer: () => { const d = dist('spirit', 'roverOdometer'); return d && { title: 'Spirit’s lifetime odometer (separate from this drive)', text: formatDistance(d), sourceIds: d.sourceIds } },
    spRockAltered: () => { const d = disc('spirit', /Columbia Hills/i); return d && { text: 'Illustration · rock altered by water', sourceIds: d.sourceIds } },
    spSoftSoil: () => ({ text: 'Soft soil (illustration)', sourceIds: M.spirit?.ending?.sourceIds ?? ['spirit'] }),
    spLastContact: () => { const d = date('spirit', 'Last contact'); return d && { title: 'Last contact', text: fmtDate(d.date), sourceIds: d.sourceIds, emphasis: true } },
    spClosure: () => { const d = date('spirit', 'Formal mission closure'); return d && { title: 'Formal mission closure', text: fmtDate(d.date), sourceIds: d.sourceIds, emphasis: true } },
    opMineralClue: () => ({ text: 'Mineral deposits: the clue that drew scientists here (illustration)', sourceIds: ['mer'] }),
    merSharedConclusion: () => { const d = disc('opportunity', /Together/i); return d && { title: 'Shared MER conclusion', text: d.text, sourceIds: d.sourceIds } },
    opSeparation: () => { const d = dist('opportunity', 'landmarkSeparation'); return d && { text: `Eagle → Endurance: ${formatDistance(d)} apart (separation, not distance driven)`, sourceIds: d.sourceIds } },
    opRecord: () => { const f = fact('opportunity', /record/i); return f && { title: 'Distance record', text: 'Held for a time; a historical record', sourceIds: f.sourceIds } },
    opStorm: () => ({ text: 'Illustration · planet-wide dust storm', sourceIds: M.opportunity?.ending?.sourceIds ?? ['opportunity'] }),
    opFinalDate: () => { const d = date('opportunity', 'Last communication'); return d && { title: 'Final transmission', text: fmtDate(d.date), sourceIds: d.sourceIds, emphasis: true } },
    compareOdometers: () => {
      const rows = ['spirit', 'opportunity'].map((id) => ({ id, name: M[id]?.name, d: dist(id, 'roverOdometer') })).filter((r) => r.d)
      const km = (d) => d.values.find((v) => v.unit === 'km')?.value
      if (rows.length < 2 || rows.some((r) => !km(r.d))) return null
      const max = Math.max(...rows.map((r) => km(r.d)))
      return { title: 'Lifetime odometers · same linear scale', bars: rows.map((r) => ({ name: r.name, value: formatDistance(r.d), pct: (km(r.d) / max) * 100, sourceIds: r.d.sourceIds })), sourceIds: [...new Set(rows.flatMap((r) => r.d.sourceIds))] }
    },
  }
  return (key) => { try { return out[key]?.() ?? null } catch { return null } }
}

export function wordsDuration(text, wps) {
  if (!text) return 0
  return text.trim().split(/\s+/).length / wps + 0.4
}

/**
 * Validate tour.json and build chapter timelines.
 * Optional cues are filtered (or swapped for their fallback) BEFORE durations and stop
 * indices are computed. Returns {chapters: Map, order, skipped:[{id, reason}], sources}.
 */
export function buildTour(json, data, { approvals: override = {}, assets = {} } = {}) {
  if (!json || json.schemaVersion !== 1 || !Array.isArray(json.cues) || !Array.isArray(json.chapters)) throw new Error('Tour data is malformed')
  const approvals = { ...(json.approvals || {}), ...override }
  const wps = Number(json.wordsPerSecond) > 0 ? json.wordsPerSecond : 2.5
  const resolve = makeResolvers(data)
  const sources = { ...data.sources }
  const skipped = []
  const byId = new Map(json.cues.map((c) => [c.id, c]))

  // Approved replacements (e.g. Troy wording) are applied to copies.
  const cues = json.cues.map((c) => ({ ...c }))
  for (const c of cues) {
    if (c.approval && approvals[c.approval] && c.replaceIn) {
      const target = cues.find((x) => x.id === c.replaceIn.cue)
      if (target && target.text.includes(c.replaceIn.from)) target.text = target.text.replace(c.replaceIn.from, c.replaceIn.to)
    }
  }

  const chapters = new Map()
  for (const ch of json.chapters) {
    const list = []
    for (const raw of cues.filter((c) => c.chapter === ch.id)) {
      let c = raw
      if (c.approval && !approvals[c.approval]) {
        const why = json.approvalNotes?.[c.approval] || `approval "${c.approval}" pending`
        if (c.fallback === 'skip' || !c.fallback) { skipped.push({ id: c.id, reason: why, fallback: 'cue skipped' }); continue }
        // Fallback beat: same cue ID, no spoken line, fallback visuals and cards.
        c = { ...c, ...c.fallback, text: null, fallbackActive: true, inspect: c.inspect }
        skipped.push({ id: c.id, reason: why, fallback: 'spoken line and gated visual skipped; fallback beat shown' })
      } else if (c.approval && approvals[c.approval]) {
        for (const g of c.gatedSources || []) if (json.gatedSources?.[g] && isSafeSourceUrl(json.gatedSources[g].url)) sources[g] = json.gatedSources[g]
        if (c.requiresAsset && !assets[c.requiresAsset]) { skipped.push({ id: c.id, reason: `approved, but asset "${c.requiresAsset}" is missing`, fallback: 'cue skipped' }); continue }
      }
      list.push(c)
    }
    let t = 0
    const timeline = list.map((c, i) => {
      const lead = Number(c.lead) || 0
      const speak = wordsDuration(c.text, wps)
      const hold = Number(c.hold) || 0
      const duration = Math.max(2, lead + speak + hold)
      const labels = (c.labels || []).map((l) => {
        const r = l.key ? resolve(l.key) : { text: l.text, sourceIds: l.sourceIds || c.sourceIds }
        return r ? { ...l, text: r.text, sourceIds: r.sourceIds || [] } : null
      }).filter(Boolean)
      const cards = (c.cards || []).map((k) => { const r = resolve(k.key); return r ? { ...k, ...r } : null }).filter(Boolean)
      const cue = {
        ...c, index: i, start: t, lead, speakStart: t + lead, speakDur: speak, speakEnd: t + lead + speak, end: t + duration, duration,
        labels, cards, sourceIds: (c.sourceIds || []).filter((s) => sources[s]),
      }
      t += duration
      return cue
    })
    chapters.set(ch.id, { ...ch, cues: timeline, duration: t })
  }
  return { chapters, order: json.chapters.map((c) => c.id), skipped, sources, approvals, byId }
}

/** Chapter cues for a run: the intro cue is only included on the full expedition start. */
export function chapterRun(tour, id, { withIntro = false } = {}) {
  const ch = tour.chapters.get(id)
  if (!ch) return null
  const cues = ch.cues.filter((c) => withIntro || !c.introOnly)
  let t = 0
  const timeline = cues.map((c, i) => {
    const shift = t - c.start
    const out = { ...c, index: i, start: c.start + shift, speakStart: c.speakStart + shift, speakEnd: c.speakEnd + shift, end: c.end + shift }
    t = out.end
    return out
  })
  return { ...ch, cues: timeline, duration: t, withIntro }
}

export function cueAt(run, t) {
  const cues = run.cues
  for (let i = cues.length - 1; i >= 0; i--) if (t >= cues[i].start - 1e-6) return cues[i]
  return cues[0]
}

/** The single active label (one callout at a time) for cue c at cue time τ. */
export function activeLabel(c, τ) {
  let lab = null
  for (const l of c.labels || []) if (τ >= l.at && (l.until == null || τ < l.until)) lab = l
  return lab
}

export function activeCards(c, τ) {
  return (c.cards || []).filter((k) => τ >= k.at)
}
