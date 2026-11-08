import { useState } from 'react'
import type { CompanyAgent } from '../types'

type Msg = { role: 'user' | 'assistant'; content: string }

type Props = {
  agent: CompanyAgent
  departmentName: string
  onClose: () => void
  onSend: (
    text: string,
    history: { role: string; content: string }[],
  ) => Promise<{ ok: true; reply: string } | { ok: false; error: string }>
}

export default function AgentChat({ agent, departmentName, onClose, onSend }: Props) {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Msg[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setErr(null)
    const next = [...messages, { role: 'user' as const, content: text }]
    setMessages(next)
    setBusy(true)
    const res = await onSend(
      text,
      messages.map((m) => ({ role: m.role, content: m.content })),
    )
    setBusy(false)
    if (!res.ok) {
      setErr(res.error)
      return
    }
    setMessages([...next, { role: 'assistant', content: res.reply }])
  }

  return (
    <div className="vo-chat-backdrop" role="dialog" aria-label={`Chat with ${agent.name}`}>
      <div className="vo-chat">
        <header>
          <div>
            <strong>{agent.name}</strong>
            <span>{departmentName} · {agent.role}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close chat">
            ×
          </button>
        </header>
        <ul className="vo-chat-msgs">
          {messages.length === 0 && (
            <li className="muted">Assign a task — replies go through Qwen (8790).</li>
          )}
          {messages.map((m, i) => (
            <li key={i} className={m.role}>
              {m.content}
            </li>
          ))}
          {busy && <li className="muted">Qwen…</li>}
        </ul>
        {err && <p className="vo-alert vo-alert--err">{err}</p>}
        <form onSubmit={(ev) => void submit(ev)}>
          <textarea
            value={input}
            onChange={(ev) => setInput(ev.target.value)}
            placeholder="Describe the work for this agent…"
            rows={3}
            disabled={busy}
          />
          <button type="submit" disabled={busy || !input.trim()}>
            {busy ? 'Qwen' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  )
}
