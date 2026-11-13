// Load-time checks for data/rovers.json and data/assets.json. Malformed mission
// records are excluded with a reason; nothing synthetic is ever filled in.

import { isValidCoordinates } from './geography.js'

export const SCHEMA_VERSION = 1
export const MISSION_IDS = ['sojourner', 'spirit', 'opportunity']
const ALLOWED_SOURCE_HOSTS = new Set(['science.nasa.gov', 'nssdc.gsfc.nasa.gov'])
const UNITS = new Set(['m', 'km', 'mi', 'ft'])
const DISTANCE_KINDS = new Set(['roverOdometer', 'landerDisplacement', 'plannedLeg', 'landmarkSeparation', 'craterDiameter'])
const PATH_KINDS = new Set(['landingBounce', 'plannedDrive', 'roverDrive'])
const GEOMETRIES = new Set(['schematic', 'sourcePolyline'])
const ID_RE = /^[a-z0-9][a-z0-9-]*$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isStr = (v) => typeof v === 'string' && v.trim().length > 0

export function isSafeSourceUrl(url) {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && ALLOWED_SOURCE_HOSTS.has(u.hostname) && !u.username && !u.password
  } catch { return false }
}

/** Local, relative, same-tree path: no scheme, no parent traversal, no absolute root. */
export function isSafeLocalPath(p) {
  return typeof p === 'string' && p.length > 0 && p.length < 300 &&
    !/^[a-z][a-z0-9+.-]*:/i.test(p) && !p.startsWith('/') && !p.includes('\\') &&
    !p.split('/').some((seg) => seg === '..' || seg === '') && /^[\w .()&\-/]+$/.test(p)
}

/** Resolve a manifest path against document.baseURI (works on GitHub Pages subpaths). */
export function resolveLocal(p) {
  return new URL(p.split('/').map(encodeURIComponent).join('/'), document.baseURI).href
}

function checkSourceIds(ids, sources, where, errs) {
  if (!Array.isArray(ids) || ids.length === 0) { errs.push(`${where}: missing sourceIds`); return }
  for (const id of ids) if (!Object.hasOwn(sources, id)) errs.push(`${where}: unknown source "${id}"`)
}

function checkDate(d) {
  if (!DATE_RE.test(d)) return false
  const t = Date.parse(`${d}T00:00:00Z`)
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d
}

function validateMission(m, sources) {
  const errs = []
  if (!isObj(m)) return ['record is not an object']
  if (!MISSION_IDS.includes(m.id)) errs.push(`unknown mission id "${m.id}"`)
  for (const k of ['name', 'designation', 'missionType']) if (!isStr(m[k])) errs.push(`missing ${k}`)
  checkSourceIds(m.sourceIds, sources, 'mission', errs)
  if (!isObj(m.site) || !isStr(m.site.name) || !isStr(m.site.context)) errs.push('invalid site')

  for (const key of ['dates', 'facts', 'discoveries', 'distanceTraveled', 'waypoints', 'traversePaths']) {
    if (!Array.isArray(m[key])) errs.push(`${key} must be an array`)
  }
  if (errs.length) return errs

  m.dates.forEach((d, i) => {
    if (!isStr(d.event) || !checkDate(d.date)) errs.push(`dates[${i}] invalid`)
    if (!(d.basis === null || ['UTC', 'PST', 'PDT', 'EST', 'EDT'].includes(d.basis))) errs.push(`dates[${i}] basis`)
    checkSourceIds(d.sourceIds, sources, `dates[${i}]`, errs)
  })
  for (const key of ['facts', 'discoveries']) {
    m[key].forEach((f, i) => {
      if (!isStr(f?.text)) errs.push(`${key}[${i}] text`)
      checkSourceIds(f?.sourceIds, sources, `${key}[${i}]`, errs)
    })
  }

  const distIds = new Set()
  m.distanceTraveled.forEach((d, i) => {
    if (!ID_RE.test(d.id ?? '') || distIds.has(d.id)) errs.push(`distanceTraveled[${i}] id`)
    distIds.add(d.id)
    if (!DISTANCE_KINDS.has(d.kind)) errs.push(`distanceTraveled[${i}] kind`)
    if (typeof d.approximate !== 'boolean') errs.push(`distanceTraveled[${i}] approximate`)
    if (!Array.isArray(d.values) || !d.values.length ||
      !d.values.every((v) => Number.isFinite(v?.value) && v.value > 0 && v.value < 1e6 && UNITS.has(v.unit))) {
      errs.push(`distanceTraveled[${i}] values`)
    }
    checkSourceIds(d.sourceIds, sources, `distanceTraveled[${i}]`, errs)
  })

  const wpIds = new Set()
  m.waypoints.forEach((w, i) => {
    if (!ID_RE.test(w.id ?? '') || wpIds.has(w.id)) errs.push(`waypoints[${i}] id`)
    wpIds.add(w.id)
    if (!isStr(w.name) || !isStr(w.kind)) errs.push(`waypoints[${i}] name/kind`)
    if (!isValidCoordinates(w.coordinates)) errs.push(`waypoints[${i}] coordinates`)
    checkSourceIds(w.sourceIds, sources, `waypoints[${i}]`, errs)
  })
  const landing = m.waypoints.find((w) => w.id === m.site.landingWaypointId)
  if (!landing) errs.push('site.landingWaypointId does not resolve')

  const pathIds = new Set()
  m.traversePaths.forEach((p, i) => {
    const where = `traversePaths[${i}]`
    if (!ID_RE.test(p.id ?? '') || pathIds.has(p.id)) errs.push(`${where} id`)
    pathIds.add(p.id)
    if (!isStr(p.name) || !PATH_KINDS.has(p.kind) || !GEOMETRIES.has(p.geometry)) errs.push(`${where} name/kind/geometry`)
    if (!Array.isArray(p.waypointIds) || p.waypointIds.length < 2 || !p.waypointIds.every((id) => wpIds.has(id))) errs.push(`${where} waypointIds`)
    if (!Array.isArray(p.distanceIds) || !p.distanceIds.every((id) => distIds.has(id))) errs.push(`${where} distanceIds`)
    checkSourceIds(p.sourceIds, sources, where, errs)
    if (p.bounce !== null) {
      const b = p.bounce
      if (!isObj(b) || !Number.isInteger(b.count) || b.count < 1 || b.count > 100 || typeof b.approximate !== 'boolean' ||
        !isObj(b.maxHeight) || !Number.isFinite(b.maxHeight.value) || !UNITS.has(b.maxHeight.unit)) errs.push(`${where} bounce`)
    }
    if (p.geometry === 'sourcePolyline') {
      // Geographic lines need sourced samples and a documented frame. Otherwise the
      // path is demoted to schematic treatment (never drawn as geography).
      const ok = Array.isArray(p.samples) && p.samples.length >= 2 &&
        p.samples.every((s) => s && isValidCoordinates(s)) && isStr(p.coordinateFrame)
      if (!ok) p._rejectedPolyline = true
    }
  })
  return errs
}

/** Returns {mars, sources, missions, excluded:[{id, reasons}]} or throws on a malformed root. */
export function validateRovers(json) {
  if (!isObj(json)) throw new Error('Mission data root is not an object')
  if (json.schemaVersion !== SCHEMA_VERSION) throw new Error(`Unsupported schemaVersion ${json.schemaVersion}`)
  if (!isObj(json.sources) || !Array.isArray(json.rovers)) throw new Error('Mission data is missing sources or rovers')
  const sources = {}
  for (const [id, s] of Object.entries(json.sources)) {
    if (isObj(s) && isStr(s.title) && isSafeSourceUrl(s.url)) sources[id] = { title: s.title, url: s.url }
  }
  const mars = isObj(json.mars) && Number.isFinite(json.mars.meanRadiusKm) && json.mars.meanRadiusKm > 0 ? json.mars : null
  const missions = []
  const excluded = []
  const evidence = []
  const seen = new Set()
  for (const m of json.rovers) {
    const errs = validateMission(m, sources)
    if (seen.has(m?.id)) errs.push('duplicate mission id')
    if (errs.length) excluded.push({ id: m?.id ?? '(unknown)', reasons: errs })
    else { missions.push(m); seen.add(m.id) }
  }
  if (!missions.length) throw new Error('No valid missions in mission data')
  // Optional evidence cards: a finding the missions made vs. a reason a site was chosen.
  for (const e of Array.isArray(json.evidence) ? json.evidence : []) {
    const errs = []
    if (!isObj(e) || !ID_RE.test(e.id ?? '') || !['finding', 'siteSelection'].includes(e.kind) || !isStr(e.title) || !isStr(e.text)) errs.push('shape')
    else {
      checkSourceIds(e.sourceIds, sources, `evidence ${e.id}`, errs)
      if (!Array.isArray(e.missionIds) || !e.missionIds.every((id) => seen.has(id))) errs.push('missionIds')
    }
    if (errs.length) console.warn('[data] evidence excluded', e?.id, errs)
    else evidence.push(e)
  }
  return { mars, sources, missions, excluded, evidence }
}

/** Normalizes the asset manifest; invalid entries become null / are dropped with warnings. */
export function validateAssets(json) {
  const warnings = []
  const out = { model: null, roverImages: {}, roverModels: { mer: null } }
  for (const id of MISSION_IDS) out.roverImages[id] = []
  if (!isObj(json)) { warnings.push('Asset manifest unreadable'); return { assets: out, warnings } }

  const m = json.model
  if (m !== null && m !== undefined) {
    if (isObj(m) && isSafeLocalPath(m.src) && /\.(glb|gltf)$/i.test(m.src)) {
      const verified = m.registrationStatus === 'verified' &&
        ['east-positive', 'west-positive'].includes(m.longitudeSense) &&
        Number.isFinite(m.primeMeridianYawDeg) && m.upAxis === '+Y' && m.northAxis === '+Y'
      out.model = {
        src: m.src,
        credit: isStr(m.credit) ? m.credit : '',
        primeMeridianYawDeg: Number.isFinite(m.primeMeridianYawDeg) ? m.primeMeridianYawDeg : 0,
        longitudeSense: m.longitudeSense === 'west-positive' ? 'west-positive' : 'east-positive',
        registrationStatus: verified ? 'verified' : 'unverified',
      }
    } else warnings.push('Model entry invalid; using reference sphere')
  }

  if (isObj(json.roverImages)) {
    for (const id of MISSION_IDS) {
      const list = Array.isArray(json.roverImages[id]) ? json.roverImages[id] : []
      out.roverImages[id] = list.slice(0, 2).filter((img) => {
        const ok = isObj(img) && isSafeLocalPath(img.src) && /\.(jpe?g|png|webp)$/i.test(img.src) && isStr(img.alt)
        if (!ok) warnings.push(`Image entry for ${id} rejected`)
        return ok
      }).map((img) => ({
        src: img.src,
        alt: img.alt,
        caption: isStr(img.caption) ? img.caption : '',
        credit: isStr(img.credit) ? img.credit : '',
        objectPosition: typeof img.objectPosition === 'string' && /^\d{1,3}% \d{1,3}%$/.test(img.objectPosition) ? img.objectPosition : '50% 50%',
      }))
    }
  }
  out.roverModels = { mer: null }
  const mer = json.roverModels?.mer
  if (isObj(mer)) {
    const rig = mer.wheelRig
    if (isSafeLocalPath(mer.src) && /\.(glb|gltf)$/i.test(mer.src) && mer.upAxis === '+Y' && mer.forwardAxis === '+Z') {
      out.roverModels.mer = {
        src: mer.src,
        credit: isStr(mer.credit) ? mer.credit : '',
        yawDeg: Number.isFinite(mer.yawDeg) ? mer.yawDeg : 0,
        unitsPerMeter: Number.isFinite(mer.unitsPerMeter) && mer.unitsPerMeter > 0 ? mer.unitsPerMeter : 1,
        expectedHeightM: Array.isArray(mer.expectedHeightM) ? mer.expectedHeightM : [1.2, 2.0],
        frontMaterial: isStr(mer.frontMaterial) ? mer.frontMaterial : null,
        wheelRig: isObj(rig) && isStr(rig.material) && Number.isInteger(rig.count) && Array.isArray(rig.radiusRange) ? rig : null,
      }
    } else warnings.push('MER model entry invalid; procedural rover will be used')
  }
  return { assets: out, warnings }
}
