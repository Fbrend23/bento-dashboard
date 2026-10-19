import type { Settings } from '@shared/settings'
import type { BentoStatus, ServiceStatus } from '@shared/monitors'
import { formatPercent, translateServiceDetail } from '@shared/format'
import { inQuietHours } from './quiet-hours'

export interface AppNotification {
  /** Stable per problem, e.g. "down:jellyfin"; useful to replace an earlier toast. */
  id: string
  title: string
  body: string
}

/** A brief drop of the connection is normal; only a lasting one deserves a notification. */
export const UNREACHABLE_GRACE_MS = 60_000

const isDown = (s: ServiceStatus): boolean => s.level === 'down' || s.level === 'absent'
const isActive = (s: ServiceStatus): boolean => s.level === 'ok' || s.level === 'degraded'

/** Only a failing healthcheck counts; "starting" and systemd "activating" are transient. */
const isUnhealthy = (s: ServiceStatus): boolean =>
  s.kind === 'container' && s.level === 'degraded' && s.detail.includes('(unhealthy)')

/** French decimals, two digits: 9.5 becomes "9,50". */
const decimal = (value: number): string => value.toFixed(2).replace('.', ',')

type Resource = 'cpu' | 'memory' | 'load'

interface ResourceTexts {
  title: string
  body(value: number, threshold: number, samples: number): string
  recoveryTitle: string
  recoveryBody(value: number): string
}

const RESOURCES: Record<Resource, ResourceTexts> = {
  cpu: {
    title: 'Processeur très sollicité',
    body: (value, threshold, samples) =>
      `${formatPercent(value)} sur les ${samples} derniers relevés, seuil d'alerte à ${formatPercent(threshold)}.`,
    recoveryTitle: 'Processeur revenu à la normale',
    recoveryBody: (value) => `${formatPercent(value)} actuellement.`
  },
  memory: {
    title: 'Mémoire presque pleine',
    body: (value, threshold, samples) =>
      `${formatPercent(value)} sur les ${samples} derniers relevés, seuil d'alerte à ${formatPercent(threshold)}.`,
    recoveryTitle: 'Mémoire revenue à la normale',
    recoveryBody: (value) => `${formatPercent(value)} actuellement.`
  },
  load: {
    title: 'Charge élevée',
    body: (value, threshold) =>
      `Charge de ${decimal(value)} sur 1 minute, seuil d'alerte à ${threshold}.`,
    recoveryTitle: 'Charge revenue à la normale',
    recoveryBody: (value) => `Charge de ${decimal(value)} sur 1 minute.`
  }
}

interface Streak {
  count: number
  /** `updatedAt` of the last reading counted: the notifier also ticks between two polls. */
  lastReading: number | null
}

/**
 * Turns the stream of statuses into notifications: one per problem, nothing repeated while the
 * problem lasts, a new one if it recovers and comes back, and (optionally) one when a notified
 * problem is over. A problem that only started during the quiet hours is held back and delivered
 * when they end, if it is still there; one that fixed itself meanwhile is never mentioned.
 * A container that is already unhealthy at the first look does not notify (changes only).
 */
export class NotificationTracker {
  private offlineSince: number | null = null
  private unreachableNotified = false
  private down = new Set<string>()
  private unhealthy = new Set<string>()
  private fullDisks = new Set<string>()
  private streaks = new Map<Resource, Streak>()
  /** True once the first real data was seen: what was already unhealthy then is not news. */
  private baselined = false
  /** Service id -> time until which its "down" notification is held back. */
  private suppressed = new Map<string, number>()

  /** Problems that were announced (or are held for the end of the quiet hours). */
  private open = new Set<string>()
  private deferred = new Map<string, AppNotification>()

  // Context of the update in progress.
  private out: AppNotification[] = []
  private quiet = false
  private recovery = true

  /**
   * Holds back the "down" notification of a service until `until` (ms since epoch): used while we
   * stop or restart it ourselves. If it is still down afterwards, the notification fires as usual.
   */
  suppress(serviceId: string, until: number): void {
    this.suppressed.set(serviceId, until)
  }

  update(status: BentoStatus, settings: Settings, now: number): AppNotification[] {
    if (!status.configured) {
      this.reset()
      return []
    }

    this.out = []
    this.quiet = settings.quietHoursEnabled
      ? inQuietHours(now, settings.quietHoursStart, settings.quietHoursEnd)
      : false
    this.recovery = settings.notifyRecovery

    if (status.connection !== 'online') {
      this.streaks.clear()
      this.checkReachability(now)
    } else {
      this.resolveReachability()
      this.checkServices(status.services, settings.notifyUnhealthy, now)
      this.checkDisks(status)
      this.checkResources(status, settings)
    }
    return this.finish()
  }

  /** What was held for the quiet hours and is still relevant comes first, in order of arrival. */
  private finish(): AppNotification[] {
    const late = this.quiet ? [] : [...this.deferred.values()]
    if (!this.quiet) this.deferred.clear()
    return [...late, ...this.out]
  }

  private reset(): void {
    this.offlineSince = null
    this.unreachableNotified = false
    this.down.clear()
    this.unhealthy.clear()
    this.fullDisks.clear()
    this.streaks.clear()
    this.open.clear()
    this.deferred.clear()
    this.baselined = false
  }

  /** A problem starts: announce it now, or keep it for the end of the quiet hours. */
  private raise(problem: string, notification: AppNotification): void {
    this.open.add(problem)
    if (this.quiet) this.deferred.set(problem, notification)
    else this.out.push(notification)
  }

  /**
   * A problem ends. If it was never delivered (still held for the quiet hours) there is nothing to
   * recover from; otherwise the recovery is announced when enabled, and never during quiet hours.
   */
  private resolve(problem: string, recovery: AppNotification): void {
    if (!this.open.delete(problem)) return
    if (this.deferred.delete(problem)) return
    if (this.recovery && !this.quiet) this.out.push(recovery)
  }

  /** A problem disappears without being solved (unwatched, stopped on purpose): say nothing. */
  private drop(problem: string): void {
    this.open.delete(problem)
    this.deferred.delete(problem)
  }

  private checkReachability(now: number): void {
    this.offlineSince ??= now
    if (this.unreachableNotified || now - this.offlineSince < UNREACHABLE_GRACE_MS) return
    this.unreachableNotified = true
    this.raise('unreachable', {
      id: 'unreachable',
      title: 'Bento est injoignable',
      body: "Aucune réponse depuis plus d'une minute. Nouvelle tentative automatique."
    })
  }

  private resolveReachability(): void {
    if (this.unreachableNotified) {
      this.resolve('unreachable', {
        id: 'reachable',
        title: 'Bento est de nouveau joignable',
        body: 'La connexion est rétablie.'
      })
    }
    this.offlineSince = null
    this.unreachableNotified = false
  }

  private checkServices(services: ServiceStatus[], notifyUnhealthy: boolean, now: number): void {
    const firstLook = !this.baselined && services.length > 0
    if (firstLook) this.baselined = true
    const present = new Set(services.map((s) => s.id))
    for (const id of [...this.down]) if (!present.has(id)) this.down.delete(id)
    for (const id of [...this.unhealthy]) if (!present.has(id)) this.unhealthy.delete(id)
    for (const problem of [...this.open]) {
      const separator = problem.indexOf(':')
      const kind = problem.slice(0, separator)
      const id = problem.slice(separator + 1)
      if ((kind === 'down' || kind === 'unhealthy') && !present.has(id)) this.drop(problem)
    }

    for (const service of services) {
      this.checkDown(service, now)
      this.checkUnhealthy(service, notifyUnhealthy, firstLook)
    }
  }

  private checkDown(service: ServiceStatus, now: number): void {
    const problem = `down:${service.id}`
    if (isDown(service)) {
      if (!this.down.has(service.id) && !this.isSuppressed(service.id, now)) {
        this.down.add(service.id)
        this.raise(problem, {
          id: problem,
          title:
            service.level === 'absent'
              ? `${service.label} est introuvable`
              : `${service.label} est à l'arrêt`,
          body: `${translateServiceDetail(service.detail)}.`
        })
      }
    } else if (service.level !== 'unknown') {
      this.down.delete(service.id)
      if (isActive(service)) {
        this.resolve(problem, {
          id: `up:${service.id}`,
          title: `${service.label} est de nouveau actif`,
          body: `${translateServiceDetail(service.detail)}.`
        })
      } else {
        // Stopped on purpose (or never running): neither an incident nor a recovery.
        this.drop(problem)
      }
    }
  }

  private checkUnhealthy(
    service: ServiceStatus,
    notifyUnhealthy: boolean,
    firstLook: boolean
  ): void {
    const problem = `unhealthy:${service.id}`
    if (isUnhealthy(service)) {
      if (this.unhealthy.has(service.id)) return
      if (firstLook) {
        // Already unhealthy when we started looking: shown, but not worth a notification.
        this.unhealthy.add(service.id)
      } else if (notifyUnhealthy) {
        this.unhealthy.add(service.id)
        this.raise(problem, {
          id: problem,
          title: `${service.label} ne répond pas bien`,
          body: 'Le contrôle de santé du conteneur échoue.'
        })
      }
    } else if (service.level !== 'unknown') {
      this.unhealthy.delete(service.id)
      this.resolve(problem, {
        id: `healthy:${service.id}`,
        title: `${service.label} répond de nouveau`,
        body: 'Le contrôle de santé du conteneur réussit.'
      })
    }
  }

  private isSuppressed(serviceId: string, now: number): boolean {
    const until = this.suppressed.get(serviceId)
    if (until === undefined) return false
    if (now >= until) {
      this.suppressed.delete(serviceId)
      return false
    }
    return true
  }

  private checkDisks(status: BentoStatus): void {
    if (!status.metrics) return
    const { disks, diskThresholdPercent } = status.metrics
    const present = new Set(disks.map((d) => d.mount))
    for (const mount of [...this.fullDisks]) {
      if (!present.has(mount)) {
        this.fullDisks.delete(mount)
        this.drop(`disk:${mount}`)
      }
    }

    for (const disk of disks) {
      const problem = `disk:${disk.mount}`
      const used = `${formatPercent(disk.usedPercent)} utilisé, seuil d'alerte à ${formatPercent(diskThresholdPercent)}.`
      if (!disk.overThreshold) {
        this.fullDisks.delete(disk.mount)
        this.resolve(problem, {
          id: `disk-ok:${disk.mount}`,
          title: `Disque revenu sous le seuil : ${disk.mount}`,
          body: used
        })
      } else if (!this.fullDisks.has(disk.mount)) {
        this.fullDisks.add(disk.mount)
        this.raise(problem, {
          id: problem,
          title: `Disque presque plein : ${disk.mount}`,
          body: used
        })
      }
    }
  }

  private checkResources(status: BentoStatus, settings: Settings): void {
    const metrics = status.metrics
    const common = { samples: settings.sustainedSamples, reading: status.updatedAt }
    this.checkResource('cpu', metrics?.cpuPercent ?? null, settings.cpuThresholdPercent, {
      ...common,
      enabled: settings.notifyCpu
    })
    this.checkResource(
      'memory',
      metrics?.memoryUsedPercent ?? null,
      settings.memoryThresholdPercent,
      { ...common, enabled: settings.notifyMemory }
    )
    this.checkResource('load', metrics?.load?.load1 ?? null, settings.loadThreshold, {
      ...common,
      enabled: settings.notifyLoad
    })
  }

  /**
   * An overload is a value above the threshold for `samples` distinct consecutive readings, so a
   * single spike (a backup, a scan) never notifies. An unknown value neither counts nor resets.
   */
  private checkResource(
    resource: Resource,
    value: number | null,
    threshold: number,
    options: { enabled: boolean; samples: number; reading: number | null }
  ): void {
    if (!options.enabled) {
      this.streaks.delete(resource)
      this.drop(resource)
      return
    }
    if (value === null) return

    const streak = this.streaks.get(resource) ?? { count: 0, lastReading: null }
    if (options.reading !== null && streak.lastReading === options.reading) return
    streak.lastReading = options.reading
    const texts = RESOURCES[resource]

    if (value > threshold) {
      streak.count += 1
      if (streak.count >= options.samples && !this.open.has(resource)) {
        this.raise(resource, {
          id: resource,
          title: texts.title,
          body: texts.body(value, threshold, options.samples)
        })
      }
    } else {
      streak.count = 0
      this.resolve(resource, {
        id: `${resource}-ok`,
        title: texts.recoveryTitle,
        body: texts.recoveryBody(value)
      })
    }
    this.streaks.set(resource, streak)
  }
}
