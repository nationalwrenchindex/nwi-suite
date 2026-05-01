'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface Notification {
  id:         string
  type:       string
  title:      string
  body:       string
  link:       string | null
  read_at:    string | null
  created_at: string
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60_000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function InboxBell() {
  const router = useRouter()
  const [notifs, setNotifs]   = useState<Notification[]>([])
  const [unread, setUnread]   = useState(0)
  const [open,   setOpen]     = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const fetchInbox = useCallback(async () => {
    try {
      const res  = await fetch('/api/inbox')
      if (!res.ok) return
      const json = await res.json()
      setNotifs(json.notifications ?? [])
      setUnread(json.unread ?? 0)
    } catch { /* silently ignore */ }
  }, [])

  // Initial fetch + 30-second polling
  useEffect(() => {
    fetchInbox()
    const id = setInterval(fetchInbox, 30_000)
    return () => clearInterval(id)
  }, [fetchInbox])

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  async function handleClick(n: Notification) {
    setOpen(false)
    if (!n.read_at) {
      await fetch(`/api/inbox/${n.id}`, { method: 'PATCH' }).catch(() => {})
      setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x))
      setUnread(prev => Math.max(0, prev - 1))
    }
    if (n.link) {
      // Strip origin if present so router.push works correctly
      const url = n.link.startsWith('http') ? new URL(n.link).pathname + new URL(n.link).search : n.link
      router.push(url)
    }
  }

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen(v => !v)}
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
        className="relative flex items-center justify-center w-8 h-8 rounded-lg border border-dark-border text-white/40 hover:text-white hover:border-white/20 transition-colors"
      >
        {/* Bell icon */}
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-0.5 flex items-center justify-center rounded-full bg-[#FF6600] text-white text-[9px] font-bold leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-80 rounded-xl border border-dark-border bg-dark-card shadow-xl">
          <div className="px-4 py-3 border-b border-dark-border flex items-center justify-between">
            <p className="text-white/40 text-xs uppercase tracking-widest">Notifications</p>
            {unread > 0 && (
              <span className="text-[#FF6600] text-xs font-semibold">{unread} unread</span>
            )}
          </div>

          {notifs.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-white/40 text-sm">No notifications yet</p>
            </div>
          ) : (
            <ul className="divide-y divide-dark-border max-h-96 overflow-y-auto">
              {notifs.map(n => (
                <li key={n.id}>
                  <button
                    onClick={() => handleClick(n)}
                    className={`w-full text-left px-4 py-3 hover:bg-white/5 transition-colors ${
                      !n.read_at ? 'bg-white/[0.03]' : ''
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {!n.read_at && (
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#FF6600] flex-shrink-0" />
                      )}
                      <div className={!n.read_at ? '' : 'pl-3.5'}>
                        <p className="text-white text-sm font-medium leading-snug">{n.title}</p>
                        {n.body && (
                          <p className="text-white/50 text-xs mt-0.5 leading-snug line-clamp-2">{n.body}</p>
                        )}
                        <p className="text-white/25 text-xs mt-1">{timeAgo(n.created_at)}</p>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
