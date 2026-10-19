<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  actionBusyLabel,
  actionLabel,
  availableActions,
  needsConfirmation,
  type ContainerAction
} from '@shared/actions'
import { confirmationText } from '@shared/confirm-text'
import { formatAge, levelLabel, rowDetail } from '@shared/format'
import type { ServiceStatus } from '@shared/monitors'
import { groupStacks, sortMembers, stackSummary } from '@shared/stacks'
import { createAgentApi } from './api'
import { summarize } from './summary'
import { systemFigures } from './system'
import { useBento } from './use-bento'

const { status, fetchedAt, error, loading, busy, actionError, refresh, run, start, stop } =
  useBento(createAgentApi(window.fetch.bind(window)))

const summary = computed(() => summarize(status.value, error.value))
const stacks = computed(() =>
  status.value
    ? groupStacks(status.value.services, { stackLabels: status.value.stackLabels, portLabels: {} })
    : []
)

const system = computed(() => (status.value ? systemFigures(status.value.metrics) : null))

// Ticks only to keep "il y a 12 s" honest; the data itself is read by useBento.
const now = ref(Date.now())
const age = computed(() => formatAge(fetchedAt.value, now.value))

// A stack opens by itself when something is wrong in it; the reader's own toggles are kept.
const expanded = ref(new Set<string>())
const seen = new Set<string>()
watch(stacks, (list) => {
  for (const stack of list) {
    if (seen.has(stack.id)) continue
    seen.add(stack.id)
    if (stack.level !== 'ok' && stack.level !== 'stopped') expanded.value.add(stack.id)
  }
})
function toggle(id: string): void {
  if (!expanded.value.delete(id)) expanded.value.add(id)
}

const pending = ref<{ action: ContainerAction; service: ServiceStatus } | null>(null)
const pendingText = computed(() =>
  pending.value ? confirmationText(pending.value.action, pending.value.service.label) : null
)

function ask(action: ContainerAction, service: ServiceStatus): void {
  if (busy.value) return
  if (needsConfirmation(action)) pending.value = { action, service }
  else void run(action, service.id)
}

function confirm(): void {
  const request = pending.value
  pending.value = null
  if (request) void run(request.action, request.service.id)
}

const isBusy = (action: ContainerAction, service: ServiceStatus): boolean =>
  busy.value?.action === action && busy.value.container === service.id

let tick: ReturnType<typeof setInterval> | null = null
function onVisibility(): void {
  // Nothing is read while the page is hidden: no battery, no needless load on bento.
  if (document.visibilityState === 'visible') {
    now.value = Date.now()
    start()
  } else {
    stop()
  }
}

onMounted(() => {
  start()
  tick = setInterval(() => (now.value = Date.now()), 5000)
  document.addEventListener('visibilitychange', onVisibility)
})
onBeforeUnmount(() => {
  stop()
  if (tick) clearInterval(tick)
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<template>
  <main class="page">
    <header class="lid" :class="`tone-${summary.tone}`" role="status" aria-live="polite">
      <div class="lid-text">
        <h1 class="lid-title">{{ summary.title }}</h1>
        <ul v-if="summary.details.length" class="lid-details">
          <li v-for="detail in summary.details" :key="detail">{{ detail }}</li>
        </ul>
      </div>
      <button
        class="btn btn-icon"
        type="button"
        :disabled="loading"
        :aria-label="loading ? 'Lecture en cours' : 'Actualiser'"
        @click="refresh()"
      >
        <span class="refresh" :class="{ spinning: loading }" aria-hidden="true">↻</span>
      </button>
    </header>

    <section v-for="stack in stacks" :key="stack.id" class="well stack">
      <button
        class="stack-head"
        type="button"
        :aria-expanded="expanded.has(stack.id)"
        @click="toggle(stack.id)"
      >
        <span class="dot" :class="`level-${stack.level}`" aria-hidden="true"></span>
        <span class="stack-name">{{ stack.label }}</span>
        <span class="stack-summary">{{ stackSummary(stack) }}</span>
        <span class="chevron" :class="{ open: expanded.has(stack.id) }" aria-hidden="true">›</span>
      </button>

      <ul v-if="expanded.has(stack.id)" class="rows">
        <li v-for="service in sortMembers(stack.members)" :key="service.id" class="row">
          <span class="dot" :class="`level-${service.level}`" aria-hidden="true"></span>
          <div class="row-text">
            <span class="row-name">{{ service.label }}</span>
            <span class="row-detail">{{ rowDetail(service.detail) }}</span>
          </div>
          <span class="row-level" :class="`level-${service.level}`">
            {{ levelLabel(service.level) }}
          </span>
          <div v-if="availableActions(service).length" class="row-actions">
            <button
              v-for="action in availableActions(service)"
              :key="action"
              class="btn"
              :class="{ 'btn-quiet': action === 'stop' }"
              type="button"
              :disabled="busy !== null"
              @click="ask(action, service)"
            >
              {{ isBusy(action, service) ? actionBusyLabel(action) : actionLabel(action) }}
            </button>
          </div>
          <p v-if="actionError?.container === service.id" class="row-error" role="alert">
            {{ actionError.message }}
          </p>
        </li>
      </ul>
    </section>

    <section v-if="system" class="well system" aria-label="Système">
      <h2 class="system-title">Système</h2>
      <dl class="figures">
        <div v-for="row in system.rows" :key="row.label" class="figure">
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </div>
      </dl>
      <ul v-if="system.disks.length" class="disks">
        <li v-for="disk in system.disks" :key="disk.mount" class="disk">
          <div class="disk-line">
            <span class="disk-mount">{{ disk.mount }}</span>
            <span class="disk-value" :class="{ alert: disk.alert }">{{ disk.value }}</span>
          </div>
          <div class="bar" aria-hidden="true">
            <div
              class="bar-fill"
              :class="{ alert: disk.alert }"
              :style="{ width: `${Math.min(100, Math.max(0, disk.percent))}%` }"
            ></div>
          </div>
        </li>
      </ul>
    </section>

    <p v-if="fetchedAt !== null" class="foot">Dernière lecture {{ age }}</p>
  </main>

  <div v-if="pending && pendingText" class="backdrop" @click.self="pending = null">
    <div class="sheet" role="dialog" aria-modal="true" :aria-label="pendingText.title">
      <h2 class="sheet-title">{{ pendingText.message }}</h2>
      <p class="sheet-detail">{{ pendingText.detail }}</p>
      <div class="sheet-actions">
        <button class="btn" type="button" @click="pending = null">Annuler</button>
        <button class="btn btn-danger" type="button" @click="confirm">
          {{ pendingText.confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>
