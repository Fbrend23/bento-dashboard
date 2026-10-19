// Pure helpers to read a raw log line: shared by main and renderer, no I/O. Lines are only ever
// displayed as text.

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

export interface LogLine {
  time?: string
  level: LogLevel | null
  text: string
}

export type LogLevelFilter = 'all' | 'errors' | 'warnings'

/** Maps a level token (`ERR`, `warning`, `INF`…) to a level; null when it is not one. */
export function levelFromToken(token: string): LogLevel | null {
  const value = token.toUpperCase()
  if (/^(ERR|ERROR|FTL|FATAL|CRITICAL)$/.test(value)) return 'error'
  if (/^(WRN|WARN|WARNING)$/.test(value)) return 'warn'
  if (/^(INF|INFO)$/.test(value)) return 'info'
  if (/^(DBG|DEBUG|TRACE)$/.test(value)) return 'debug'
  return null
}

// Jellyfin: `[04:07:36] [WRN] [37] Namespace: message`
const JELLYFIN = /^\[(\d{2}:\d{2}:\d{2}(?:\.\d+)?)\] \[([A-Za-z]{3,8})\] (.*)$/
// Nginx Proxy Manager: `[10/14/2026] [2:01:25 PM] [SSL      ] › ℹ  info      message`
const NGINX =
  /^\[\d{1,2}\/\d{1,2}\/\d{4}\] \[(\d{1,2}:\d{2}:\d{2}(?: [AP]M)?)\] \[([^\]]*)\] › \S+\s+(\w+)\s+(.*)$/
// journalctl -o short-iso: `2026-10-16T02:11:57+02:00 host unit[pid]: message`
const JOURNAL = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})\S* \S+ (.*)$/

const ERROR_WORDS = /\b(?:error|fatal|panic|critical)\b/i
const WARN_WORDS = /\bwarn(?:ing)?\b/i

function levelFromText(text: string): LogLevel | null {
  if (ERROR_WORDS.test(text)) return 'error'
  if (WARN_WORDS.test(text)) return 'warn'
  return null
}

export function parseLogLine(raw: string): LogLine {
  const jellyfin = JELLYFIN.exec(raw)
  if (jellyfin) {
    const level = levelFromToken(jellyfin[2])
    if (level) return { time: jellyfin[1], level, text: jellyfin[3] }
  }

  const nginx = NGINX.exec(raw)
  if (nginx) {
    return {
      time: nginx[1],
      level: levelFromToken(nginx[3]),
      text: `[${nginx[2].trim()}] ${nginx[4]}`
    }
  }

  const journal = JOURNAL.exec(raw)
  if (journal) return { time: journal[1], level: levelFromText(journal[2]), text: journal[2] }

  return { level: levelFromText(raw), text: raw }
}

export function filterLogLines(
  lines: readonly string[],
  query: string,
  level: LogLevelFilter
): string[] {
  const needle = query.trim().toLowerCase()
  return lines.filter((line) => {
    if (needle !== '' && !line.toLowerCase().includes(needle)) return false
    if (level === 'all') return true
    const found = parseLogLine(line).level
    return found === 'error' || (level === 'warnings' && found === 'warn')
  })
}

export function countByLevel(lines: readonly string[]): Record<LogLevel | 'none', number> {
  const counts = { error: 0, warn: 0, info: 0, debug: 0, none: 0 }
  for (const line of lines) counts[parseLogLine(line).level ?? 'none']++
  return counts
}
