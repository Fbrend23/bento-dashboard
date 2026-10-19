<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  areaPath,
  formatMoment,
  formatTick,
  gapThreshold,
  linePath,
  linearScale,
  nearestIndex,
  timeTicks,
  yTicks,
  type XY
} from '@shared/chart'
import { formatChartValue, type ChartSpec } from '@shared/history-charts'
import { RANGE_MS, type HistoryRange } from '@shared/history'

const props = defineProps<{
  spec: ChartSpec
  range: HistoryRange
  /** The server-side "now" the range was cut at: every chart shares one time axis. */
  now: number
  loading?: boolean
}>()

// Geometry in real pixels: the width follows the container, so the text keeps its size.
const HEIGHT = 190
const LEFT = 52
const RIGHT = 12
const TOP = 10
const BOTTOM = 24
const width = ref(560)
const plot = computed(() => ({
  left: LEFT,
  right: Math.max(LEFT + 40, width.value - RIGHT),
  top: TOP,
  bottom: HEIGHT - BOTTOM
}))

const frame = ref<HTMLElement | null>(null)
let observer: ResizeObserver | undefined
onMounted(() => {
  if (!frame.value) return
  width.value = frame.value.clientWidth || width.value
  observer = new ResizeObserver(([entry]) => {
    if (entry.contentRect.width > 0) width.value = Math.round(entry.contentRect.width)
  })
  observer.observe(frame.value)
})
onBeforeUnmount(() => observer?.disconnect())

const from = computed(() => props.now - RANGE_MS[props.range])
const x = computed(() => linearScale(from.value, props.now, plot.value.left, plot.value.right))
const y = computed(() =>
  linearScale(props.spec.domain.min, props.spec.domain.max, plot.value.bottom, plot.value.top)
)

const xs = computed(() => props.spec.times.map((t) => x.value(t)))

/** A hole wider than two and a half readings is a gap in the data, not a line to draw across. */
const maxGap = computed(
  () => x.value(from.value + gapThreshold(props.spec.times)) - x.value(from.value)
)

const lines = computed(() =>
  props.spec.series.map((series) => {
    const points: XY[] = series.values.map((value, i) => ({
      x: xs.value[i],
      y: value === null ? null : y.value(value)
    }))
    return {
      series,
      line: linePath(points, maxGap.value),
      // A wash under the line only when there is one series: two washes would hide each other.
      area: props.spec.series.length === 1 ? areaPath(points, maxGap.value, plot.value.bottom) : ''
    }
  })
)

const yAxis = computed(() =>
  yTicks(props.spec.domain.max).map((value) => ({
    y: y.value(value),
    label: formatChartValue(props.spec.unit, value)
  }))
)

const xAxis = computed(() =>
  timeTicks(from.value, props.now, props.range)
    .map((t) => ({ x: x.value(t), label: formatTick(t, props.range) }))
    // Keep the labels clear of the value labels on the left.
    .filter((tick) => tick.x >= plot.value.left + 14 && tick.x <= plot.value.right - 14)
)

// Hover and keyboard share one position.
const hovered = ref<number | null>(null)
const svg = ref<SVGSVGElement | null>(null)

function pointerTo(event: PointerEvent): void {
  const box = svg.value?.getBoundingClientRect()
  if (!box || box.width === 0) return
  const position = ((event.clientX - box.left) / box.width) * width.value
  const index = nearestIndex(xs.value, position)
  hovered.value = index >= 0 ? index : null
}

function onKey(event: KeyboardEvent): void {
  const count = props.spec.times.length
  if (count === 0) return
  if (event.key === 'Escape') {
    hovered.value = null
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault()
    const step = event.key === 'ArrowLeft' ? -1 : 1
    hovered.value = Math.min(count - 1, Math.max(0, (hovered.value ?? count - 1) + step))
  }
}

const tooltip = computed(() => {
  const index = hovered.value
  if (index === null || index >= props.spec.times.length) return null
  return {
    left: (xs.value[index] / width.value) * 100,
    moment: formatMoment(props.spec.times[index]),
    rows: props.spec.series.map((series) => ({
      id: series.id,
      slot: series.slot,
      name: series.name,
      value: formatChartValue(props.spec.unit, series.values[index])
    })),
    dots: props.spec.series.flatMap((series) => {
      const value = series.values[index]
      return value === null
        ? []
        : [{ id: series.id, slot: series.slot, cx: xs.value[index], cy: y.value(value) }]
    })
  }
})

const showTable = ref(false)
const tableRows = computed(() =>
  props.spec.times.map((t, i) => ({
    moment: formatMoment(t),
    cells: props.spec.series.map((s) => formatChartValue(props.spec.unit, s.values[i]))
  }))
)

const summary = computed(() => {
  const last = props.spec.series
    .map(
      (s) =>
        `${s.name} ${formatChartValue(props.spec.unit, s.values.findLast((v) => v !== null) ?? null)}`
    )
    .join(', ')
  return `${props.spec.title}. Dernières valeurs : ${last}.`
})
</script>

<template>
  <section class="chart" :class="{ loading }">
    <header>
      <h3>{{ spec.title }}</h3>
      <ul v-if="spec.series.length > 1" class="legend" aria-label="Légende">
        <li v-for="series in spec.series" :key="series.id">
          <span
            class="key"
            :style="{ background: `var(--series-${series.slot})` }"
            aria-hidden="true"
          ></span>
          {{ series.name }}
        </li>
      </ul>
    </header>

    <div
      ref="frame"
      class="frame"
      tabindex="0"
      :aria-label="`${spec.title} : flèches gauche et droite pour parcourir les valeurs`"
      @keydown="onKey"
      @blur="hovered = null"
    >
      <svg
        ref="svg"
        :viewBox="`0 0 ${width} ${HEIGHT}`"
        :height="HEIGHT"
        role="img"
        :aria-label="summary"
        @pointermove="pointerTo"
        @pointerleave="hovered = null"
      >
        <g class="grid">
          <line
            v-for="tick in yAxis"
            :key="`y${tick.y}`"
            :x1="plot.left"
            :x2="plot.right"
            :y1="tick.y"
            :y2="tick.y"
          />
          <line
            v-for="tick in xAxis"
            :key="`x${tick.x}`"
            :x1="tick.x"
            :x2="tick.x"
            :y1="plot.bottom"
            :y2="plot.bottom + 4"
          />
        </g>
        <g class="labels">
          <text
            v-for="tick in yAxis"
            :key="`yl${tick.y}`"
            :x="plot.left - 8"
            :y="tick.y + 4"
            text-anchor="end"
          >
            {{ tick.label }}
          </text>
          <text
            v-for="tick in xAxis"
            :key="`xl${tick.x}`"
            :x="tick.x"
            :y="HEIGHT - 6"
            text-anchor="middle"
          >
            {{ tick.label }}
          </text>
        </g>

        <g
          v-for="item in lines"
          :key="item.series.id"
          :style="{ '--c': `var(--series-${item.series.slot})` }"
        >
          <path v-if="item.area" class="area" :d="item.area" />
          <path class="line" :d="item.line" />
        </g>

        <g v-if="tooltip">
          <line
            class="crosshair"
            :x1="xs[hovered ?? 0]"
            :x2="xs[hovered ?? 0]"
            :y1="plot.top"
            :y2="plot.bottom"
          />
          <circle
            v-for="dot in tooltip.dots"
            :key="dot.id"
            class="dot"
            :cx="dot.cx"
            :cy="dot.cy"
            r="4"
            :style="{ fill: `var(--series-${dot.slot})` }"
          />
        </g>
      </svg>

      <div
        v-if="tooltip"
        class="tooltip"
        :class="{ right: tooltip.left > 60 }"
        :style="{ left: `${tooltip.left}%` }"
        role="status"
      >
        <span class="moment">{{ tooltip.moment }}</span>
        <div v-for="row in tooltip.rows" :key="row.id" class="row">
          <span
            class="key"
            :style="{ background: `var(--series-${row.slot})` }"
            aria-hidden="true"
          ></span>
          <strong>{{ row.value }}</strong>
          <span class="name">{{ row.name }}</span>
        </div>
      </div>
    </div>

    <details class="table-view" @toggle="showTable = ($event.target as HTMLDetailsElement).open">
      <summary>Voir les valeurs</summary>
      <div v-if="showTable" class="scroll">
        <table>
          <caption class="sr-only">
            {{
              spec.title
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">Moment</th>
              <th v-for="series in spec.series" :key="series.id" scope="col">{{ series.name }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in tableRows" :key="row.moment + row.cells.join()">
              <th scope="row">{{ row.moment }}</th>
              <td v-for="(cell, i) in row.cells" :key="i">{{ cell }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  </section>
</template>

<style scoped>
.chart {
  display: grid;
  gap: 8px;
  transition: opacity 200ms;
}

/* A reload keeps the frame: the charts stay where they are, only dimmed. */
.chart.loading {
  opacity: 0.6;
}

header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px 16px;
}

h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--ink-soft);
  font-size: 12.5px;
}

.legend li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

/* A short stroke of the series colour keys the line, in the legend and in the tooltip. */
.key {
  display: inline-block;
  width: 14px;
  height: 2px;
  border-radius: 1px;
}

.frame {
  position: relative;
  outline-offset: 2px;
}

svg {
  display: block;
  width: 100%;
  touch-action: pan-y;
}

.grid line {
  stroke: var(--well-edge);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.labels text {
  fill: var(--ink-soft);
  font-size: 11px;
}

.line {
  fill: none;
  stroke: var(--c);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.area {
  fill: var(--c);
  opacity: 0.1;
}

.crosshair {
  stroke: var(--ink-soft);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

/* The dot carries a ring in the surface colour so it reads where lines cross. */
.dot {
  stroke: var(--well);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.tooltip {
  position: absolute;
  top: 6px;
  z-index: 1;
  display: grid;
  gap: 2px;
  min-width: 150px;
  padding: 8px 10px;
  border: 1px solid var(--well-edge);
  border-radius: var(--radius-well);
  background: var(--well);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  transform: translateX(10px);
  pointer-events: none;
}

.tooltip.right {
  transform: translateX(calc(-100% - 10px));
}

.tooltip .moment {
  color: var(--ink-soft);
  font-size: 12px;
}

.tooltip .row {
  display: grid;
  grid-template-columns: auto auto 1fr;
  align-items: center;
  gap: 8px;
}

/* In the tooltip the value leads and the name follows. */
.tooltip strong {
  font-weight: 700;
}

.tooltip .name {
  color: var(--ink-soft);
  font-size: 12.5px;
}

.table-view summary {
  color: var(--ink-soft);
  font-size: 12.5px;
  cursor: pointer;
}

.scroll {
  max-height: 240px;
  margin-top: 6px;
  overflow: auto;
  border: 1px solid var(--well-edge);
  border-radius: var(--radius-well);
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

th,
td {
  padding: 4px 10px;
  text-align: right;
  white-space: nowrap;
}

thead th {
  position: sticky;
  top: 0;
  background: var(--well);
  color: var(--ink-soft);
  font-weight: 500;
}

tbody th {
  font-weight: 400;
  text-align: left;
  color: var(--ink-soft);
}

tbody tr + tr > * {
  border-top: 1px solid var(--well-edge);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
