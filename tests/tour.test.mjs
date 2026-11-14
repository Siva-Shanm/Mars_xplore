// Development-only checks for Neo's tour data. Run: node tests/tour.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildTour, chapterRun, cueAt, activeLabel, activeCards, checkpoints } from '../js/tour.js'
import { validateRovers } from '../js/validate.js'

const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url)))
const data = validateRovers(read('rovers.json'))
const json = read('tour.json')
const script = readFileSync(new URL('../Neo Narration Script.md', import.meta.url), 'utf8')

// Every spoken line is copied verbatim from the narration script, under the matching cue ID.
for (const c of json.cues) {
  assert.ok(script.includes(`**${c.id} ·`), `cue ${c.id} exists in the script`)
  assert.ok(script.includes(`> ${c.text}`), `line for ${c.id} is verbatim`)
}

// Default: all four source gates pending → fallbacks.
const tour = buildTour(json, data)
assert.deepEqual(tour.skipped.map((s) => s.id), ['pf-record', 'sp-troy', 'op-outcrop', 'op-image'])
const pf = chapterRun(tour, 'pf', { withIntro: true })
assert.equal(pf.cues[0].id, 'intro')
assert.ok(!pf.cues.some((c) => c.id === 'pf-record'))
assert.equal(chapterRun(tour, 'pf').cues[0].id, 'pf-arrival')
const op = chapterRun(tour, 'op')
const outcrop = op.cues.find((c) => c.id === 'op-outcrop')
assert.equal(outcrop.text, null, 'gated spoken line is skipped')
assert.match(outcrop.cards[0].text, /Together, Spirit and Opportunity/)
assert.ok(tour.chapters.get('sp').cues.find((c) => c.id === 'sp-final').text.startsWith('Soft soil stopped Spirit’s drive. As'))

// Approving Troy changes the sp-final sentence and adds the Troy cue; filtering precedes timing.
const approved = buildTour(json, data, { approvals: { spTroy: true } })
const sp2 = chapterRun(approved, 'sp')
assert.ok(sp2.cues.find((c) => c.id === 'sp-final').text.startsWith('Soft soil stopped Spirit’s drive here at Troy.'))
assert.ok(sp2.cues.some((c) => c.id === 'sp-troy'))
assert.ok(sp2.duration > chapterRun(tour, 'sp').duration)
// Approving the last image without the asset still skips it.
assert.ok(buildTour(json, data, { approvals: { opImage: true } }).skipped.some((s) => s.id === 'op-image' && /asset/.test(s.reason)))

// Contiguous timelines, 2–3 minute chapters, lines inside their cues.
for (const id of ['pf', 'sp', 'op']) {
  const r = chapterRun(tour, id)
  assert.ok(r.duration >= 120 && r.duration <= 180, `${id} duration ${r.duration.toFixed(1)}`)
  r.cues.forEach((c, i) => {
    if (i) assert.ok(Math.abs(c.start - r.cues[i - 1].end) < 1e-9)
    assert.ok(c.speakStart >= c.start && c.speakEnd <= c.end + 1e-9)
    assert.equal(cueAt(r, c.start + 0.01).id, c.id)
  })
}

// On-screen numbers come from rovers.json and keep their kinds distinct.
const bounce = pf.cues.find((c) => c.id === 'pf-bounce')
assert.deepEqual(bounce.labels.map((l) => l.text), ['Up to 50 ft high (lander bounce; heights not to scale)', 'About 15 bounces', 'About 1 km from first impact to rest (lander, not a drive)'])
assert.equal(activeLabel(bounce, 7).text, 'About 15 bounces')
const dist = op.cues.find((c) => c.id === 'op-distance')
const cmp = activeCards(dist, 2)[0]
assert.equal(cmp.bars[1].pct, 100)
assert.ok(Math.abs(cmp.bars[0].pct - (7.73 / 45.16) * 100) < 1e-9)
assert.match(op.cues.find((c) => c.id === 'op-eagle').labels[1].text, /750 m apart \(separation, not distance driven\)/)
assert.match(pf.cues.find((c) => c.id === 'pf-final').cards[1].text, /2\.3 billion bits/)

// Required interaction checkpoints (version 4): after the line, inside the cue, ordered.
const expected = { pf: ['pf-pebble-look', 'pf-dust'], sp: ['sp-rock'], op: ['op-outcrop', 'op-eagle'] }
for (const [id, ids] of Object.entries(expected)) {
  const r = chapterRun(tour, id, { withIntro: id === 'pf' })
  const cps = checkpoints(r)
  assert.deepEqual(cps.map((c) => c.id), ids)
  for (const cp of cps) {
    const c = r.cues.find((x) => x.id === cp.id)
    assert.ok(cp.required && cp.prompt && cp.label && cp.fallbackLabel && cp.target)
    assert.ok(cp.t > c.start && cp.t < c.end, `${cp.id} inside its cue`)
    if (c.text) assert.ok(cp.t >= c.speakEnd - 1e-9, `${cp.id} waits until after Neo's line`)
  }
}
// The Eagle look-back waits with the rover on the rim (before the onward drive starts).
const eagle = chapterRun(tour, 'op').cues.find((c) => c.id === 'op-eagle')
assert.ok(eagle.checkpoint.atRel <= eagle.rover[1].start && eagle.checkpoint.atRel >= eagle.rover[0].end)
// Labels and cards that reveal results come after the checkpoint.
const dust = pf.cues.find((c) => c.id === 'pf-dust')
assert.ok(dust.labels.find((l) => /Magnetic dust/.test(l.text)).at > dust.checkpoint.atRel)
assert.ok(op.cues.find((c) => c.id === 'op-outcrop').cards[0].at > op.cues.find((c) => c.id === 'op-outcrop').checkpoint.atRel)
console.log('tour tests passed')
