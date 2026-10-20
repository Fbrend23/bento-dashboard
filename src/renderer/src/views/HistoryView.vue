<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { buildCharts } from '@shared/history-charts'
import { HISTORY_RANGES, type HistoryRange } from '@shared/history'
import { describeIncident } from '@shared/incident-text'
import TrendChart from '../components/TrendChart.vue'
import { useHistoryStore } from '../stores/history'

const RANGE_LABELS: Record<HistoryRange, string> = {
  '1h': 'Dernière heure',
  '24h': '24 heures',
  '7d': '7 jours'
}
/** The charts are redrawn about as often as a new minute is written. */
const REFRESH_MS = 30_000

const store = useHistoryStore()
const { range, result, loading, failed } = storeToRefs(store)

const charts = computed(() => (result.value ? buildCharts(result.value) : []))
const incidents = computed(() =>
  (result.value?.incidents ?? []).map((incident) => ({
    key: `${incident.key}@${incident.startedAt}`,
    ...describeIncident(incident, result.value?.now ?? Date.now())
  }))
)

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void store.load()
  timer = setInterval(() => void store.load(), REFRESH_MS)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div class="page">
    <div class="filters" role="group" aria-label="Période affichée">
      <button
        v-for="option in HISTORY_RANGES"
        :key="option"
        type="button"
        class="range"
        :aria-pressed="range === option"
        @click="store.setRange(option)"
      >
        {{ RANGE_LABELS[option] }}
      </button>
    </div>

    <p v-if="failed" class="notice error" role="alert">
      L'historique n'a pas pu être lu sur bento : le serveur est injoignable, ou l'agent n'est pas
      installé.
      <template v-if="charts.length > 0">Les derniers graphes restent affichés.</template>
    </p>

    <section v-if="charts.length === 0 && !loading && !failed" class="well empty">
      <h2>Historique</h2>
      <p>
        Rien à montrer pour l'instant. L'historique est tenu par l'agent sur bento : un relevé
        toutes les 30 secondes, une valeur par minute, conservée 7 jours, même quand cette
        application est fermée.
      </p>
    </section>

    <div v-if="charts.length > 0 && result" class="charts">
      <section v-for="chart in charts" :key="chart.id" class="well">
        <TrendChart :spec="chart" :range="result.range" :now="result.now" :loading="loading" />
      </section>
    </div>

    <section class="well incidents">
      <h2>Incidents</h2>
      <p v-if="incidents.length === 0" class="none">Aucun incident sur cette période.</p>
      <ul v-else>
        <li v-for="incident in incidents" :key="incident.key">
          <span class="tile" :class="{ open: incident.open }" aria-hidden="true"></span>
          <div class="what">
            <span class="name">{{ incident.title }}</span>
            <span class="sub">{{ incident.when }} · {{ incident.duration }}</span>
          </div>
          <span v-if="incident.open" class="state">En cours</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.page {
  display: grid;
  gap: 10px;
  max-width: 980px;
  margin: 0 auto;
}

/* The filters sit in one row above everything they scope. */
.filters {
  display: flex;
  gap: 6px;
}

.range {
  padding: 4px 14px;
  border: 1px solid var(--well-edge);
  border-radius: 999px;
  background: var(--well);
  color: var(--ink-soft);
  font-weight: 500;
}

.range:hover {
  color: var(--ink);
}

.range[aria-pressed='true'] {
  border-color: var(--indigo);
  background: var(--indigo);
  color: var(--indigo-ink);
}

.charts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
  gap: 10px;
}

@media (max-width: 520px) {
  .charts {
    grid-template-columns: 1fr;
  }
}

.notice {
  margin: 0;
  padding: 8px 14px;
  border: 1px solid var(--well-edge);
  border-radius: var(--radius-well);
}

.notice.error {
  background: var(--lacquer-lid);
}

.empty p,
.none {
  margin: 0;
  color: var(--ink-soft);
}

ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

li {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 9px 0;
  border-top: 1px solid var(--well-edge);
}

li:first-child {
  padding-top: 0;
  border-top: 0;
}

li:last-child {
  padding-bottom: 0;
}

.tile {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  background: var(--stone);
}

.tile.open {
  background: var(--lacquer);
}

.what {
  display: grid;
}

.name {
  font-weight: 500;
}

.sub {
  color: var(--ink-soft);
  font-size: 12.5px;
}

.state {
  color: var(--lacquer);
  font-weight: 500;
}
</style>
