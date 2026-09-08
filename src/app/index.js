import { registerRootComponent } from 'expo'
import App from './App'

if (typeof document !== 'undefined') {
  const styleId = 'fantazone-global-web-style'
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style')
    style.id = styleId
    style.textContent = `
      * {
        scrollbar-width: thin;
        scrollbar-color: var(--color8, #64748b) transparent;
      }

      *::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }

      *::-webkit-scrollbar-track {
        background: transparent;
      }

      *::-webkit-scrollbar-thumb {
        min-height: 36px;
        border: 2px solid transparent;
        border-radius: 999px;
        background: linear-gradient(
          180deg,
          var(--color8, #64748b),
          var(--blue8, #3b82f6)
        );
        background-clip: padding-box;
      }

      *::-webkit-scrollbar-thumb:hover {
        background: linear-gradient(
          180deg,
          var(--color10, #94a3b8),
          var(--blue10, #60a5fa)
        );
        background-clip: padding-box;
      }

      *::-webkit-scrollbar-corner {
        background: transparent;
      }

      *::-webkit-scrollbar-button {
        width: 0;
        height: 0;
        display: none;
      }
    `
    document.head.appendChild(style)
  }
}

if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/fantazone-push-sw.js').catch(() => {
      // Offline shell support is an optimization; the application must still boot normally.
    })
  })
}

registerRootComponent(App)
