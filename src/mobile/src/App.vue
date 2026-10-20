<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { confirmationText } from '@shared/confirm-text'
import { needsConfirmation, type ContainerAction } from '@shared/actions'
import { formatAge } from '@shared/format'
import type { ServiceStatus } from '@shared/monitors'
import { groupStacks } from '@shared/stacks'
import { createAgentApi } from './api'
import { summarize } from './summary'
import { systemFigures } from './system'
import { MOBILE_TABS, isSwipeStart, swipeTarget, tabFromHash, type MobileTab } from './tabs'
import { useBento } from './use-bento'
import { useHistory } from './use-history'
import HistoryView from './views/HistoryView.vue'
import ServicesView from './views/ServicesView.vue'
import SystemView from './views/SystemView.vue'

const api = createAgentApi(window.fetch.bind(window))
const { status, fetchedAt, error, loading, busy, actionError, refresh, run, start, stop } =
  useBento(api)
const trend = useHistory(api)

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

const tab = ref<MobileTab>(tabFromHash(window.location.hash))
const direction = ref<'forward' | 'back'>('forward')

function selectTab(next: MobileTab): void {
  if (next === tab.value) return
  const order = MOBILE_TABS.map((entry) => entry.id)
  direction.value = order.indexOf(next) > order.indexOf(tab.value) ? 'forward' : 'back'
  tab.value = next
  // The hash keeps the tab over a reload; replacing it keeps Android's back gesture for leaving.
  window.history.replaceState(null, '', `#${next}`)
}

// A dot on the tab that needs a look; the history tab has nothing to flag before it is opened.
const flagged = computed<Record<MobileTab, boolean>>(() => ({
  services: summary.value.tone === 'warn' || summary.value.tone === 'danger',
  system: system.value?.disks.some((disk) => disk.alert) ?? false,
  history: false
}))

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

// One finger travelling sideways changes the tab; vertical scrolling stays native.
let touch: { id: number; x: number; y: number } | null = null

function onPointerDown(event: PointerEvent): void {
  touch = null
  if (event.pointerType === 'mouse' || !event.isPrimary || pending.value) return
  // The chart follows the finger to show its values: its movements are not swipes.
  if (event.target instanceof Element && event.target.closest('.frame')) return
  if (!isSwipeStart(event.clientX, window.innerWidth)) return
  touch = { id: event.pointerId, x: event.clientX, y: event.clientY }
}

function onPointerUp(event: PointerEvent): void {
  const start = touch
  touch = null
  if (!start || start.id !== event.pointerId) return
  const target = swipeTarget(tab.value, event.clientX - start.x, event.clientY - start.y)
  if (target) selectTab(target)
}

const visible = ref(document.visibilityState === 'visible')
let tick: ReturnType<typeof setInterval> | null = null
function onVisibility(): void {
  // Nothing is read while the page is hidden: no battery, no needless load on bento.
  visible.value = document.visibilityState === 'visible'
  if (visible.value) {
    now.value = Date.now()
    start()
  } else {
    stop()
  }
}

// The history is only read while its tab is on screen.
watch(
  [tab, visible],
  ([current, shown]) => (current === 'history' && shown ? trend.start() : trend.stop()),
  { immediate: true }
)

onMounted(() => {
  start()
  tick = setInterval(() => (now.value = Date.now()), 5000)
  document.addEventListener('visibilitychange', onVisibility)
})
onBeforeUnmount(() => {
  stop()
  trend.stop()
  if (tick) clearInterval(tick)
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<template>
  <main
    class="page"
    @pointerdown="onPointerDown"
    @pointerup="onPointerUp"
    @pointercancel="touch = null"
  >
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

    <Transition :name="`slide-${direction}`" mode="out-in">
      <KeepAlive>
        <ServicesView
          v-if="tab === 'services'"
          :stacks="stacks"
          :busy="busy"
          :action-error="actionError"
          @ask="ask"
        />
        <SystemView v-else-if="tab === 'system'" :system="system" />
        <HistoryView
          v-else
          :range="trend.range.value"
          :result="trend.result.value"
          :error="trend.error.value"
          :loading="trend.loading.value"
          @range="trend.setRange"
        />
      </KeepAlive>
    </Transition>

    <p v-if="fetchedAt !== null" class="foot">Dernière lecture {{ age }}</p>
  </main>

  <nav class="tabbar" aria-label="Sections">
    <button
      v-for="entry in MOBILE_TABS"
      :key="entry.id"
      class="tab"
      type="button"
      :aria-current="tab === entry.id ? 'page' : undefined"
      @click="selectTab(entry.id)"
    >
      <span class="tab-icon">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <template v-if="entry.id === 'services'">
            <rect x="4" y="4" width="7" height="7" rx="1.5" />
            <rect x="13" y="4" width="7" height="7" rx="1.5" />
            <rect x="4" y="13" width="7" height="7" rx="1.5" />
            <rect x="13" y="13" width="7" height="7" rx="1.5" />
          </template>
          <template v-else-if="entry.id === 'system'">
            <path d="M4 16a8 8 0 1 1 16 0" />
            <path d="M12 16l4-5" />
          </template>
          <template v-else>
            <path d="M4 5v14h16" />
            <path d="M7 15l4-5 3 3 5-6" />
          </template>
        </svg>
        <span v-if="flagged[entry.id]" class="tab-flag" aria-hidden="true"></span>
      </span>
      <span class="tab-label">{{ entry.label }}</span>
    </button>
  </nav>

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
