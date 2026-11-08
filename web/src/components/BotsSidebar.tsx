import type { CompanyOffice, WorkStatus } from '../types'

const STATUS_DOT: Record<WorkStatus, string> = {
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
}

/** Hermes BOTS-style rail — departments A→Z, agents A→Z. */
export default function BotsSidebar({ plan, selectedAgentId, onSelectAgent }: Props) {
  return (
    <aside className="vo-bots" aria-label="BOTS">
      <div className="vo-bots-tabs">
        <span className="muted">SESSIONS</span>
        <span className="on">BOTS</span>
      </div>
      <p className="vo-bots-hint">Click an agent to view tasks and KPIs.</p>
      <nav className="vo-bots-tree">
        {plan.departments.map((dept) => (
          <section key={dept.id} className="vo-bots-dept">
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
                    <i style={{ background: STATUS_DOT[agent.status] }} aria-hidden />
                    <span>{agent.name}</span>
                    <small>{agent.role}</small>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>
    </aside>
  )
}
