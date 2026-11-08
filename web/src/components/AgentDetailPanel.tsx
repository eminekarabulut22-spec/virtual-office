import OutcomeKpiStrip, { rollupOutcomeKpi } from './OutcomeKpiStrip'
import type { AgentUsage, CompanyOffice, WorkStatus } from '../types'

const STATUS_LABEL: Record<WorkStatus, string> = {
  working: 'In progress',
  waiting: 'Waiting',
  problem: 'Problem',
  idle: 'Idle',
  offline: 'Offline',
}

type Props = {
  plan: CompanyOffice
  usage: Record<string, AgentUsage>
  selectedAgentId: string | null
  modelLabel?: string
  embedded?: boolean
}

/** Right of 3D — agent KPI (matches Agenten / co-tasks panel layout in Hermes embed). */
export default function AgentDetailPanel({
  plan,
  usage,
  selectedAgentId,
  modelLabel = 'openai/vllm/company-ai-local',
  embedded = false,
}: Props) {
  const stats = { working: 0, waiting: 0, problem: 0, idle: 0, offline: 0, total: 0 }
  for (const d of plan.departments) {
    for (const a of d.agents) {
      stats.total += 1
      stats[a.status] += 1
    }
  }

  const hit = selectedAgentId
    ? plan.departments
        .flatMap((d) => d.agents.map((a) => ({ agent: a, deptName: d.name })))
        .find((r) => r.agent.id === selectedAgentId)
    : null

  const allAgentIds = plan.departments.flatMap((d) => d.agents.map((a) => a.id))
  const scopeIds = hit ? [hit.agent.id] : allAgentIds
  const outcome = rollupOutcomeKpi(scopeIds, usage)
  const deptLabel = hit ? hit.deptName.toUpperCase() : 'ALL DEPARTMENTS'

  if (embedded) {
    return (
      <aside className="co-tasks vo-detail-co" aria-label="Tasks">
        <header className="co-tasks-head">
          <div className="co-tasks-head-row">
            <span className="co-brain-kicker">Live</span>
          </div>
          <h2>Tasks</h2>
          <p className="co-tasks-dept">{deptLabel}</p>
        </header>

        <OutcomeKpiStrip
          title={hit ? hit.agent.name : plan.company}
          subtitle={hit ? hit.agent.role : 'Company totals (all agents)'}
          jobsDone={outcome.jobsDone}
          workTokens={outcome.workTokens}
          jobsInProgress={outcome.jobsInProgress}
        />

        {!hit && (
          <p className="vo-detail-empty">Select an agent on the left or in the 3D floor.</p>
        )}

        {hit && (
          <section className="co-tasks-agent" id={`co-agent-${hit.agent.id}`} aria-label="Selected agent">
            <p className="co-tasks-agent-doing">{hit.agent.doing}</p>

            <dl className="co-tasks-agent-meta">
              <div>
                <dt>Model</dt>
                <dd>{hit.agent.model || modelLabel}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{STATUS_LABEL[hit.agent.status]}</dd>
              </div>
              <div>
                <dt>Department</dt>
                <dd>{hit.deptName}</dd>
              </div>
            </dl>

          </section>
        )}

        <div className="co-tasks-counters co-tasks-counters--4">
          <div>
            <strong>{stats.total}</strong>
            <span>Agents</span>
          </div>
          <div>
            <strong>{stats.working}</strong>
            <span>In progress</span>
          </div>
          <div>
            <strong>{stats.waiting}</strong>
            <span>Waiting</span>
          </div>
          <div>
            <strong>{stats.idle}</strong>
            <span>Idle</span>
          </div>
        </div>
      </aside>
    )
  }

  return (
    <aside className="vo-detail" aria-label="Agent details">
      <header className="vo-detail-head">
        <span className="kicker">Live</span>
        <h2>Tasks</h2>
        <p>ALL DEPARTMENTS</p>
      </header>

      <OutcomeKpiStrip
        title={hit ? hit.agent.name : plan.company}
        subtitle={hit ? hit.agent.role : 'Company totals (all agents)'}
        jobsDone={outcome.jobsDone}
        workTokens={outcome.workTokens}
        jobsInProgress={outcome.jobsInProgress}
      />

      {!hit && <p className="vo-detail-empty">Select an agent on the left or in the 3D floor.</p>}

      {hit && (
        <section className="vo-detail-card">
          <p className="vo-detail-doing">{hit.agent.doing}</p>

          <dl className="vo-detail-meta">
            <div>
              <dt>Model</dt>
              <dd>{hit.agent.model || modelLabel}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{STATUS_LABEL[hit.agent.status]}</dd>
            </div>
            <div>
              <dt>Department</dt>
              <dd>{hit.deptName}</dd>
            </div>
          </dl>

        </section>
      )}

      <div className="vo-detail-counters">
        <div>
          <strong>{stats.total}</strong>
          <span>Agents</span>
        </div>
        <div>
          <strong>{stats.working}</strong>
          <span>In progress</span>
        </div>
        <div>
          <strong>{stats.waiting}</strong>
          <span>Waiting</span>
        </div>
        <div>
          <strong>{stats.idle}</strong>
          <span>Idle</span>
        </div>
      </div>
    </aside>
  )
}
