// Development-only checks for js/geography.js. Run: node tests/geography.test.mjs
import assert from 'node:assert/strict'
import {
  latLonToUnit, signedLatLon, wrapLongitude, densifyGreatCircle, centralAngle, unitToLatLon, chordSagitta, rad, slerpUnit,
} from '../js/geography.js'

const close = (a, b, eps = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) < eps)

// Cardinal mappings (PRD §6.2)
assert.ok(close(latLonToUnit(90, 0), [0, 1, 0]), 'north pole → +Y')
assert.ok(close(latLonToUnit(0, 0), [0, 0, 1]), '(0,0) → +Z')
assert.ok(close(latLonToUnit(0, 90), [1, 0, 0]), '(0,90E) → +X')

// Hemisphere signs and wrapping
const opp = signedLatLon({ latDeg: 1.9483, latHemisphere: 'S', lonDeg: 354.47417, lonHemisphere: 'E' })
assert.ok(Math.abs(opp.lon - -5.52583) < 1e-9 && Math.abs(opp.lat - -1.9483) < 1e-12, 'Opportunity wraps to −5.52583°')
const pf = signedLatLon({ latDeg: 19.3, latHemisphere: 'N', lonDeg: 33.52, lonHemisphere: 'W' })
assert.equal(pf.lon, -33.52)
assert.equal(wrapLongitude(180), -180)
assert.equal(wrapLongitude(-180), -180)

// Synthetic seam-crossing line: 179°E → 179°W must take the 2° short arc, not 358°.
const a = latLonToUnit(-14, 179)
const b = latLonToUnit(-14, -179)
const step = rad(0.25)
const dense = densifyGreatCircle([a, b], step)
assert.ok(dense.length >= 9 && dense.length <= 10, `densified count ${dense.length}`)
for (let i = 1; i < dense.length; i++) {
  assert.ok(centralAngle(dense[i - 1], dense[i]) <= step + 1e-12, 'no chord exceeds max step')
  const { lon } = unitToLatLon(dense[i])
  assert.ok(Math.abs(lon) >= 178.9, `stays near the seam (lon ${lon.toFixed(3)})`)
}
assert.ok(chordSagitta(step) < 0.004, 'shell lift 0.004 keeps chords outside the unit sphere')

// Coincident points collapse; antipodes are rejected as ambiguous.
assert.equal(densifyGreatCircle([a, a, a]).length, 1)
assert.throws(() => slerpUnit([0, 0, 1], [0, 0, -1], 0.5), RangeError)
assert.throws(() => densifyGreatCircle([[0, 0, 1], [0, 0, -1]]), RangeError)

console.log('geography tests passed')
