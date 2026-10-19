import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

createApp(App).mount('#app')

// Only the shell is cached (see public/sw.js), so an unreachable bento shows a clear message
// instead of the browser's error page. It needs https, which `tailscale serve` provides.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // Not installable here (plain http, private window): the page works the same without it.
  })
}
