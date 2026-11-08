import type { CompanyOffice, WorkStatus } from '../types'
import { STATUS_VIEW } from './floor-plan'

const DEPT_ACCENT: Record<string, string> = {
  knowledge: '#e6c85a',
  engineering: '#5b9fd4',
  executive: '#9aa3ad',
  sales: '#e8a04a',
  marketing: '#c97ad9',
  'customer-support': '#6bcf8a',
  finance: '#7eb8d4',
  legal: '#a890d4',
  hr: '#d4a574',
}

const DEPT_NAMES: Record<string, string> = {
  knowledge: 'Knowledge',
  engineering: 'Engineering',
  executive: 'Executive',
  sales: 'Sales',
  marketing: 'Marketing',
  'customer-support': 'Customer Support',
}

export function departmentDisplayName(departmentId: string, fallbackName: string): string {
  return DEPT_NAMES[departmentId] ?? fallbackName
}

export type DepartmentDashboard = {
  id: string
  name: string
  accent: string
}

export function departmentDashboard(plan: CompanyOffice, departmentId: string): DepartmentDashboard | null {
  const dept = plan.departments.find((d) => d.id === departmentId)
  if (!dept) return null
  return {
    id: dept.id,
    name: dept.name,
    accent: DEPT_ACCENT[departmentId] ?? '#8aa0b2',
  }
}

export { STATUS_VIEW }
export type { WorkStatus }
