<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import type { LogSourceId } from '@shared/logs'
import { useActionsStore } from '../stores/actions'
import { useSettingsStore } from '../stores/settings'
import { useStatusStore } from '../stores/status'
import { buildVerdict } from '@shared/verdict'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { groupStacks, primaryLink, stackSummary } from '@shared/stacks'
import {
  formatBytes,
  formatLoad,
  formatMemoryKb,
  formatPercent,
  formatRate,
  formatTemperature,
  formatUptime,
  levelLabel
} from '@shared/format'
import PortLink from '../components/PortLink.vue'
import SegmentMeter from '../components/SegmentMeter.vue'
import StackView from './StackView.vue'

defineEmits<{ configure: []; logs: [source: LogSourceId] }>()

const { status } = storeToRefs(useStatusStore())
const { settings } = storeToRefs(useSettingsStore())
const actions = useActionsStore()
const { portError } = storeToRefs(actions)

const verdict = computed(() => (status.value ? buildVerdict(status.value) : null))
const metrics = computed(() => status.value?.metrics ?? null)
const stacks = computed(() =>
  groupStacks(status.value?.services ?? [], settings.value ?? DEFAULT_SETTINGS)
)
const selectedId = ref<string | null>(null)
// A stack that disappears (container removed, host hidden in the settings) closes its detail.
const selected = computed(() => stacks.value.find((s) => s.id === selectedId.value) ?? null)
const showBoard = computed(
  () => !!status.value?.configured && (status.value.services.length > 0 || !!metrics.value)
)
</script>

<template>
  <StackView
    v-if="status && verdict && selected"
    :stack="selected"
    @back="selectedId = null"
    @logs="(source) => $emit('logs', source)"
  />
  <div v-else-if="status && verdict" class="board" :class="{ solo: !showBoard }">
    <section class="lid" :class="verdict.tone" aria-live="polite">
      <h1>{{ verdict.title }}</h1>
      <p v-for="line in verdict.details" :key="line" class="detail">{{ line }}</p>
      <p v-if="verdict.technical" class="technical">{{ verdict.technical }}</p>
      <button
        v-if="verdict.action === 'configure'"
        type="button"
        class="button primary"
        @click="$emit('configure')"
      >
        Ouvrir les réglages
      </button>
    </section>

    <template v-if="showBoard">
      <section class="well services">
        <h2>Services</h2>
        <ul>
          <li v-for="stack in stacks" :key="stack.id" :class="{ idle: stack.level === 'stopped' }">
            <button type="button" class="row" @click="selectedId = stack.id">
              <span class="tile" :class="stack.level" aria-hidden="true"></span>
              <span class="what">
                <span class="name">{{ stack.label }}</span>
                <span class="sub">{{ stackSummary(stack) }}</span>
              </span>
              <span class="state" :class="stack.level">{{ levelLabel(stack.level) }}</span>
              <span class="chevron" aria-hidden="true">›</span>
            </button>
            <div v-if="primaryLink(stack)" class="quick">
              <PortLink :link="primaryLink(stack)!" />
            </div>
          </li>
        </ul>
        <p v-if="portError" class="action-error" role="alert">{{ portError }}</p>
        <p class="legend">Cliquez sur un service pour voir ses conteneurs.</p>
      </section>

      <section v-if="metrics" class="well system">
        <h2>Système</h2>
        <div class="measure">
          <div class="head">
            <span>Processeur</span>
            <strong>{{ formatPercent(metrics.cpuPercent) }}</strong>
          </div>
          <SegmentMeter label="Utilisation du processeur" :percent="metrics.cpuPercent" />
        </div>
        <div class="measure">
          <div class="head">
            <span
              >Mémoire<small>sur {{ formatMemoryKb(metrics.memoryTotalKb) }}</small></span
            >
            <strong>{{ formatPercent(metrics.memoryUsedPercent) }}</strong>
          </div>
          <SegmentMeter label="Utilisation de la mémoire" :percent="metrics.memoryUsedPercent" />
        </div>
        <div v-if="metrics.swapUsedPercent !== null" class="measure">
          <div class="head">
            <span
              >Swap<small>sur {{ formatMemoryKb(metrics.swapTotalKb) }}</small></span
            >
            <strong>{{ formatPercent(metrics.swapUsedPercent) }}</strong>
          </div>
          <SegmentMeter label="Utilisation du swap" :percent="metrics.swapUsedPercent" />
        </div>
        <dl class="facts">
          <div>
            <dt>Charge sur 1, 5 et 15 min</dt>
            <dd>{{ formatLoad(metrics.load) }}</dd>
          </div>
          <div>
            <dt>En ligne depuis</dt>
            <dd>{{ formatUptime(metrics.uptimeSeconds) }}</dd>
          </div>
          <div v-if="metrics.network">
            <dt>Réseau (câble et Wi-Fi)</dt>
            <dd>
              ↓ {{ formatRate(metrics.network.downBytesPerSec) }} · ↑
              {{ formatRate(metrics.network.upBytesPerSec) }}
            </dd>
          </div>
          <div v-if="metrics.temperatureC !== null">
            <dt>Température du processeur</dt>
            <dd>{{ formatTemperature(metrics.temperatureC) }}</dd>
          </div>
        </dl>
      </section>

      <section v-if="metrics && metrics.disks.length > 0" class="well disks">
        <h2>Disques</h2>
        <div v-for="disk in metrics.disks" :key="disk.mount" class="measure">
          <div class="head">
            <span>
              {{ disk.mount }}
              <small
                >{{ formatBytes(disk.usedBytes) }} sur {{ formatBytes(disk.totalBytes) }}</small
              >
            </span>
            <strong :class="{ over: disk.overThreshold }">{{
              formatPercent(disk.usedPercent)
            }}</strong>
          </div>
          <SegmentMeter
            :label="`Espace utilisé sur ${disk.mount}`"
            :percent="disk.usedPercent"
            :marker="metrics.diskThresholdPercent"
            :alert="disk.overThreshold"
          />
        </div>
        <p class="legend">
          Le trait marque le seuil d'alerte, à {{ formatPercent(metrics.diskThresholdPercent) }}.
        </p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.board {
  display: grid;
  gap: 10px;
  max-width: 980px;
  margin: 0 auto;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  grid-template-areas:
    'lid services'
    'system services'
    'system disks';
  align-items: start;
}

.board.solo {
  max-width: 640px;
  grid-template-columns: 1fr;
  grid-template-areas: 'lid';
}

@media (max-width: 760px) {
  .board {
    grid-template-columns: 1fr;
    grid-template-areas: 'lid' 'services' 'system' 'disks';
  }
}

/* The lid: the answer, in a sentence, tinted by the current state. */
.lid {
  grid-area: lid;
  padding: 26px 28px 28px;
  border-radius: var(--radius-well);
  border: 1px solid var(--well-edge);
  background: var(--stone-lid);
  transition: background-color 400ms;
}

.lid.ok {
  background: var(--jade-lid);
}

.lid.warn {
  background: var(--amber-lid);
}

.lid.danger {
  background: var(--lacquer-lid);
}

h1 {
  margin: 0 0 10px;
  max-width: 14em;
  font-size: 40px;
  font-weight: 700;
  line-height: 1.08;
  letter-spacing: -0.02em;
  text-wrap: balance;
}

.detail {
  margin: 4px 0 0;
  max-width: 38em;
  font-size: 15px;
}

.technical {
  margin: 12px 0 0;
  color: var(--ink-soft);
  font-size: 12.5px;
}

.lid .button {
  margin-top: 18px;
}

.services {
  grid-area: services;
}

.system {
  grid-area: system;
}

.disks {
  grid-area: disks;
}

ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

li {
  padding: 4px 0;
  border-top: 1px solid var(--well-edge);
}

li:first-child {
  padding-top: 0;
  border-top: 0;
}

li:last-child {
  padding-bottom: 0;
}

.row {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 7px 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
}

.row:hover .name {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.chevron {
  color: var(--ink-soft);
  font-size: 18px;
  line-height: 1;
}

li.idle .name {
  color: var(--ink-soft);
}

.quick {
  display: flex;
  padding: 0 0 6px 24px;
}

.action-error {
  margin: 10px 0 0;
  color: var(--lacquer);
  font-size: 12.5px;
}

.tile {
  width: 12px;
  height: 12px;
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

.what {
  display: grid;
}

.name {
  font-weight: 500;
  font-size: 15px;
}

.sub {
  color: var(--ink-soft);
  font-size: 12.5px;
}

.state {
  font-weight: 500;
  color: var(--stone);
}

.state.ok {
  color: var(--jade);
}

.state.degraded,
.state.unknown {
  color: var(--amber);
}

.state.down,
.state.absent {
  color: var(--lacquer);
}

.measure + .measure {
  margin-top: 16px;
}

.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 7px;
}

.head small {
  margin-left: 8px;
  color: var(--ink-soft);
  font-size: 12.5px;
}

.head strong {
  font-weight: 700;
}

.head .over {
  color: var(--lacquer);
}

.facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 12px;
  margin: 20px 0 0;
  padding-top: 14px;
  border-top: 1px solid var(--well-edge);
}

.facts dt {
  color: var(--ink-soft);
  font-size: 12.5px;
}

.facts dd {
  margin: 0;
  font-weight: 700;
}

.legend {
  margin: 18px 0 0;
  color: var(--ink-soft);
  font-size: 12.5px;
}
</style>
