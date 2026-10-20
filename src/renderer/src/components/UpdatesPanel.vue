<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { updateSummary } from '@shared/update-text'
import { useUpdatesStore } from '../stores/updates'

const store = useUpdatesStore()
const { state } = storeToRefs(store)

const summary = computed(() => (state.value ? updateSummary(state.value) : 'Chargement…'))
const canCheck = computed(() => {
  const phase = state.value?.phase
  return (
    phase !== undefined &&
    phase !== 'unavailable' &&
    phase !== 'checking' &&
    phase !== 'available' &&
    phase !== 'downloading'
  )
})
</script>

<template>
  <section class="well panel" aria-labelledby="updates-title">
    <h2 id="updates-title">Mises à jour</h2>

    <p v-if="state" class="installed">
      Version installée : <strong>{{ state.currentVersion }}</strong>
    </p>

    <p class="summary" role="status">{{ summary }}</p>

    <div class="buttons">
      <button
        v-if="state?.phase === 'available'"
        type="button"
        class="button primary"
        @click="store.download()"
      >
        Télécharger
      </button>
      <button
        v-else-if="state?.phase === 'ready'"
        type="button"
        class="button primary"
        @click="store.install()"
      >
        Redémarrer pour installer
      </button>
      <button type="button" class="button" :disabled="!canCheck" @click="store.check()">
        Vérifier maintenant
      </button>
    </div>
  </section>
</template>

<style scoped>
.panel {
  display: grid;
  gap: 14px;
}

.panel > h2 {
  margin-bottom: 0;
}

.installed,
.summary {
  margin: 0;
}

.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
</style>
