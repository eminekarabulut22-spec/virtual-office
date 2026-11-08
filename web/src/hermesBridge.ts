/** Same contract for every customer: office iframe asks Hermes Desktop to open Bot Chat. */

export type OpenBotChatPayload = {
  type: 'kyaani-office-open-bot-chat'
  agentId: string
  profile: string
}

export function officeProfileName(agentId: string): string {
  return `office-${agentId}`
}

/** Opens the agent in Hermes BOTS → Bot Chat (parent must handle the message). */
export type OfficePlanUpdatedMessage = {
  type: 'kyaani:office-plan-updated'
  updatedAt?: string
}

/** Tell Hermes Desktop plugin to refresh BOTS roster after Update. */
export function notifyHermesPlanUpdated(updatedAt?: string): void {
  const payload: OfficePlanUpdatedMessage = {
    type: 'kyaani:office-plan-updated',
    updatedAt,
  }
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(payload, '*')
  }
}

export function requestHermesBotChat(agentId: string): void {
  const payload: OpenBotChatPayload = {
    type: 'kyaani-office-open-bot-chat',
    agentId,
    profile: officeProfileName(agentId),
  }
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(payload, '*')
    return
  }
  // Standalone office (no Hermes shell): deep-link hint only
  const q = new URLSearchParams(window.location.search)
  q.set('agent', agentId)
  window.history.replaceState(null, '', `${window.location.pathname}?${q}`)
  window.alert(
    `Open Hermes Desktop → BOTS → ${payload.profile} and start Bot Chat. Work and tokens are counted there.`,
  )
}
