// The import wizard's column check, shown before anything is posted. Pure: it renders the
// result of preflightColumns / preflightMapping (src/lib/hd/import-columns.ts) and holds no
// state, so the blocked screen can be rendered and read in a test.
import { missingColumnsMessage, type Preflight } from '@/lib/hd/import-columns'

export interface ImportPreflightProps {
  preflight: Preflight
  /** A work order export (Fullbay, invoices) or a unit list (custom). */
  kind: 'work_orders' | 'units'
  /** The format reads no unit column at all (the invoice export). */
  readsNoUnit?: boolean
  onChooseFile: () => void
}

const sectionTitle = 'text-xs uppercase tracking-widest mb-2 font-semibold'

export default function ImportPreflight({ preflight, kind, readsNoUnit, onChooseFile }: ImportPreflightProps) {
  const { recognized, unrecognized, missing, missingRequired, missingOptional, blocked } = preflight
  return (
    <div className="space-y-4" data-testid="import-preflight">
      {blocked && (
        <div role="alert" data-testid="import-blocked" className="px-4 py-3 rounded-lg text-sm space-y-3"
          style={{ background: '#7f1d1d40', border: '1px solid #EF444460', color: 'var(--hd-negative)' }}>
          <p data-testid="import-blocked-message">{missingColumnsMessage(missingRequired, kind)}</p>
          <button type="button" onClick={onChooseFile} data-testid="import-choose-file"
            className="px-4 py-2 rounded-lg text-sm font-semibold"
            style={{ background: 'var(--hd-inner)', color: 'rgba(var(--hd-ink-rgb), 0.9)', border: '1px solid var(--hd-border)' }}>
            Choose a different file
          </button>
        </div>
      )}

      {!blocked && missingOptional.length > 0 && (
        <div role="status" data-testid="import-warning" className="px-4 py-3 rounded-lg text-sm"
          style={{ background: '#78350f30', border: '1px solid #F59E0B50', color: 'var(--hd-warning, #F59E0B)' }}>
          This file has no column for {missingOptional.map(f => f.label).join(', ')}. The import will run, and{' '}
          {missingOptional.length === 1 ? 'that field' : 'those fields'} will be blank on every row.
        </div>
      )}

      {readsNoUnit && (
        <div data-testid="import-no-unit-notice" className="px-4 py-3 rounded-lg text-xs"
          style={{ background: 'var(--hd-card)', border: '1px solid var(--hd-border)', color: 'var(--hd-text-muted)' }}>
          This format has no unit column, so imported invoices will not attach to any unit and will not appear in a unit&apos;s history.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg p-3" style={{ background: 'var(--hd-card)', border: '1px solid var(--hd-border)' }} data-testid="import-recognized">
          <p className={sectionTitle} style={{ color: 'var(--hd-positive)' }}>Recognized ({recognized.length})</p>
          {recognized.length === 0
            ? <p className="text-xs" style={{ color: 'var(--hd-text-faint)' }}>Nothing in this file matched a column the import reads.</p>
            : <ul className="space-y-1 text-xs">
                {recognized.map(r => (
                  <li key={r.field.key}>
                    <span className="text-white">{r.field.label}</span>
                    <span style={{ color: 'var(--hd-text-faint)' }}> ← </span>
                    <span className="font-mono" style={{ color: 'var(--hd-text-muted)' }}>{r.header}</span>
                  </li>
                ))}
              </ul>}
        </div>

        <div className="rounded-lg p-3" style={{ background: 'var(--hd-card)', border: '1px solid var(--hd-border)' }} data-testid="import-unrecognized">
          <p className={sectionTitle} style={{ color: 'var(--hd-text-muted)' }}>Not recognized ({unrecognized.length})</p>
          {unrecognized.length === 0
            ? <p className="text-xs" style={{ color: 'var(--hd-text-faint)' }}>Every column in this file is read.</p>
            : <ul className="space-y-1 text-xs">
                {unrecognized.map(u => (
                  <li key={u.header}>
                    <span className="font-mono" style={{ color: 'var(--hd-text-muted)' }}>{u.header || '(blank heading)'}</span>
                    {u.note && <span style={{ color: 'var(--hd-text-faint)' }}> - ignored: {u.note}</span>}
                  </li>
                ))}
              </ul>}
        </div>

        <div className="rounded-lg p-3" style={{ background: 'var(--hd-card)', border: '1px solid var(--hd-border)' }} data-testid="import-missing">
          <p className={sectionTitle} style={{ color: missingRequired.length ? 'var(--hd-negative)' : 'var(--hd-text-muted)' }}>Missing ({missing.length})</p>
          {missing.length === 0
            ? <p className="text-xs" style={{ color: 'var(--hd-text-faint)' }}>Every column the import reads is in this file.</p>
            : <ul className="space-y-1 text-xs">
                {missing.map(f => (
                  <li key={f.key}>
                    <span className="text-white">{f.label}</span>
                    {f.required && <span className="ml-1 font-semibold" style={{ color: 'var(--hd-negative)' }}>required</span>}
                  </li>
                ))}
              </ul>}
        </div>
      </div>
    </div>
  )
}
