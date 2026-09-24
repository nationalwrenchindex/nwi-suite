'use client'

// Per-business Work Orders switch for the admin table. Optimistic, because the
// row it sits in is server-rendered: waiting for revalidation would leave the
// switch looking dead for the length of a round trip.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

export default function WorkOrdersToggle({
  userId,
  enabled: initial,
}: {
  userId:  string
  enabled: boolean
}) {
  const [enabled, setEnabled] = useState(initial)
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const router = useRouter()

  async function toggle() {
    const next = !enabled
    setEnabled(next)          // optimistic
    setBusy(true)
    try {
      const res = await fetch('/api/admin/work-orders-flag', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ user_id: userId, enabled: next }),
      })
      if (!res.ok) {
        setEnabled(!next)     // roll back so the switch never lies about the DB
      } else {
        startTransition(() => router.refresh())
      }
    } catch {
      setEnabled(!next)
    }
    setBusy(false)
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy || pending}
      aria-pressed={enabled}
      title={enabled ? 'Work orders ON — click to disable' : 'Work orders OFF — click to enable'}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-150 focus:outline-none disabled:opacity-40 ${
        enabled ? 'border-orange bg-orange' : 'border-white/20 bg-white/10'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-150 ${
          enabled ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}
