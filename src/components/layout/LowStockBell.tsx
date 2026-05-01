'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'

export default function LowStockBell() {
  const [count,   setCount]   = useState(0)
  const [open,    setOpen]    = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function fetchCount() {
      try {
        const res  = await fetch('/api/inventory/low-stock')
        const json = await res.json()
        setCount(json.count ?? 0)
      } catch { /* silently ignore — bell just shows 0 */ }
    }
    fetchCount()
    // Re-check every 60 seconds while the tab is open
    const id = setInterval(fetchCount, 60_000)
    return () => clearInterval(id)
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen(v => !v)}
        aria-label={`Low-stock alerts${count > 0 ? ` (${count})` : ''}`}
        className="relative flex items-center justify-center w-8 h-8 rounded-lg border border-dark-border text-white/40 hover:text-white hover:border-white/20 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-0.5 flex items-center justify-center rounded-full bg-danger text-white text-[9px] font-bold leading-none">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-64 rounded-xl border border-dark-border bg-dark-card shadow-xl">
          <div className="px-4 py-3 border-b border-dark-border">
            <p className="text-white/40 text-xs uppercase tracking-widest">Low Stock</p>
          </div>
          {count === 0 ? (
            <div className="px-4 py-5 text-center">
              <p className="text-success text-sm font-medium">All products stocked</p>
              <p className="text-white/30 text-xs mt-0.5">Nothing running low right now.</p>
            </div>
          ) : (
            <div className="px-4 py-3 space-y-1">
              <p className="text-danger text-sm font-medium">{count} product{count !== 1 ? 's' : ''} running low</p>
              <p className="text-white/40 text-xs">Check your inventory to restock.</p>
            </div>
          )}
          <div className="px-4 py-3 border-t border-dark-border">
            <Link
              href="/inventory"
              onClick={() => setOpen(false)}
              className="block text-center text-xs text-orange hover:text-orange-light transition-colors font-medium"
            >
              Manage Inventory →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
