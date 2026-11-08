/**
 * Local gateway front (127.0.0.1:9120) → SSH tunnel upstream (9123).
 * Merges company-office plan agents into profiles.list (WebSocket + GET /api/profiles).
 *
 * Until company-devops gateway ships _append_kyaani_company_office_profiles.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import WebSocket, { WebSocketServer } from 'ws'

const FRONT_PORT = Number(process.env.KYAANI_GATEWAY_FRONT_PORT ?? 9122)
const UPSTREAM = (process.env.KYAANI_GATEWAY_UPSTREAM ?? 'http://127.0.0.1:9123').replace(/\/+$/, '')
const OFFICE_URL = (process.env.KYAANI_OFFICE_URL ?? 'http://127.0.0.1:3001').replace(/\/+$/, '')
const PLAN_JSON = process.env.KYAANI_COMPANY_OFFICE_JSON ?? ''

type OfficeBot = {
  id: string
  name: string
  role: string
  departmentId: string
  department: string
  doing: string
  model: string
}

const DEPT_LABEL: Record<string, string> = {
  knowledge: 'Knowledge',
  hr: 'Human Resources',
  engineering: 'Engineering',
  executive: 'Executive',
  sales: 'Sales',
  marketing: 'Marketing',
  'customer-support': 'Customer Support',
  finance: 'Finance',
  operations: 'Operations',
  research: 'Research',
  policy: 'Policy',
  email: 'Email',
  media: 'Media',
  legal: 'Legal',
  product: 'Product',
  'compliance-risk': 'Compliance & Risk',
  'human-resources': 'Human Resources',
  procurement: 'Procurement',
}

function departmentSectionMeta(departmentId: string, fallbackName: string) {
  const id = String(departmentId || '').trim() || 'unknown'
  return {
    sectionId: `office-dept-${id}`,
    sectionName: DEPT_LABEL[id] ?? fallbackName,
  }
}

type ProfileRow = Record<string, unknown>

let cachedBots: OfficeBot[] | null = null
let cachedAt = 0
let cachedPlanMtime = 0

export function invalidateOfficeBotsCache(): void {
  cachedBots = null
  cachedAt = 0
  cachedPlanMtime = 0
}

async function loadOfficeBots(): Promise<OfficeBot[]> {
  const now = Date.now()
  if (PLAN_JSON) {
    try {
      const mtime = statSync(resolve(PLAN_JSON)).mtimeMs
      if (mtime !== cachedPlanMtime) {
        invalidateOfficeBotsCache()
        cachedPlanMtime = mtime
      }
    } catch {
      /* ignore */
    }
  }
  if (cachedBots && now - cachedAt < 5000) return cachedBots

  if (PLAN_JSON) {
    try {
      const raw = readFileSync(resolve(PLAN_JSON), 'utf8')
      const data = JSON.parse(raw) as { departments?: { id?: string; name?: string; agents?: Record<string, unknown>[] }[] }
      const bots: OfficeBot[] = []
      const depts = [...(data.departments ?? [])].sort((a, b) =>
        departmentSortLabel(a).localeCompare(departmentSortLabel(b), 'en', { sensitivity: 'base' }),
      )
      for (const dept of depts) {
        for (const agent of dept.agents ?? []) {
          const row = botFromPlanRow(dept, agent)
          if (row) bots.push(row)
        }
      }
      cachedBots = sortOfficeBots(bots)
      cachedAt = now
      return cachedBots
    } catch {
      /* fall through */
    }
  }

  try {
    const res = await fetch(`${OFFICE_URL}/api/kyaani/office/bots`, { cache: 'no-store' })
    if (!res.ok) return cachedBots ?? []
    const body = (await res.json()) as { bots?: OfficeBot[] }
    cachedBots = sortOfficeBots(Array.isArray(body.bots) ? body.bots : [])
    cachedAt = now
    return cachedBots
  } catch {
    return cachedBots ?? []
  }
}

function officeProfileName(id: string): string {
  return `office:${id}`
}

/** Hermes profile on disk / gateway (`hermes profile create office-<id>`). */
function diskProfileName(id: string): string {
  return `office-${String(id).trim().toLowerCase()}`
}

function planBotUiMeta(bot: OfficeBot, options?: { officePlan?: boolean }): Record<string, unknown> {
  const section = departmentSectionMeta(bot.departmentId, bot.department)
  // Never mark as officePlan in Desktop — that path opens a browser tab, not Bot Chat.
  const officePlan = options?.officePlan ?? false
  return {
    'hermes-bots': {
      title: bot.name,
      officePlan,
      officePlanId: bot.id,
      department: section.sectionName,
      sectionId: section.sectionId,
      sectionName: section.sectionName,
    },
  }
}

function planBotSortKey(bot: OfficeBot): string {
  const section = departmentSectionMeta(bot.departmentId, bot.department)
  return `${section.sectionName}\0${bot.name}\0${bot.id}`
}

function sortOfficeBots(bots: OfficeBot[]): OfficeBot[] {
  return [...bots].sort((a, b) =>
    planBotSortKey(a).localeCompare(planBotSortKey(b), 'en', { sensitivity: 'base' }),
  )
}

function departmentSortLabel(dept: { id?: string; name?: string }): string {
  const id =
    String(dept.id ?? '').trim() ||
    String(dept.name ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
  return DEPT_LABEL[id] ?? String(dept.name ?? id)
}

function botFromPlanRow(
  dept: { id?: string; name?: string },
  agent: Record<string, unknown>,
): OfficeBot | null {
  const id = String(agent.id ?? '').trim()
  if (!id) return null
  const departmentId =
    String(dept.id ?? '').trim() ||
    String(dept.name ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
  const department = departmentSortLabel(dept)
  return {
    id,
    name: String(agent.name ?? id),
    role: String(agent.role ?? 'agent'),
    departmentId,
    department,
    doing: String(agent.doing ?? ''),
    model: String(agent.model ?? ''),
  }
}

function planBotForProfileName(name: string): OfficeBot | undefined {
  const n = String(name ?? '').trim()
  let id = ''
  if (n.startsWith('office-')) id = n.slice('office-'.length)
  else if (n.startsWith('office:')) id = n.slice('office:'.length)
  else return undefined
  return cachedBots?.find((b) => b.id === id)
}

function enrichWithPlanMeta(row: ProfileRow, bot: OfficeBot): ProfileRow {
  const prevMeta = (row.ui_meta as Record<string, unknown> | undefined) ?? {}
  const prevBots = (prevMeta['hermes-bots'] as Record<string, unknown> | undefined) ?? {}
  const planBots = planBotUiMeta(bot)['hermes-bots'] as Record<string, unknown>
  return {
    ...row,
    display_name: bot.name,
    title: bot.name,
    description: row.description ?? '',
    model: row.model ?? bot.model,
    role: row.role ?? bot.role,
    ui_meta: {
      ...prevMeta,
      'hermes-bots': {
        ...prevBots,
        ...planBots,
        officePlanId: bot.id,
      },
    },
  }
}

function planRowIndex(profiles: ProfileRow[], bot: OfficeBot): number {
  const disk = diskProfileName(bot.id)
  const alias = officeProfileName(bot.id)
  return profiles.findIndex((r) => {
    const n = String(r.name ?? '')
    return n === disk || n === alias || n === bot.id
  })
}

/** Tag gateway profiles that belong to the company plan (keep real `office-<id>` names). */
function normalizePlanProfileRows(profiles: ProfileRow[]): ProfileRow[] {
  const bots = cachedBots ?? []
  if (!bots.length) return profiles

  const byId = new Map(bots.map((b) => [b.id, b]))
  return profiles.map((row) => {
    const name = String(row.name ?? '')
    let botId = ''
    if (name.startsWith('office:')) botId = name.slice('office:'.length)
    else if (name.startsWith('office-')) botId = name.slice('office-'.length)
    else if (byId.has(name)) botId = name
    const bot = botId ? byId.get(botId) : undefined
    if (!bot) return row
    return enrichWithPlanMeta(row, bot)
  })
}

/** Gateway/plan placeholders with no disk path — Desktop “Could not open … chat”. */
function inferGatewayHermesHome(profiles: ProfileRow[]): string {
  const fromEnv = (process.env.KYAANI_HERMES_REMOTE_HOME ?? process.env.HERMES_HOME ?? '').trim()
  if (fromEnv) return fromEnv.replace(/\/+$/, '')
  for (const row of profiles) {
    const p = String(row.path ?? '')
    const m = p.match(/^(.+)\/profiles\/office-[a-z0-9_-]+$/i)
    if (m?.[1]) return m[1]
    const m2 = p.match(/^(.+)\/profiles\/default$/i)
    if (m2?.[1]) return m2[1]
  }
  return ''
}

function gatewayProfilePath(home: string, profileName: string): string {
  if (!home) return ''
  return `${home.replace(/\/+$/, '')}/profiles/${profileName}`
}

function isOfficeProfileRow(row: ProfileRow): boolean {
  const n = String(row.name ?? '')
  if (n.startsWith('office-') || n.startsWith('office:')) return true
  const meta = (row.ui_meta as Record<string, unknown> | undefined)?.['hermes-bots'] as
    | { officePlan?: boolean; officePlanId?: string }
    | undefined
  if (meta?.officePlanId) return true
  if (meta?.officePlan === true) return true
  return false
}

function isGhostRosterRow(row: ProfileRow, planIds: Set<string>): boolean {
  const path = String(row.path ?? '').trim()
  if (path) return false
  const n = String(row.name ?? '')
  const botsMeta = (row.ui_meta as Record<string, unknown> | undefined)?.['hermes-bots'] as
    | { officePlan?: boolean }
    | undefined
  if (botsMeta?.officePlan === true) return true
  if (n.startsWith('office:')) return true
  if (planIds.has(n)) return true
  return false
}

function mergeProfiles(profiles: ProfileRow[]): ProfileRow[] {
  const bots = cachedBots ?? []
  if (!bots.length) {
    return profiles.filter((row) => !isOfficeProfileRow(row))
  }
  const planIds = new Set(bots.map((b) => String(b.id || '').trim()).filter(Boolean))
  let out = normalizePlanProfileRows(
    profiles.filter((row) => {
      if (isGhostRosterRow(row, planIds)) return false
      if (isOfficeProfileRow(row) && !planIds.has(String(row.name ?? '').replace(/^office[-:]/, ''))) {
        const n = String(row.name ?? '')
        const id = n.startsWith('office-') ? n.slice('office-'.length) : n.startsWith('office:') ? n.slice('office:'.length) : ''
        if (id && !planIds.has(id)) return false
      }
      return true
    }),
  )
  const diskNames = new Set(bots.map((b) => diskProfileName(b.id)))

  const gatewayHome = inferGatewayHermesHome(out)

  for (const bot of bots) {
    if (!bot.id) continue
    const idx = planRowIndex(out, bot)
    if (idx >= 0) {
      out[idx] = enrichWithPlanMeta(out[idx]!, bot)
      continue
    }
    const disk = diskProfileName(bot.id)
    const path = gatewayProfilePath(gatewayHome, disk)
    if (!path) continue
    out.push({
      name: disk,
      path,
      is_default: false,
      model: bot.model,
      provider: '',
      description: '',
      display_name: bot.name,
      skill_count: 0,
      previous_names: [],
      role: bot.role,
      ui_meta: planBotUiMeta(bot),
      has_avatar: false,
    })
  }

  // Prefer real `office-<id>` rows — drop ghost `office:<id>` duplicates (no path → chat fails).
  out = out.filter((row) => {
    const n = String(row.name ?? '')
    if (!isGhostRosterRow(row, planIds)) {
      if (!n.startsWith('office:')) return true
      const id = n.slice('office:'.length)
      return !diskNames.has(diskProfileName(id))
    }
    return false
  })

  out.sort((a, b) => {
    const na = String(a.name ?? '')
    const nb = String(b.name ?? '')
    if (na === 'default') return -1
    if (nb === 'default') return 1
    const ba =
      planBotForProfileName(na) ??
      cachedBots?.find((x) => diskProfileName(x.id) === na || officeProfileName(x.id) === na)
    const bb =
      planBotForProfileName(nb) ??
      cachedBots?.find((x) => diskProfileName(x.id) === nb || officeProfileName(x.id) === nb)
    if (ba && bb) return planBotSortKey(ba).localeCompare(planBotSortKey(bb), 'en', { sensitivity: 'base' })
    if (ba && !bb) return 1
    if (bb && !ba) return -1
    return na.localeCompare(nb, 'en', { sensitivity: 'base' })
  })

  return out
}

async function patchJsonText(text: string): Promise<string> {
  await loadOfficeBots()
  try {
    const msg = JSON.parse(text) as {
      result?: { profiles?: ProfileRow[] }
      profiles?: ProfileRow[]
    }
    if (msg.result?.profiles && Array.isArray(msg.result.profiles)) {
      const before = msg.result.profiles.length
      msg.result.profiles = mergeProfiles(msg.result.profiles)
      if (msg.result.profiles.length > before) {
        console.log(`[kyaani] profiles.list merged: ${before} → ${msg.result.profiles.length}`)
      }
      return JSON.stringify(msg)
    }
    if (Array.isArray(msg.profiles)) {
      return JSON.stringify({ ...msg, profiles: mergeProfiles(msg.profiles) })
    }
  } catch {
    /* not JSON-RPC */
  }
  return text
}

function upstreamRequest(
  req: IncomingMessage,
  res: ServerResponse,
  body?: Buffer,
) {
  const url = new URL(req.url ?? '/', UPSTREAM)
  const isHttps = url.protocol === 'https:'
  const lib = isHttps ? httpsRequest : httpRequest
  const headers: Record<string, string | string[] | undefined> = { ...req.headers, host: url.host }
  delete headers['proxy-connection']

  const up = lib(
    {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: req.method,
      headers,
    },
    (upRes) => {
      const chunks: Buffer[] = []
      upRes.on('data', (c) => chunks.push(c as Buffer))
      upRes.on('end', async () => {
        await loadOfficeBots()
        let payload = Buffer.concat(chunks)
        const ctype = String(upRes.headers['content-type'] ?? '')
        const path = url.pathname
        if (
          payload.length &&
          ctype.includes('json') &&
          (path === '/api/profiles' || path.startsWith('/api/jsonrpc'))
        ) {
          const patched = await patchJsonText(payload.toString('utf8'))
          payload = Buffer.from(patched, 'utf8')
          const hdrs = { ...upRes.headers }
          delete hdrs['content-length']
          hdrs['x-kyaani-bots-proxy'] = '1'
          res.writeHead(upRes.statusCode ?? 502, hdrs)
          res.end(payload)
          return
        }
        const hdrs = { ...upRes.headers, 'x-kyaani-bots-proxy': '1' }
        delete hdrs['content-length']
        res.writeHead(upRes.statusCode ?? 502, hdrs)
        res.end(payload)
      })
    },
  )
  up.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'text/plain' })
    res.end(`Upstream error: ${err.message}`)
  })
  if (body?.length) up.write(body)
  up.end()
}

const server = createServer((req, res) => {
  const pathOnly = (req.url ?? '/').split('?')[0] ?? '/'
  if (pathOnly === '/kyaani-bots-proxy-health') {
    res.writeHead(200, {
      'content-type': 'application/json',
      'x-kyaani-bots-proxy': '1',
    })
    res.end(JSON.stringify({ ok: true, port: FRONT_PORT, upstream: UPSTREAM }))
    return
  }
  if (pathOnly === '/kyaani-bots-proxy-refresh' && req.method === 'POST') {
    invalidateOfficeBotsCache()
    void loadOfficeBots().then((bots) => {
      console.log(`[kyaani] plan cache refreshed (${bots.length} office bots)`)
    })
    res.writeHead(200, {
      'content-type': 'application/json',
      'x-kyaani-bots-proxy': '1',
    })
    res.end(JSON.stringify({ ok: true, bots: cachedBots?.length ?? 0 }))
    return
  }

  const chunks: Buffer[] = []
  req.on('data', (c) => chunks.push(c as Buffer))
  req.on('end', () => {
    void loadOfficeBots().then(() => upstreamRequest(req, res, Buffer.concat(chunks)))
  })
})

const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (client) => {
    void loadOfficeBots().then(() => {
      const wsUrl = UPSTREAM.replace(/^http/, 'ws') + (req.url ?? '/')
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined) continue
        headers[k] = Array.isArray(v) ? v.join(', ') : v
      }
      const upstream = new WebSocket(wsUrl, { headers })

      const closeBoth = () => {
        try {
          client.close()
        } catch {
          /* ignore */
        }
        try {
          upstream.close()
        } catch {
          /* ignore */
        }
      }

      client.on('close', closeBoth)
      upstream.on('close', closeBoth)
      client.on('error', closeBoth)
      upstream.on('error', closeBoth)

      upstream.on('open', () => {
        client.on('message', (data, isBinary) => {
          if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary })
        })
      })

      upstream.on('message', (data, isBinary) => {
        if (isBinary) {
          client.send(data, { binary: true })
          return
        }
        const text = data.toString()
        void patchJsonText(text).then((out) => client.send(out))
      })
    })
  })
})

server.listen(FRONT_PORT, '127.0.0.1', () => {
  console.log(`[kyaani] gateway bots proxy 127.0.0.1:${FRONT_PORT} → ${UPSTREAM} (office ${OFFICE_URL})`)
})
