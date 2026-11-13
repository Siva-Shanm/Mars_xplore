// "Evidence for ancient water": a keyboard-operable tab list of sourced cards.
// Each card states whether it is a FINDING the missions made or a REASON NASA chose
// a landing site. No artist's concept is used as evidence.

import { isSafeSourceUrl } from './validate.js'

const KIND = {
  finding: { badge: 'Finding made by the mission', cls: 'is-finding' },
  siteSelection: { badge: 'Why NASA chose this site (before landing)', cls: 'is-selection' },
}

export class EvidenceView {
  constructor({ root, data, onShow }) {
    this.root = root
    this.data = data
    this.onShow = onShow
    this.index = 0
    this.render()
  }

  render() {
    const items = this.data.evidence ?? []
    this.root.hidden = items.length === 0
    if (!items.length) return
    const tabs = this.root.querySelector('#evidence-tabs')
    const panel = this.root.querySelector('#evidence-card')
    tabs.replaceChildren()
    items.forEach((e, i) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.id = `ev-tab-${e.id}`
      b.className = `ev-tab ${KIND[e.kind].cls}`
      b.setAttribute('role', 'tab')
      b.setAttribute('aria-controls', 'evidence-card')
      const n = document.createElement('span'); n.className = 'ev-num'; n.textContent = String(i + 1); n.setAttribute('aria-hidden', 'true')
      const t = document.createElement('span'); t.textContent = e.title
      b.append(n, t)
      b.addEventListener('click', () => this.select(i, { highlight: true }))
      b.addEventListener('keydown', (ev) => {
        const k = ev.key
        if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(k)) return
        ev.preventDefault()
        const next = k === 'Home' ? 0 : k === 'End' ? items.length - 1 : (this.index + (k === 'ArrowRight' ? 1 : -1) + items.length) % items.length
        this.select(next, { highlight: false })
        tabs.children[next].focus()
      })
      tabs.append(b)
    })
    this.select(0, { highlight: false })
    void panel
  }

  select(i, { highlight }) {
    const items = this.data.evidence
    const e = items[i]
    if (!e) return
    this.index = i
    const tabs = this.root.querySelector('#evidence-tabs')
    ;[...tabs.children].forEach((b, j) => {
      b.setAttribute('aria-selected', String(j === i))
      b.tabIndex = j === i ? 0 : -1
    })
    const card = this.root.querySelector('#evidence-card')
    card.setAttribute('aria-labelledby', `ev-tab-${e.id}`)
    card.className = `ev-card ${KIND[e.kind].cls}`
    card.replaceChildren()
    const badge = document.createElement('p'); badge.className = 'ev-badge'; badge.textContent = KIND[e.kind].badge
    const h = document.createElement('h3'); h.textContent = e.title
    const p = document.createElement('p'); p.className = 'ev-text'; p.textContent = e.text
    const missions = e.missionIds.map((id) => this.data.missions.find((m) => m.id === id)).filter(Boolean)
    const who = document.createElement('p'); who.className = 'ev-who'; who.textContent = `Mission${missions.length > 1 ? 's' : ''}: ${missions.map((m) => m.name).join(' and ')}`
    const src = document.createElement('p'); src.className = 'cite'
    src.append('Source: ')
    e.sourceIds.forEach((sid, k) => {
      const s = this.data.sources[sid]
      if (!s || !isSafeSourceUrl(s.url)) return
      if (k) src.append(' · ')
      const a = document.createElement('a'); a.href = s.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = s.title
      src.append(a)
    })
    const actions = document.createElement('div'); actions.className = 'ev-actions'
    for (const m of missions) {
      const b = document.createElement('button')
      b.type = 'button'; b.className = 'btn btn-small'
      b.textContent = e.stopId ? `Show at ${m.site.name}` : `Show ${m.site.name}`
      b.addEventListener('click', () => this.onShow?.(e, m.id))
      actions.append(b)
    }
    const note = document.createElement('p'); note.className = 'note'
    note.textContent = 'No supplied photo documents this evidence, so none is shown. Rover images on this site are not evidence.'
    card.append(badge, h, p, who, actions, src, note)
    card.classList.remove('is-entering'); void card.offsetWidth; card.classList.add('is-entering')
    if (highlight) this.onShow?.(e, missions[0]?.id, { soft: true })
  }
}
