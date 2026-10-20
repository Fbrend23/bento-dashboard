import type { ContainerAction, ContainerActionResult } from '@shared/actions'
import {
  AGENT_ACTION_PATH,
  AGENT_HEADER,
  AGENT_HEADER_VALUE,
  AGENT_HISTORY_PATH,
  AGENT_STATUS_PATH,
  type AgentActionRequest,
  type AgentStatus
} from '@shared/agent'
import { isHistoryRange, type HistoryRange, type HistoryResult } from '@shared/history'

export type StatusResult = { ok: true; status: AgentStatus } | { ok: false; error: string }

export type HistoryReply = { ok: true; result: HistoryResult } | { ok: false; error: string }

export interface HistoryApi {
  getHistory(range: HistoryRange): Promise<HistoryReply>
}

export interface AgentApi {
  getStatus(): Promise<StatusResult>
  runAction(action: ContainerAction, container: string): Promise<ContainerActionResult>
}

const UNREACHABLE = 'Bento est injoignable.'
const FORBIDDEN = "Ce téléphone n'est pas autorisé à utiliser l'agent."
const UNEXPECTED = "Réponse inattendue de l'agent."

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown
  } catch {
    return null
  }
}

const errorOf = (body: unknown, fallback: string): string =>
  isRecord(body) && typeof body.error === 'string' && body.error !== '' ? body.error : fallback

function isAgentStatus(value: unknown): value is AgentStatus {
  return (
    isRecord(value) &&
    typeof value.updatedAt === 'number' &&
    Array.isArray(value.services) &&
    isRecord(value.stackLabels) &&
    isRecord(value.metrics)
  )
}

function isHistoryResult(value: unknown): value is HistoryResult {
  return (
    isRecord(value) &&
    isHistoryRange(value.range) &&
    typeof value.now === 'number' &&
    Array.isArray(value.points) &&
    value.points.every((point) => isRecord(point) && typeof point.t === 'number') &&
    Array.isArray(value.incidents) &&
    value.incidents.every(
      (incident) =>
        isRecord(incident) &&
        typeof incident.key === 'string' &&
        typeof incident.kind === 'string' &&
        typeof incident.subject === 'string' &&
        typeof incident.startedAt === 'number'
    )
  )
}

/**
 * The page's only door to bento: two same-origin requests to the agent that served it. The
 * confirmation for stop and restart happens in the page, before `runAction` is called.
 */
export function createAgentApi(fetchFn: typeof fetch): AgentApi & HistoryApi {
  return {
    async getStatus() {
      let response: Response
      try {
        response = await fetchFn(AGENT_STATUS_PATH, {
          cache: 'no-store',
          credentials: 'same-origin'
        })
      } catch {
        return { ok: false, error: UNREACHABLE }
      }
      if (response.status === 403) return { ok: false, error: FORBIDDEN }
      const body = await readJson(response)
      if (response.status === 502) {
        return { ok: false, error: errorOf(body, 'Lecture de bento impossible.') }
      }
      if (!response.ok || !isAgentStatus(body)) return { ok: false, error: UNEXPECTED }
      return { ok: true, status: body }
    },

    async getHistory(range) {
      let response: Response
      try {
        response = await fetchFn(`${AGENT_HISTORY_PATH}?range=${range}`, {
          cache: 'no-store',
          credentials: 'same-origin'
        })
      } catch {
        return { ok: false, error: UNREACHABLE }
      }
      if (response.status === 403) return { ok: false, error: FORBIDDEN }
      const body = await readJson(response)
      if (!response.ok) return { ok: false, error: errorOf(body, UNEXPECTED) }
      if (!isHistoryResult(body)) return { ok: false, error: UNEXPECTED }
      return { ok: true, result: body }
    },

    async runAction(action, container) {
      const request: AgentActionRequest = { action, container }
      let response: Response
      try {
        response = await fetchFn(AGENT_ACTION_PATH, {
          method: 'POST',
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', [AGENT_HEADER]: AGENT_HEADER_VALUE },
          body: JSON.stringify(request)
        })
      } catch {
        return { ok: false, error: UNREACHABLE }
      }
      if (response.status === 403) return { ok: false, error: FORBIDDEN }
      const body = await readJson(response)
      if (response.ok && isRecord(body)) {
        if (body.ok === true) return { ok: true }
        if (body.ok === false && typeof body.error === 'string') {
          return { ok: false, error: body.error }
        }
      }
      return { ok: false, error: response.ok ? UNEXPECTED : errorOf(body, UNEXPECTED) }
    }
  }
}
