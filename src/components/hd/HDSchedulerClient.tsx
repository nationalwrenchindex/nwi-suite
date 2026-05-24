'use client'

import { useState, useEffect, useCallback } from 'react'

const HD_ORANGE = '#E85D24'
const HD_BLUE   = '#1A6BAF'

type WOStatus = 'open' | 'on_the_way' | 'in_progress' | 'completed' | 'invoiced' | 'cancelled'

interface WorkOrder {
  id:               string
  work_order_number: string | null
  status:           WOStatus
  service_type:     string | null
  total_amount:     number | null
  created_at:       string
  scheduled_at:     string | null
  unit:             { unit_number: string; manufacturer: string; model: string } | null
  fleet_account:    { fleet_name: string } | null
}

const STATUS_LABELS: Record<WOStatus, string> = {
  open:        'Scheduled',
  on_the_way:  'On My Way',
  in_progress: 'Working',
  completed:   'Completed',
  invoiced:    'Invoiced',
  cancelled:   'Cancelled',
}

const STATUS_COLORS: Record<WOStatus, string> = {
  open:        '#6B7280',
  on_the_way:  HD_BLUE,
  in_progress: HD_ORANGE,
  completed:   '#22C55E',
  invoiced:    '#22C55E',
  cancelled:   '#EF4444',
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function JobCard({ wo, laborRate }: { wo: WorkOrder; laborRate: number }) {
  const storageKey = `hd_timer_${wo.id}`

  const [status,   setStatus]   = useState<WOStatus>(wo.status)
  const [loading,  setLoading]  = useState(false)
  const [elapsed,  setElapsed]  = useState(0)
  const [timerOn,  setTimerOn]  = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)

  // Restore timer from localStorage on mount
  useEffect(() => {
    if (status === 'in_progress') {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const ts = Number(saved)
        setStartedAt(ts)
        setTimerOn(true)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Tick
  useEffect(() => {
    if (!timerOn || startedAt === null) return
    const interval = setInterval(() => {
      setElapsed(Date.now() - startedAt)
    }, 1000)
    return () => clearInterval(interval)
  }, [timerOn, startedAt])

  const transition = useCallback(async (newStatus: WOStatus) => {
    setLoading(true)
    try {
      const body: Record<string, unknown> = { status: newStatus }

      if (newStatus === 'in_progress') {
        const now = Date.now()
        setStartedAt(now)
        setTimerOn(true)
        setElapsed(0)
        localStorage.setItem(storageKey, String(now))
      }

      if (newStatus === 'completed') {
        setTimerOn(false)
        const laborMinutes = startedAt ? Math.round((Date.now() - startedAt) / 60000) : 0
        body.labor_minutes = laborMinutes
        localStorage.removeItem(storageKey)
      }

      const res = await fetch(`/api/hd/work-orders/${wo.id}/status`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      if (res.ok) {
        setStatus(newStatus)
      }
    } finally {
      setLoading(false)
    }
  }, [storageKey, startedAt, wo.id])

  const laborHours = elapsed > 0 ? elapsed / 3600000 : 0
  const laborEst   = laborHours * laborRate

  const color = STATUS_COLORS[status]

  return (
    <div
      className="rounded-xl p-5 flex flex-col gap-4"
      style={{ background: '#111920', border: `1px solid ${color}50` }}
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="text-xs font-bold px-2 py-0.5 rounded-full"
              style={{ background: `${color}20`, color }}
            >
              {STATUS_LABELS[status]}
            </span>
          </div>
          <p className="font-condensed font-bold text-white text-lg tracking-wide leading-tight">
            {wo.work_order_number ?? `WO-${wo.id.slice(0, 6).toUpperCase()}`}
          </p>
          <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
            {wo.service_type ?? 'Service'}
          </p>
        </div>
        {wo.total_amount && (
          <p className="font-condensed font-bold text-xl" style={{ color: HD_ORANGE }}>${Number(wo.total_amount).toFixed(0)}</p>
        )}
      </div>

      {/* Unit and fleet info */}
      {(wo.unit || wo.fleet_account) && (
        <div className="rounded-lg p-3 space-y-1" style={{ background: '#162030' }}>
          {wo.unit && (
            <p className="text-sm text-white font-medium">
              {wo.unit.unit_number} — {wo.unit.manufacturer} {wo.unit.model}
            </p>
          )}
          {wo.fleet_account && (
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>{wo.fleet_account.fleet_name}</p>
          )}
        </div>
      )}

      {/* Timer display */}
      {status === 'in_progress' && (
        <div className="rounded-lg p-4 text-center" style={{ background: `${HD_ORANGE}15`, border: `1px solid ${HD_ORANGE}30` }}>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>On Job</p>
          <p className="font-condensed font-bold text-4xl" style={{ color: HD_ORANGE }}>
            {timerOn ? formatElapsed(elapsed) : '--:--'}
          </p>
          {elapsed > 0 && (
            <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
              est. ${laborEst.toFixed(0)} @ ${laborRate}/hr
            </p>
          )}
        </div>
      )}

      {/* Action buttons — large touch targets */}
      {status === 'open' && (
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => transition('on_the_way')}
            disabled={loading}
            className="py-4 rounded-xl font-bold text-white text-sm tracking-wide"
            style={{ background: HD_BLUE, opacity: loading ? 0.6 : 1 }}
          >
            On My Way
          </button>
          <button
            onClick={() => transition('in_progress')}
            disabled={loading}
            className="py-4 rounded-xl font-bold text-white text-sm tracking-wide"
            style={{ background: HD_ORANGE, opacity: loading ? 0.6 : 1 }}
          >
            Arrived — Start Timer
          </button>
        </div>
      )}

      {status === 'on_the_way' && (
        <button
          onClick={() => transition('in_progress')}
          disabled={loading}
          className="w-full py-5 rounded-xl font-bold text-white text-lg tracking-wide"
          style={{ background: HD_ORANGE, opacity: loading ? 0.6 : 1 }}
        >
          Arrived — Start Timer
        </button>
      )}

      {status === 'in_progress' && (
        <button
          onClick={() => transition('completed')}
          disabled={loading}
          className="w-full py-5 rounded-xl font-bold text-white text-lg tracking-wide"
          style={{ background: '#22C55E', opacity: loading ? 0.6 : 1 }}
        >
          Complete Job — Stop Timer
        </button>
      )}

      {(status === 'completed' || status === 'invoiced') && (
        <div className="py-3 text-center rounded-xl" style={{ background: '#22C55E15', border: '1px solid #22C55E30' }}>
          <p className="text-sm font-semibold" style={{ color: '#22C55E' }}>
            {status === 'invoiced' ? 'Invoiced' : 'Job Complete'}
          </p>
        </div>
      )}
    </div>
  )
}

export default function HDSchedulerClient({
  workOrders,
  laborRate,
}: {
  workOrders: WorkOrder[]
  laborRate:  number
}) {
  const [filter, setFilter] = useState<'active' | 'all'>('active')

  const displayed = filter === 'active'
    ? workOrders.filter(wo => !['completed', 'invoiced', 'cancelled'].includes(wo.status))
    : workOrders

  return (
    <div>
      <div className="flex gap-2 mb-5">
        {[
          { key: 'active' as const, label: 'Active Jobs' },
          { key: 'all'    as const, label: 'All Jobs'    },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={filter === f.key
              ? { background: `${HD_ORANGE}20`, color: HD_ORANGE, border: `1px solid ${HD_ORANGE}50` }
              : { color: 'rgba(255,255,255,0.4)', border: '1px solid #1e3040' }
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {displayed.length === 0 ? (
        <div className="py-16 text-center rounded-xl" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>
            {filter === 'active' ? 'No active jobs' : 'No work orders'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {displayed.map(wo => (
            <JobCard key={wo.id} wo={wo} laborRate={laborRate} />
          ))}
        </div>
      )}
    </div>
  )
}
