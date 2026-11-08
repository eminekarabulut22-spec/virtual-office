import { useCallback, useEffect, useState } from 'react'
import { fetchPlan, fetchPlanWriter, fetchUsage, runOfficeUpdate } from './api'
import AgentDetailPanel from './components/AgentDetailPanel'
import AgentsByDeptPanel from './components/AgentsByDeptPanel'
import BotsSidebar from './components/BotsSidebar'
import OfficeScene from './components/OfficeScene'
import { notifyHermesPlanUpdated } from './hermesBridge'
import { planLiveKey } from './scene/company-floor'
import ResizableOfficeMain from './components/ResizableOfficeMain'
import TasksPanel from './components/TasksPanel'
import { useAgentDeepLink, useHermesEmbed } from './hooks/useHermesEmbed'
import type { AgentUsage, CompanyOffice } from './types'

/** Fast Kanban poll — update done/running only (never reset work tokens). */
function mergeKpi(
  prev: Record<string, AgentUsage>,
  patch: Record<string, AgentUsage>,
): Record<string, AgentUsage> {
  const out = { ...prev }
  for (const [id, row] of Object.entries(patch)) {
    const prior = out[id]
    out[id] = {
      profile: prior?.profile ?? row.profile ?? `office-${id}`,
      tokens: prior?.tokens ?? 0,
      workTokens: prior?.workTokens ?? 0,
      jobsCompleted: prior?.jobsCompleted ?? 0,
      stateFound: prior?.stateFound,
      kanban: {
        done: row.kanban?.done ?? prior?.kanban?.done ?? 0,
        running: row.kanban?.running ?? prior?.kanban?.running ?? 0,
      },
    }
  }
  return out
}

function mergeUsageFull(
  prev: Record<string, AgentUsage>,
  patch: Record<string, AgentUsage>,
): Record<string, AgentUsage> {
  const out = { ...prev }
  for (const [id, row] of Object.entries(patch)) {
    const prior = out[id]
    out[id] = {
      ...prior,
      ...row,
      kanban: { ...prior?.kanban, ...row.kanban },
    }
  }
  return out
}

function sortPlan(plan: CompanyOffice): CompanyOffice {
  const departments = [...plan.departments]
    .map((d) => ({
      ...d,
      agents: [...d.agents].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })),
    }))
    .sort((a, b) =>
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) ||
      a.id.localeCompare(b.id, 'en'),
    )
  return { ...plan, departments }
}

export default function App() {
  const [plan, setPlan] = useState<CompanyOffice | null>(null)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState('Qwen')
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [qwenReady, setQwenReady] = useState<boolean | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [usage, setUsage] = useState<Record<string, AgentUsage>>({})
  const [selectedDept, setSelectedDept] = useState<string | null>(null)
  const embedded = useHermesEmbed()

  useAgentDeepLink((id) => setSelectedAgentId(id))

  const loadPlan = useCallback(async () => {
    const res = await fetchPlan()
    if (res.ok && res.data?.plan) {
      const next = sortPlan(res.data.plan)
      setPlan((prev) => {
        if (prev && planLiveKey(prev) === planLiveKey(next)) return prev
        return next
      })
    }
    if (res.ok && res.data?.kpiByAgentId) {
      setUsage((prev) => mergeKpi(prev, res.data!.kpiByAgentId!))
    }
  }, [])

  useEffect(() => {
    void loadPlan()
    const ms = embedded ? 3_000 : 8_000
    const t = window.setInterval(() => void loadPlan(), ms)
    return () => window.clearInterval(t)
  }, [loadPlan, embedded])

  useEffect(() => {
    const pull = () => {
      void fetchPlanWriter().then((r) => {
        if (r.ok) setQwenReady(r.data?.ok === true)
      })
    }
    pull()
    const t = window.setInterval(pull, 12_000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    const pull = () => {
      void fetchUsage().then((r) => {
        if (r.ok && r.data?.usage?.byAgentId) {
          setUsage((prev) => mergeUsageFull(prev, r.data!.usage!.byAgentId))
        }
      })
    }
    pull()
    const soon = window.setTimeout(pull, 3_000)
    const t = window.setInterval(pull, 15_000)
    return () => {
      window.clearTimeout(soon)
      window.clearInterval(t)
    }
  }, [plan?.updatedAt])

  async function onUpdate(e?: React.FormEvent) {
    e?.preventDefault()
    const text = prompt.trim()
    if (!text || busy) return
    setBusy(true)
    setBusyLabel('Qwen')
    setErr(null)
    const res = await runOfficeUpdate(text, (label) => setBusyLabel(label))
    setBusy(false)
    if (!res.ok || !res.plan) {
      setErr(res.error || 'Update failed.')
      return
    }
    const next = sortPlan(res.plan)
    setPlan(next)
    setPrompt('')
    const summary = res.plan.note || 'Office plan updated — 3D, BOTS, and profiles synced.'
    if (/no change/i.test(summary)) {
      setErr('Update saved but Qwen reported no changes. Try a short add prompt (e.g. add Legal / Zoe).')
      setPlan(sortPlan(res.plan))
      return
    }
    setNote(summary)
    notifyHermesPlanUpdated(next.updatedAt)
    void fetch('/api/office/ensure-profiles', { method: 'POST' })
    window.setTimeout(() => setNote(null), 12_000)
  }

  const agentCount = plan?.departments.reduce((n, d) => n + d.agents.length, 0) ?? 0

  const pickAgent = useCallback((id: string) => setSelectedAgentId(id), [])
  const pickDept = useCallback((id: string | null) => setSelectedDept(id), [])
  const pickBrain = useCallback(() => {
    setSelectedDept('knowledge')
    setSelectedAgentId(null)
  }, [])

  return (
    <div className={`vo-app${embedded ? ' vo-app--hermes-embed' : ''}`}>
      {!embedded && (
        <p className="vo-build-badge" title="Source repo">
          Virtual Office · virtual-office
        </p>
      )}
      <header className="vo-header">
        <div className="vo-title">
          <strong>{plan?.company ?? 'Virtual Office'}</strong>
          <span>
            {plan
              ? embedded
                ? `${plan.departments.length} departments · ${agentCount} agents · Knowledge · 3D · Tasks · build infra-doc`
                : `Agents' Office · ${agentCount} agents · ${plan.departments.length} departments`
              : 'Virtual Office'}
          </span>
        </div>
        {plan && (
          <div className="vo-update">
            <span className="vo-update-label">
              Update plan
              {qwenReady === true && <em> · ready</em>}
            </span>
            <div className="vo-update-form">
              <textarea
                value={prompt}
                onChange={(ev) => setPrompt(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
                    ev.preventDefault()
                    void onUpdate()
                  }
                }}
                placeholder="Add or remove agents, move departments… (syncs 3D + Hermes BOTS)"
                rows={Math.min(4, Math.max(1, Math.ceil(prompt.length / 90)))}
                disabled={busy}
                aria-label="Office plan update"
              />
              <button
                type="button"
                disabled={busy || !prompt.trim()}
                onClick={() => void onUpdate()}
              >
                {busy ? busyLabel : 'Update'}
              </button>
            </div>
          </div>
        )}
      </header>

      {err && <p className="vo-alert vo-alert--err">{err}</p>}
      {note && !err && <p className="vo-alert vo-alert--ok">{note}</p>}
      {qwenReady === false && !err && (
        <p className="vo-alert vo-alert--warn">
          Qwen offline — set <code>PLAN_CHAT_URL</code> (default 127.0.0.1:8790) and run your chat tunnel.
        </p>
      )}

      {!plan && (
        <section className="vo-empty">
          <h1>Set up the office</h1>
          <p>Describe your company. Update sends the prompt to Qwen and saves the plan to this repo.</p>
          <textarea
            value={prompt}
            onChange={(ev) => setPrompt(ev.target.value)}
            rows={8}
            placeholder="Long or short prompt — e.g. add a Legal department with two agents…"
            disabled={busy}
          />
          <button type="button" disabled={busy || !prompt.trim()} onClick={() => void onUpdate()}>
            {busy ? busyLabel : 'Build office'}
          </button>
        </section>
      )}

      {plan && (
        <ResizableOfficeMain
          embedded={embedded}
          left={
            embedded ? (
              <AgentsByDeptPanel
                plan={plan}
                selectedAgentId={selectedAgentId}
                onSelectAgent={pickAgent}
              />
            ) : (
              <BotsSidebar
                plan={plan}
                selectedAgentId={selectedAgentId}
                onSelectAgent={setSelectedAgentId}
              />
            )
          }
          center={
            <OfficeScene
              plan={plan}
              selectedAgentId={selectedAgentId}
              selectedDepartmentId={selectedDept}
              onSelectAgent={pickAgent}
              onSelectDepartment={pickDept}
              onSelectBrain={pickBrain}
            />
          }
          right={
            embedded ? (
              <AgentDetailPanel
                plan={plan}
                usage={usage}
                selectedAgentId={selectedAgentId}
                embedded
              />
            ) : (
              <TasksPanel
                plan={plan}
                usage={usage}
                selectedAgentId={selectedAgentId}
                selectedDepartmentId={selectedDept}
                onSelectAgent={(id) => setSelectedAgentId(id)}
              />
            )
          }
        />
      )}
    </div>
  )
}
