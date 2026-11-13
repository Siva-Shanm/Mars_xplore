// Pure coordinate and spherical-sampling helpers. No Three.js dependency, so this
// module loads (and can be unit-tested in Node) even when the 3D stack fails.

export const DEG = Math.PI / 180

export const rad = (deg) => deg * DEG

/** Wrap a signed longitude in degrees to [-180, 180). */
export function wrapLongitude(lonDeg) {
  if (lonDeg >= -180 && lonDeg < 180) return lonDeg // avoid float drift on in-range values
  return (((lonDeg + 180) % 360) + 360) % 360 - 180
}

/**
 * Convert a source coordinate record ({latDeg, latHemisphere, lonDeg, lonHemisphere},
 * unsigned magnitudes) to signed east-positive degrees.
 */
export function signedLatLon(c) {
  const lat = c.latHemisphere === 'S' ? -c.latDeg : c.latDeg
  const lon = wrapLongitude(c.lonHemisphere === 'W' ? -c.lonDeg : c.lonDeg)
  return { lat, lon }
}

/** Unit vector [x, y, z] in the canonical globe frame (+Y north, (0,0) → +Z, 90°E → +X). */
export function latLonToUnit(latDeg, lonDeg) {
  const latitude = rad(latDeg)
  const longitude = rad(wrapLongitude(lonDeg))
  const cosLatitude = Math.cos(latitude)
  return [Math.sin(longitude) * cosLatitude, Math.sin(latitude), Math.cos(longitude) * cosLatitude]
}

export function coordinatesToUnit(c) {
  const { lat, lon } = signedLatLon(c)
  return latLonToUnit(lat, lon)
}

export function unitToLatLon([x, y, z]) {
  const len = Math.hypot(x, y, z) || 1
  return { lat: Math.asin(Math.max(-1, Math.min(1, y / len))) / DEG, lon: wrapLongitude(Math.atan2(x, z) / DEG) }
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2])
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]
}

/** Central angle between two unit vectors, robust near 0 and π. */
export function centralAngle(a, b) {
  return Math.atan2(Math.hypot(...cross(a, b)), Math.max(-1, Math.min(1, dot(a, b))))
}

/** Shortest-arc spherical interpolation of unit vectors. Throws on ambiguous antipodes. */
export function slerpUnit(a, b, t) {
  const omega = centralAngle(a, b)
  if (omega < 1e-9) return norm([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t])
  if (Math.PI - omega < 1e-6) throw new RangeError('Antipodal samples are ambiguous; supply an intermediate point')
  const s = Math.sin(omega)
  const wa = Math.sin((1 - t) * omega) / s
  const wb = Math.sin(t * omega) / s
  return norm([a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb])
}

/**
 * Densify an ordered list of unit vectors along great-circle arcs so that no
 * rendered chord exceeds maxStepRad. Coincident consecutive points are dropped.
 * The longitude seam needs no special handling because work is done on vectors.
 */
export function densifyGreatCircle(points, maxStepRad = rad(0.25)) {
  const out = []
  for (let i = 0; i < points.length; i++) {
    const p = norm(points[i])
    if (i === 0) { out.push(p); continue }
    const a = out[out.length - 1]
    const omega = centralAngle(a, p)
    if (omega < 1e-9) continue
    const steps = Math.max(1, Math.ceil(omega / maxStepRad))
    for (let s = 1; s <= steps; s++) out.push(slerpUnit(a, p, s / steps))
  }
  return out
}

/** Lift needed so a chord of angular length step on a sphere of radius r stays outside it. */
export function chordSagitta(stepRad, r = 1) {
  return r * (1 - Math.cos(stepRad / 2))
}

/** Great-circle distance in km for a sphere of the given radius. */
export function arcLengthKm(angleRad, radiusKm) {
  return angleRad * radiusKm
}

export function isValidCoordinates(c) {
  if (c === null) return true
  if (!c || typeof c !== 'object') return false
  const { latDeg, latHemisphere, lonDeg, lonHemisphere } = c
  return Number.isFinite(latDeg) && latDeg >= 0 && latDeg <= 90 &&
    Number.isFinite(lonDeg) && lonDeg >= 0 && lonDeg <= 360 &&
    (latHemisphere === 'N' || latHemisphere === 'S') &&
    (lonHemisphere === 'E' || lonHemisphere === 'W')
}

/** Format a signed coordinate pair for display, rounded. */
export function formatLatLon(c, digits = 1) {
  const { lat, lon } = signedLatLon(c)
  const la = `${Math.abs(lat).toFixed(digits)}°${lat < 0 ? 'S' : 'N'}`
  const lo = `${Math.abs(lon).toFixed(digits)}°${lon < 0 ? 'W' : 'E'}`
  return `${la}, ${lo}`
}
