/**
 * Kyaani plan agents in Hermes BOTS (Desktop):
 * - Normal click → Hermes opens Bot Chat (office-<id>) — do NOT intercept.
 * - Option (⌥) / Alt click → Virtual Office 3D + Tasks for that agent.
 * - Office iframe postMessage `kyaani-office-open-bot-chat` → BOTS + Bot Chat.
 */
import React, { useEffect } from 'react'
import { host, STATUSBAR_AREAS } from '@hermes/plugin-sdk'

const OFFICE_BASE = (() => {
  const raw =
    (typeof globalThis !== 'undefined' && globalThis.__HERMES_VIRTUAL_OFFICE_URL) ||
    'http://127.0.0.1:3001'
  try {
    const u = new URL(String(raw).includes('://') ? String(raw) : `http://${String(raw)}`)
    if (!u.port && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) u.port = '3001'
    return u.origin.replace(/\/+$/, '')
  } catch {
    return 'http://127.0.0.1:3001'
  }
})()

/** @type {Set<string>} */
let officeIds = new Set()
/** @type {Set<string>} */
let planSectionIds = new Set()
let lastPlanUpdatedAt = ''

async function refreshOfficePlan() {
  try {
    const res = await fetch(`${OFFICE_BASE}/api/kyaani/office/bots`, { cache: 'no-store' })
    if (!res.ok) return
    const body = await res.json()
    officeIds = new Set((body.bots || []).map((b) => String(b.id || '').trim()).filter(Boolean))
    planSectionIds = new Set(
      (body.sections || []).map((s) => String(s.sectionId || s.id || '').trim()).filter(Boolean),
    )
    const updatedAt = String(body.updatedAt || '')
    if (updatedAt && updatedAt !== lastPlanUpdatedAt) {
      lastPlanUpdatedAt = updatedAt
      fetch('http://127.0.0.1:9122/kyaani-bots-proxy-refresh', { method: 'POST' }).catch(() => {})
      fetch(`${OFFICE_BASE}/api/kyaani/office/ensure-profiles`, { method: 'POST' }).catch(() => {})
      if (typeof host?.invalidateQueries === 'function') {
        host.invalidateQueries(['roster'])
      }
    }
    applyRosterFilter()
  } catch {
    /* office down */
  }
}

/** Packaged Hermes + raw 9120: hide gateway office-* rows not on the current plan. */
function applyRosterFilter() {
  for (const row of document.querySelectorAll('[data-roster-key]')) {
    const profile = profileFromRosterKey(row.getAttribute('data-roster-key') || '')
    if (!profile || profile === 'default') {
      row.style.removeProperty('display')
      continue
    }
    const id = planAgentIdFromProfile(profile)
    const isOffice = profile.startsWith('office-') || profile.startsWith('office:') || Boolean(id)
    if (!isOffice) continue
    const onPlan = id && officeIds.has(id)
    if (onPlan) {
      row.style.removeProperty('display')
      row.style.removeProperty('pointer-events')
    } else {
      row.style.display = 'none'
    }
  }
  hideEmptyOfficeSections()
}

/** Plan empty → no orphan KNOWLEDGE / ENGINEERING headings with zero agents. */
function hideEmptyOfficeSections() {
  for (const section of document.querySelectorAll('[data-slot="bots-section"]')) {
    const heading = section.querySelector('[data-slot="bots-section-heading"]')
    const sectionId = heading?.getAttribute('data-section-id') || ''
    const isOfficeDept = sectionId.startsWith('office-dept-')
    const rows = section.querySelectorAll('[data-roster-key]')
    let anyVisible = false
    for (const row of rows) {
      if (row.style.display !== 'none') {
        anyVisible = true
        break
      }
    }
    const onPlan = !isOfficeDept || (sectionId && planSectionIds.has(sectionId))
    const show = onPlan && (rows.length === 0 ? planSectionIds.has(sectionId) : anyVisible)
    section.style.display = show ? '' : 'none'
  }

  for (const heading of document.querySelectorAll('[data-slot="bots-section-heading"]')) {
    const sectionId = heading.getAttribute('data-section-id') || ''
    if (!sectionId.startsWith('office-dept-')) continue
    if (planSectionIds.has(sectionId)) continue
    const block = heading.closest('[data-slot="bots-section"]')
    if (block) block.style.display = 'none'
    else heading.style.display = 'none'
  }
}

function profileFromRosterKey(key) {
  const i = String(key).lastIndexOf('::')
  return i >= 0 ? key.slice(i + 2) : String(key)
}

function planAgentIdFromProfile(profileName) {
  const n = String(profileName || '')
  if (n.startsWith('office:')) return n.slice('office:'.length)
  if (n.startsWith('office-')) return n.slice('office-'.length)
  if (officeIds.has(n)) return n
  return ''
}

function isPlanAgent(profileName) {
  return Boolean(planAgentIdFromProfile(profileName))
}

function diskProfileName(id) {
  return `office-${String(id).trim().toLowerCase()}`
}

function officeIframe() {
  return (
    document.querySelector('iframe[title="Kyaani Office"]') ||
    document.querySelector('iframe[src*="127.0.0.1:3001"]') ||
    document.querySelector('iframe[src*="localhost:3001"]')
  )
}

function rosterRowForProfile(profileName) {
  const want = String(profileName || '').trim()
  if (!want) return null
  for (const row of document.querySelectorAll('[data-roster-key]')) {
    if (row.style.display === 'none') continue
    const prof = profileFromRosterKey(row.getAttribute('data-roster-key') || '')
    if (prof === want) return row
  }
  return null
}

/** Virtual Office → BOTS: same path as a normal roster click (Bot Chat). */
function showBotsPane() {
  try {
    host.navigate('/sessions')
  } catch {
    /* older hosts */
  }
  try {
    const pane = host.paneVisibility?.('hermes-bots:pane')
    if (pane && typeof pane.set === 'function') pane.set(true)
  } catch {
    /* optional SDK */
  }
  for (const el of document.querySelectorAll('[role="tab"], button')) {
    const label = (el.textContent || '').trim()
    if (/^bots$/i.test(label)) {
      el.click()
      return
    }
  }
}

function openBotChatFromOffice(agentId, profileName) {
  const profile = String(profileName || diskProfileName(agentId)).trim()
  const id = String(agentId || planAgentIdFromProfile(profile)).trim()
  if (!id || (officeIds.size && !officeIds.has(id))) return

  showBotsPane()

  const clickRow = () => {
    const row = rosterRowForProfile(profile)
    if (!row) return false
    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    row.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, view: window, button: 0 }),
    )
    return true
  }

  if (clickRow()) return
  let tries = 0
  const timer = window.setInterval(() => {
    if (clickRow() || ++tries > 45) window.clearInterval(timer)
  }, 120)
}

function focusOfficeAgent(id) {
  if (!id) return
  const url = `${OFFICE_BASE}/?embed=hermes&agent=${encodeURIComponent(id)}`
  host.navigate('/kyaani')
  const apply = () => {
    const frame = officeIframe()
    if (!frame) return false
    try {
      if (!String(frame.src || '').includes(`agent=${encodeURIComponent(id)}`)) {
        frame.src = url
      }
      frame.contentWindow?.postMessage({ type: 'kyaani-office-focus-agent', id }, '*')
    } catch {
      frame.src = url
    }
    return true
  }
  if (apply()) return
  let tries = 0
  const timer = window.setInterval(() => {
    if (apply() || ++tries > 50) window.clearInterval(timer)
  }, 120)
}

function OfficeBotClickGuard() {
  useEffect(() => {
    void refreshOfficePlan()
    const poll = window.setInterval(() => void refreshOfficePlan(), 4000)
    const mo = new MutationObserver(() => applyRosterFilter())
    mo.observe(document.body, { childList: true, subtree: true })
    const onOfficePlanMessage = (ev) => {
      const data = ev?.data
      if (!data || data.type !== 'kyaani:office-plan-updated') return
      void refreshOfficePlan()
      fetch('http://127.0.0.1:9122/kyaani-bots-proxy-refresh', { method: 'POST' }).catch(() => {})
      if (typeof host?.invalidateQueries === 'function') {
        host.invalidateQueries(['roster'])
      }
    }
    const onOpenBotChatMessage = (ev) => {
      const data = ev?.data
      if (!data || data.type !== 'kyaani-office-open-bot-chat') return
      try {
        if (ev.origin && ev.origin !== OFFICE_BASE) return
      } catch {
        return
      }
      const frame = officeIframe()
      if (frame?.contentWindow && ev.source && ev.source !== frame.contentWindow) return
      openBotChatFromOffice(data.agentId, data.profile)
    }
    window.addEventListener('message', onOfficePlanMessage)
    window.addEventListener('message', onOpenBotChatMessage)

    /** Normal click → Hermes Bot Chat (never intercept). Option/Alt → 3D office. */
    const onAltOffice = (ev) => {
      if (!ev.altKey && !ev.metaKey) return
      if (ev.type === 'click' && ev.button !== 0) return
      const target = ev.target
      if (!target || typeof target.closest !== 'function') return
      const row = target.closest('[data-roster-key]')
      if (!row) return
      const profile = profileFromRosterKey(row.getAttribute('data-roster-key') || '')
      if (!isPlanAgent(profile)) return
      ev.preventDefault()
      ev.stopPropagation()
      if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation()
      focusOfficeAgent(planAgentIdFromProfile(profile))
    }
    document.addEventListener('click', onAltOffice, true)
    document.addEventListener('auxclick', onAltOffice, true)
    return () => {
      mo.disconnect()
      window.clearInterval(poll)
      window.removeEventListener('message', onOfficePlanMessage)
      window.removeEventListener('message', onOpenBotChatMessage)
      document.removeEventListener('click', onAltOffice, true)
      document.removeEventListener('auxclick', onAltOffice, true)
    }
  }, [])
  return null
}

export default {
  id: 'kyaani-office-bots-open',
  name: 'Kyaani Office bot opens',
  defaultEnabled: true,
  register(ctx) {
    console.info('[kyaani] BOTS: normal click = Bot Chat · Option+click = Virtual Office 3D')
    ctx.registerMany([
      {
        id: 'guard',
        area: STATUSBAR_AREAS.right,
        order: 2,
        render: () => React.createElement(OfficeBotClickGuard),
      },
    ])
  },
}
