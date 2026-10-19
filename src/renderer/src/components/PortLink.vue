<script setup lang="ts">
import type { StackLink } from '@shared/stacks'
import { useActionsStore } from '../stores/actions'

defineProps<{ link: StackLink }>()

const actions = useActionsStore()
</script>

<template>
  <button
    type="button"
    class="port"
    :title="`Ouvrir le port ${link.hostPort} dans le navigateur`"
    @click="actions.openPort(link.container, link.hostPort)"
  >
    <span v-if="link.label" class="name">{{ link.label }}</span>
    <span class="num">:{{ link.hostPort }}</span>
    <span class="arrow" aria-hidden="true">↗</span>
  </button>
</template>

<style scoped>
.port {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  padding: 2px 9px;
  border: 1px solid var(--well-edge);
  border-radius: 999px;
  background: var(--well);
  color: var(--ink);
  font-size: 12.5px;
  line-height: 1.5;
}

.port:hover {
  border-color: var(--indigo);
  color: var(--indigo);
}

.name {
  font-weight: 500;
}

.num {
  color: var(--ink-soft);
}

.port:hover .num {
  color: inherit;
}

.arrow {
  font-size: 11px;
}
</style>
