<script setup lang="ts">
import type { Tone } from '@shared/verdict'

defineProps<{ tone: Tone }>()
</script>

<template>
  <svg class="mark" :class="tone" viewBox="0 0 28 28" width="26" height="26" aria-hidden="true">
    <rect class="lid" x="2.5" y="2.5" width="10.5" height="23" rx="2" />
    <rect
      x="1"
      y="1"
      width="26"
      height="26"
      rx="5"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    />
    <path d="M13.5 1.5v25M13.5 14h13" stroke="currentColor" stroke-width="2" fill="none" />
  </svg>
</template>

<style scoped>
.mark {
  flex: none;
}

.lid {
  fill: var(--stone);
  transition: fill 400ms;
}

.ok .lid {
  fill: var(--jade);
}

.warn .lid {
  fill: var(--amber);
}

.danger .lid {
  fill: var(--lacquer);
}
</style>
