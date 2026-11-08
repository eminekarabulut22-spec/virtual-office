import type { CompanyOffice, WorkStatus } from '../types'

const STATUS: Record<WorkStatus, string> = {
  working: '#3dbe7a',
  waiting: '#e6b15a',
  problem: '#e25b56',
  idle: '#8aa0b2',
  offline: '#5c6b76',
}

const STATUS_LABEL: Record<WorkStatus, string> = {
  working: 'In progress',
  waiting: 'Waiting',
  problem: 'Problem',
  idle: 'Idle',
  offline: 'Offline',
}

type Props = {
  plan: CompanyOffice
  selectedAgentId: string | null
  onSelectAgent: (id: string) => void
}

/** Left of 3D — departments A→Z, agents A→Z under each (Hermes office layout). */
export default function AgentsByDeptPanel({ plan, selectedAgentId, onSelectAgent }: Props) {
  return (
    <aside className="vo-roster" aria-label="Agents by department">
      <header className="vo-roster-head">
        <p className="vo-roster-kicker">THE BRAIN · HERMES / QWEN</p>
        <h2>Agents&apos; Office</h2>
        <p className="vo-roster-sub">How AI agents run {plan.company}</p>
      </header>
      <div className="vo-roster-scroll" role="region" aria-label="Agents list">
        <nav className="vo-roster-tree">
          {plan.departments.map((dept) => (
            <section key={dept.id} className="vo-roster-dept">
              <h3>
                {dept.name.toUpperCase()} <small>({dept.agents.length})</small>
              </h3>
              <ul>
                {dept.agents.map((agent) => (
                  <li key={agent.id}>
                    <button
                      type="button"
                      className={selectedAgentId === agent.id ? 'on' : ''}
                      onClick={() => onSelectAgent(agent.id)}
                    >
                      <i style={{ background: STATUS[agent.status] }} aria-hidden />
                      <span className="vo-roster-name">{agent.name}</span>
                      <span className="vo-roster-meta">{STATUS_LABEL[agent.status]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
      </div>
    </aside>
  )
}
