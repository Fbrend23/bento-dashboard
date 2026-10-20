<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { DEFAULT_SETTINGS } from '@shared/settings'
import UpdatesPanel from '../components/UpdatesPanel.vue'
import { useSettingsStore } from '../stores/settings'
import { useStatusStore } from '../stores/status'
import { toForm, type SettingsForm } from '../settings-form'

const emit = defineEmits<{ saved: [] }>()

const store = useSettingsStore()
const { errors, saving, testing, testResult } = storeToRefs(store)
const { status } = storeToRefs(useStatusStore())

// Start from the saved settings when they are already loaded, so nothing looks modified.
const form = reactive<SettingsForm>(toForm(store.settings ?? DEFAULT_SETTINGS))
const justSaved = ref(false)

// The floating save button only shows when the form differs from what is saved.
const dirty = computed(
  () => JSON.stringify(form) !== JSON.stringify(toForm(store.settings ?? DEFAULT_SETTINGS))
)

// The containers of the last poll, plus any already chosen that bento no longer lists, so a
// choice never vanishes from the form without the user unticking it.
const logChoices = computed(() => {
  const seen = (status.value?.services ?? [])
    .filter((service) => service.kind === 'container' && service.id !== 'docker')
    .map((service) => service.id)
  return [...new Set([...seen, ...form.logContainers])].sort((a, b) => a.localeCompare(b))
})

onMounted(async () => {
  await store.load()
  if (store.settings) Object.assign(form, toForm(store.settings))
})

function discard(): void {
  Object.assign(form, toForm(store.settings ?? DEFAULT_SETTINGS))
}

async function submit(): Promise<void> {
  justSaved.value = false
  if (await store.save(form)) {
    if (store.settings) Object.assign(form, toForm(store.settings))
    justSaved.value = true
    emit('saved')
  }
}
</script>

<template>
  <div class="page">
    <form class="settings" novalidate @submit.prevent="submit">
      <h1>Réglages</h1>

      <p v-if="errors.settings" class="error" role="alert">{{ errors.settings }}</p>

      <section class="well">
        <h2>Connexion à bento</h2>

        <label>
          <span>Hôte</span>
          <input
            v-model="form.host"
            type="text"
            autocomplete="off"
            spellcheck="false"
            placeholder="Nom MagicDNS ou adresse Tailscale"
          />
          <small v-if="errors.host" class="error">{{ errors.host }}</small>
        </label>

        <div class="row">
          <label>
            <span>Port</span>
            <input v-model.number="form.port" type="number" min="1" max="65535" />
            <small v-if="errors.port" class="error">{{ errors.port }}</small>
          </label>
          <label>
            <span>Utilisateur</span>
            <input v-model="form.username" type="text" autocomplete="off" spellcheck="false" />
            <small v-if="errors.username" class="error">{{ errors.username }}</small>
          </label>
        </div>

        <label>
          <span>Empreinte du serveur</span>
          <input
            v-model="form.hostFingerprint"
            type="text"
            autocomplete="off"
            spellcheck="false"
            placeholder="SHA256:…"
          />
          <small v-if="errors.hostFingerprint" class="error">{{ errors.hostFingerprint }}</small>
          <small v-else class="hint">
            Sur bento, lancez <code>ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</code> et
            collez la ligne entière. L'app refuse tout serveur dont l'empreinte diffère.
          </small>
        </label>

        <p class="hint">
          La clé SSH reste dans l'agent Windows (<code>ssh-add</code>) : l'app ne la stocke pas.
        </p>
      </section>

      <section class="well">
        <h2>Surveillance</h2>

        <div class="row">
          <label>
            <span>Rafraîchissement, en secondes</span>
            <input v-model.number="form.refreshIntervalSec" type="number" min="10" max="3600" />
            <small v-if="errors.refreshIntervalSec" class="error">{{
              errors.refreshIntervalSec
            }}</small>
          </label>
          <label>
            <span>Seuil d'alerte des disques, en %</span>
            <input v-model.number="form.diskThresholdPercent" type="number" min="1" max="100" />
            <small v-if="errors.diskThresholdPercent" class="error">{{
              errors.diskThresholdPercent
            }}</small>
          </label>
        </div>

        <label>
          <span>Conteneurs Docker masqués</span>
          <textarea v-model="form.hiddenContainers" rows="3" spellcheck="false"></textarea>
          <small v-if="errors.hiddenContainers" class="error">{{ errors.hiddenContainers }}</small>
          <small v-else class="hint"
            >Un nom par ligne. Tous les autres conteneurs sont affichés ; Tailscale est toujours
            surveillé.</small
          >
        </label>

        <label>
          <span>Points de montage ignorés</span>
          <textarea v-model="form.excludedMounts" rows="2" spellcheck="false"></textarea>
          <small v-if="errors.excludedMounts" class="error">{{ errors.excludedMounts }}</small>
          <small v-else class="hint"
            >Un chemin par ligne, par exemple <code>/boot/efi</code>.</small
          >
        </label>
      </section>

      <section class="well">
        <h2>Conteneurs</h2>

        <label>
          <span>Noms des conteneurs</span>
          <textarea v-model="form.containerLabels" rows="3" spellcheck="false"></textarea>
          <small v-if="errors.containerLabels" class="error">{{ errors.containerLabels }}</small>
          <small v-else class="hint"
            >Une ligne par conteneur, sous la forme <code>nom docker = nom affiché</code>. Un
            conteneur sans ligne garde son nom docker.</small
          >
        </label>

        <label>
          <span>Noms des stacks</span>
          <textarea v-model="form.stackLabels" rows="2" spellcheck="false"></textarea>
          <small v-if="errors.stackLabels" class="error">{{ errors.stackLabels }}</small>
          <small v-else class="hint"
            >Une ligne par projet compose, par exemple <code>media = Médias</code>.</small
          >
        </label>

        <label>
          <span>Noms des interfaces web</span>
          <textarea v-model="form.portLabels" rows="3" spellcheck="false"></textarea>
          <small v-if="errors.portLabels" class="error">{{ errors.portLabels }}</small>
          <small v-else class="hint"
            >Une ligne par port publié, par exemple <code>8096 = Jellyfin</code>. Sert aux liens
            rapides.</small
          >
        </label>

        <fieldset class="logs-pick">
          <legend>Conteneurs dont on lit les journaux</legend>
          <p v-if="logChoices.length === 0" class="hint">
            Aucun conteneur dans le dernier relevé : connectez-vous à bento d'abord.
          </p>
          <label v-for="name in logChoices" :key="name" class="check">
            <input v-model="form.logContainers" type="checkbox" :value="name" />
            <span>{{ name }}</span>
          </label>
          <small v-if="errors.logContainers" class="error">{{ errors.logContainers }}</small>
          <small v-else class="hint">
            La lecture passe par le script <code>bento-docker-logs</code> installé sur bento (une
            seule règle sudoers pour tous les conteneurs). Sans lui, bento refuse et l'écran des
            journaux l'indique.
          </small>
        </fieldset>
      </section>

      <section class="well">
        <h2>Notifications et démarrage</h2>

        <label class="check">
          <input v-model="form.notifyUnhealthy" type="checkbox" />
          <span>
            Prévenir quand un conteneur est non sain
            <small class="hint">
              En plus des services arrêtés, de bento injoignable et des disques pleins, qui sont
              toujours signalés.
            </small>
          </span>
        </label>

        <label class="check">
          <input v-model="form.notifyRecovery" type="checkbox" />
          <span>
            Prévenir aussi quand un problème signalé est terminé
            <small class="hint">
              Service revenu, bento de nouveau joignable, disque ou charge revenus à la normale.
            </small>
          </span>
        </label>

        <h3>Surcharge</h3>
        <p class="hint">
          Une alerte n'est envoyée que si la valeur reste au-dessus du seuil pendant plusieurs
          relevés de suite : un pic isolé (sauvegarde, analyse) ne compte pas.
        </p>

        <div class="row">
          <label class="check">
            <input v-model="form.notifyCpu" type="checkbox" />
            <span>Processeur au-dessus de</span>
          </label>
          <label>
            <span>Seuil, en %</span>
            <input v-model.number="form.cpuThresholdPercent" type="number" min="50" max="100" />
            <small v-if="errors.cpuThresholdPercent" class="error">{{
              errors.cpuThresholdPercent
            }}</small>
          </label>
        </div>

        <div class="row">
          <label class="check">
            <input v-model="form.notifyMemory" type="checkbox" />
            <span>Mémoire au-dessus de</span>
          </label>
          <label>
            <span>Seuil, en %</span>
            <input v-model.number="form.memoryThresholdPercent" type="number" min="50" max="100" />
            <small v-if="errors.memoryThresholdPercent" class="error">{{
              errors.memoryThresholdPercent
            }}</small>
          </label>
        </div>

        <div class="row">
          <label class="check">
            <input v-model="form.notifyLoad" type="checkbox" />
            <span>Charge sur 1 minute au-dessus de</span>
          </label>
          <label>
            <span>Seuil</span>
            <input v-model.number="form.loadThreshold" type="number" min="1" max="1000" />
            <small v-if="errors.loadThreshold" class="error">{{ errors.loadThreshold }}</small>
          </label>
        </div>

        <label>
          <span>Relevés de suite avant d'alerter</span>
          <input v-model.number="form.sustainedSamples" type="number" min="1" max="20" />
          <small v-if="errors.sustainedSamples" class="error">{{ errors.sustainedSamples }}</small>
        </label>

        <h3>Plage silencieuse</h3>
        <label class="check">
          <input v-model="form.quietHoursEnabled" type="checkbox" />
          <span>
            Ne pas envoyer de notification pendant cette plage
            <small class="hint">
              Un problème qui commence pendant la plage et dure encore à la fin est signalé à ce
              moment-là ; un problème réglé entre-temps n'est jamais signalé.
            </small>
          </span>
        </label>
        <div class="row">
          <label>
            <span>De</span>
            <input v-model="form.quietHoursStart" type="time" />
            <small v-if="errors.quietHoursStart" class="error">{{ errors.quietHoursStart }}</small>
          </label>
          <label>
            <span>À</span>
            <input v-model="form.quietHoursEnd" type="time" />
            <small v-if="errors.quietHoursEnd" class="error">{{ errors.quietHoursEnd }}</small>
          </label>
        </div>

        <h3>Démarrage</h3>
        <label class="check">
          <input v-model="form.launchAtStartup" type="checkbox" />
          <span>
            Lancer Bento au démarrage de Windows
            <small class="hint">
              L'app démarre dans la barre système, sans ouvrir de fenêtre. Effet uniquement sur
              l'application installée.
            </small>
          </span>
        </label>

        <h3>Mises à jour</h3>
        <label class="check">
          <input v-model="form.autoUpdate" type="checkbox" />
          <span>
            Télécharger et installer les mises à jour automatiquement
            <small class="hint">
              Sans cette option, l'app propose la nouvelle version et attend votre accord. Avec
              elle, elle la télécharge dès qu'elle la trouve, puis redémarre toute seule pour
              l'installer. Effet uniquement sur l'application installée.
            </small>
          </span>
        </label>
      </section>

      <div class="actions">
        <button
          type="button"
          class="button"
          :disabled="testing || saving"
          @click="store.testConnection(form)"
        >
          {{ testing ? 'Test en cours…' : 'Tester la connexion' }}
        </button>
        <span v-if="justSaved" class="saved" role="status">Réglages enregistrés.</span>
      </div>

      <div v-if="testResult" class="test-result" :class="{ ok: testResult.ok }" role="status">
        <strong>{{ testResult.ok ? 'Connexion réussie.' : testResult.message }}</strong>
        <small v-if="testResult.ok" class="hint">
          L'empreinte du serveur correspond et la clé est acceptée. Pensez à enregistrer.
        </small>
        <small v-else-if="testResult.technical" class="hint">{{ testResult.technical }}</small>
      </div>

      <Transition name="float">
        <div
          v-if="dirty"
          class="floating"
          role="region"
          aria-label="Modifications non enregistrées"
        >
          <span class="floating-text">Modifications non enregistrées</span>
          <button type="button" class="button" :disabled="saving" @click="discard">Annuler</button>
          <button type="submit" class="button primary" :disabled="saving">
            {{ saving ? 'Enregistrement…' : 'Enregistrer' }}
          </button>
        </div>
      </Transition>
    </form>
    <UpdatesPanel />
  </div>
</template>

<style scoped>
.page {
  display: grid;
  gap: 10px;
  max-width: 640px;
  margin: 0 auto;
}

.settings {
  display: grid;
  gap: 10px;
}

h1 {
  margin: 4px 0 6px;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.well {
  display: grid;
  gap: 14px;
}

.well > h2 {
  margin-bottom: 0;
}

.well > h3 {
  margin: 6px 0 -6px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--ink-soft);
}

label {
  display: grid;
  gap: 4px;
}

label > span {
  font-weight: 500;
}

.row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 14px;
}

input,
textarea {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--well-edge);
  border-radius: 4px;
  background: color-mix(in srgb, var(--well) 65%, var(--tray));
}

input:focus,
textarea:focus {
  border-color: var(--indigo);
}

textarea {
  resize: vertical;
  font-size: 13px;
}

.logs-pick {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  border: 0;
}

.logs-pick legend {
  padding: 0;
  margin-bottom: 8px;
  font-weight: 500;
}

.check {
  grid-template-columns: auto 1fr;
  align-items: start;
  gap: 10px;
}

.check input {
  width: auto;
  margin-top: 4px;
  accent-color: var(--indigo);
}

.check .hint {
  display: block;
}

.hint {
  margin: 0;
  color: var(--ink-soft);
  font-size: 12.5px;
}

code {
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--cell-off);
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: 12px;
}

.error {
  color: var(--lacquer);
  font-size: 12.5px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 4px;
}

.floating {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border: 1px solid var(--well-edge);
  border-radius: var(--radius-tray);
  background: var(--well);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
}

.floating-text {
  margin-right: 4px;
  color: var(--ink-soft);
  font-size: 13px;
}

.float-enter-active,
.float-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.float-enter-from,
.float-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

@media (prefers-reduced-motion: reduce) {
  .float-enter-active,
  .float-leave-active {
    transition: none;
  }
}

.saved {
  color: var(--jade);
  font-weight: 500;
}

.test-result {
  display: grid;
  gap: 2px;
  margin-top: 10px;
  padding: 10px 14px;
  border: 1px solid var(--well-edge);
  border-radius: var(--radius-well);
  background: var(--lacquer-lid);
}

.test-result.ok {
  background: var(--jade-lid);
}
</style>
