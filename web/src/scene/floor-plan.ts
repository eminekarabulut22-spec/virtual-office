/** 3D floor layout — Virtual Office (radial ring + brain hub). */

import type { CompanyAgent, CompanyDepartment, CompanyOffice, WorkStatus } from '../types'

export const KNOWLEDGE_DEPARTMENT_ID = 'knowledge'
export const MAX_AGENTS_PER_DEPT_TILE = 6

export const STATUS_VIEW: Record<WorkStatus, { label: string; color: string; hex: number }> = {
  working: { label: 'working', color: '#3dbe7a', hex: 0x3dbe7a },
  waiting: { label: 'waiting', color: '#e6b15a', hex: 0xe6b15a },
  problem: { label: 'problem', color: '#e25b56', hex: 0xe25b56 },
  idle: { label: 'idle', color: '#8aa0b2', hex: 0x8aa0b2 },
  offline: { label: 'offline', color: '#5c6b76', hex: 0x5c6b76 },
}

export type DeskPlacement = { agent: CompanyAgent; x: number; z: number; yaw: number }

export type RoomPlacement = {
  department: CompanyDepartment
  roomKey: string
  partIndex: number
  partCount: number
  x: number
  z: number
  w: number
  d: number
  desks: DeskPlacement[]
}

export type FloorLayout = { rooms: RoomPlacement[]; width: number; depth: number }

const ROOM_W = 11
const RING_GAP = 2.6
const SPLIT_R_STEP = ROOM_W * 0.38
const DESK_PITCH = 3.4
const DESK_COL_SPAN = 2.75

function roomDepth(agentCount: number): number {
  const n = Math.max(agentCount, 1)
  const rows = n <= 1 ? 1 : Math.ceil(n / 2)
  return Math.max(7.5, (rows - 1) * DESK_PITCH + 5.2)
}

function sortedDepartments(plan: CompanyOffice): CompanyDepartment[] {
  return [...plan.departments]
    .map((d) => ({
      ...d,
      agents: [...d.agents].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })),
    }))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) ||
        a.id.localeCompare(b.id, 'en'),
    )
}

function chunkAgents<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export function layoutOfficeRadial(plan: CompanyOffice): FloorLayout {
  const orderedDepts = sortedDepartments(plan)
  const deptCount = orderedDepts.length
  if (!deptCount) return { rooms: [], width: 24, depth: 24 }

  type RoomSpec = {
    department: CompanyDepartment
    roomKey: string
    partIndex: number
    partCount: number
    ringIndex: number
    w: number
    d: number
    desks: DeskPlacement[]
  }

  const specs: RoomSpec[] = []
  for (let deptSlot = 0; deptSlot < orderedDepts.length; deptSlot++) {
    const source = orderedDepts[deptSlot]!
    const chunks = chunkAgents(source.agents, MAX_AGENTS_PER_DEPT_TILE)
    const partCount = Math.max(chunks.length, 1)
    const parts = chunks.length ? chunks : [[] as CompanyAgent[]]

    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      const agents = parts[partIndex]!
      const deskCols = agents.length <= 1 ? 1 : agents.length <= 3 ? agents.length : agents.length <= 4 ? 2 : 3
      const deskRows = Math.ceil(agents.length / deskCols) || 1
      const desks: DeskPlacement[] = agents.map((agent, s) => {
        const col = s % deskCols
        const row = Math.floor(s / deskCols)
        const xOff = deskCols === 1 ? 0 : (col - (deskCols - 1) / 2) * DESK_COL_SPAN
        const zSpan = (deskRows - 1) * DESK_PITCH
        const zOff = row * DESK_PITCH - zSpan / 2
        return { agent, x: xOff, z: zOff, yaw: 0 }
      })
      specs.push({
        department: { id: source.id, name: source.name, agents },
        roomKey: `${source.id}:${partIndex}`,
        partIndex,
        partCount,
        ringIndex: deptSlot,
        w: ROOM_W,
        d: roomDepth(Math.max(agents.length, 1)),
        desks,
      })
    }
  }

  const ringR =
    deptCount <= 1 ? 0 : (ROOM_W + RING_GAP) / (2 * Math.sin(Math.PI / deptCount))
  const ringRadius = Math.max(8, ringR)

  const rooms: RoomPlacement[] = specs.map((spec) => {
    const angle = (spec.ringIndex / deptCount) * Math.PI * 2 - Math.PI / 2
    const r = ringRadius + spec.partIndex * SPLIT_R_STEP
    const cx = Math.cos(angle) * r
    const cz = Math.sin(angle) * r
    const yawBase = Math.PI + angle
    const desks = spec.desks.map((d) => ({
      ...d,
      x: cx + d.x,
      z: cz + d.z,
      yaw: yawBase,
    }))
    return {
      department: spec.department,
      roomKey: spec.roomKey,
      partIndex: spec.partIndex,
      partCount: spec.partCount,
      x: cx,
      z: cz,
      w: spec.w,
      d: spec.d,
      desks,
    }
  })

  const maxDepth = Math.max(...rooms.map((r) => r.d), ROOM_W)
  const outer = ringRadius + SPLIT_R_STEP * 2 + maxDepth / 2
  const span = outer * 2 + 10
  return { rooms, width: span, depth: span }
}

export function columnCount(rooms: number, aspect: number, prevCols = 0): number {
  if (rooms <= 1) return 1
  const narrow = prevCols <= 1 ? aspect < 0.92 : aspect < 0.8
  if (narrow) return 1
  const twoCol = prevCols === 2 ? aspect < 1.34 : aspect < 1.16
  if (twoCol) return Math.min(2, rooms)
  return Math.max(1, Math.min(rooms, Math.ceil(Math.sqrt(rooms))))
}
