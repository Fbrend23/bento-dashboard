<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    percent: number | null
    label: string
    /** Position (in %) of the alert threshold, drawn as a tick across the cells. */
    marker?: number
    alert?: boolean
    cells?: number
  }>(),
  { marker: undefined, alert: false, cells: 24 }
)

const filled = computed(() => {
  if (props.percent === null || props.percent <= 0) return 0
  return Math.min(props.cells, Math.max(1, Math.round((props.percent / 100) * props.cells)))
})
</script>

<template>
  <div
    class="meter"
    role="meter"
    :aria-label="label"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="percent === null ? undefined : Math.round(percent)"
  >
    <span
      v-for="i in cells"
      :key="i"
      class="cell"
      :class="{ on: i <= filled, alert }"
      :style="{ '--i': i }"
    ></span>
    <span
      v-if="marker !== undefined"
      class="tick"
      :style="{ left: `${marker}%` }"
      aria-hidden="true"
    ></span>
  </div>
</template>

<style scoped>
.meter {
  position: relative;
  display: flex;
  gap: 2px;
  height: 14px;
}

.cell {
  flex: 1;
  border-radius: 2px;
  background: var(--cell-off);
}

.cell.on {
  background: var(--indigo);
  animation: light 260ms ease-out both;
  animation-delay: calc(var(--i) * 14ms);
}

.cell.on.alert {
  background: var(--lacquer);
}

/* The only non-reactive motion: cells light up once when a reading first appears. */
@keyframes light {
  from {
    opacity: 0.1;
  }
}

.tick {
  position: absolute;
  top: -4px;
  bottom: -4px;
  width: 2px;
  margin-left: -1px;
  border-radius: 1px;
  background: var(--ink);
}
</style>
