'use client'

import { useEffect } from 'react'

/**
 * Registers /sw.js and bridges its messages to the page.
 *
 * Rendered once from the root layout. Renders null — nothing here touches the
 * server-rendered markup, so there is no hydration mismatch to worry about.
 */

/**
 * Module-level, deliberately outside the component. A `controllerchange` reload
 * would otherwise re-mount the component, register again, and reload again — an
 * infinite refresh loop that is very hard to diagnose because the page never stays
 * up long enough to inspect. Module scope survives re-mounts within a document and
 * resets on the reload itself, which is exactly the lifetime we want.
 */
let reloading = false

/** Event the pre-trip page listens for to drain its localStorage queue. */
const FLUSH_EVENT = 'nwi-flush-queue'

export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return

    // Production only. A service worker in dev caches hashed chunks that the dev
    // server is actively rebuilding, so you edit a file, see nothing change, and
    // lose an afternoon to a stale bundle that no hard refresh clears. There is no
    // offline scenario worth testing on localhost that is worth that.
    if (process.env.NODE_ENV !== 'production') return

    const onControllerChange = () => {
      if (reloading) return
      reloading = true
      window.location.reload()
    }

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string } | null
      if (!data || data.type !== 'NWI_FLUSH_QUEUE') return
      // Re-dispatch as a plain window event so pages can listen without knowing
      // anything about service workers.
      window.dispatchEvent(new CustomEvent(FLUSH_EVENT))
    }

    const register = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch((err) => {
          // A failed registration must never break the app — offline support is
          // additive. Log and carry on.
          console.error('[nwi] service worker registration failed', err)
        })
    }

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    navigator.serviceWorker.addEventListener('message', onMessage)

    if (document.readyState === 'complete') {
      register()
    } else {
      // Registering after load keeps the SW's own fetches off the critical path of
      // the first render.
      window.addEventListener('load', register, { once: true })
    }

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      navigator.serviceWorker.removeEventListener('message', onMessage)
      window.removeEventListener('load', register)
    }
  }, [])

  return null
}
