import type { CompanyOffice, WorkStatus } from '../types'

const STATUS: Record<WorkStatus, string> = {
  working: '#3dbe7a',
  waiting: '#e6b15a',
  problem: '#e25b56',
  idle: '#8aa0b2',
  offline: '#5c6b76',
}

type Props = {
  plan: CompanyOffice
  selectedAgentId: string | null
  onSelectAgent: (id: string) => void
  onSelectDepartment: (deptId: string | null) => void
}

export default function BrainPanel({ plan, selectedAgentId, onSelectAgent, onSelectDepartment }: Props) {
  const knowledge = plan.departments.find((d) => d.id === 'knowledge')
  const lead = knowledge?.agents[0]
  const stats = { working: 0, waiting: 0, problem: 0, idle: 0, offline: 0 }
  for (const d of plan.departments) {
    for (const a of d.agents) stats[a.status] += 1
  }

  return (
    <aside className="vo-brain" aria-label="Agents overview">
      <p className="vo-brain-kicker">THE BRAIN · HERMES / QWEN</p>
      <h2>Agents&apos; Office</h2>
      <p className="vo-brain-sub">How AI agents run {plan.company}</p>
      {lead && (
        <button type="button" className="vo-brain-lead" onClick={() => onSelectAgent(lead.id)}>
          <strong>{lead.name}</strong> — {lead.role}
        </button>
      )}
      <p className="vo-brain-note">[from company-office.json in virtual-office]</p>
      <div className="vo-brain-stats">
        {(
          [
            ['In progress', stats.working],
            ['Waiting', stats.waiting],
            ['Idle', stats.idle],
            ['Problem', stats.problem],
            ['Offline', stats.offline],
          ] as const
        ).map(([label, n]) => (
          <div key={label}>
            <strong>{n}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <p className="vo-brain-dept-label">Departments (A→Z)</p>
      <ul className="vo-brain-depts">
        {plan.departments.map((d) => (
          <li key={d.id}>
            <button type="button" onClick={() => onSelectDepartment(d.id)}>
              {d.name} ({d.agents.length})
            </button>
          </li>
        ))}
      </ul>
      <ul className="vo-brain-agents">
        {plan.departments.flatMap((d) =>
          d.agents.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className={selectedAgentId === a.id ? 'on' : ''}
                onClick={() => onSelectAgent(a.id)}
              >
                <i style={{ background: STATUS[a.status] }} />
                {a.name}
              </button>
            </li>
          )),
        )}
      </ul>
    </aside>
  )
}
