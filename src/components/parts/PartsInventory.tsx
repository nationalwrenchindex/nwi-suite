'use client'

// The shop's parts inventory: what is on which shelf or truck, what it cost, and every
// movement that put it there. One component for /hd/parts and /reefer/parts.
//
// EVERYTHING THAT CHANGES A COUNT IS A LEDGER ROW. Receive, count and transfer each
// write a stock_movement through /api/parts/stock; nothing on this screen sets on_hand.
// Allocation (an open work order) and deduction (the invoice) happen on those screens,
// through the same ledger, and show up here.
//
// NO VENDOR NAME, ANYWHERE. A receipt takes a quantity, what was paid and a reference
// number. There is no supplier field, so no store's name can ever sit beside a cost.

import { useCallback, useEffect, useState } from 'react'

interface StockRow {
  inventory_id: string; part_id: string; location_id: string; location_name: string | null
  location_kind: string | null; bin: string | null; on_hand: number; min_qty: number | null
  last_cost: number | null; sell_price: number | null; allocated: number; available: number
  below_minimum: boolean; negative: boolean
  part_number: string; description: string | null; part_type: string; manufacturer: string
}
interface Location { id: string; name: string; kind: string; is_default: boolean; active: boolean }
interface Movement {
  id: string; part_id: string; location_id: string; delta: number; reason: string
  unit_cost: number | null; source_ref: string | null; note: string | null; created_at: string; part_number: string
}
interface StockResponse { stock: StockRow[]; locations: Location[]; movements: Movement[] }
interface PartHit { id: string; part_number: string; description: string | null; part_type: string; manufacturer: string }

const PRIMARY = '#FF6600'
const field = { background: 'var(--hd-card)', border: '1px solid var(--hd-border)', minHeight: 44 } as const
const inputCls = 'w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder:text-white/30 outline-none'
const secondaryCls = 'px-3 py-2 rounded-lg text-sm font-medium text-white'
const secondaryStyle = { background: 'var(--hd-inner)', border: '1px solid var(--hd-border)' } as const

const money = (n: number | null | undefined) => (n == null ? '--' : `$${Number(n).toFixed(2)}`)

const REASON_LABEL: Record<string, string> = {
  received: 'Received', used: 'Used on invoice', adjusted: 'Count adjustment',
  transferred_in: 'Transfer in', transferred_out: 'Transfer out', returned: 'Returned', opening: 'Opening stock',
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="block text-xs mb-1" style={{ color: 'var(--hd-text-faint)' }}>{children}</span>
}

async function post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch('/api/parts/stock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json as { error?: string }).error ?? 'That did not save.')
  return json as Record<string, unknown>
}

export default function PartsInventory({ scope }: { scope: 'all' | 'reefer' }) {
  const [data, setData] = useState<StockResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [panel, setPanel] = useState<null | 'receive' | 'location'>(null)
  const [active, setActive] = useState<{ row: StockRow; mode: 'count' | 'transfer' | 'edit' | 'history' } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/parts/stock', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not read stock.')
      setData(json as StockResponse); setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read stock.')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const done = async (msg: string) => { setNotice(msg); setPanel(null); setActive(null); await load() }
  const locations = (data?.locations ?? []).filter(l => l.active)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setPanel(panel === 'receive' ? null : 'receive')}
          className="px-5 rounded-lg text-sm font-semibold text-on-accent" style={{ background: PRIMARY, minHeight: 44 }}>
          Receive stock
        </button>
        <button type="button" onClick={() => setPanel(panel === 'location' ? null : 'location')} className={secondaryCls} style={{ ...secondaryStyle, minHeight: 44 }}>
          Add a location
        </button>
        <p className="text-xs" style={{ color: 'var(--hd-text-muted)' }}>
          Locations: {locations.length ? locations.map(l => `${l.name}${l.kind === 'vehicle' ? ' (truck)' : ''}`).join(', ') : 'none yet - the first receipt creates "Shop"'}
        </p>
      </div>

      {notice && <p className="text-sm" style={{ color: 'var(--hd-positive)' }}>{notice}</p>}
      {error && <p className="text-sm" style={{ color: 'var(--hd-negative)' }}>{error}</p>}

      {panel === 'receive' && <ReceivePanel scope={scope} locations={locations} onDone={done} onCancel={() => setPanel(null)} />}
      {panel === 'location' && <LocationPanel onDone={done} onCancel={() => setPanel(null)} />}

      {data && data.stock.length === 0 && (
        <div className="rounded-xl p-6 text-center" style={{ background: 'var(--hd-card)', border: '1px solid var(--hd-border)' }}>
          <p className="text-white text-sm font-medium">Nothing is stocked yet.</p>
          <p className="text-sm mt-2" style={{ color: 'var(--hd-text-muted)' }}>
            Receive a part to start. Parts put on an open work order are held against it; the invoice takes them off the shelf.
          </p>
        </div>
      )}

      {data && data.stock.length > 0 && (
        <div className="rounded-xl overflow-x-auto" style={{ background: 'var(--hd-card)', border: '1px solid var(--hd-border)' }}>
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr className="text-left text-xs" style={{ color: 'var(--hd-text-faint)' }}>
                {['Part', 'Location', 'Bin', 'On hand', 'On jobs', 'Available', 'Minimum', 'Last paid', 'Sell', ''].map(h => (
                  <th key={h} className="px-3 py-2 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.stock.map(r => (
                <tr key={r.inventory_id} className="border-t align-top text-white" style={{ borderColor: 'var(--hd-border)' }}>
                  <td className="px-3 py-2">
                    <span className="font-mono font-bold">{r.part_number}</span>
                    <span className="block text-xs" style={{ color: 'var(--hd-text-muted)' }}>{r.description ?? r.part_type}</span>
                  </td>
                  <td className="px-3 py-2">{r.location_name ?? 'Shop'}</td>
                  <td className="px-3 py-2">{r.bin ?? '--'}</td>
                  <td className="px-3 py-2 font-semibold">
                    {r.on_hand}
                    {r.negative && <span className="block text-xs" style={{ color: 'var(--hd-negative)' }}>negative - count it</span>}
                  </td>
                  <td className="px-3 py-2">{r.allocated}</td>
                  <td className="px-3 py-2">
                    {r.available}
                    {r.below_minimum && <span className="block text-xs" style={{ color: 'var(--hd-warn)' }}>at or below minimum</span>}
                  </td>
                  <td className="px-3 py-2">{r.min_qty ?? 'not set'}</td>
                  <td className="px-3 py-2">{money(r.last_cost)}</td>
                  <td className="px-3 py-2">{money(r.sell_price)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {(['count', 'transfer', 'edit', 'history'] as const).map(m => (
                        <button key={m} type="button" onClick={() => setActive(active?.row.inventory_id === r.inventory_id && active.mode === m ? null : { row: r, mode: m })}
                          className="px-2 py-1 rounded text-xs text-white" style={secondaryStyle}>
                          {m === 'count' ? 'Count' : m === 'transfer' ? 'Move' : m === 'edit' ? 'Edit' : 'History'}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {active?.mode === 'count'    && <CountPanel row={active.row} onDone={done} onCancel={() => setActive(null)} />}
      {active?.mode === 'transfer' && <TransferPanel row={active.row} locations={locations} onDone={done} onCancel={() => setActive(null)} />}
      {active?.mode === 'edit'     && <EditPanel row={active.row} onDone={done} onCancel={() => setActive(null)} />}
      {active?.mode === 'history'  && <HistoryPanel row={active.row} locations={data?.locations ?? []} onCancel={() => setActive(null)} />}
    </div>
  )
}

function Panel({ title, children, onCancel }: { title: string; children: React.ReactNode; onCancel: () => void }) {
  return (
    <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--hd-card)', border: '1px solid var(--hd-border)', borderLeft: `4px solid ${PRIMARY}` }}>
      <div className="flex items-center justify-between">
        <h3 className="font-condensed font-bold text-white text-sm tracking-wider uppercase">{title}</h3>
        <button type="button" onClick={onCancel} className="text-sm text-white">Close</button>
      </div>
      {children}
    </div>
  )
}

function SaveRow({ busy, label, err, onSave }: { busy: boolean; label: string; err: string | null; onSave: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={busy} onClick={onSave} className={secondaryCls} style={{ ...secondaryStyle, minHeight: 44, borderColor: PRIMARY }}>
        {busy ? 'Saving...' : label}
      </button>
      {err && <span className="text-sm" style={{ color: 'var(--hd-negative)' }}>{err}</span>}
    </div>
  )
}

function useSave(onDone: (msg: string) => Promise<void>) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const run = async (body: Record<string, unknown>, msg: string) => {
    setBusy(true); setErr(null)
    try { await post(body); await onDone(msg) } catch (e) { setErr(e instanceof Error ? e.message : 'That did not save.') } finally { setBusy(false) }
  }
  return { busy, err, run }
}

function ReceivePanel({ scope, locations, onDone, onCancel }: {
  scope: 'all' | 'reefer'; locations: Location[]; onDone: (m: string) => Promise<void>; onCancel: () => void
}) {
  const [number, setNumber] = useState('')
  const [hits, setHits] = useState<PartHit[] | null>(null)
  const [part, setPart] = useState<PartHit | null>(null)
  const [qty, setQty] = useState('1')
  const [cost, setCost] = useState('')
  const [loc, setLoc] = useState(locations.find(l => l.is_default)?.id ?? '')
  const [ref, setRef] = useState('')
  const [lookErr, setLookErr] = useState<string | null>(null)
  const { busy, err, run } = useSave(onDone)

  async function lookup() {
    setLookErr(null); setPart(null)
    const res = await fetch(`/api/parts/counter?scope=${scope}&q=${encodeURIComponent(number.trim())}`, { cache: 'no-store' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setLookErr(json.error ?? 'Lookup failed.'); return }
    const found = (json.results ?? []) as PartHit[]
    setHits(found)
    if (found.length === 1) setPart(found[0])
  }

  return (
    <Panel title="Receive stock" onCancel={onCancel}>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
        <label className="block">
          <Label>Part number</Label>
          <input value={number} onChange={e => setNumber(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void lookup() }}
            placeholder="30-60143-01" className={inputCls} style={field} />
        </label>
        <button type="button" onClick={() => void lookup()} disabled={!number.trim()} className={secondaryCls} style={{ ...secondaryStyle, minHeight: 44 }}>Look up</button>
      </div>
      {lookErr && <p className="text-sm" style={{ color: 'var(--hd-negative)' }}>{lookErr}</p>}
      {hits && hits.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--hd-warn)' }}>That number is not in the catalog, so it cannot be stocked yet.</p>
      )}
      {hits && hits.length > 1 && !part && (
        <div className="flex flex-wrap gap-2">
          {hits.map(h => (
            <button key={h.id} type="button" onClick={() => setPart(h)} className={secondaryCls} style={secondaryStyle}>
              {h.part_number} - {h.description ?? h.part_type}
            </button>
          ))}
        </div>
      )}
      {part && (
        <>
          <p className="text-sm text-white"><span className="font-mono font-bold">{part.part_number}</span> - {part.description ?? part.part_type} ({part.manufacturer})</p>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <label className="block"><Label>Quantity</Label>
              <input value={qty} onChange={e => setQty(e.target.value)} inputMode="numeric" className={inputCls} style={field} /></label>
            <label className="block"><Label>What you paid, each</Label>
              <input value={cost} onChange={e => setCost(e.target.value)} inputMode="decimal" placeholder="leave blank if unknown" className={inputCls} style={field} /></label>
            <label className="block"><Label>Location</Label>
              <select value={loc} onChange={e => setLoc(e.target.value)} className={inputCls} style={field}>
                {!locations.length && <option value="">Shop (created now)</option>}
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select></label>
            <label className="block"><Label>PO or packing slip number</Label>
              <input value={ref} onChange={e => setRef(e.target.value)} className={inputCls} style={field} /></label>
          </div>
          <SaveRow busy={busy} err={err} label="Save receipt" onSave={() => void run(
            { action: 'receive', part_id: part.id, quantity: qty, unit_cost: cost, location_id: loc || undefined, reference: ref },
            `Received ${qty} x ${part.part_number}.`)} />
        </>
      )}
    </Panel>
  )
}

function LocationPanel({ onDone, onCancel }: { onDone: (m: string) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'shop' | 'vehicle'>('vehicle')
  const { busy, err, run } = useSave(onDone)
  return (
    <Panel title="Add a location" onCancel={onCancel}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block"><Label>Name</Label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Truck 2" className={inputCls} style={field} /></label>
        <label className="block"><Label>Kind</Label>
          <select value={kind} onChange={e => setKind(e.target.value as 'shop' | 'vehicle')} className={inputCls} style={field}>
            <option value="vehicle">Service truck</option>
            <option value="shop">Shop or storeroom</option>
          </select></label>
      </div>
      <SaveRow busy={busy} err={err} label="Add location" onSave={() => void run({ action: 'location', name, kind }, `Added ${name}.`)} />
    </Panel>
  )
}

function CountPanel({ row, onDone, onCancel }: { row: StockRow; onDone: (m: string) => Promise<void>; onCancel: () => void }) {
  const [counted, setCounted] = useState(String(row.on_hand))
  const [note, setNote] = useState('')
  const { busy, err, run } = useSave(onDone)
  return (
    <Panel title={`Count ${row.part_number} at ${row.location_name ?? 'Shop'}`} onCancel={onCancel}>
      <p className="text-xs" style={{ color: 'var(--hd-text-muted)' }}>
        The books say {row.on_hand}. Enter what is physically there; the difference is recorded as an adjustment, and the old figure stays in the history.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block"><Label>Counted</Label>
          <input value={counted} onChange={e => setCounted(e.target.value)} inputMode="numeric" className={inputCls} style={field} /></label>
        <label className="block"><Label>Note (optional)</Label>
          <input value={note} onChange={e => setNote(e.target.value)} className={inputCls} style={field} /></label>
      </div>
      <SaveRow busy={busy} err={err} label="Save count" onSave={() => void run(
        { action: 'count', part_id: row.part_id, location_id: row.location_id, counted, note }, `Counted ${row.part_number}.`)} />
    </Panel>
  )
}

function TransferPanel({ row, locations, onDone, onCancel }: { row: StockRow; locations: Location[]; onDone: (m: string) => Promise<void>; onCancel: () => void }) {
  const others = locations.filter(l => l.id !== row.location_id)
  const [to, setTo] = useState(others[0]?.id ?? '')
  const [qty, setQty] = useState('1')
  const { busy, err, run } = useSave(onDone)
  return (
    <Panel title={`Move ${row.part_number} from ${row.location_name ?? 'Shop'}`} onCancel={onCancel}>
      {others.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--hd-text-muted)' }}>Add a second location (a truck) first.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block"><Label>To</Label>
              <select value={to} onChange={e => setTo(e.target.value)} className={inputCls} style={field}>
                {others.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select></label>
            <label className="block"><Label>Quantity</Label>
              <input value={qty} onChange={e => setQty(e.target.value)} inputMode="numeric" className={inputCls} style={field} /></label>
          </div>
          <SaveRow busy={busy} err={err} label="Move stock" onSave={() => void run(
            { action: 'transfer', part_id: row.part_id, from_location_id: row.location_id, to_location_id: to, quantity: qty }, `Moved ${qty} x ${row.part_number}.`)} />
        </>
      )}
    </Panel>
  )
}

function EditPanel({ row, onDone, onCancel }: { row: StockRow; onDone: (m: string) => Promise<void>; onCancel: () => void }) {
  const [bin, setBin] = useState(row.bin ?? '')
  const [min, setMin] = useState(row.min_qty == null ? '' : String(row.min_qty))
  const [sell, setSell] = useState(row.sell_price == null ? '' : String(row.sell_price))
  const { busy, err, run } = useSave(onDone)
  return (
    <Panel title={`${row.part_number} at ${row.location_name ?? 'Shop'}`} onCancel={onCancel}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block"><Label>Bin</Label>
          <input value={bin} onChange={e => setBin(e.target.value)} className={inputCls} style={field} /></label>
        <label className="block"><Label>Minimum to keep (blank = none set)</Label>
          <input value={min} onChange={e => setMin(e.target.value)} inputMode="numeric" className={inputCls} style={field} /></label>
        <label className="block"><Label>Your sell price</Label>
          <input value={sell} onChange={e => setSell(e.target.value)} inputMode="decimal" className={inputCls} style={field} /></label>
      </div>
      <p className="text-xs" style={{ color: 'var(--hd-text-muted)' }}>
        For your reference. A work order prices a part from its cost and the work order&apos;s own markup, not from this figure.
      </p>
      <SaveRow busy={busy} err={err} label="Save" onSave={() => void run(
        { action: 'settings', part_id: row.part_id, location_id: row.location_id, bin, min_qty: min, sell_price: sell }, `Saved ${row.part_number}.`)} />
    </Panel>
  )
}

function HistoryPanel({ row, locations, onCancel }: { row: StockRow; locations: Location[]; onCancel: () => void }) {
  const [moves, setMoves] = useState<Movement[] | null>(null)
  useEffect(() => {
    fetch(`/api/parts/stock?part_id=${row.part_id}`, { cache: 'no-store' })
      .then(r => r.json()).then(j => setMoves((j.movements ?? []) as Movement[])).catch(() => setMoves([]))
  }, [row.part_id])
  const locName = (id: string) => locations.find(l => l.id === id)?.name ?? 'Shop'
  return (
    <Panel title={`History - ${row.part_number}`} onCancel={onCancel}>
      {!moves ? <p className="text-sm" style={{ color: 'var(--hd-text-muted)' }}>Loading...</p> : moves.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--hd-text-muted)' }}>No movements yet.</p>
      ) : (
        <ul className="space-y-1">
          {moves.map(m => (
            <li key={m.id} className="text-xs text-white flex flex-wrap gap-x-3">
              <span style={{ color: 'var(--hd-text-muted)' }}>{new Date(m.created_at).toLocaleString()}</span>
              <span className="font-semibold">{REASON_LABEL[m.reason] ?? m.reason}</span>
              <span>{m.delta > 0 ? `+${m.delta}` : m.delta}</span>
              <span>{locName(m.location_id)}</span>
              {m.unit_cost != null && <span>{m.reason === 'used' ? 'cost' : 'paid'} {money(m.unit_cost)} each</span>}
              {m.source_ref && <span>ref {m.source_ref}</span>}
              {m.note && <span style={{ color: 'var(--hd-text-muted)' }}>{m.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
