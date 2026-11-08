import type { AgentUsage, CompanyOffice } from './types'

async function parse<T>(res: Response): Promise<{ ok: boolean; data?: T; error?: string; status: number }> {
  const status = res.status
  const body = (await res.json().catch(() => null)) as T | { error?: string | { message?: string } } | null
  if (!res.ok) {
    const err =
      typeof body === 'object' && body && 'error' in body
        ? typeof (body as { error: unknown }).error === 'string'
          ? (body as { error: string }).error
          : (body as { error: { message?: string } }).error?.message
        : res.statusText
    return { ok: false, error: err || 'Request failed', status }
  }
  return { ok: true, data: body as T, status }
}

export async function fetchPlan() {
  return parse<{ plan: CompanyOffice | null; kpiByAgentId?: Record<string, AgentUsage> }>(
    await fetch('/api/kyaani/office', { cache: 'no-store' }),
  )
}

export async function fetchKpi() {
  return parse<{ kpiByAgentId: Record<string, AgentUsage> }>(
    await fetch('/api/kyaani/office/kpi', { cache: 'no-store' }),
  )
}

export async function fetchPlanWriter() {
  return parse<{ ok: boolean; endpoint?: string }>(
    await fetch('/api/kyaani/office/plan-writer', { cache: 'no-store' }),
  )
}

export async function fetchUsage() {
  return parse<{ usage: { byAgentId: Record<string, AgentUsage>; companyTokens: number } }>(
    await fetch('/api/kyaani/office/usage?chat=0', { cache: 'no-store' }),
  )
}

export async function runOfficeUpdate(
  prompt: string,
  onProgress?: (label: string) => void,
): Promise<{ ok: boolean; plan?: CompanyOffice; error?: string }> {
  const start = await parse<{ jobId: string }>(
    await fetch('/api/kyaani/office/update-job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    }),
  )
  if (!start.ok || !start.data?.jobId) {
    return { ok: false, error: start.error || 'Could not start Update.' }
  }
  const jobId = start.data.jobId
  const deadline = Date.now() + 240_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000))
    const poll = await parse<{
      status: string
      phase?: string
      plan?: CompanyOffice
      error?: string
    }>(await fetch(`/api/kyaani/office/update-job?id=${encodeURIComponent(jobId)}`, { cache: 'no-store' }))
    if (!poll.ok) return { ok: false, error: poll.error }
    if (poll.data?.status === 'running') {
      const phase = poll.data.phase
      if (phase === 'calling_qwen' || phase === 'starting') onProgress?.('Qwen')
      else if (phase === 'applying_plan') onProgress?.('Applying…')
      continue
    }
    if (poll.data?.status === 'error') {
      return { ok: false, error: poll.data.error || 'Update failed.' }
    }
    if (poll.data?.status === 'done' && poll.data.plan) {
      return { ok: true, plan: poll.data.plan }
    }
  }
  return { ok: false, error: 'Update timed out.' }
}

export async function sendAgentChat(agentId: string, messages: { role: string; content: string }[]) {
  return parse<{ reply: string; tokensEstimated?: number }>(
    await fetch('/api/kyaani/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, messages }),
    }),
  )
}
