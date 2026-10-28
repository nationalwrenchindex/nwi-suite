'use client'

// /hd/parts and /reefer/parts: the counter, the shop's inventory, and - until its 255
// rows are folded into the one parts store - the old Parts Lookup.
//
// The tab is in the URL (?tab=inventory) so a link can open the right one and the
// server renders it, which is what lets the smoke suite assert it in rendered HTML.

import { useState } from 'react'
import PartsCounter from '@/components/parts/PartsCounter'
import PartsInventory from '@/components/parts/PartsInventory'
import PartsLookup from './PartsLookup'

export type PartsTab = 'counter' | 'inventory' | 'lookup'

const TABS: Array<{ id: PartsTab; label: string }> = [
  { id: 'counter',   label: 'Counter' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'lookup',    label: 'Parts Lookup (old)' },
]

export default function PartsHome({ initialTab, scope, canSeed, surface }: {
  initialTab: PartsTab
  scope: 'all' | 'reefer'
  canSeed: boolean
  surface: 'HD Suite' | 'NWI Reefer'
}) {
  const [tab, setTab] = useState<PartsTab>(initialTab)

  function pick(t: PartsTab) {
    setTab(t)
    // Keep the URL in step without a navigation, so a refresh lands on the same tab.
    const url = new URL(window.location.href)
    if (t === 'counter') url.searchParams.delete('tab'); else url.searchParams.set('tab', t)
    window.history.replaceState(null, '', url.toString())
  }

  const tabs = (
    <div className="flex gap-1 border-b overflow-x-auto" style={{ borderColor: 'var(--hd-border)' }} role="tablist">
      {TABS.map(t => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          onClick={() => pick(t.id)}
          className="px-4 py-2.5 text-sm font-semibold whitespace-nowrap text-white"
          style={{ borderBottom: tab === t.id ? '3px solid #FF6600' : '3px solid transparent', minHeight: 44 }}
        >
          {t.label}
        </button>
      ))}
    </div>
  )

  // The old lookup renders its own page body; it sits under the same tab bar.
  if (tab === 'lookup') {
    return (
      <div className="flex-1 flex flex-col">
        <div className="px-4 sm:px-6 pt-4 sm:pt-6">{tabs}</div>
        <PartsLookup canSeed={canSeed} />
      </div>
    )
  }

  return (
    <main className="flex-1 p-4 sm:p-6 space-y-5">
      <div>
        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--hd-text-faint)' }}>{surface}</p>
        <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">
          {tab === 'counter' ? 'PARTS COUNTER' : 'PARTS INVENTORY'}
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--hd-text-muted)' }}>
          {tab === 'counter'
            ? 'Pick the unit, then the part. Every answer says how far to trust it.'
            : 'What is on your shelves and trucks. Every change is a ledger entry.'}
        </p>
      </div>
      {tabs}
      {tab === 'counter' ? <PartsCounter scope={scope} /> : <PartsInventory scope={scope} />}
    </main>
  )
}
