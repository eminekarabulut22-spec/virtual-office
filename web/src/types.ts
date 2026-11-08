export type WorkStatus = 'working' | 'waiting' | 'problem' | 'idle' | 'offline'

export type CompanyAgent = {
  id: string
  name: string
  role: string
  status: WorkStatus
  doing: string
  model: string
}

export type CompanyDepartment = {
  id: string
  name: string
  agents: CompanyAgent[]
}

export type CompanyOffice = {
  company: string
  departments: CompanyDepartment[]
  updatedAt: string
  note?: string
}

export type AgentUsage = {
  /** Chat / profile total */
  tokens: number
  profile: string
  stateFound?: boolean
  jobsCompleted: number
  workTokens?: number
  kanban: { done: number; running?: number }
}

export type BotRow = {
  id: string
  name: string
  role: string
  departmentId: string
  department: string
  sectionId: string
  sectionName: string
  status: WorkStatus
  profile: string
}
