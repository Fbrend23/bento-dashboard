<script setup lang="ts">
import type { SystemFigures } from '../system'

defineProps<{ system: SystemFigures | null }>()
</script>

<template>
  <div class="panel">
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
  </div>
</template>
