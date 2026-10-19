<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import type { LogSourceId } from '@shared/logs'
import type { AppView } from '@shared/views'
import { useLogsStore } from './stores/logs'
import { useSettingsStore } from './stores/settings'
import { useStatusStore } from './stores/status'
import { useUpdatesStore } from './stores/updates'
import { formatAge } from '@shared/format'
import { staleness } from '@shared/staleness'
import { viewForShortcut } from '@shared/shortcuts'
import { buildVerdict } from '@shared/verdict'
import BentoMark from './components/BentoMark.vue'
import DashboardView from './views/DashboardView.vue'
import HistoryView from './views/HistoryView.vue'
import LogsView from './views/LogsView.vue'
import SettingsView from './views/SettingsView.vue'

type View = AppView

const statusStore = useStatusStore()
const { status } = storeToRefs(statusStore)
const logsStore = useLogsStore()
const settingsStore = useSettingsStore()
const updatesStore = useUpdatesStore()
const { state: updateState } = storeToRefs(updatesStore)

const view = ref<View>('dashboard')
const now = ref(Date.now())
const refreshing = ref(false)
let clock: ReturnType<typeof setInterval> | undefined
let stopNavigation: (() => void) | undefined

const tone = computed(() => (status.value ? buildVerdict(status.value).tone : 'idle'))
const stale = computed(() =>
  status.value
    ? staleness(status.value, settingsStore.settings?.refreshIntervalSec ?? 30, now.value)
    : null
)
const canRefresh = computed(() => status.value?.connection === 'online' && !refreshing.value)

function openLogs(id: LogSourceId): void {
  logsStore.source = id
  logsStore.result = null
  view.value = 'logs'
}

function onKeydown(event: KeyboardEvent): void {
  const target = viewForShortcut(event)
  if (!target) return
  event.preventDefault()
  view.value = target
}

async function refresh(): Promise<void> {
  refreshing.value = true
  try {
    await statusStore.refresh()
  } finally {
    refreshing.value = false
  }
}

onMounted(async () => {
  clock = setInterval(() => (now.value = Date.now()), 1000)
  // The tray menu can ask for a screen ("Journaux").
  window.addEventListener('keydown', onKeydown)
  stopNavigation = window.bento.onNavigate((target) => (view.value = target))
  await Promise.all([statusStore.init(), updatesStore.init(), settingsStore.load()])
})

onBeforeUnmount(() => {
  clearInterval(clock)
  stopNavigation?.()
  window.removeEventListener('keydown', onKeydown)
  statusStore.dispose()
  updatesStore.dispose()
})
</script>

<template>
  <div class="shell">
    <header>
      <div class="brand">
        <BentoMark :tone="tone" />
        <span class="wordmark">bento</span>
        <span v-if="updateState" class="version" title="Version installée">
          v{{ updateState.currentVersion }}
        </span>
      </div>

      <nav aria-label="Navigation principale">
        <button
          type="button"
          :aria-current="view === 'dashboard' ? 'page' : undefined"
          @click="view = 'dashboard'"
        >
          Tableau de bord
        </button>
        <button
          type="button"
          :aria-current="view === 'history' ? 'page' : undefined"
          @click="view = 'history'"
        >
          Historique
        </button>
        <button
          type="button"
          :aria-current="view === 'logs' ? 'page' : undefined"
          @click="view = 'logs'"
        >
          Journaux
        </button>
        <button
          type="button"
          :aria-current="view === 'settings' ? 'page' : undefined"
          @click="view = 'settings'"
        >
          Réglages
        </button>
      </nav>

      <div class="refresh">
        <span v-if="status?.configured" class="age">
          Dernière lecture : {{ formatAge(status.updatedAt, now) }}
        </span>
        <button type="button" class="button" :disabled="!canRefresh" @click="refresh">
          Actualiser
        </button>
      </div>
    </header>

    <div v-if="updateState?.phase === 'ready'" class="update-bar" role="status">
      <span>La version {{ updateState.version }} est prête.</span>
      <button type="button" class="button primary small" @click="updatesStore.install()">
        Redémarrer pour installer
      </button>
    </div>

    <div v-if="stale" class="stale-bar" role="status">
      <strong>{{ stale.message }}</strong>
      <span v-if="stale.cause">{{ stale.cause }}</span>
      <small v-if="stale.technical" class="technical">{{ stale.technical }}</small>
    </div>

    <main>
      <DashboardView v-if="view === 'dashboard'" @configure="view = 'settings'" @logs="openLogs" />
      <HistoryView v-else-if="view === 'history'" />
      <LogsView v-else-if="view === 'logs'" />
      <SettingsView v-else @saved="view = 'dashboard'" />
    </main>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100%;
}

header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 24px;
  padding: 14px 20px 6px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.version {
  align-self: flex-end;
  padding-bottom: 4px;
  color: var(--ink-soft);
  font-size: 12.5px;
}

.wordmark {
  font-size: 23px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.update-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  margin: 6px 20px 0;
  padding: 8px 14px;
  border: 1px solid var(--well-edge);
  border-radius: var(--radius-well);
  background: var(--jade-lid);
}

.stale-bar {
  display: grid;
  gap: 2px;
  margin: 6px 20px 0;
  padding: 8px 14px;
  border: 1px solid var(--well-edge);
  border-radius: var(--radius-well);
  background: var(--amber-lid);
}

.stale-bar .technical {
  color: var(--ink-soft);
  font-size: 12.5px;
}

.button.small {
  padding: 3px 10px;
  font-size: 12.5px;
}

nav {
  display: flex;
  gap: 22px;
}

nav button {
  padding: 4px 0;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--ink-soft);
  font-weight: 500;
}

nav button:hover {
  color: var(--ink);
}

nav button[aria-current='page'] {
  border-bottom-color: var(--ink);
  color: var(--ink);
}

.refresh {
  display: flex;
  align-items: center;
  gap: 14px;
}

.age {
  color: var(--ink-soft);
  font-size: 12.5px;
}

main {
  flex: 1;
  overflow-y: auto;
  padding: 10px 20px 20px;
}
</style>
