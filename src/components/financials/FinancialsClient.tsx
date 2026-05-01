'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import QuotesTab    from './QuotesTab'
import OverviewTab  from './OverviewTab'
import InvoicesTab  from './InvoicesTab'
import ExpensesTab  from './ExpensesTab'

type Tab = 'quotes' | 'overview' | 'invoices' | 'expenses'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  {
    id: 'quotes',
    label: 'Quotes',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z" />
      </svg>
    ),
  },
  {
    id: 'overview',
    label: 'Overview',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    id: 'invoices',
    label: 'Invoices',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
  },
  {
    id: 'expenses',
    label: 'Expenses',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
]

export default function FinancialsClient({ businessType }: { businessType?: string }) {
  const searchParams = useSearchParams()
  const tabParam     = searchParams.get('tab') as Tab | null
  const quoteParam   = searchParams.get('quote') ?? undefined

  const [activeTab, setActiveTab] = useState<Tab>(() => {
    if (tabParam && TABS.some(t => t.id === tabParam)) return tabParam
    return 'quotes'
  })

  // Sync if the URL changes (e.g. browser back/forward)
  useEffect(() => {
    if (tabParam && TABS.some(t => t.id === tabParam)) {
      setActiveTab(tabParam)
    }
  }, [tabParam])

  return (
    <div>
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-dark-border mb-6 overflow-x-auto">
        {TABS.map(tab => (
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

      {activeTab === 'quotes'   && <QuotesTab initialQuoteId={quoteParam} isDetailer={businessType === 'detailer'} />}
      {activeTab === 'overview' && <OverviewTab />}
      {activeTab === 'invoices' && <InvoicesTab />}
      {activeTab === 'expenses' && <ExpensesTab />}
    </div>
  )
}
