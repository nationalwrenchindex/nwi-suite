'use client'

import Link from 'next/link'
import { INSPECTION_CATEGORIES, categoryLabel } from '@/lib/hd/dot-categories'

const HD_ORANGE = '#E85D24'
const HD_BLUE   = '#1A6BAF'

interface CategoryRecord { result: string; notes: string }
interface Violation { category: string; notes: string }

interface DOTInspection {
  id: string
  inspection_id: string | null
  inspection_date: string
  inspector_name: string | null
  inspector_cert_number: string | null
  odometer_hours: string | null
  location: string | null
  inspection_data: Record<string, CategoryRecord>
  violations: Violation[] | null
  overall_result: string
  signature_data: string | null
  locked: boolean
  locked_at: string | null
  created_at: string
  unit: { unit_number: string; manufacturer: string; model: string; serial_number: string | null } | null
  fleet_account: { fleet_name: string } | null
}

const RESULT_CFG = {
  pass: { label: 'PASS', color: '#22C55E', bg: '#22C55E20', border: '#22C55E50' },
  fail: { label: 'FAIL', color: '#EF4444', bg: '#EF444420', border: '#EF444450' },
  na:   { label: 'N/A',  color: '#6B7280', bg: '#6B728020', border: '#6B728050' },
}

function ResultBadge({ result }: { result: string }) {
  const cfg = RESULT_CFG[result as keyof typeof RESULT_CFG] ?? RESULT_CFG.na
  return (
    <span
      className="text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0"
      style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}
    >
      {cfg.label}
    </span>
  )
}

export default function DOTInspectionDetail({ inspection }: { inspection: DOTInspection }) {
  const isPassed  = inspection.overall_result === 'pass'
  const inspDate  = new Date(inspection.inspection_date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
  const lockedAt  = inspection.locked_at
    ? new Date(inspection.locked_at).toLocaleString()
    : null
  const inspId    = inspection.inspection_id ?? `DOT-${inspection.id.slice(0, 8).toUpperCase()}`
  const violations = inspection.violations ?? []

  return (
    <>
      {/* Print stylesheet */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          .no-print { display: none !important; }
          .print-show { display: block !important; }
          @page { size: letter; margin: 0.65in; }
          body { background: white !important; color: black !important; }
          #print-root { position: fixed; inset: 0; background: white; z-index: 9999; padding: 0; }
        }
        .print-show { display: none; }
      ` }} />

      {/* ── WEB VIEW ── */}
      <div className="no-print max-w-3xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
              HD Suite — DOT Inspection Record
            </p>
            <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">
              {inspId}
            </h1>
            <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
              {inspDate}
              {inspection.location && ` · ${inspection.location}`}
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <Link
              href="/hd/dot-inspections"
              className="px-3 py-2 rounded-lg text-sm"
              style={{ color: 'rgba(255,255,255,0.4)', border: '1px solid #1e3040' }}
            >
              ← Back
            </Link>
            <button
              type="button"
              onClick={() => window.print()}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white flex items-center gap-2"
              style={{ background: HD_BLUE }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Print / PDF
            </button>
          </div>
        </div>

        {/* Locked banner */}
        <div
          className="rounded-xl px-5 py-3 flex items-center gap-3"
          style={{ background: '#0d1820', border: `1px solid ${HD_ORANGE}40` }}
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke={HD_ORANGE} strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <p className="text-xs font-bold tracking-wide" style={{ color: HD_ORANGE }}>
            LOCKED RECORD — NOT EDITABLE
          </p>
          {lockedAt && (
            <p className="text-xs ml-auto" style={{ color: 'rgba(255,255,255,0.35)' }}>
              Signed {lockedAt}
            </p>
          )}
        </div>

        {/* Overall result */}
        <div
          className="rounded-xl px-5 py-4 flex items-center gap-4"
          style={{
            background: isPassed ? '#22C55E15' : '#EF444415',
            border: `2px solid ${isPassed ? '#22C55E40' : '#EF444440'}`,
          }}
        >
          <span className="font-condensed font-bold text-4xl" style={{ color: isPassed ? '#22C55E' : '#EF4444' }}>
            {isPassed ? 'PASS' : 'FAIL'}
          </span>
          <div>
            <p className="text-white font-semibold text-sm">Annual DOT Inspection</p>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
              {violations.length > 0
                ? `${violations.length} violation${violations.length !== 1 ? 's' : ''} found`
                : 'No violations found'
              }
            </p>
          </div>
        </div>

        {/* Unit info */}
        <div className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="font-condensed font-bold text-white text-lg tracking-wide mb-4">UNIT INFORMATION</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Unit Number',    value: inspection.unit?.unit_number     ?? '—' },
              { label: 'Make / Model',   value: inspection.unit ? `${inspection.unit.manufacturer} ${inspection.unit.model}` : '—' },
              { label: 'Serial / VIN',   value: inspection.unit?.serial_number   ?? '—' },
              { label: 'Fleet Account',  value: inspection.fleet_account?.fleet_name ?? '—' },
              { label: 'Odometer / Hrs', value: inspection.odometer_hours        ?? '—' },
              { label: 'Location',       value: inspection.location              ?? '—' },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs uppercase tracking-widest mb-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>{label}</p>
                <p className="text-sm text-white">{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Categories */}
        <div className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="font-condensed font-bold text-white text-lg tracking-wide mb-4">INSPECTION RESULTS</p>
          <div className="space-y-1">
            {INSPECTION_CATEGORIES.map(cat => {
              const d = inspection.inspection_data[cat.id] ?? { result: 'na', notes: '' }
              const isFail = d.result === 'fail'
              return (
                <div
                  key={cat.id}
                  className="rounded-lg"
                  style={{
                    background: isFail ? '#1a0505' : '#0f1820',
                    border: `1px solid ${isFail ? '#EF444430' : '#1e3040'}`,
                  }}
                >
                  <div className="flex items-center gap-3 px-4 py-2.5">
                    <span className="text-xs font-mono font-bold w-6 text-right flex-shrink-0" style={{ color: 'rgba(255,255,255,0.25)' }}>
                      {cat.num}
                    </span>
                    <p className="flex-1 text-sm text-white">{cat.label}</p>
                    <ResultBadge result={d.result} />
                  </div>
                  {isFail && d.notes && (
                    <div className="px-4 pb-3 ml-9">
                      <p className="text-xs leading-relaxed" style={{ color: '#EF4444CC' }}>
                        Violation: {d.notes}
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Violations summary */}
        {violations.length > 0 && (
          <div className="rounded-xl p-5" style={{ background: '#1a0505', border: '1px solid #EF444440' }}>
            <p className="font-condensed font-bold text-lg tracking-wide mb-3" style={{ color: '#EF4444' }}>
              VIOLATIONS FOUND
            </p>
            <div className="space-y-2">
              {violations.map((v, i) => (
                <div key={i} className="rounded-lg p-3" style={{ background: '#EF444415', border: '1px solid #EF444430' }}>
                  <p className="text-xs font-bold uppercase tracking-wide mb-0.5" style={{ color: '#EF4444' }}>
                    {categoryLabel(v.category)}
                  </p>
                  <p className="text-sm text-white">{v.notes || '(No description provided)'}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Signature + Inspector */}
        <div className="rounded-xl p-5 space-y-4" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="font-condensed font-bold text-white text-lg tracking-wide">INSPECTOR CERTIFICATION</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs uppercase tracking-widest mb-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>Inspector</p>
              <p className="text-sm text-white">{inspection.inspector_name ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest mb-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>Cert #</p>
              <p className="text-sm text-white">{inspection.inspector_cert_number ?? '—'}</p>
            </div>
          </div>
          {inspection.signature_data && (
            <div>
              <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'rgba(255,255,255,0.35)' }}>Signature</p>
              <div className="rounded-lg p-3" style={{ background: '#162030', border: '1px solid #1e3040' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={inspection.signature_data}
                  alt="Inspector signature"
                  className="max-h-24 w-auto"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="rounded-xl p-4" style={{ background: '#0d1820', border: '1px solid #1e3040' }}>
          <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.3)' }}>
            Inspection ID: {inspId} · Generated {new Date(inspection.created_at).toLocaleString()} ·
            This record was electronically signed and is locked. Generated by NWI HD Suite.
          </p>
        </div>

      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          PRINT-ONLY LAYOUT (hidden on screen, shown when printing)
      ══════════════════════════════════════════════════════════════════════ */}
      <div id="print-root" className="print-show" style={{ fontFamily: 'Arial, sans-serif', color: '#111', lineHeight: 1.4 }}>
        {/* Print header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '3px solid #E85D24', paddingBottom: 12, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: 2, color: '#E85D24', textTransform: 'uppercase' }}>
              NWI HD Suite
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginTop: 2 }}>
              Annual DOT Vehicle Inspection Record
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: '#666', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
              FMCSA 49 CFR Part 396
            </div>
            <div style={{
              marginTop: 4, padding: '3px 10px', borderRadius: 4, fontWeight: 700, fontSize: 12,
              background: isPassed ? '#22C55E' : '#EF4444', color: '#fff', display: 'inline-block',
            }}>
              {isPassed ? 'PASS' : 'FAIL'} — {violations.length} VIOLATION{violations.length !== 1 ? 'S' : ''}
            </div>
          </div>
        </div>

        <div style={{ fontSize: 9, fontWeight: 700, color: '#E85D24', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
          LOCKED RECORD — NOT EDITABLE · {inspId}
        </div>

        {/* Unit info table */}
        <div style={{ border: '1px solid #ccc', borderRadius: 4, marginBottom: 14 }}>
          <div style={{ background: '#f5f5f5', padding: '6px 12px', fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', borderBottom: '1px solid #ccc' }}>
            Unit Information
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0 }}>
            {[
              { label: 'Unit Number',    value: inspection.unit?.unit_number     ?? '—' },
              { label: 'Make / Model',   value: inspection.unit ? `${inspection.unit.manufacturer} ${inspection.unit.model}` : '—' },
              { label: 'Serial / VIN',   value: inspection.unit?.serial_number   ?? '—' },
              { label: 'Fleet Account',  value: inspection.fleet_account?.fleet_name ?? '—' },
              { label: 'Odometer / Hrs', value: inspection.odometer_hours        ?? '—' },
              { label: 'Location',       value: inspection.location              ?? '—' },
              { label: 'Inspection Date',value: new Date(inspection.inspection_date + 'T12:00:00').toLocaleDateString() },
              { label: 'Inspector',      value: inspection.inspector_name        ?? '—' },
              { label: 'Cert #',         value: inspection.inspector_cert_number ?? '—' },
            ].map(({ label, value }, i) => (
              <div key={i} style={{ padding: '6px 12px', borderBottom: i < 6 ? '1px solid #eee' : undefined, borderRight: i % 3 < 2 ? '1px solid #eee' : undefined }}>
                <div style={{ fontSize: 8, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
                <div style={{ fontSize: 11, fontWeight: 600, marginTop: 1 }}>{value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Categories */}
        <div style={{ border: '1px solid #ccc', borderRadius: 4, marginBottom: 14 }}>
          <div style={{ background: '#f5f5f5', padding: '6px 12px', fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', borderBottom: '1px solid #ccc' }}>
            CVSA Inspection Categories
          </div>
          {INSPECTION_CATEGORIES.map((cat, i) => {
            const d      = inspection.inspection_data[cat.id] ?? { result: 'na', notes: '' }
            const isFail = d.result === 'fail'
            const cfg    = RESULT_CFG[d.result as keyof typeof RESULT_CFG] ?? RESULT_CFG.na
            return (
              <div key={cat.id} style={{ borderBottom: i < 17 ? '1px solid #eee' : undefined, background: isFail ? '#fff8f8' : undefined }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px' }}>
                  <span style={{ fontSize: 9, color: '#999', width: 20, textAlign: 'right', flexShrink: 0 }}>{cat.num}</span>
                  <span style={{ flex: 1, fontSize: 11 }}>{cat.label}</span>
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                    background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
                  }}>
                    {cfg.label}
                  </span>
                </div>
                {isFail && d.notes && (
                  <div style={{ marginLeft: 40, paddingRight: 12, paddingBottom: 5, fontSize: 10, color: '#c00' }}>
                    Violation: {d.notes}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Signature section */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <div style={{ border: '1px solid #ccc', borderRadius: 4 }}>
            <div style={{ background: '#f5f5f5', padding: '6px 12px', fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', borderBottom: '1px solid #ccc' }}>
              Inspector Certification
            </div>
            <div style={{ padding: 12 }}>
              <div style={{ fontSize: 9, color: '#888', textTransform: 'uppercase', marginBottom: 2 }}>Name</div>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{inspection.inspector_name ?? '—'}</div>
              <div style={{ fontSize: 9, color: '#888', textTransform: 'uppercase', marginBottom: 2 }}>Certification #</div>
              <div style={{ fontSize: 11 }}>{inspection.inspector_cert_number ?? '—'}</div>
              <div style={{ marginTop: 10, fontSize: 9, color: '#888', lineHeight: 1.4 }}>
                I certify this vehicle has been inspected per FMCSA 49 CFR 396 and I am a qualified inspector
                as defined by 49 CFR 396.19.
              </div>
            </div>
          </div>

          <div style={{ border: '1px solid #ccc', borderRadius: 4 }}>
            <div style={{ background: '#f5f5f5', padding: '6px 12px', fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', borderBottom: '1px solid #ccc' }}>
              Electronic Signature
            </div>
            <div style={{ padding: 12 }}>
              {inspection.signature_data ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={inspection.signature_data} alt="Signature" style={{ maxHeight: 80, maxWidth: '100%' }} />
              ) : (
                <div style={{ fontSize: 10, color: '#999' }}>No signature captured</div>
              )}
              <div style={{ marginTop: 4, fontSize: 8, color: '#aaa' }}>
                Electronically signed {lockedAt ?? ''}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ borderTop: '1px solid #ccc', paddingTop: 8, fontSize: 9, color: '#999', display: 'flex', justifyContent: 'space-between' }}>
          <span>
            Inspection ID: {inspId} · Generated by NWI HD Suite ·
            This record was electronically signed and is locked.
          </span>
          <span>Generated {new Date(inspection.created_at).toLocaleString()}</span>
        </div>
      </div>
    </>
  )
}
