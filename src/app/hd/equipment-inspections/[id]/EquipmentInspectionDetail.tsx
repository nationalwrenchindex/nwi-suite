'use client'

// Signed equipment inspection record — screen view and print document in one.
//
// Printing is served the same way the aerial and DOT inspections do it: a print
// stylesheet plus window.print(), which the browser turns into a PDF. That keeps
// all three inspection families producing identical-looking documents and avoids
// adding a PDF rendering dependency to produce something the platform does well.

import Image from 'next/image'
import type { EquipmentFormDef, EquipmentInspectionRecord, ItemResult } from '@/types/equipment'
import { EQUIPMENT_TYPE_LABEL } from '@/lib/hd/equipment/forms'
import { BrandHeader, BrandFooter } from '@/components/BrandHeader'
import type { Branding } from '@/lib/branding'

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function fmtStamp(ts: string | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  })
}

function resultPill(r: ItemResult | '') {
  const map: Record<string, { bg: string; label: string; cls: string }> = {
    pass: { bg: '#22C55E', label: 'PASS', cls: 'print-pass' },
    fail: { bg: '#EF4444', label: 'FAIL', cls: 'print-fail' },
    na:   { bg: '#9CA3AF', label: 'N/A',  cls: 'print-na'   },
  }
  return map[r] ?? { bg: '#4B5563', label: '—', cls: '' }
}

export default function EquipmentInspectionDetail({
  record, def, branding,
}: {
  record: EquipmentInspectionRecord
  def: EquipmentFormDef
  branding: Branding
}) {
  const failed = record.overall_result === 'fail'
  const unitLabel = [record.unit_identifier, record.unit_make, record.unit_model]
    .filter(Boolean).join(' · ') || '—'

  return (
    <div className="max-w-3xl mx-auto">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
          .print-doc { color: #000 !important; background: #fff !important; }
          .print-doc * { color: #000 !important; border-color: #ddd !important; background: transparent !important; }
          /* The blanket rule above must not neutralise the brand logo or the
             signature: images keep their own colours on the printed page. */
          .print-doc img { display: inline-block !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print-pass { background: #22C55E !important; color: #fff !important; }
          .print-fail { background: #EF4444 !important; color: #fff !important; }
          .print-na   { background: #9CA3AF !important; color: #fff !important; }
          .print-section { break-inside: avoid; }
        }
      `}</style>

      {/* Actions — never printed */}
      <div className="no-print flex items-center justify-between mb-4">
        <div>
          <h1 className="font-condensed font-bold text-2xl text-white tracking-wide">
            {def.title.toUpperCase()}
          </h1>
          <p className="text-white/40 text-xs mt-0.5">
            {record.inspection_id ?? record.id.slice(0, 8)} · {EQUIPMENT_TYPE_LABEL[record.equipment_type]}
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="px-5 py-2.5 bg-orange hover:bg-orange-hover text-white font-condensed font-bold text-sm rounded-lg transition-colors"
        >
          Download PDF
        </button>
      </div>

      <div className="print-doc rounded-xl p-6" style={{ background: '#111920', border: '1px solid #1e3040' }}>

        {/* Document header — subscriber branding. Never .no-print: the brand is
            part of the document, not the app chrome. */}
        <div className="pb-4 mb-4" style={{ borderBottom: '2px solid #1e3040' }}>
          <BrandHeader branding={branding} className="text-white mb-3" />
          <p className="font-condensed font-bold text-xl text-white tracking-wide">{def.title}</p>
          <p className="text-white/50 text-xs mt-0.5">{def.citation}</p>
        </div>

        {/* Overall determination */}
        <div className="mb-5 px-4 py-3 rounded-lg print-section"
          style={{ background: failed ? '#2d0505' : '#052d10', border: `1px solid ${failed ? '#EF4444' : '#22C55E'}` }}>
          <p className="text-sm font-bold" style={{ color: failed ? '#EF4444' : '#22C55E' }}>
            {failed ? 'FAIL — DEFICIENCIES FOUND' : 'PASS — NO DEFICIENCIES'}
          </p>
          {record.removed_from_service && (
            <p className="text-danger text-xs mt-1 font-semibold">
              UNIT REMOVED FROM SERVICE — this machine may not be operated until repaired and re-inspected.
            </p>
          )}
        </div>

        {/* Identification */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 mb-6 text-sm print-section">
          {[
            ['Machine Class',        EQUIPMENT_TYPE_LABEL[record.equipment_type]],
            ['Unit',                 record.unit_identifier ?? unitLabel],
            ['Make / Model',         [record.unit_make, record.unit_model].filter(Boolean).join(' ') || '—'],
            ['Serial',               record.unit_serial ?? '—'],
            ['Inspection Date',      fmtDate(record.inspection_date)],
            ...(def.requiresOperatorContext ? [
              ['Operator',           record.operator_name ?? '—'],
              ['Shift',              record.shift ?? '—'],
              ['Operator Cert Current', record.operator_cert_current ? 'Yes' : 'No'],
            ] as const : []),
            ...(def.requiresServiceHistory ? [
              ['Hour Meter',         record.hour_meter != null ? String(record.hour_meter) : '—'],
              ['Last Frequent',      fmtDate(record.last_frequent_date)],
              ['Last Annual',        fmtDate(record.last_annual_date)],
            ] as const : []),
          ].map(([label, value]) => (
            <div key={label as string}>
              <p className="text-white/35 text-xs uppercase tracking-widest">{label}</p>
              <p className="text-white/85">{value}</p>
            </div>
          ))}
        </div>

        {/* Sections */}
        {def.sections.map(section => (
          <div key={section.id} className="mb-4 print-section">
            <p className="text-white text-sm font-semibold mb-1.5">
              <span className="text-white/30 mr-2">§{section.num}</span>{section.label}
            </p>
            <div style={{ border: '1px solid #1e3040', borderRadius: 6, overflow: 'hidden' }}>
              {section.items.map((item, i) => {
                const st = record.inspection_data?.sections?.[section.id]?.items?.[item.id]
                const pill = resultPill((st?.result ?? '') as ItemResult | '')
                return (
                  <div key={item.id} style={{ borderTop: i === 0 ? undefined : '1px solid #1e3040' }}>
                    <div className="flex items-center gap-3 px-3 py-1.5">
                      <p className="flex-1 text-xs text-white/70">{item.label}</p>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${pill.cls}`}
                        style={{ background: pill.bg, color: '#fff', minWidth: 42, textAlign: 'center' }}>
                        {pill.label}
                      </span>
                    </div>
                    {st?.result === 'fail' && st.notes && (
                      <p className="px-3 pb-1.5 text-xs" style={{ color: '#EF4444' }}>↳ {st.notes}</p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {/* Deficiency summary */}
        {record.deficiencies?.length > 0 && (
          <div className="mb-6 print-section">
            <p className="text-white text-sm font-semibold mb-1.5">Deficiencies</p>
            <ul className="space-y-1">
              {record.deficiencies.map(d => (
                <li key={`${d.sectionId}-${d.itemId}`} className="text-xs text-white/70">
                  • {d.label}{d.safetyCritical ? ' (safety critical)' : ''}{d.notes ? ` — ${d.notes}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Load test — ASME B30.5, cranes only */}
        {def.requiresLoadTest && (
          <div className="mb-6 print-section">
            <p className="text-white text-sm font-semibold mb-1.5">Load Test</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div>
                <p className="text-white/35 text-xs uppercase tracking-widest">Performed</p>
                <p className="text-white/85">{record.load_test_performed ? 'Yes' : 'No'}</p>
              </div>
              <div>
                <p className="text-white/35 text-xs uppercase tracking-widest">Date</p>
                <p className="text-white/85">{fmtDate(record.load_test_date)}</p>
              </div>
            </div>
            {record.load_test_notes && (
              <p className="text-xs text-white/70 mt-2">{record.load_test_notes}</p>
            )}
          </div>
        )}

        {/* Signature block */}
        <div className="pt-4 print-section" style={{ borderTop: '2px solid #1e3040' }}>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-white/35 text-xs uppercase tracking-widest mb-1">Inspector</p>
              <p className="text-white/85 text-sm">{record.inspector_name ?? '—'}</p>
              {def.requiresInspectorCert && (
                <p className="text-white/50 text-xs mt-0.5">
                  License / Cert: {record.inspector_cert_number ?? '—'}
                </p>
              )}
            </div>
            <div>
              <p className="text-white/35 text-xs uppercase tracking-widest mb-1">Signature</p>
              {record.signature_data
                ? <Image src={record.signature_data} alt="Inspector signature" width={240} height={70}
                    unoptimized style={{ height: 70, width: 'auto', objectFit: 'contain' }} />
                : <p className="text-white/40 text-sm">—</p>}
            </div>
          </div>
          {/* The lock stamp is the document's integrity claim — always printed. */}
          <p className="text-white/35 text-xs mt-4">
            Record locked {fmtStamp(record.locked_at)} · ID {record.inspection_id ?? record.id}
          </p>
        </div>

        {/* Trademark attribution — inside .print-doc so it lands on the PDF. */}
        <BrandFooter className="mt-4 text-white" />
      </div>
    </div>
  )
}
