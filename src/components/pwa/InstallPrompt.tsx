'use client'

import { useEffect, useState } from 'react'

// The beforeinstallprompt event is Chromium-only and still not in lib.dom, so it
// is declared here rather than pulled from a @types package.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'nwi-pwa-dismissed'

// Safari in private mode throws on localStorage access rather than returning
// null, and a throw here would take the whole banner down. Dismissal is a nicety,
// so both helpers fail silently.
function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

function writeDismissed() {
  try {
    window.localStorage.setItem(DISMISS_KEY, '1')
  } catch {
    // ignore — the banner just reappears next visit
  }
}

function isStandalone(): boolean {
  // Chromium/Android report standalone through the display-mode media query;
  // iOS Safari never has, and only exposes the legacy navigator.standalone flag.
  const displayMode = window.matchMedia?.('(display-mode: standalone)').matches ?? false
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  return displayMode || iosStandalone
}

function isIOS(): boolean {
  const ua = window.navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua)) return true
  // iPadOS 13+ ships a desktop user agent string that says "Macintosh". The only
  // reliable tell is that a real Mac reports maxTouchPoints of 0 or 1, while an
  // iPad reports 5. Without this branch every iPad falls through to the Chromium
  // path and — since beforeinstallprompt never fires on iOS — sees nothing.
  return ua.includes('Macintosh') && navigator.maxTouchPoints > 1
}

export default function InstallPrompt() {
  // Everything below depends on window, so nothing renders until after mount.
  // Returning null on the server and on the first client pass keeps the markup
  // identical across hydration.
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [ios, setIOS] = useState(false)
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    setMounted(true)

    if (isStandalone() || readDismissed()) return

    if (isIOS()) {
      // iOS Safari never fires beforeinstallprompt and has no programmatic
      // install API, so the only thing we can do is tell the user where the
      // Share sheet is. Roughly half the field techs are on iPhones — skipping
      // this branch would leave them with no install path at all.
      setIOS(true)
      setVisible(true)
      return
    }

    function onBeforeInstallPrompt(event: Event) {
      // Suppress Chrome's own mini-infobar so our branded banner is the only
      // install affordance on screen.
      event.preventDefault()
      setDeferred(event as BeforeInstallPromptEvent)
      setVisible(true)
    }

    function onInstalled() {
      setVisible(false)
      setDeferred(null)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  async function install() {
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice
    // The event is single-use — Chrome will fire a fresh one later if the user
    // declined, so drop this one either way.
    setDeferred(null)
    setVisible(false)
  }

  function dismiss() {
    writeDismissed()
    setVisible(false)
  }

  if (!mounted || !visible) return null

  return (
    <div
      role="dialog"
      aria-label="Install NWI Suite"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-xl border p-4 shadow-2xl"
      style={{ background: '#111920', borderColor: '#1e3040' }}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          style={{ background: '#0f1923', border: '1px solid #1e3040' }}
          aria-hidden="true"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="#ff6600">
            <path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z" />
          </svg>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">Install NWI Suite</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            {ios
              ? 'Tap the Share button, then choose "Add to Home Screen" for full-screen access.'
              : 'Add NWI to your home screen for faster, full-screen access in the field.'}
          </p>

          <div className="mt-3 flex items-center gap-2">
            {!ios && (
              <button
                type="button"
                onClick={install}
                className="rounded-md px-3 py-1.5 text-xs font-semibold text-white"
                style={{ background: '#ff6600' }}
              >
                Install
              </button>
            )}
            <button
              type="button"
              onClick={dismiss}
              className="rounded-md border px-3 py-1.5 text-xs font-medium text-slate-300"
              style={{ borderColor: '#1e3040' }}
            >
              {ios ? 'Got it' : 'Not now'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
