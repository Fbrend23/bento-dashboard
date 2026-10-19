// Groups the flat list of services into stacks (docker compose projects) for the dashboard.
// Pure and shared: the status stays a flat list everywhere else (tray, notifications, verdict).

import { stackLabel, webPortLabel, type LabelSettings } from './labels'
import type { ServiceLevel, ServiceStatus } from './monitors'

/** A published tcp port, with the name of the web interface behind it when it is a known one. */
export interface StackLink {
  container: string
  hostPort: number
  label: string | null
}

export interface Stack {
  /** `stack:<project>` for a compose project, `service:<id>` for a lone container or unit. */
  id: string
  label: string
  level: ServiceLevel
  members: ServiceStatus[]
  /** Members that are up (ok or degraded). */
  activeCount: number
  links: StackLink[]
}

/** Higher is worse. `stopped` counts for less than `ok`: it never hides a running container. */
const SEVERITY: Record<ServiceLevel, number> = {
  down: 5,
  absent: 5,
  degraded: 4,
  unknown: 3,
  ok: 2,
  stopped: 1
}

const isActive = (s: ServiceStatus): boolean => s.level === 'ok' || s.level === 'degraded'

function stackLevel(members: ServiceStatus[]): ServiceLevel {
  const worst = members.reduce((a, b) => (SEVERITY[b.level] > SEVERITY[a.level] ? b : a))
  return worst.level === 'absent' ? 'down' : worst.level
}

const byPort = (a: StackLink, b: StackLink): number =>
  a.hostPort - b.hostPort || a.container.localeCompare(b.container)

type PortLabels = Pick<LabelSettings, 'portLabels'>

/** The tcp ports one container publishes, named when the settings name that port. */
export function memberLinks(member: ServiceStatus, labels: PortLabels): StackLink[] {
  return member.ports
    .filter((p) => p.linkable)
    .map((p) => ({
      container: member.id,
      hostPort: p.hostPort,
      label: webPortLabel(p.hostPort, labels)
    }))
    .sort(byPort)
}

function linksOf(members: ServiceStatus[], labels: PortLabels): StackLink[] {
  return members.flatMap((member) => memberLinks(member, labels)).sort(byPort)
}

function toStack(id: string, label: string, members: ServiceStatus[], labels: PortLabels): Stack {
  return {
    id,
    label,
    level: stackLevel(members),
    members,
    activeCount: members.filter(isActive).length,
    links: linksOf(members, labels)
  }
}

export function groupStacks(
  services: ServiceStatus[],
  labels: Pick<LabelSettings, 'stackLabels' | 'portLabels'>
): Stack[] {
  const byProject = new Map<string, ServiceStatus[]>()
  const stacks: Stack[] = []
  for (const service of services) {
    if (service.project === null) {
      stacks.push(toStack(`service:${service.id}`, service.label, [service], labels))
    } else {
      byProject.set(service.project, [...(byProject.get(service.project) ?? []), service])
    }
  }
  for (const [project, members] of byProject) {
    stacks.push(toStack(`stack:${project}`, stackLabel(project, labels), members, labels))
  }
  return stacks.sort(
    (a, b) => SEVERITY[b.level] - SEVERITY[a.level] || a.label.localeCompare(b.label)
  )
}

/** One short line under the name of a stack. */
export function stackSummary(stack: Stack): string {
  const total = stack.members.length
  if (total === 1)
    return stack.level === 'ok' || stack.level === 'degraded' ? 'Actif' : levelWord(stack)
  if (stack.activeCount === 0) return `Aucun actif sur ${total}`
  return `${stack.activeCount} sur ${total} actifs`
}

const levelWord = (stack: Stack): string => {
  switch (stack.level) {
    case 'down':
    case 'absent':
      return 'Arrêté'
    case 'stopped':
      return 'Inactif'
    default:
      return 'Inconnu'
  }
}

/**
 * The one link worth showing on a stack tile: the interface named like the stack, else (for a
 * lone container) its first named port or its first port. Never a guess among a stack's ports.
 */
export function primaryLink(stack: Stack): StackLink | null {
  const named = stack.links.find((l) => l.label === stack.label)
  if (named) return named
  if (stack.members.length === 1) return stack.links.find((l) => l.label) ?? stack.links[0] ?? null
  return stack.links.find((l) => l.label) ?? null
}

/** Problems first, then running containers, then stopped ones; by name inside a group. */
export function sortMembers(members: ServiceStatus[]): ServiceStatus[] {
  return [...members].sort(
    (a, b) => SEVERITY[b.level] - SEVERITY[a.level] || a.label.localeCompare(b.label)
  )
}
