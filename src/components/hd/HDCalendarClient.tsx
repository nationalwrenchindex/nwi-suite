'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

const HD_ORANGE = '#E85D24'
const HD_BLUE   = '#1A6BAF'

type WOStatus = 'open' | 'on_the_way' | 'in_progress' | 'completed' | 'invoiced' | 'cancelled'

interface CalendarWO {
  id:                string
  work_order_number: string | null
  status:            WOStatus
  service_type:      string | null
  total_amount:      number | null
  scheduled_at:      string | null
  unit:              { unit_number: string; manufacturer: string; model: string } | null
  fleet_account:     { fleet_name: string } | null
}

const STATUS_COLOR: Record<WOStatus, string> = {
  open:        HD_BLUE,
  on_the_way:  HD_BLUE,
  in_progress: HD_ORANGE,
  completed:   '#22C55E',
  invoiced:    '#22C55E',
  cancelled:   '#6B7280',
}

const STATUS_LABEL: Record<WOStatus, string> = {
  open:        'Scheduled',
  on_the_way:  'On My Way',
  in_progress: 'In Progress',
  completed:   'Completed',
  invoiced:    'Invoiced',
  cancelled:   'Cancelled',
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function pad2(n: number) { return String(n).padStart(2, '0') }
function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
function monthKey(year: number, month: number) { return `${year}-${pad2(month + 1)}` }
function monthLabel(year: number, month: number) {
  return new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase()
}
function buildGrid(year: number, month: number): string[][] {
  const firstDay    = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const grid: string[][] = []
  let week: string[] = []
  for (let i = 0; i < firstDay; i++) week.push('')
  for (let d = 1; d <= daysInMonth; d++) {
    week.push(`${year}-${pad2(month + 1)}-${pad2(d)}`)
    if (week.length === 7) { grid.push(week); week = [] }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push('')
    grid.push(week)
  }
  return grid
}

export default function HDCalendarClient() {
  const [mounted,    setMounted]    = useState(false)
  const [viewYear,   setViewYear]   = useState(0)
  const [viewMonth,  setViewMonth]  = useState(0)
  const [calendar,   setCalendar]   = useState<Record<string, CalendarWO[]>>({})
  const [selected,   setSelected]   = useState('')
  const [todayS,     setTodayS]     = useState('')
  const [loading,    setLoading]    = useState(true)

  const fetchMonth = useCallback(async (year: number, month: number) => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/hd/work-orders/calendar?month=${monthKey(year, month)}`)
      if (!res.ok) return
      const json = await res.json()
      setCalendar(json.calendar ?? {})
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const d = new Date()
    const year = d.getFullYear(); const month = d.getMonth()
    setViewYear(year); setViewMonth(month)
    setSelected(todayStr()); setTodayS(todayStr())
    setMounted(true)
    fetchMonth(year, month)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!mounted) return
    function onVisible() { if (!document.hidden) fetchMonth(viewYear, viewMonth) }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [mounted, viewYear, viewMonth, fetchMonth])

  function prevMonth() {
    const y = viewMonth === 0 ? viewYear - 1 : viewYear
    const m = viewMonth === 0 ? 11 : viewMonth - 1
    setViewYear(y); setViewMonth(m); fetchMonth(y, m)
  }
  function nextMonth() {
    const y = viewMonth === 11 ? viewYear + 1 : viewYear
    const m = viewMonth === 11 ? 0 : viewMonth + 1
    setViewYear(y); setViewMonth(m); fetchMonth(y, m)
  }
  function goToday() {
    const d = new Date()
    const year = d.getFullYear(); const month = d.getMonth()
    setViewYear(year); setViewMonth(month)
    setSelected(todayStr())
    fetchMonth(year, month)
  }

  if (!mounted) {
    return <div className="h-64 animate-pulse rounded-xl" style={{ background: '#111920' }} />
  }

  const grid   = buildGrid(viewYear, viewMonth)
  const dayWOs = calendar[selected] ?? []

  return (
    <div>
      {/* Legend */}
      <div className="flex items-center justify-end gap-5 mb-5 text-xs flex-wrap">
        {[
          { label: 'Scheduled',  color: HD_BLUE   },
          { label: 'In Progress', color: HD_ORANGE },
          { label: 'Completed',  color: '#22C55E'  },
          { label: 'Cancelled',  color: '#6B7280'  },
        ].map(l => (
          <span key={l.label} className="flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: l.color }} />
            {l.label}
          </span>
        ))}
      </div>

      <div className="flex flex-col lg:flex-row gap-6">

        {/* ── Calendar grid ── */}
        <div className="flex-1 min-w-0">

          {/* Month nav */}
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={prevMonth}
              className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors"
              style={{ border: '1px solid #1e3040', color: 'rgba(255,255,255,0.5)' }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <div className="flex items-center gap-3">
              <button
                onClick={goToday}
                className="text-xs px-2.5 py-1 rounded-lg"
                style={{ color: HD_ORANGE, border: `1px solid ${HD_ORANGE}50` }}
              >
                Today
              </button>
              <p className="font-condensed font-bold text-xl text-white tracking-wide">
                {monthLabel(viewYear, viewMonth)}
              </p>
            </div>

            <button
              onClick={nextMonth}
              className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors"
              style={{ border: '1px solid #1e3040', color: 'rgba(255,255,255,0.5)' }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Day labels */}
          <div className="grid grid-cols-7 mb-1">
            {DAY_LABELS.map(d => (
              <p key={d} className="text-center text-xs py-1.5 font-medium" style={{ color: 'rgba(255,255,255,0.3)' }}>
                {d}
              </p>
            ))}
          </div>

          {/* Grid */}
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040', background: '#0a0f14' }}>
            {loading ? (
              <div className="h-64 flex items-center justify-center">
                <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: HD_ORANGE, borderTopColor: 'transparent' }} />
              </div>
            ) : (
              grid.map((week, wi) => (
                <div
                  key={wi}
                  className="grid grid-cols-7"
                  style={{ borderBottom: wi < grid.length - 1 ? '1px solid #1e3040' : undefined }}
                >
                  {week.map((dateStr, di) => {
                    const wos        = dateStr ? (calendar[dateStr] ?? []) : []
                    const isToday    = dateStr === todayS
                    const isSelected = dateStr === selected

                    return (
                      <button
                        key={di}
                        onClick={() => dateStr && setSelected(dateStr)}
                        disabled={!dateStr}
                        className="p-1.5 text-left min-h-[72px] sm:min-h-[88px] transition-colors"
                        style={{
                          borderRight: di < 6 ? '1px solid #1e3040' : undefined,
                          background:  isSelected
                            ? `${HD_ORANGE}18`
                            : isToday
                            ? `${HD_BLUE}12`
                            : 'transparent',
                        }}
                      >
                        {dateStr && (
                          <>
                            <span
                              className="text-xs font-medium inline-flex items-center justify-center w-6 h-6 rounded-full mb-1"
                              style={{
                                background: isToday ? HD_ORANGE : 'transparent',
                                color: isToday ? '#fff' : isSelected ? HD_ORANGE : 'rgba(255,255,255,0.6)',
                                fontWeight: isToday || isSelected ? 700 : 400,
                              }}
                            >
                              {parseInt(dateStr.slice(8))}
                            </span>
                            <div className="space-y-0.5">
                              {wos.slice(0, 3).map(wo => (
                                <div
                                  key={wo.id}
                                  className="rounded text-[9px] font-semibold px-1 py-0.5 truncate leading-tight"
                                  style={{
                                    background: `${STATUS_COLOR[wo.status]}22`,
                                    color: STATUS_COLOR[wo.status],
                                  }}
                                >
                                  {wo.unit?.unit_number ?? wo.work_order_number ?? 'WO'}
                                </div>
                              ))}
                              {wos.length > 3 && (
                                <p className="text-[9px] pl-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>
                                  +{wos.length - 3}
                                </p>
                              )}
                            </div>
                          </>
                        )}
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Day panel ── */}
        <div className="lg:w-80 xl:w-96 flex-shrink-0">
          <div className="rounded-xl overflow-hidden" style={{ background: '#111920', border: '1px solid #1e3040' }}>

            {/* Panel header */}
            <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid #1e3040' }}>
              <p className="font-condensed font-bold text-white text-sm tracking-wide">
                {selected
                  ? new Date(selected + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                  : 'Select a day'}
              </p>
              <Link
                href="/hd/work-orders?new=1"
                className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white"
                style={{ background: HD_ORANGE }}
              >
                + New Job
              </Link>
            </div>

            <div className="p-3">
              {dayWOs.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="text-sm mb-3" style={{ color: 'rgba(255,255,255,0.25)' }}>No jobs scheduled</p>
                  <Link href="/hd/work-orders?new=1" className="text-xs" style={{ color: HD_ORANGE }}>
                    + Schedule a job
                  </Link>
                </div>
              ) : (
                <div className="space-y-2">
                  {dayWOs.map(wo => (
                    <Link
                      key={wo.id}
                      href="/hd/work-orders"
                      className="block rounded-xl p-3 transition-opacity hover:opacity-80"
                      style={{ background: '#162030', border: `1px solid ${STATUS_COLOR[wo.status]}35` }}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <p className="text-sm text-white font-medium leading-tight">
                          {wo.work_order_number ?? `WO-${wo.id.slice(0, 6).toUpperCase()}`}
                        </p>
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                          style={{ background: `${STATUS_COLOR[wo.status]}25`, color: STATUS_COLOR[wo.status] }}
                        >
                          {STATUS_LABEL[wo.status]}
                        </span>
                      </div>
                      {wo.unit && (
                        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
                          {wo.unit.unit_number} — {wo.unit.manufacturer} {wo.unit.model}
                        </p>
                      )}
                      {wo.fleet_account && (
                        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>{wo.fleet_account.fleet_name}</p>
                      )}
                      {wo.service_type && (
                        <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>{wo.service_type}</p>
                      )}
                      {wo.total_amount && (
                        <p className="text-sm font-semibold mt-1" style={{ color: HD_ORANGE }}>
                          ${Number(wo.total_amount).toFixed(0)}
                        </p>
                      )}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
