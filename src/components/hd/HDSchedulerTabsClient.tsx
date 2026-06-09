'use client'

import { useState } from 'react'
import HDCalendarClient  from './HDCalendarClient'
import HDSchedulerClient from './HDSchedulerClient'

const HD_ORANGE = '#E85D24'

type WOStatus = 'open' | 'on_the_way' | 'in_progress' | 'completed' | 'invoiced' | 'cancelled'
interface WorkOrder {
  id:                string
  work_order_number: string | null
  status:            WOStatus
  service_type:      string | null
  total_amount:      number | null
  created_at:        string
  scheduled_at:      string | null
  unit:              { unit_number: string; manufacturer: string; model: string } | null
  fleet_account:     { fleet_name: string } | null
}

type Tab = 'calendar' | 'jobs'

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
]

export default function HDSchedulerTabsClient({
  workOrders,
  laborRate,
  activeCount,
}: {
  workOrders:  WorkOrder[]
  laborRate:   number
  activeCount: number
}) {
  const [activeTab, setActiveTab] = useState<Tab>('calendar')

  return (
    <div>
      {/* Tab bar */}
      <div className="flex items-center gap-1 mb-6 border-b" style={{ borderColor: '#1e3040' }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors relative"
            style={activeTab === tab.id
              ? { color: HD_ORANGE }
              : { color: 'rgba(255,255,255,0.4)' }
            }
          >
            {tab.icon}
            {tab.label}
            {tab.id === 'jobs' && activeCount > 0 && (
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-0.5"
                style={{ background: `${HD_ORANGE}25`, color: HD_ORANGE }}
              >
                {activeCount}
              </span>
            )}
            {activeTab === tab.id && (
              <span
                className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t"
                style={{ background: HD_ORANGE }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'calendar' && <HDCalendarClient />}
      {activeTab === 'jobs'     && (
        <HDSchedulerClient workOrders={workOrders} laborRate={laborRate} />
      )}
    </div>
  )
}
