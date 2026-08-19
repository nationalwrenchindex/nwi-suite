'use client'

// Shared rendering + submit engine for every equipment class.
//
// The classes differ only in their EquipmentFormDef, so there is one component
// rather than eleven near-identical forms. Visual language is lifted from
// AerialChecklist so all three inspection families look and print alike.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type {
  EquipmentFormDef, EquipmentInspectionData, EquipmentItemState, ItemResult,
} from '@/types/equipment'
import {
  collectDeficiencies, emptyData, hasCriticalDeficiency, overallResult, unansweredCount,
} from '@/types/equipment'
import SignaturePad from '@/components/hd/SignaturePad'

interface UnitOption { id: string; unit_number: string | null; manufacturer: string | null; model: string | null; serial_number?: string | null }

// Sentinel values for the invoice picker, matching the aerial form.
const INV_CREATE = '__create__'
const INV_NONE   = '__none__'

interface InvoiceOption {
  id: string
  invoice_number: string | null
  customer_name: string | null
  total: number | null
  status: string
}

// ─── One checklist row ────────────────────────────────────────────────────────

function ItemRow({
  label, safetyCritical, state, onChange, even,
}: {
  label: string; safetyCritical?: boolean; state: EquipmentItemState
  onChange: (f: 'result' | 'notes', v: string) => void; even: boolean
}) {
  const isFail = state.result === 'fail'
  return (
    <div style={{ background: isFail ? '#1a0505' : even ? '#0f1820' : '#111920', borderTop: '1px solid #1e3040' }}>
      <div className="flex items-center gap-3 px-4 py-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs leading-snug" style={{ color: isFail ? '#EF4444CC' : 'rgba(255,255,255,0.65)' }}>
            {label}
          </p>
          {safetyCritical && (
            <span className="inline-block font-bold px-1.5 py-0.5 rounded mt-0.5"
              style={{ background: '#EF444415', color: '#EF4444', fontSize: 9 }}>
              ⚠ SAFETY CRITICAL
            </span>
          )}
        </div>
        <div className="flex gap-0.5 flex-shrink-0">
          {(['pass', 'fail', 'na'] as const).map(r => (
            <button key={r} type="button" onClick={() => onChange('result', r)}
              className="text-xs font-bold transition-colors"
              style={{
                width: 44, padding: '4px 0', borderRadius: 4,
                background: state.result === r
                  ? r === 'pass' ? '#22C55E' : r === 'fail' ? '#EF4444' : '#4B5563'
                  : '#162030',
                color: state.result === r ? '#fff' : 'rgba(255,255,255,0.28)',
              }}>
              {r === 'na' ? 'N/A' : r.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      {isFail && (
        <div className="px-4 pb-2 pt-0">
          <textarea value={state.notes} onChange={e => onChange('notes', e.target.value)}
            placeholder="Describe the deficiency found…" rows={2}
            className="w-full px-3 py-1.5 rounded text-xs text-white placeholder-white/20 resize-none"
            style={{ background: '#2d0505', border: '1px solid #EF444440', borderLeft: '3px solid #EF4444' }} />
        </div>
      )}
    </div>
  )
}

// ─── Form ─────────────────────────────────────────────────────────────────────

export default function EquipmentChecklist({
  def, units, invoices = [], defaultInspector, workOrderId, initialUnitId,
}: {
  def: EquipmentFormDef
  units: UnitOption[]
  invoices?: InvoiceOption[]
  defaultInspector: string
  workOrderId?: string | null
  initialUnitId?: string | null
}) {
  const router = useRouter()

  const [selectedInvoice, setSelectedInvoice] = useState(INV_NONE)
  const [unitId,      setUnitId]      = useState(initialUnitId ?? '')
  const [unitIdent,   setUnitIdent]   = useState('')
  const [unitMake,    setUnitMake]    = useState('')
  const [unitModel,   setUnitModel]   = useState('')
  const [unitSerial,  setUnitSerial]  = useState('')
  const [date,        setDate]        = useState(new Date().toISOString().slice(0, 10))
  const [shift,       setShift]       = useState('')
  const [operator,    setOperator]    = useState('')
  const [operatorCert, setOperatorCert] = useState(false)
  const [hourMeter,   setHourMeter]   = useState('')
  const [lastFreq,    setLastFreq]    = useState('')
  const [lastAnnual,  setLastAnnual]  = useState('')
  const [inspector,   setInspector]   = useState(defaultInspector)
  const [certNumber,  setCertNumber]  = useState('')
  const [signature,   setSignature]   = useState<string | null>(null)
  const [removeFromService, setRemoveFromService] = useState(false)
  const [loadTestDone, setLoadTestDone]  = useState(false)
  const [loadTestDate, setLoadTestDate]  = useState('')
  const [loadTestNotes, setLoadTestNotes] = useState('')
  const [data,        setData]        = useState<EquipmentInspectionData>(() => emptyData(def))
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  const deficiencies = useMemo(() => collectDeficiencies(def, data), [def, data])
  const critical     = hasCriticalDeficiency(deficiencies)
  const result       = overallResult(deficiencies)
  const unanswered   = unansweredCount(def, data)

  function setItem(sectionId: string, itemId: string, field: 'result' | 'notes', value: string) {
    setData(prev => ({
      sections: {
        ...prev.sections,
        [sectionId]: {
          items: {
            ...prev.sections[sectionId]?.items,
            [itemId]: {
              ...(prev.sections[sectionId]?.items[itemId] ?? { result: '' as const, notes: '' }),
              [field]: field === 'result' ? (value as ItemResult) : value,
            },
          },
        },
      },
    }))
  }

  // Blocked rather than warned: an unanswered item on a compliance record is a
  // gap in the legal document, and a missing signature makes it unsigned.
  const blockers: string[] = []
  if (unanswered > 0)                       blockers.push(`${unanswered} item${unanswered === 1 ? '' : 's'} unanswered`)
  if (!inspector.trim())                    blockers.push('inspector name required')
  if (!signature)                           blockers.push('signature required')
  if (def.requiresInspectorCert && !certNumber.trim())
    blockers.push('inspector certification number required')
  if (def.requiresOperatorContext && !operator.trim())
    blockers.push('operator name required')
  if (!unitId && !unitIdent.trim())         blockers.push('unit required')
  if (critical && !removeFromService)
    blockers.push('a safety-critical item failed — removal from service must be confirmed')

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/hd/equipment-inspections', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipment_type:  def.type,
          unit_id:         unitId || null,
          work_order_id:   workOrderId ?? null,
          invoice_action:
            selectedInvoice === INV_CREATE ? 'create'
            : selectedInvoice === INV_NONE ? 'none'
            : 'existing',
          invoice_id: (selectedInvoice === INV_CREATE || selectedInvoice === INV_NONE) ? null : selectedInvoice,
          inspection_date: date,
          shift:           shift || null,
          operator_name:   operator || null,
          operator_cert_current: def.requiresOperatorContext ? operatorCert : null,
          unit_identifier: unitIdent || null,
          unit_make:       unitMake || null,
          unit_model:      unitModel || null,
          unit_serial:     unitSerial || null,
          hour_meter:      hourMeter ? Number(hourMeter) : null,
          last_frequent_date: lastFreq   || null,
          last_annual_date:   lastAnnual || null,
          load_test_performed: def.requiresLoadTest ? loadTestDone : false,
          load_test_date:      def.requiresLoadTest && loadTestDate ? loadTestDate : null,
          load_test_notes:     def.requiresLoadTest ? (loadTestNotes || null) : null,
          inspection_data: data,
          deficiencies,
          overall_result:  result,
          removed_from_service: removeFromService,
          inspector_name:  inspector,
          inspector_cert_number: certNumber || null,
          signature_data:  signature,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to save inspection')
      // The inspection saved even if billing did not; say so rather than letting
      // the tech assume an invoice exists.
      if (json.invoice_error) {
        alert(`Inspection saved, but the invoice could not be created:\n${json.invoice_error}`)
      }
      router.push(`/hd/equipment-inspections/${json.id}`)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save inspection')
      setSaving(false)
    }
  }

  const inp = 'w-full px-3 py-2 rounded text-sm text-white placeholder-white/20'
  const inpStyle = { background: '#0f1820', border: '1px solid #1e3040' } as const
  const lbl = 'text-white/40 text-xs uppercase tracking-widest block mb-1.5'

  return (
    <div className="space-y-5">

      {/* Heading */}
      <div className="rounded-xl p-4" style={{ background: '#111920', border: '1px solid #1e3040' }}>
        <h1 className="font-condensed font-bold text-xl text-white tracking-wide">{def.title}</h1>
        <p className="text-white/40 text-xs mt-0.5">{def.citation}</p>
        <p className="text-white/30 text-xs mt-1.5">{def.cadence}</p>
      </div>

      {/* Unit + context */}
      <div className="rounded-xl p-4 space-y-3" style={{ background: '#111920', border: '1px solid #1e3040' }}>
        <div>
          <label className={lbl}>Unit</label>
          <select value={unitId} onChange={e => setUnitId(e.target.value)} className={inp} style={inpStyle}>
            <option value="">— Not a registered unit —</option>
            {units.map(u => (
              <option key={u.id} value={u.id}>
                {[u.unit_number, u.manufacturer, u.model].filter(Boolean).join(' · ')}
              </option>
            ))}
          </select>
        </div>

        {/* Billing. A new invoice takes its customer from the selected unit's fleet
            account, so it is worth picking the unit above first. */}
        <div>
          <label className={lbl}>Invoice</label>
          <select value={selectedInvoice} onChange={e => setSelectedInvoice(e.target.value)} className={inp} style={inpStyle}>
            <option value={INV_CREATE}>+ Create new invoice for this inspection</option>
            <option value={INV_NONE}>— No invoice (standalone) —</option>
            {invoices.map(inv => (
              <option key={inv.id} value={inv.id}>
                {(inv.invoice_number ?? 'Invoice')}{inv.customer_name ? ` — ${inv.customer_name}` : ''}
                {inv.total != null ? ` ($${Number(inv.total).toFixed(0)})` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Free-text identity for machines that are not registered units. */}
        {!unitId && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Unit ID</label>
              <input className={inp} style={inpStyle} value={unitIdent} onChange={e => setUnitIdent(e.target.value)} /></div>
            <div><label className={lbl}>Serial</label>
              <input className={inp} style={inpStyle} value={unitSerial} onChange={e => setUnitSerial(e.target.value)} /></div>
            <div><label className={lbl}>Make</label>
              <input className={inp} style={inpStyle} value={unitMake} onChange={e => setUnitMake(e.target.value)} /></div>
            <div><label className={lbl}>Model</label>
              <input className={inp} style={inpStyle} value={unitModel} onChange={e => setUnitModel(e.target.value)} /></div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Inspection Date</label>
            <input type="date" className={inp} style={inpStyle} value={date} onChange={e => setDate(e.target.value)} /></div>
          {def.requiresOperatorContext && (
            <div><label className={lbl}>Shift</label>
              <input className={inp} style={inpStyle} value={shift} onChange={e => setShift(e.target.value)} placeholder="Day / Night" /></div>
          )}
          {def.requiresServiceHistory && (
            <>
              <div><label className={lbl}>Hour Meter</label>
                <input type="number" min={0} className={inp} style={inpStyle} value={hourMeter} onChange={e => setHourMeter(e.target.value)} /></div>
              <div><label className={lbl}>Last Frequent Inspection</label>
                <input type="date" className={inp} style={inpStyle} value={lastFreq} onChange={e => setLastFreq(e.target.value)} /></div>
              <div><label className={lbl}>Last Annual Inspection</label>
                <input type="date" className={inp} style={inpStyle} value={lastAnnual} onChange={e => setLastAnnual(e.target.value)} /></div>
            </>
          )}
        </div>

        {def.requiresOperatorContext && (
          <div className="grid grid-cols-2 gap-3 items-end">
            <div><label className={lbl}>Operator Name</label>
              <input className={inp} style={inpStyle} value={operator} onChange={e => setOperator(e.target.value)} /></div>
            <label className="flex items-center gap-2 text-white/70 text-sm pb-2">
              <input type="checkbox" checked={operatorCert} onChange={e => setOperatorCert(e.target.checked)} />
              Operator certification current
            </label>
          </div>
        )}
      </div>

      {/* Sections */}
      {def.sections.map(section => (
        <div key={section.id} className="rounded-xl overflow-hidden" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <div className="px-4 py-2.5" style={{ background: '#0d151c' }}>
            <p className="text-white text-sm font-semibold">
              <span className="text-white/30 mr-2">§{section.num}</span>{section.label}
            </p>
          </div>
          {section.items.map((item, i) => (
            <ItemRow
              key={item.id}
              label={item.label}
              safetyCritical={item.safetyCritical}
              even={i % 2 === 0}
              state={data.sections[section.id]?.items[item.id] ?? { result: '', notes: '' }}
              onChange={(f, v) => setItem(section.id, item.id, f, v)}
            />
          ))}
        </div>
      ))}

      {/* Critical banner — out-of-service determination */}
      {critical && (
        <div className="rounded-xl p-4" style={{ background: '#2d0505', border: '1px solid #EF4444' }}>
          <p className="text-danger text-sm font-semibold mb-2">
            Safety-critical deficiency found — this machine may not be operated.
          </p>
          <label className="flex items-start gap-2 text-white/80 text-sm">
            <input type="checkbox" className="mt-0.5" checked={removeFromService}
              onChange={e => setRemoveFromService(e.target.checked)} />
            I confirm the unit has been removed from service and tagged.
          </label>
        </div>
      )}

      {/* Load test — ASME B30.5 documentation, cranes only */}
      {def.requiresLoadTest && (
        <div className="rounded-xl p-4 space-y-3" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="text-white text-sm font-semibold">Load Test Documentation</p>
          <label className="flex items-center gap-2 text-white/70 text-sm">
            <input type="checkbox" checked={loadTestDone} onChange={e => setLoadTestDone(e.target.checked)} />
            Load test performed and documented
          </label>
          {loadTestDone && (
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>Load Test Date</label>
                <input type="date" className={inp} style={inpStyle} value={loadTestDate} onChange={e => setLoadTestDate(e.target.value)} /></div>
              <div className="col-span-2"><label className={lbl}>Load Test Notes</label>
                <textarea rows={2} className={`${inp} resize-none`} style={inpStyle} value={loadTestNotes}
                  onChange={e => setLoadTestNotes(e.target.value)}
                  placeholder="Test load, configuration, certifying agency…" /></div>
            </div>
          )}
        </div>
      )}

      {/* Sign-off */}
      <div className="rounded-xl p-4 space-y-3" style={{ background: '#111920', border: '1px solid #1e3040' }}>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Inspector Name</label>
            <input className={inp} style={inpStyle} value={inspector} onChange={e => setInspector(e.target.value)} /></div>
          {def.requiresInspectorCert && (
            <div><label className={lbl}>License / Certification No.</label>
              <input className={inp} style={inpStyle} value={certNumber} onChange={e => setCertNumber(e.target.value)} /></div>
          )}
        </div>
        <div>
          <label className={lbl}>Inspector Signature</label>
          <SignaturePad onChange={setSignature} />
        </div>
      </div>

      {/* Summary + submit */}
      <div className="rounded-xl p-4" style={{ background: '#111920', border: '1px solid #1e3040' }}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-white/50 text-sm">
            Result:{' '}
            <span className={result === 'pass' ? 'text-green-400 font-semibold' : 'text-danger font-semibold'}>
              {result.toUpperCase()}
            </span>
            {deficiencies.length > 0 && (
              <span className="text-white/40"> · {deficiencies.length} deficienc{deficiencies.length === 1 ? 'y' : 'ies'}</span>
            )}
          </p>
        </div>

        {blockers.length > 0 && (
          <ul className="text-white/40 text-xs mb-3 space-y-0.5">
            {blockers.map(b => <li key={b}>• {b}</li>)}
          </ul>
        )}
        {error && <p className="text-danger text-sm mb-3">{error}</p>}

        <button
          type="button"
          onClick={submit}
          disabled={saving || blockers.length > 0}
          className="w-full py-3 bg-orange hover:bg-orange-hover disabled:opacity-40 disabled:cursor-not-allowed text-white font-condensed font-bold text-sm tracking-wide rounded-xl transition-colors"
        >
          {saving ? 'Saving…' : 'Sign and Submit Inspection'}
        </button>
        <p className="text-white/25 text-xs mt-2 text-center">
          Submission locks this record and stamps the time. It cannot be edited afterwards.
        </p>
      </div>
    </div>
  )
}
