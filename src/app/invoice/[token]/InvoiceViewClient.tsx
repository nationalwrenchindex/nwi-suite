'use client'

import { useEffect, useRef } from 'react'

export default function InvoiceViewClient({ token }: { token: string }) {
  const tracked = useRef(false)

  useEffect(() => {
    if (tracked.current) return
    tracked.current = true
    fetch(`/api/invoices/public/${token}/view`, { method: 'POST' }).catch(() => {})
  }, [token])

  return null
}
