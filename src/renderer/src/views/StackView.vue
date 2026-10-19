<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { actionBusyLabel, actionLabel, availableActions } from '@shared/actions'
import { containerSource, type LogSourceId } from '@shared/logs'
import { levelLabel, rowDetail } from '@shared/format'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { memberLinks, sortMembers, stackSummary, type Stack } from '@shared/stacks'
import PortLink from '../components/PortLink.vue'
import { useActionsStore } from '../stores/actions'
import { useSettingsStore } from '../stores/settings'
import { useStatusStore } from '../stores/status'

const props = defineProps<{ stack: Stack }>()
defineEmits<{ back: []; logs: [source: LogSourceId] }>()

const { status } = storeToRefs(useStatusStore())
const { settings } = storeToRefs(useSettingsStore())
const actions = useActionsStore()
const { busy, actionError, portError } = storeToRefs(actions)
const online = computed(() => status.value?.connection === 'online')
const members = computed(() => sortMembers(props.stack.members))
</script>

<template>
  <div class="detail">
    <section class="well">
      <button type="button" class="back" @click="$emit('back')">← Tableau de bord</button>
      <header>
        <span class="tile" :class="stack.level" aria-hidden="true"></span>
        <div class="what">
          <h1>{{ stack.label }}</h1>
          <span class="sub">{{ stackSummary(stack) }}</span>
        </div>
        <span class="state" :class="stack.level">{{ levelLabel(stack.level) }}</span>
      </header>
      <p v-if="portError" class="action-error" role="alert">{{ portError }}</p>
    </section>

    <section class="well">
      <h2>Conteneurs</h2>
      <ul>
        <li
          v-for="member in members"
          :key="member.id"
          :class="{ idle: member.level === 'stopped' }"
        >
          <span class="tile" :class="member.level" aria-hidden="true"></span>
          <div class="what">
            <span class="name">{{ member.label }}</span>
            <span class="sub">{{ rowDetail(member.detail) }}</span>
          </div>
          <span class="state" :class="member.level">{{ levelLabel(member.level) }}</span>

          <div class="actions">
            <PortLink
              v-for="link in memberLinks(member, settings ?? DEFAULT_SETTINGS)"
              :key="link.hostPort"
              :link="link"
            />
            <button
              v-if="settings?.logContainers.includes(member.id)"
              type="button"
              class="link"
              @click="$emit('logs', containerSource(member.id))"
            >
              Voir les journaux
            </button>
            <button
              v-for="action in availableActions(member)"
              :key="action"
              type="button"
              class="button small"
              :class="{ danger: action === 'stop' }"
              :disabled="!online || !!busy"
              @click="actions.runAction(action, member.id)"
            >
              {{
                busy?.container === member.id && busy.action === action
                  ? actionBusyLabel(action)
                  : actionLabel(action)
              }}
            </button>
            <button
              v-if="member.level === 'down' && member.kind === 'container'"
              type="button"
              class="link"
              title="Ne plus alerter pour ce conteneur tant qu'il n'a pas redémarré"
              @click="actions.forgetContainer(member.id)"
            >
              Ignorer cet arrêt
            </button>
          </div>
          <p v-if="actionError?.container === member.id" class="action-error" role="alert">
            {{ actionError.message }}
          </p>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.detail {
  display: grid;
  gap: 10px;
  max-width: 760px;
  margin: 0 auto;
}

.back {
  margin-bottom: 14px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--ink-soft);
  font-size: 12.5px;
}

.back:hover {
  color: var(--ink);
}

header {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 14px;
}

h1 {
  margin: 0;
  font-size: 30px;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.02em;
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
  gap: 8px 12px;
  padding: 11px 0;
  border-top: 1px solid var(--well-edge);
}

li:first-child {
  padding-top: 0;
  border-top: 0;
}

li:last-child {
  padding-bottom: 0;
}

li.idle .name {
  color: var(--ink-soft);
}

.actions {
  grid-column: 2 / -1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
}

.actions:empty {
  display: none;
}

.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--ink-soft);
  font-size: 12.5px;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.link:hover {
  color: var(--ink);
}

.button.small {
  padding: 3px 10px;
  font-size: 12.5px;
}

.button.small.danger:not(:disabled) {
  border-color: var(--lacquer);
  color: var(--lacquer);
}

.action-error {
  grid-column: 2 / -1;
  margin: 0;
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
</style>
