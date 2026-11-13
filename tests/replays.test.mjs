// Development-only checks for js/replays.js. Run: node tests/replays.test.mjs
import assert from 'node:assert/strict'
import { PlaybackClock, sampleKeys } from '../js/replays.js'


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

console.log('replay clock tests passed')
