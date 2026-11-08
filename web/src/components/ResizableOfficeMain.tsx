import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

const STORAGE_KEY = 'kyaani-vo-panel-widths-v1'

const LIMITS = {
  left: { min: 160, max: 420, default: 220, embedDefault: 240 },
  right: { min: 200, max: 480, default: 300, embedDefault: 300 },
  centerMin: 200,
} as const

type Widths = { left: number; right: number }

function loadWidths(embedded: boolean): Widths {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<Widths>
      if (typeof p.left === 'number' && typeof p.right === 'number') {
        return {
          left: clamp(p.left, LIMITS.left.min, LIMITS.left.max),
          right: clamp(p.right, LIMITS.right.min, LIMITS.right.max),
        }
      }
    }
  } catch {
    /* ignore */
  }
  return {
    left: embedded ? LIMITS.left.embedDefault : LIMITS.left.default,
    right: embedded ? LIMITS.right.embedDefault : LIMITS.right.default,
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

type Props = {
  embedded?: boolean
  left: ReactNode
  center: ReactNode
  right: ReactNode
}

export default function ResizableOfficeMain({ embedded = false, left, center, right }: Props) {
  const [widths, setWidths] = useState<Widths>(() => loadWidths(embedded))
  const mainRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ edge: 'left' | 'right'; startX: number; startLeft: number; startRight: number } | null>(
    null,
  )

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(widths))
    } catch {
      /* ignore */
    }
  }, [widths])

  const onPointerMove = useCallback((ev: PointerEvent) => {
    const d = dragRef.current
    const el = mainRef.current
    if (!d || !el) return
    const dx = ev.clientX - d.startX
    const total = el.clientWidth
    const handleW = 12
    const maxLeft = total - d.startRight - LIMITS.centerMin - handleW * 2
    const maxRight = total - d.startLeft - LIMITS.centerMin - handleW * 2

    if (d.edge === 'left') {
      const next = clamp(d.startLeft + dx, LIMITS.left.min, Math.min(LIMITS.left.max, maxLeft))
      setWidths((w) => ({ ...w, left: next }))
    } else {
      const next = clamp(d.startRight - dx, LIMITS.right.min, Math.min(LIMITS.right.max, maxRight))
      setWidths((w) => ({ ...w, right: next }))
    }
  }, [])

  const endDrag = useCallback(() => {
    dragRef.current = null
    document.body.classList.remove('vo-resize-active')
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', endDrag)
    window.removeEventListener('pointercancel', endDrag)
  }, [onPointerMove])

  const startDrag = useCallback(
    (edge: 'left' | 'right', ev: React.PointerEvent<HTMLDivElement>) => {
      ev.preventDefault()
      dragRef.current = {
        edge,
        startX: ev.clientX,
        startLeft: widths.left,
        startRight: widths.right,
      }
      document.body.classList.add('vo-resize-active')
      ev.currentTarget.setPointerCapture(ev.pointerId)
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', endDrag)
      window.addEventListener('pointercancel', endDrag)
    },
    [widths.left, widths.right, onPointerMove, endDrag],
  )

  return (
    <div
      ref={mainRef}
      className={`vo-main vo-main--resizable${embedded ? ' vo-main--embed' : ''}`}
      style={
        {
          '--vo-panel-left': `${widths.left}px`,
          '--vo-panel-right': `${widths.right}px`,
        } as React.CSSProperties
      }
    >
      <div className="vo-main-col vo-main-col--left">{left}</div>
      <div
        className="vo-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize left panel"
        onPointerDown={(ev) => startDrag('left', ev)}
      />
      <div className="vo-main-col vo-main-col--center">{center}</div>
      <div
        className="vo-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize right panel"
        onPointerDown={(ev) => startDrag('right', ev)}
      />
      <div className="vo-main-col vo-main-col--right">{right}</div>
    </div>
  )
}
