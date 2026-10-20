<script setup lang="ts">
import { computed } from 'vue'
import { buildCharts } from '@shared/history-charts'
import { HISTORY_RANGES, type HistoryRange, type HistoryResult } from '@shared/history'
import { describeIncident } from '@shared/incident-text'
import TrendChart from '@renderer/components/TrendChart.vue'

const props = defineProps<{
  range: HistoryRange
  result: HistoryResult | null
  error: string | null
  loading: boolean
}>()
const emit = defineEmits<{ range: [range: HistoryRange] }>()

const RANGE_LABELS: Record<HistoryRange, string> = {
  '1h': '1 h',
  '24h': '24 h',
  '7d': '7 jours'
}

const charts = computed(() => (props.result ? buildCharts(props.result) : []))
const incidents = computed(() =>
  (props.result?.incidents ?? []).map((incident) => ({
    key: `${incident.key}@${incident.startedAt}`,
    ...describeIncident(incident, props.result?.now ?? Date.now())
  }))
)
</script>

<template>
  <div class="panel">
    <div class="filters" role="group" aria-label="Période affichée">
      <button
        v-for="option in HISTORY_RANGES"
        :key="option"
        type="button"
        class="range"
        :aria-pressed="range === option"
        @click="emit('range', option)"
      >
        {{ RANGE_LABELS[option] }}
      </button>
    </div>

    <p v-if="error" class="notice" role="alert">
      {{ error }}
      <template v-if="charts.length > 0">Les derniers graphes restent affichés.</template>
    </p>

    <section v-if="charts.length === 0 && !loading && !error" class="well history-empty">
      <h2>Historique</h2>
      <p>
        Rien à montrer pour l'instant : l'agent relève bento toutes les 30 secondes et garde une
        valeur par minute pendant 7 jours.
      </p>
    </section>

    <template v-if="result">
      <section v-for="chart in charts" :key="chart.id" class="well chart-well">
        <TrendChart :spec="chart" :range="result.range" :now="result.now" :loading="loading" />
      </section>
    </template>

    <section v-if="result" class="well incidents">
      <h2 class="incidents-title">Incidents</h2>
      <p v-if="incidents.length === 0" class="incidents-none">Aucun incident sur cette période.</p>
      <ul v-else class="incident-list">
        <li v-for="incident in incidents" :key="incident.key" class="incident">
          <span class="tile" :class="{ open: incident.open }" aria-hidden="true"></span>
          <div class="incident-what">
            <span class="incident-name">{{ incident.title }}</span>
            <span class="incident-sub">{{ incident.when }} · {{ incident.duration }}</span>
          </div>
          <span v-if="incident.open" class="incident-state">En cours</span>
        </li>
      </ul>
    </section>
  </div>
</template>
