'use client'

import { useState } from 'react'
import CustomersTab  from './CustomersTab'
import VinLookupTab  from './VinLookupTab'
import AlertsTab     from './AlertsTab'

type Tab = 'customers' | 'vin' | 'alerts'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  {
    id: 'customers',
    label: 'Customers',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    id: 'vin',
    label: 'VIN Decoder',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        <circle cx="12" cy="16" r="1" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: 'alerts',
    label: 'Service Alerts',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
  },
]

export default function IntelClient({ slug }: { slug?: string }) {
  const [activeTab, setActiveTab] = useState<Tab>('customers')

  return (
    <div>
      {/* Tab bar */}
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
      </div>

      {activeTab === 'customers' && <CustomersTab slug={slug} />}
      {activeTab === 'vin'       && <VinLookupTab />}
      {activeTab === 'alerts'    && <AlertsTab />}
    </div>
  )
}
