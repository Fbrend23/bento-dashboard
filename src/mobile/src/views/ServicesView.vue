<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  actionBusyLabel,
  actionLabel,
  availableActions,
  type ContainerAction
} from '@shared/actions'
import { levelLabel, rowDetail } from '@shared/format'
import type { ServiceStatus } from '@shared/monitors'
import { sortMembers, stackSummary, type Stack } from '@shared/stacks'

const props = defineProps<{
  stacks: Stack[]
  busy: { action: ContainerAction; container: string } | null
  actionError: { container: string; message: string } | null
}>()
const emit = defineEmits<{ ask: [action: ContainerAction, service: ServiceStatus] }>()

// A stack opens by itself when something is wrong in it; the reader's own toggles are kept.
const expanded = ref(new Set<string>())
const seen = new Set<string>()
watch(
  () => props.stacks,
  (list) => {
    for (const stack of list) {
      if (seen.has(stack.id)) continue
      seen.add(stack.id)
      if (stack.level !== 'ok' && stack.level !== 'stopped') expanded.value.add(stack.id)
    }
  },
  { immediate: true }
)
function toggle(id: string): void {
  if (!expanded.value.delete(id)) expanded.value.add(id)
}

const isBusy = (action: ContainerAction, service: ServiceStatus): boolean =>
  props.busy?.action === action && props.busy.container === service.id
</script>

<template>
  <div class="panel">
    <section v-for="stack in stacks" :key="stack.id" class="well stack">
      <button
        class="stack-head"
        type="button"
        :aria-expanded="expanded.has(stack.id)"
        @click="toggle(stack.id)"
      >
        <span class="dot" :class="`level-${stack.level}`" aria-hidden="true"></span>
        <span class="stack-name">{{ stack.label }}</span>
        <span class="stack-summary">{{ stackSummary(stack) }}</span>
        <span class="chevron" :class="{ open: expanded.has(stack.id) }" aria-hidden="true">›</span>
      </button>

      <ul v-if="expanded.has(stack.id)" class="rows">
        <li v-for="service in sortMembers(stack.members)" :key="service.id" class="row">
          <span class="dot" :class="`level-${service.level}`" aria-hidden="true"></span>
          <div class="row-text">
            <span class="row-name">{{ service.label }}</span>
            <span class="row-detail">{{ rowDetail(service.detail) }}</span>
          </div>
          <span class="row-level" :class="`level-${service.level}`">
            {{ levelLabel(service.level) }}
          </span>
          <div v-if="availableActions(service).length" class="row-actions">
            <button
              v-for="action in availableActions(service)"
              :key="action"
              class="btn"
              :class="{ 'btn-quiet': action === 'stop' }"
              type="button"
              :disabled="busy !== null"
              @click="emit('ask', action, service)"
            >
              {{ isBusy(action, service) ? actionBusyLabel(action) : actionLabel(action) }}
            </button>
          </div>
          <p v-if="actionError?.container === service.id" class="row-error" role="alert">
            {{ actionError.message }}
          </p>
        </li>
      </ul>
    </section>
  </div>
</template>
