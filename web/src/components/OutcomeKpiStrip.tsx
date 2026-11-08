type Props = {
  title: string
  subtitle?: string
  jobsDone: number
  workTokens: number
  jobsInProgress?: number
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toLocaleString('en-US')
}

/** Patron KPI — completed Kanban jobs + work-run tokens only. */
export default function OutcomeKpiStrip({
  title,
  subtitle,
  jobsDone,
  workTokens,
  jobsInProgress = 0,
}: Props) {
  return (
    <section className="vo-outcome-kpi vo-outcome-kpi--two" aria-label="Work outcomes">
      <header className="vo-outcome-kpi-head">
        <h3 className="vo-outcome-kpi-title">{title}</h3>
        {subtitle ? <p className="vo-outcome-kpi-sub">{subtitle}</p> : null}
      </header>
      <div className="vo-outcome-kpi-grid">
        <div className="vo-outcome-kpi-cell vo-outcome-kpi-cell--done">
          <span className="vo-outcome-kpi-label">Completed</span>
          <strong className="vo-outcome-kpi-value">{formatCount(jobsDone)}</strong>
          <small>Jobs finished (Kanban)</small>
        </div>
        <div className="vo-outcome-kpi-cell vo-outcome-kpi-cell--work">
          <span className="vo-outcome-kpi-label">Work tokens</span>
          <strong className="vo-outcome-kpi-value">{formatCount(workTokens)}</strong>
          <small>Dispatched job runs only</small>
        </div>
      </div>
      {jobsInProgress > 0 ? (
        <p className="vo-outcome-kpi-foot">{jobsInProgress} job(s) in progress</p>
      ) : null}
    </section>
  )
}

export function rollupOutcomeKpi(
  agentIds: string[],
  usage: Record<string, import('../types').AgentUsage>,
): { jobsDone: number; workTokens: number; jobsInProgress: number } {
  let jobsDone = 0
  let workTokens = 0
  let jobsInProgress = 0
  for (const id of agentIds) {
    const u = usage[id]
    if (!u) continue
    jobsDone += u.kanban?.done ?? 0
    workTokens += u.workTokens ?? 0
    jobsInProgress += u.kanban?.running ?? 0
  }
  return { jobsDone, workTokens, jobsInProgress }
}
