'use client'

import { useState } from 'react'
import CalendarTab   from './CalendarTab'
import MyJobsTab     from './MyJobsTab'
import BookJobTab    from './BookJobTab'
import NotificationsTab from './NotificationsTab'

type Tab = 'calendar' | 'jobs' | 'book' | 'notifications'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  {
    id: 'calendar',
    label: 'Calendar',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8"  y1="2" x2="8"  y2="6" />
        <line x1="3"  y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    id: 'jobs',
    label: 'My Jobs',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
        <rect x="9" y="3" width="6" height="4" rx="1" />
        <line x1="9" y1="12" x2="15" y2="12" />
        <line x1="9" y1="16" x2="13" y2="16" />
      </svg>
    ),
  },
  {
    id: 'book',
    label: 'Book Job',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="16" />
        <line x1="8"  y1="12" x2="16" y2="12" />
      </svg>
    ),
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    ),
  },
]

export default function SchedulerClient({ businessType }: { businessType?: string }) {
  const [activeTab,      setActiveTab]      = useState<Tab>('calendar')
  const [lunchActive,    setLunchActive]    = useState(false)
  const [lunchStartedAt, setLunchStartedAt] = useState<number | null>(null)
  const [lunchVersion,   setLunchVersion]   = useState(0)

  function goToBook() { setActiveTab('book') }

  function toggleLunch() {
    if (!lunchActive) {
      setLunchActive(true)
      setLunchStartedAt(Date.now())
      void fetch('/api/lunch-break', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'start' }),
      })
    } else {
      const mins = lunchStartedAt
        ? Math.max(1, Math.round((Date.now() - lunchStartedAt) / 60000))
        : 1
      setLunchActive(false)
      setLunchStartedAt(null)
      setLunchVersion((v) => v + 1)
      void fetch('/api/lunch-break', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'end', lunch_minutes: mins }),
      })
    }
  }

  return (
    <div>
      {/* ── Tab bar ── */}
      <div className="flex items-center gap-1 border-b border-dark-border mb-6 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`
              flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap
              border-b-2 -mb-px transition-colors
              ${activeTab === tab.id
                ? 'border-orange text-orange'
                : 'border-transparent text-white/40 hover:text-white'}
            `}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}

        {/* Lunch break button — right-aligned in tab bar */}
        <div className="ml-auto pl-3 flex-shrink-0 flex items-center pb-px">
          <button
            onClick={toggleLunch}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
              lunchActive
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-400 animate-pulse'
                : 'border-dark-border text-white/35 hover:text-white/60 hover:border-white/20'
            }`}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1M4.22 4.22l.7.7M18.36 18.36l.7.7M3 12h1m16 0h1M4.22 19.78l.7-.7M18.36 5.64l.7-.7"/>
              <circle cx="12" cy="12" r="4"/>
            </svg>
            {lunchActive ? 'ON BREAK' : 'Lunch Break'}
          </button>
        </div>
      </div>

      {/* ── Tab content ── */}
      {activeTab === 'calendar'      && <CalendarTab onBookJob={goToBook} />}
      {activeTab === 'jobs'          && (
        <MyJobsTab
          onBookJob={goToBook}
          businessType={businessType}
          lunchActive={lunchActive}
          lunchVersion={lunchVersion}
        />
      )}
      {activeTab === 'book'          && <BookJobTab  onSuccess={() => setActiveTab('jobs')} businessType={businessType} />}
      {activeTab === 'notifications' && <NotificationsTab />}
    </div>
  )
}
