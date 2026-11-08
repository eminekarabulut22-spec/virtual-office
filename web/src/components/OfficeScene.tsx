import { useEffect, useRef } from 'react'
import { createCompanyFloor, planStructureKey, type CompanyFloor } from '../scene/company-floor'
import type { CompanyOffice } from '../types'
import '../scene/office-floor.css'

type Props = {
  plan: CompanyOffice
  selectedAgentId: string | null
  selectedDepartmentId?: string | null
  onSelectAgent: (id: string) => void
  onSelectDepartment?: (id: string | null) => void
  onSelectBrain?: () => void
}

/** Isometric 3D floor — glowing brain hub + department platforms (infra-doc). */
export default function OfficeScene({
  plan,
  selectedDepartmentId,
  onSelectAgent,
  onSelectDepartment,
  onSelectBrain,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const labelRef = useRef<HTMLDivElement>(null)
  const floorRef = useRef<CompanyFloor | null>(null)
  const structureKeyRef = useRef('')
  const hooksRef = useRef({ onSelectAgent, onSelectDepartment, onSelectBrain })
  hooksRef.current = { onSelectAgent, onSelectDepartment, onSelectBrain }

  useEffect(() => {
    const canvas = canvasRef.current
    const labels = labelRef.current
    if (!canvas || !labels) return

    const floor = createCompanyFloor(canvas, labels, {
      onSelectAgent: (id) => hooksRef.current.onSelectAgent(id),
      onSelectDepartment: (id) => hooksRef.current.onSelectDepartment?.(id ?? null),
      onSelectBrain: () => hooksRef.current.onSelectBrain?.(),
    })
    floorRef.current = floor

    const parent = canvas.parentElement!
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    const sync = () => {
      const w = Math.max(320, parent.clientWidth)
      const h = Math.max(320, parent.clientHeight)
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => floor.resize(w, h), 150)
    }
    const ro = new ResizeObserver(sync)
    ro.observe(parent)
    sync()
    window.addEventListener('resize', sync)

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer)
      window.removeEventListener('resize', sync)
      ro.disconnect()
      floor.dispose()
      floorRef.current = null
    }
  }, [])

  useEffect(() => {
    const structure = planStructureKey(plan)
    const refit = structure !== structureKeyRef.current
    structureKeyRef.current = structure
    floorRef.current?.setPlan(plan, refit)
  }, [plan])

  useEffect(() => {
    floorRef.current?.setSelectedDepartment(selectedDepartmentId ?? null)
  }, [selectedDepartmentId, plan])

  return (
    <section className="vo-scene vo-scene-wrap" aria-label="3D office">
      <div className="co-scene-root co-scene-root--agenten">
        <canvas ref={canvasRef} className="co-canvas" />
        <div ref={labelRef} className="co-labels co-labels--agenten" />
      </div>
    </section>
  )
}
