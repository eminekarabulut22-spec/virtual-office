import type { AgentUsage, CompanyOffice } from '../types'

function workCompleted(u: AgentUsage | undefined): number {
  return u?.kanban?.done ?? 0
}

type Props = {
  plan: CompanyOffice
  usage: Record<string, AgentUsage>
  selectedAgentId: string | null
  selectedDepartmentId?: string | null
  onSelectAgent: (id: string) => void
}

export default function TasksPanel({
  plan,
  usage,
  selectedAgentId,
  selectedDepartmentId = null,
  onSelectAgent,
}: Props) {
  const selected = selectedAgentId
    ? plan.departments.flatMap((d) => d.agents.map((a) => ({ ...a, dept: d.name }))).find((a) => a.id === selectedAgentId)
    : null

  const rows = plan.departments
    .filter((d) => !selectedDepartmentId || d.id === selectedDepartmentId)
    .flatMap((d) => d.agents.map((a) => ({ ...a, dept: d.name })))

  return (
    <aside className="vo-tasks" aria-label="Tasks">
      <header>
        <span className="kicker">Live</span>
        <h2>Tasks</h2>
        <p>ALL DEPARTMENTS</p>
      </header>

      {selected && (
        <section className="vo-tasks-agent">
          <h3>{selected.name}</h3>
          <p>{selected.role}</p>
          <p className="doing">{selected.doing}</p>
          <div className="vo-kpi">
            <div>
              <span>Completed</span>
              <strong>{workCompleted(usage[selected.id])}</strong>
              <small>Jobs finished</small>
            </div>
            <div>
              <span>Work tokens</span>
              <strong>{(usage[selected.id]?.workTokens ?? 0).toLocaleString('en-US')}</strong>
              <small>Dispatched job runs</small>
            </div>
          </div>
        </section>
      )}

      <ul className="vo-task-list">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              className={selectedAgentId === row.id ? 'on' : ''}
              onClick={() => onSelectAgent(row.id)}
            >
              <span>{row.name} · {row.doing.slice(0, 48)}</span>
              <small>
                {(usage[row.id]?.workTokens ?? 0).toLocaleString('en-US')} work tok ·{' '}
                {workCompleted(usage[row.id])} done
              </small>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
