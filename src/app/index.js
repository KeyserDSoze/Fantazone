import { registerRootComponent } from 'expo'
import App from './App'

if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/fantazone-push-sw.js').catch(() => {
      // Offline shell support is an optimization; the application must still boot normally.
    })
  })
}

registerRootComponent(App)
