import { useEffect, useState } from 'react'

function detectHermesEmbed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (window.self !== window.top) return true
  } catch {
    return true
  }
  const q = new URLSearchParams(window.location.search)
  return q.get('embed') === 'hermes' || document.documentElement.dataset.embed === 'hermes'
}

export function useHermesEmbed() {
  const [embedded, setEmbedded] = useState(detectHermesEmbed)

  useEffect(() => {
    setEmbedded(detectHermesEmbed())
  }, [])

  return embedded
}

export function useAgentDeepLink(onAgent: (id: string) => void) {
  useEffect(() => {
    const apply = () => {
      const id = new URLSearchParams(window.location.search).get('agent')?.trim()
      if (id) onAgent(id)
    }
    apply()
    const onMessage = (ev: MessageEvent) => {
      const data = ev.data as { type?: string; id?: string } | null
      if (data?.type === 'kyaani-office-focus-agent' && data.id) {
        onAgent(String(data.id).trim())
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onAgent])
}
