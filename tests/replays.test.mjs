// Development-only checks for js/replays.js. Run: node tests/replays.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PlaybackClock, sampleKeys, buildReplay, activeCue, activeStopIndex } from '../js/replays.js'

const data = JSON.parse(readFileSync(new URL('../data/rovers.json', import.meta.url)))
const byId = Object.fromEntries(data.rovers.map((m) => [m.id, m]))

// Keyframes: continuous, zero velocity at keys, monotonic between increasing keys.
const keys = [{ t: 0, s: 0 }, { t: 2, s: 1 }, { t: 4, s: 1 }, { t: 6, s: 3 }]
assert.equal(sampleKeys(keys, -1), 0)
assert.equal(sampleKeys(keys, 3), 1)
assert.equal(sampleKeys(keys, 10), 3)
let prev = -Infinity
for (let t = 0; t <= 6; t += 0.01) { const s = sampleKeys(keys, t); assert.ok(s >= prev - 1e-12); prev = s }
assert.ok(Math.abs(sampleKeys(keys, 2.001) - sampleKeys(keys, 1.999)) < 1e-4, 'no jump at a stop')

// One clock: play to the end holds the final frame; seek pauses; glide is driven by tick.
const c = new PlaybackClock(10)
c.play(); for (let i = 0; i < 200; i++) c.tick(0.1)
assert.equal(c.time, 10); assert.equal(c.playing, false); assert.equal(c.ended, true)
c.seek(4, 0.5); assert.equal(c.playing, false); c.tick(0.25); assert.ok(c.time > 4 && c.time < 10); c.tick(0.3); assert.equal(c.time, 4)
c.play(); c.tick(1); assert.equal(c.time, 5)

// Captions come from data; distance kinds stay distinct.
const pf = buildReplay(byId.sojourner)
const texts = pf.cues.map((q) => q.text).join(' | ')
assert.match(texts, /About 15 bounces/)
assert.match(texts, /Up to 50 ft high/)
assert.match(texts, /About 1 km from first impact to rest \(lander, not a drive\)/)
assert.match(texts, /20° deployment ramp/)
assert.equal(activeCue(pf, pf.stops.find((s) => s.id === 'ramp').t).text, '20° deployment ramp')
assert.equal(activeStopIndex(pf, 5.6), 2)

const sp = buildReplay(byId.spirit)
assert.ok(sp.chips.some((x) => /odometer \(not this replay\)/.test(x.label) && x.value === 'about 7.73 km (4.8 mi)'))
assert.ok(sp.chips.filter((x) => x.plan).length === 3, 'early-plan figures kept separate')
const op = buildReplay(byId.opportunity)
assert.ok(op.chips.some((x) => /separation/.test(x.label) && x.value === 'about 750 m'))
assert.ok(op.chips.some((x) => /record/i.test(x.label) && /Historical/.test(x.value)))
for (const d of [pf, sp, op]) {
  assert.ok(d.duration >= 15 && d.duration <= 25, `${d.missionId} duration ${d.duration}`)
  for (const s of d.stops) assert.ok(s.t >= 0 && s.t <= d.duration)
}
console.log('replay tests passed')
