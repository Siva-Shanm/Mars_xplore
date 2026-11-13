// Safe DOM rendering of the mission details panel. All data goes through
// textContent; links are allowlisted NASA HTTPS URLs; images are validated local paths.

import { formatLatLon } from './geography.js'
import { isSafeSourceUrl, resolveLocal } from './validate.js'

const TRANSITION_MS = 320

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue
    if (k === 'class') node.className = v
    else if (k === 'text') node.textContent = v
    else if (k === 'dataset') Object.assign(node.dataset, v)
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
    else node.setAttribute(k, v === true ? '' : String(v))
  }
  for (const c of children.flat()) if (c) node.append(c)
  return node
}

const KIND_LABEL = {
  roverOdometer: 'Total distance driven (odometer)',
  landerDisplacement: 'Lander displacement, first impact to rest',
  plannedLeg: 'Planned leg',
  landmarkSeparation: 'Landmark separation',
  craterDiameter: 'Crater width',
}

const PATH_KIND_LABEL = {
  landingBounce: 'Landing event (airbags)',
  plannedDrive: 'Planned route — not driven as drawn',
  roverDrive: 'Completed drive sequence',
}

export function formatDistance(d) {
  const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
  const [first, ...rest] = d.values.map((v) => `${nf.format(v.value)} ${v.unit}`)
  return `${d.approximate ? 'about ' : ''}${first}${rest.length ? ` (${rest.join(', ')})` : ''}`
}

export function kmValue(d) {
  const km = d.values.find((v) => v.unit === 'km')
  return km ? km.value : null
}

function formatDate(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' })
}

export class MissionPanel {
  constructor({ root, data, assets, onClose, onJourneyChange, onWatch, canWatch }) {
    this.onWatch = onWatch
    this.canWatch = canWatch
    this.root = root
    this.data = data
    this.assets = assets
    this.onClose = onClose
    this.onJourneyChange = onJourneyChange
    this.mission = null
    this.globeAvailable = false
    this.journey = { show: false, plan: false }
    this._token = 0
    root.hidden = true
  }

  get isOpen() { return !!this.mission }

  setGlobeAvailable(ok) {
    this.globeAvailable = ok
    if (this.mission) this._syncJourneyButtons()
  }

  open(mission, { focusHeading = false } = {}) {
    const token = ++this._token
    this.mission = mission
    this.journey = { show: false, plan: false }
    this.root.replaceChildren(this._render(mission))
    this.root.hidden = false
    this.root.setAttribute('aria-labelledby', 'panel-title')
    this._syncJourneyButtons()
    requestAnimationFrame(() => {
      if (token !== this._token) return
      this.root.classList.add('is-open')
      // Bars grow from a common zero baseline; values stay visible as text throughout.
      requestAnimationFrame(() => {
        if (token !== this._token) return
        for (const b of this.root.querySelectorAll('.bar-fill[data-w]')) b.style.width = `${b.dataset.w}%`
        this.root.querySelector('.disp-graphic')?.classList.add('is-run')
      })
    })
    if (focusHeading) this.root.querySelector('#panel-title')?.focus({ preventScroll: false })
  }

  close() {
    if (!this.mission) return
    const token = ++this._token
    this.mission = null
    this.root.classList.remove('is-open')
    // Keep closed content out of the tab order immediately.
    this.root.setAttribute('inert', '')
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    setTimeout(() => {
      if (token !== this._token) return
      this.root.hidden = true
      this.root.removeAttribute('inert')
      this.root.replaceChildren()
    }, reduce ? 0 : TRANSITION_MS)
  }

  /** Reflect journey state changes made elsewhere (e.g. new selection). */
  setJourneyState(state) {
    this.journey = { ...state }
    this._syncJourneyButtons()
  }

  _syncJourneyButtons() {
    this.root.removeAttribute('inert')
    const show = this.root.querySelector('[data-action="journey"]')
    const plan = this.root.querySelector('[data-action="plan"]')
    const note = this.root.querySelector('.journey-3d-note')
    for (const b of [show, plan]) if (b) b.disabled = !this.globeAvailable
    if (show) {
      show.setAttribute('aria-pressed', String(this.journey.show))
      show.textContent = this.journey.show ? 'Hide journey on globe' : 'Show journey on globe'
    }
    if (plan) {
      plan.setAttribute('aria-pressed', String(this.journey.plan))
      plan.textContent = this.journey.plan ? 'Hide early route plan' : 'Show early route plan (dashed)'
    }
    if (note) note.hidden = this.globeAvailable
  }

  _cite(ids) {
    const links = []
    for (const id of ids || []) {
      const s = this.data.sources[id]
      if (!s || !isSafeSourceUrl(s.url)) continue
      links.push(el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', text: s.title }))
    }
    if (!links.length) return null
    const span = el('span', { class: 'cite' }, el('span', { class: 'cite-label', text: 'Source: ' }))
    links.forEach((a, i) => { if (i) span.append(' · '); span.append(a) })
    return span
  }

  _render(m) {
    const frag = document.createDocumentFragment()
    const wp = new Map(m.waypoints.map((w) => [w.id, w]))
    const dist = new Map(m.distanceTraveled.map((d) => [d.id, d]))
    const landing = wp.get(m.site.landingWaypointId)

    // Header ----------------------------------------------------------------
    const odo = m.distanceTraveled.find((d) => d.kind === 'roverOdometer')
    frag.append(el('header', { class: 'panel-head' },
      el('div', { class: 'panel-head-text' },
        el('p', { class: 'eyebrow', text: `${m.designation} · ${m.missionType}` }),
        el('h2', { id: 'panel-title', tabindex: '-1', text: m.name }),
        el('p', { class: 'site-name', text: m.site.name }),
      ),
      el('button', { type: 'button', class: 'icon-btn panel-close', 'aria-label': `Close ${m.name} details`, onclick: () => this.onClose?.('button') },
        el('span', { 'aria-hidden': 'true', text: '×' })),
    ))
    const ctx = el('p', { class: 'site-context' }, m.site.context, ' ', this._cite(m.sourceIds))
    frag.append(ctx)
    if (landing?.coordinates) {
      frag.append(el('p', { class: 'coords' },
        el('span', { class: 'label', text: 'Landing site (rounded): ' }),
        el('span', { class: 'num', text: formatLatLon(landing.coordinates, 1) }),
        ' ', this._cite(landing.sourceIds)))
    }

    // Primary action -----------------------------------------------------------
    if (this.canWatch?.(m.id)) {
      frag.append(el('div', { class: 'watch' },
        el('button', { type: 'button', class: 'btn btn-primary', id: 'btn-watch', 'data-action': 'watch', onclick: () => this.onWatch?.(m.id) },
          el('span', { class: 'watch-icon', 'aria-hidden': 'true', text: '▶' }), ' Watch rover journey'),
        el('p', { class: 'note', text: 'An illustrative surface close-up with play, pause and a stop-by-stop timeline. Schematic · not to scale.' })))
    }

    // Dates and metrics -----------------------------------------------------
    const metrics = el('section', { class: 'metrics', 'aria-label': 'Dates and key figures' })
    const dl = el('dl', { class: 'dates' })
    for (const d of m.dates) {
      dl.append(el('div', { class: 'date-row' },
        el('dt', { text: d.event }),
        el('dd', {},
          el('time', { datetime: d.date, text: formatDate(d.date) }),
          d.basis ? el('span', { class: 'basis', text: ` (${d.basis})` }) : null,
          ' ', this._cite(d.sourceIds))))
    }
    metrics.append(dl)
    if (odo) {
      metrics.append(el('div', { class: 'metric-hero' },
        el('span', { class: 'metric-label', text: 'Lifetime odometer' }),
        el('span', { class: 'metric-value num', text: formatDistance(odo) }),
        this._cite(odo.sourceIds)))
    } else {
      metrics.append(el('div', { class: 'metric-hero is-muted' },
        el('span', { class: 'metric-label', text: 'Rover driving distance' }),
        el('span', { class: 'metric-value', text: 'Not specified in this dataset' })))
    }
    frag.append(metrics)

    // Imagery ---------------------------------------------------------------
    const imgs = this.assets.roverImages[m.id] || []
    if (imgs.length) {
      frag.append(this._figure(imgs[0], true))
      if (imgs[1]) frag.append(this._figure(imgs[1], false))
    } else {
      frag.append(el('figure', { class: 'media media-hero is-missing' },
        el('div', { class: 'media-frame' }, el('div', { class: 'media-placeholder', text: 'Image unavailable' }))))
    }

    // Discoveries -----------------------------------------------------------
    frag.append(el('section', { class: 'discoveries', 'aria-labelledby': 'h-disc' },
      el('h3', { id: 'h-disc', text: 'Discoveries' }),
      el('ul', {}, m.discoveries.map((d) => el('li', {}, d.text, ' ', this._cite(d.sourceIds))))))

    // Journey ---------------------------------------------------------------
    frag.append(this._renderJourney(m, wp, dist))

    // Distance comparison ---------------------------------------------------
    frag.append(this._renderComparison(m))

    // Facts -----------------------------------------------------------------
    if (m.facts.length) {
      frag.append(el('section', { class: 'facts', 'aria-labelledby': 'h-facts' },
        el('h3', { id: 'h-facts', text: 'Mission facts' }),
        el('ul', {}, m.facts.map((f) => el('li', {}, f.text, ' ', this._cite(f.sourceIds))))))
    }

    // Sources ---------------------------------------------------------------
    const used = new Set()
    const collect = (ids) => (ids || []).forEach((i) => used.add(i))
    collect(m.sourceIds)
    for (const k of ['dates', 'facts', 'discoveries', 'distanceTraveled', 'waypoints', 'traversePaths']) m[k].forEach((r) => collect(r.sourceIds))
    frag.append(el('section', { class: 'sources', 'aria-labelledby': 'h-src' },
      el('h3', { id: 'h-src', text: 'NASA sources' }),
      el('ul', {}, [...used].filter((id) => this.data.sources[id]).map((id) => {
        const s = this.data.sources[id]
        return el('li', {}, el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', text: s.title }),
          el('span', { class: 'src-host', text: ` — ${new URL(s.url).hostname}` }))
      }))))

    return frag
  }

  _figure(img, hero) {
    const frame = el('div', { class: 'media-frame' })
    const image = el('img', {
      src: resolveLocal(img.src), alt: img.alt, decoding: 'async',
      loading: hero ? 'eager' : 'lazy', class: hero ? 'kenburns' : '',
    })
    image.style.objectPosition = img.objectPosition
    image.addEventListener('error', () => {
      frame.replaceChildren(el('div', { class: 'media-placeholder', role: 'img', 'aria-label': `Image unavailable: ${img.alt}`, text: 'Image unavailable' }))
      frame.parentElement?.classList.add('is-missing')
    }, { once: true })
    frame.append(image)
    const cap = el('figcaption', {},
      img.caption ? el('span', { class: 'cap-text', text: img.caption }) : null,
      img.credit ? el('span', { class: 'cap-credit', text: img.credit }) : null)
    return el('figure', { class: `media ${hero ? 'media-hero' : 'media-detail'}` }, frame, cap)
  }

  _renderJourney(m, wp, dist) {
    const sec = el('section', { class: 'journey', 'aria-labelledby': 'h-journey' })
    sec.append(el('div', { class: 'journey-head' },
      el('h3', { id: 'h-journey', text: 'Journey' }),
      el('span', { class: 'scale-badge', text: 'Schematic · not to scale' })))
    sec.append(el('p', { class: 'journey-intro', text: 'The drawing shows order and relationships only. Spacing and direction on the globe are illustrative, not mapped positions.' }))

    const controls = el('div', { class: 'journey-controls' })
    const hasCompleted = m.traversePaths.some((p) => p.kind !== 'plannedDrive')
    const hasPlan = m.traversePaths.some((p) => p.kind === 'plannedDrive')
    if (hasCompleted) {
      controls.append(el('button', {
        type: 'button', class: 'btn', 'data-action': 'journey', 'aria-pressed': 'false',
        onclick: () => { this.journey.show = !this.journey.show; this._syncJourneyButtons(); this.onJourneyChange?.(m.id, { ...this.journey }) },
        text: 'Show journey on globe',
      }))
    }
    if (hasPlan) {
      controls.append(el('button', {
        type: 'button', class: 'btn btn-plan', 'data-action': 'plan', 'aria-pressed': 'false',
        onclick: () => { this.journey.plan = !this.journey.plan; this._syncJourneyButtons(); this.onJourneyChange?.(m.id, { ...this.journey }) },
        text: 'Show early route plan (dashed)',
      }))
    }
    sec.append(controls)
    sec.append(el('p', { class: 'journey-3d-note note', text: '3D globe unavailable — the journey steps below remain complete.' }))

    // Legend (text + line pattern, not color alone)
    const legend = el('ul', { class: 'legend', 'aria-label': 'Journey legend' })
    const kinds = new Set(m.traversePaths.map((p) => p.kind))
    if (kinds.has('landingBounce')) legend.append(el('li', {}, el('span', { class: 'swatch swatch-bounce', 'aria-hidden': 'true' }), 'Landing bounces (heights exaggerated)'))
    if (kinds.has('roverDrive')) legend.append(el('li', {}, el('span', { class: 'swatch swatch-drive', 'aria-hidden': 'true' }), 'Completed sequence (solid)'))
    if (kinds.has('plannedDrive')) legend.append(el('li', {}, el('span', { class: 'swatch swatch-plan', 'aria-hidden': 'true' }), 'Early plan (dashed, “P” steps)'))
    sec.append(legend)

    // Completed paths first, then plans, each with ordered steps.
    const ordered = [...m.traversePaths].sort((a, b) => (a.kind === 'plannedDrive') - (b.kind === 'plannedDrive'))
    for (const p of ordered) {
      const isPlan = p.kind === 'plannedDrive'
      const block = el('div', { class: `path-block ${isPlan ? 'is-plan' : ''}` })
      block.append(el('h4', {}, p.name, ' ', el('span', { class: 'path-kind', text: `· ${PATH_KIND_LABEL[p.kind]}` })))
      const ol = el('ol', { class: 'steps' })
      p.waypointIds.forEach((id, i) => {
        const w = wp.get(id)
        ol.append(el('li', {},
          el('span', { class: 'step-num', 'aria-hidden': 'true', text: isPlan ? `P${i + 1}` : String(i + 1) }),
          el('span', { class: 'step-name', text: w.name }),
          ' ', this._cite(w.sourceIds)))
      })
      block.append(ol)
      if (p.bounce) {
        const h = p.bounce.maxHeight
        block.append(el('p', { class: 'bounce' },
          `${p.bounce.approximate ? 'About ' : ''}${p.bounce.count} bounces, up to ${h.value} ${h.unit} high. `,
          'Drawn arches are stylized; the maximum observed height is stated here, not drawn to scale. ', this._cite(p.sourceIds)))
      }
      const ds = p.distanceIds.map((id) => dist.get(id)).filter(Boolean)
      if (ds.length) {
        block.append(el('ul', { class: 'path-distances' }, ds.map((d) => el('li', {},
          el('span', { class: 'label', text: `${isPlan ? 'Early plan · ' : ''}${KIND_LABEL[d.kind]}: ` }),
          el('span', { class: 'num', text: formatDistance(d) }), ' ', this._cite(d.sourceIds)))))
      }
      if (p.kind === 'roverDrive') {
        block.append(el('p', { class: 'note', text: 'This sequence covers an early portion of the mission, not the full lifetime route.' }))
      }
      if (p._rejectedPolyline) block.append(el('p', { class: 'note', text: 'Supplied route samples failed validation; shown as a schematic.' }))
      block.append(this._cite(p.sourceIds) || '')
      sec.append(block)
    }
    if (m.id === 'sojourner') {
      sec.append(el('p', { class: 'note', text: 'The 1 km figure is how far the lander travelled while bouncing and rolling to rest. It is not a rover driving distance; Sojourner’s odometer is not specified in this dataset.' }))
    }
    return sec
  }

  /** Separate first-impact-to-rest graphic for the lander displacement (own label and units). */
  _displacementGraphic(pf, disp) {
    const NS = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('viewBox', '0 0 320 92')
    svg.setAttribute('class', 'disp-svg')
    svg.setAttribute('aria-hidden', 'true')
    const b = pf.traversePaths.find((p) => p.bounce)?.bounce
    const n = Math.min(b?.count ?? 8, 15)
    let d = 'M 16 70'
    let x = 16
    let h = 46
    const w0 = 252
    let sumW = 0
    const ws = []
    for (let k = 0; k < n; k++) { ws.push(Math.pow(0.86, k)); sumW += ws[k] }
    for (let k = 0; k < n; k++) {
      const w = (ws[k] / sumW) * w0 * 0.9
      d += ` Q ${(x + w / 2).toFixed(1)} ${(70 - h * 2).toFixed(1)} ${(x + w).toFixed(1)} 70`
      x += w; h *= 0.8
    }
    d += ` L ${16 + w0} 70`
    const ground = document.createElementNS(NS, 'line')
    Object.entries({ x1: 8, y1: 72, x2: 312, y2: 72, class: 'disp-ground' }).forEach(([k, v]) => ground.setAttribute(k, v))
    const path = document.createElementNS(NS, 'path')
    path.setAttribute('d', d)
    path.setAttribute('class', 'disp-path')
    path.setAttribute('pathLength', '1')
    const dot = document.createElementNS(NS, 'circle')
    dot.setAttribute('r', '6'); dot.setAttribute('class', 'disp-dot')
    dot.style.offsetPath = `path('${d}')`
    const tick = (tx, label) => {
      const g = document.createElementNS(NS, 'g')
      const l = document.createElementNS(NS, 'line')
      Object.entries({ x1: tx, y1: 66, x2: tx, y2: 80, class: 'disp-tick' }).forEach(([k, v]) => l.setAttribute(k, v))
      const t = document.createElementNS(NS, 'text')
      Object.entries({ x: tx, y: 90, 'text-anchor': tx < 100 ? 'start' : 'end', class: 'disp-label' }).forEach(([k, v]) => t.setAttribute(k, v))
      t.textContent = label
      g.append(l, t)
      return g
    }
    svg.append(ground, path, dot, tick(16, 'First impact'), tick(16 + w0, 'Rest'))
    return el('figure', { class: 'disp-graphic' },
      svg,
      el('figcaption', {},
        el('strong', { text: 'Pathfinder landing, shown separately: ' }),
        `lander displacement from first impact to rest, ${formatDistance(disp)}. Not a rover odometer; bounce heights are schematic. `,
        this._cite(disp.sourceIds)))
  }

  _renderComparison(current) {
    const rows = []
    for (const m of this.data.missions) {
      const odo = m.distanceTraveled.find((d) => d.kind === 'roverOdometer')
      const km = odo && kmValue(odo)
      if (km) rows.push({ m, odo, km })
    }
    const sec = el('section', { class: 'compare', 'aria-labelledby': 'h-compare' },
      el('h3', { id: 'h-compare', text: 'Lifetime odometers, linear scale' }))
    if (rows.length) {
      const max = Math.max(...rows.map((r) => r.km))
      const list = el('ul', { class: 'bars' })
      for (const r of rows) {
        const pct = (r.km / max) * 100
        const bar = el('span', { class: 'bar-fill', 'aria-hidden': 'true', 'data-w': pct.toFixed(2) })
        bar.style.width = matchMedia('(prefers-reduced-motion: reduce)').matches ? `${pct.toFixed(2)}%` : '0%'
        list.append(el('li', { class: r.m.id === current.id ? 'is-current' : '' },
          el('span', { class: 'bar-label' }, el('span', { text: r.m.name }), r.m.id === current.id ? el('span', { class: 'tag', text: ' (this mission)' }) : null),
          el('span', { class: 'bar-track', 'aria-hidden': 'true' }, bar),
          el('span', { class: 'bar-value num', text: formatDistance(r.odo) })))
      }
      sec.append(list)
      sec.append(el('p', { class: 'note', text: `Bars share one maximum (${max} km) and are drawn from the kilometre values in the mission data.` }))
    }
    const pf = this.data.missions.find((m) => m.id === 'sojourner')
    const disp = pf?.distanceTraveled.find((d) => d.kind === 'landerDisplacement')
    if (disp) {
      sec.append(this._displacementGraphic(pf, disp))
    }
    return sec
  }
}
