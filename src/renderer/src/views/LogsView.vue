<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { TAILSCALED_SOURCE, groupLogSources, logSources } from '@shared/logs'
import { parseLogLine, type LogLevelFilter } from '@shared/log-lines'
import { useLogsStore } from '../stores/logs'
import { useSettingsStore } from '../stores/settings'
import { useStatusStore } from '../stores/status'

const logs = useLogsStore()
const { source, result, loading, query, level, wrap, autoRefresh, notice, filtered, total } =
  storeToRefs(logs)
const { status } = storeToRefs(useStatusStore())
const { settings } = storeToRefs(useSettingsStore())

// The containers chosen in the settings, then Tailscale.
const sources = computed(() => logSources(settings.value ?? DEFAULT_SETTINGS))
const groups = computed(() =>
  groupLogSources(sources.value, status.value?.services ?? [], settings.value ?? DEFAULT_SETTINGS)
)

const viewer = ref<HTMLElement | null>(null)
const online = computed(() => status.value?.connection === 'online')
const rows = computed(() => filtered.value.map((raw) => ({ raw, level: parseLogLine(raw).level })))
const LEVELS: { id: LogLevelFilter; label: string }[] = [
  { id: 'all', label: 'Tout' },
  { id: 'warnings', label: 'Avertissements et erreurs' },
  { id: 'errors', label: 'Erreurs' }
]
const copied = ref<boolean | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

async function copy(): Promise<void> {
  copied.value = await logs.copy()
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copied.value = null), 2000)
}

function toggleAutoRefresh(event: Event): void {
  logs.setAutoRefresh((event.target as HTMLInputElement).checked)
}
const fetchedAt = computed(() =>
  result.value?.ok
    ? new Date(result.value.fetchedAt).toLocaleTimeString('fr-CH', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    : null
)

// The newest lines are at the bottom: show them first.
watch([result, filtered], async () => {
  await nextTick()
  if (viewer.value) viewer.value.scrollTop = viewer.value.scrollHeight
})

// A container removed from the settings while it was selected: back to the journal that always exists.
watch(sources, (list) => {
  if (!list.some((item) => item.id === source.value)) void logs.select(TAILSCALED_SOURCE)
})

onMounted(() => {
  if (!sources.value.some((item) => item.id === source.value)) logs.source = TAILSCALED_SOURCE
  if (!loading.value) void logs.load()
})

// Nothing keeps polling once the tab is left.
onUnmounted(() => {
  logs.stopAutoRefresh()
  if (copiedTimer) clearTimeout(copiedTimer)
})
</script>

<template>
  <div class="logs">
    <h1>Journaux</h1>

    <div class="layout">
      <nav class="sources" aria-label="Source des journaux">
        <template v-for="group in groups" :key="group.key">
          <p v-if="group.label" class="group">{{ group.label }}</p>
          <hr v-else-if="group.key === TAILSCALED_SOURCE" class="sep" />
          <button
            v-for="item in group.sources"
            :key="item.id"
            type="button"
            :title="item.label"
            :aria-current="source === item.id ? 'true' : undefined"
            @click="logs.select(item.id)"
          >
            <span class="tile" :class="item.level ?? 'unknown-level'" aria-hidden="true"></span>
            <span class="source-name">{{ item.label }}</span>
          </button>
        </template>
      </nav>

      <div class="main">
        <div class="bar">
          <div class="refresh">
            <span v-if="fetchedAt" class="age">Lu à {{ fetchedAt }}</span>
            <button
              type="button"
              class="button"
              :disabled="loading || !online"
              @click="logs.load()"
            >
              Relire
            </button>
          </div>
        </div>

        <div class="tools">
          <input
            v-model="query"
            class="search"
            type="search"
            placeholder="Rechercher dans les lignes"
            aria-label="Rechercher dans les journaux"
            autocomplete="off"
            spellcheck="false"
          />
          <div class="levels" role="group" aria-label="Niveau">
            <button
              v-for="item in LEVELS"
              :key="item.id"
              type="button"
              :aria-pressed="level === item.id"
              @click="level = item.id"
            >
              {{ item.label }}
            </button>
          </div>
          <label class="check"><input v-model="wrap" type="checkbox" /> Retour à la ligne</label>
          <label class="check">
            <input type="checkbox" :checked="autoRefresh" @change="toggleAutoRefresh" />
            Actualiser toutes les 10 s
          </label>
          <button type="button" class="button" :disabled="filtered.length === 0" @click="copy()">
            {{ copied === true ? 'Copié' : copied === false ? 'Copie impossible' : 'Copier' }}
          </button>
          <button
            type="button"
            class="button"
            :disabled="!result?.ok || total === 0"
            @click="logs.exportLogs()"
          >
            Exporter…
          </button>
        </div>
        <p
          v-if="notice"
          class="note"
          :class="{ error: notice.kind === 'error' }"
          :role="notice.kind === 'error' ? 'alert' : 'status'"
        >
          {{ notice.text }}
        </p>

        <section class="well">
          <p v-if="!online && !result" class="note">
            Bento est injoignable : les journaux ne peuvent pas être lus pour l'instant.
          </p>
          <p v-else-if="loading && !result" class="note" aria-live="polite">Lecture en cours…</p>
          <p v-else-if="result && !result.ok" class="note error" role="alert">{{ result.error }}</p>
          <p v-else-if="result && result.lines.length === 0" class="note">
            Aucune ligne dans ce journal.
          </p>
          <p v-else-if="result && filtered.length === 0" class="note">
            Aucune ligne ne correspond au filtre.
          </p>
          <!-- Plain text only: log lines come from the server and are never rendered as HTML. -->
          <div
            v-else-if="result"
            ref="viewer"
            class="viewer"
            :class="{ wrap }"
            tabindex="0"
            role="log"
            aria-label="Dernières lignes du journal"
          >
            <span
              v-for="(row, index) in rows"
              :key="index"
              class="line"
              :class="row.level ? 'is-' + row.level : null"
              >{{ row.raw }}</span
            >
          </div>
          <p v-if="result?.ok && total > 0" class="legend">
            {{ filtered.length }} lignes sur {{ total }}, la plus récente en bas.
          </p>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.logs {
  max-width: 980px;
  margin: 0 auto;
}

h1 {
  margin: 0 0 14px;
  font-size: 28px;
  letter-spacing: -0.02em;
}

.layout {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.main {
  min-width: 0;
}

.bar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 10px;
}

.sources {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: calc(100vh - 160px);
  overflow-y: auto;
}

.group {
  margin: 10px 0 2px;
  padding: 0 10px;
  color: var(--ink-soft);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.group:first-child {
  margin-top: 0;
}

.sep {
  width: 100%;
  margin: 8px 0;
  border: 0;
  border-top: 1px solid var(--well-edge);
}

.sources button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-well);
  background: transparent;
  color: var(--ink-soft);
  font-weight: 500;
  text-align: left;
}

.sources button:hover {
  color: var(--ink);
  border-color: var(--well-edge);
}

.sources button[aria-current='true'] {
  border-color: var(--indigo);
  background: var(--indigo);
  color: var(--indigo-ink);
}

.source-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tile {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 3px;
  background: var(--stone);
}

.tile.ok {
  background: var(--jade);
}

.tile.degraded,
.tile.unknown {
  background: var(--amber);
}

.tile.down,
.tile.absent {
  background: var(--lacquer);
}

.refresh {
  display: flex;
  align-items: center;
  gap: 14px;
}

@media (max-width: 640px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .sources {
    max-height: 140px;
  }
}

.age {
  color: var(--ink-soft);
  font-size: 12.5px;
}

.note {
  margin: 0;
}

.error {
  color: var(--lacquer);
}

.tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  margin-bottom: 10px;
}

.search {
  flex: 1 1 200px;
  min-width: 160px;
  padding: 6px 10px;
  border: 1px solid var(--well-edge);
  border-radius: var(--radius-well);
  background: var(--well);
  color: var(--ink);
}

.search:focus {
  outline: 2px solid var(--indigo);
  outline-offset: 1px;
}

.levels {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.levels button {
  padding: 5px 10px;
  border: 1px solid var(--well-edge);
  border-radius: var(--radius-well);
  background: transparent;
  color: var(--ink-soft);
  font-weight: 500;
}

.levels button:hover {
  color: var(--ink);
  border-color: var(--ink-soft);
}

.levels button[aria-pressed='true'] {
  border-color: var(--indigo);
  background: var(--indigo);
  color: var(--indigo-ink);
}

.check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-soft);
  font-size: 12.5px;
}

.line {
  display: block;
  padding: 0 6px;
  border-left: 3px solid transparent;
}

.line.is-error {
  border-left-color: var(--lacquer);
  background: var(--lacquer-lid);
  color: var(--lacquer);
}

.line.is-warn {
  border-left-color: var(--amber);
  background: var(--amber-lid);
  color: var(--amber);
}

.line.is-debug {
  color: var(--ink-soft);
}

.viewer {
  max-height: calc(100vh - 300px);
  min-height: 220px;
  margin: 0;
  overflow: auto;
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre;
  tab-size: 4;
}

.viewer.wrap {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.legend {
  margin: 12px 0 0;
  color: var(--ink-soft);
  font-size: 12.5px;
}
</style>
