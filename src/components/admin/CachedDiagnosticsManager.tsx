'use client'

import { useState, useMemo } from 'react'

export interface CachedEntry {
  id:            string
  cache_key:     string
  manufacturer:  string | null
  alarm_code:    string | null
  unit_model:    string | null
  engine_brand:  string | null
  engine_model:  string | null
  spn:           string | null
  fmi:           string | null
  result_html:   string
  source:        string | null
  search_count:  number | null
  created_at:    string
  last_accessed: string | null
  needs_review:  boolean | null
  reviewed_at:   string | null
  reviewed_by:   string | null
  citations:     string[] | null
  expires_at:    string | null
}

type SortKey = 'most_searched' | 'recent_accessed' | 'recent_cached'

// Section headers the diagnostic results use — mirrors the QuickWrench parser so
// a promote can pre-fill the structured verified columns from result_html.
const SECTION_KEYS = [
  'ALARM MEANING', 'MOST LIKELY CAUSES', 'DIAGNOSTIC STEPS',
  'COMMON FIX', 'PARTS NEEDED', 'SPECIAL TOOLS REQUIRED', 'SAFETY WARNINGS', 'PM NOTE',
] as const

function parseSections(text: string): Record<string, string> {
  const escaped = SECTION_KEYS.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`(${escaped.join('|')}):`, 'g')
  const found: { key: string; contentStart: number; headerStart: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    found.push({ key: m[1], headerStart: m.index, contentStart: m.index + m[0].length })
  }
  const out: Record<string, string> = {}
  found.forEach((pos, i) => {
    out[pos.key] = text.slice(pos.contentStart, found[i + 1]?.headerStart ?? text.length).trim()
  })
  return out
}

interface PromoteForm {
  manufacturer:     string
  unit_family:      string
  alarm_code:       string
  display_text:     string
  meaning:          string
  severity:         string
  common_causes:    string
  diagnostic_steps: string
  common_fix:       string
  parts_needed:     string
  safety_warning:   string
  field_notes:      string
  book_time:        string
  mobile_time:      string
}

// Pre-fill the promote form from a cached entry. Structured fields are parsed
// from result_html; if no ALARM MEANING section is found, the whole text seeds
// `meaning` so the required field is never blank. The founder reviews/edits all
// of this before saving — nothing is silently copied to verified.
function promoteDefaults(e: CachedEntry): PromoteForm {
  const s = parseSections(e.result_html)
  return {
    manufacturer:     e.manufacturer === 'Carrier' ? 'Carrier' : 'TK',
    unit_family:      e.unit_model ?? '',
    alarm_code:       e.alarm_code ?? '',
    display_text:     '',
    meaning:          s['ALARM MEANING'] || e.result_html.trim(),
    severity:         'check',
    common_causes:    s['MOST LIKELY CAUSES'] ?? '',
    diagnostic_steps: s['DIAGNOSTIC STEPS'] ?? '',
    common_fix:       s['COMMON FIX'] ?? '',
    parts_needed:     s['PARTS NEEDED'] ?? '',
    safety_warning:   s['SAFETY WARNINGS'] ?? '',
    field_notes:      s['PM NOTE'] ?? '',
    book_time:        '',
    mobile_time:      '',
  }
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function identity(e: CachedEntry): string {
  if (e.manufacturer) return [e.manufacturer, e.unit_model].filter(Boolean).join(' ') || '—'
  return [e.engine_brand, e.engine_model].filter(Boolean).join(' ') || '—'
}

function codeLabel(e: CachedEntry): string {
  if (e.alarm_code) return e.alarm_code
  const parts = [e.spn ? `SPN ${e.spn}` : null, e.fmi ? `FMI ${e.fmi}` : null].filter(Boolean)
  return parts.length ? parts.join(' ') : '—'
}

// Reefer rows can be promoted into hd_alarm_codes (TK/Carrier + alarm code);
// truck rows cannot (that table's manufacturer CHECK rejects engine brands).
function canPromote(e: CachedEntry): boolean {
  return (e.manufacturer === 'TK' || e.manufacturer === 'Carrier') && !!e.alarm_code
}

export default function CachedDiagnosticsManager({ entries }: { entries: CachedEntry[] }) {
  const [rows,   setRows]   = useState<CachedEntry[]>(entries)
  const [sort,   setSort]   = useState<SortKey>('most_searched')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error,  setError]  = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [editEntry, setEditEntry] = useState<CachedEntry | null>(null)
  const [editText,  setEditText]  = useState('')

  const [promoteEntry, setPromoteEntry] = useState<CachedEntry | null>(null)
  const [promoteForm,  setPromoteForm]  = useState<PromoteForm | null>(null)

  // "Needs Review" tab — Gemini-generated entries flagged as hazardous.
  const [reviewOnly, setReviewOnly] = useState(false)
  const needsReviewCount = rows.filter(r => r.needs_review).length

  const sorted = useMemo(() => {
    const copy = rows.filter(r => (reviewOnly ? r.needs_review : true))
    copy.sort((a, b) => {
      if (sort === 'most_searched')   return (b.search_count ?? 0) - (a.search_count ?? 0)
      if (sort === 'recent_accessed') return (b.last_accessed ?? '').localeCompare(a.last_accessed ?? '')
      return (b.created_at ?? '').localeCompare(a.created_at ?? '')
    })
    return copy
  }, [rows, sort, reviewOnly])

  async function call(payload: Record<string, unknown>): Promise<boolean> {
    setError(null); setNotice(null)
    try {
      const res  = await fetch('/api/admin/cached-diagnostics', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({})) as { error?: unknown }
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : `Request failed (${res.status})`)
        return false
      }
      return true
    } catch {
      setError('Network error — please try again.')
      return false
    }
  }

  async function saveEdit() {
    if (!editEntry) return
    setBusyId(editEntry.id)
    const ok = await call({ action: 'update', id: editEntry.id, result_html: editText })
    setBusyId(null)
    if (ok) {
      const stamp = new Date().toISOString()
      setRows(rs => rs.map(r => r.id === editEntry.id
        ? { ...r, result_html: editText, last_accessed: stamp, needs_review: false, reviewed_at: stamp }
        : r))
      setNotice('Saved corrected result.')
      setEditEntry(null)
    }
  }

  async function doDelete(e: CachedEntry) {
    if (!window.confirm(`Delete cached entry "${e.cache_key}"? The next lookup will regenerate it.`)) return
    setBusyId(e.id)
    const ok = await call({ action: 'delete', id: e.id })
    setBusyId(null)
    if (ok) { setRows(rs => rs.filter(r => r.id !== e.id)); setNotice('Deleted cached entry.') }
  }

  async function savePromote() {
    if (!promoteEntry || !promoteForm) return
    if (!promoteForm.unit_family.trim() || !promoteForm.meaning.trim()) {
      setError('Unit family and meaning are required to promote.')
      return
    }
    setBusyId(promoteEntry.id)
    const ok = await call({ action: 'promote', id: promoteEntry.id, fields: promoteForm })
    setBusyId(null)
    if (ok) {
      setRows(rs => rs.filter(r => r.id !== promoteEntry.id))
      setNotice('Promoted to verified and removed from cache.')
      setPromoteEntry(null); setPromoteForm(null)
    }
  }

  const th = 'px-4 py-3 text-left text-xs font-semibold text-white/40 uppercase tracking-wider whitespace-nowrap'
  const td = 'px-4 py-3 text-sm text-white/80 whitespace-nowrap'

  const sortBtn = (key: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => setSort(key)}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
        sort === key ? 'bg-orange text-white' : 'bg-dark-card border border-dark-border text-white/50 hover:text-white/80'
      }`}
    >
      {label}
    </button>
  )

  const up = (key: keyof PromoteForm, value: string) =>
    setPromoteForm(f => (f ? { ...f, [key]: value } : f))

  const fieldLabel = 'block text-xs uppercase tracking-widest mb-1.5 text-white/40'
  const inputCls   = 'w-full px-3 py-2 rounded-lg text-sm text-white bg-dark-lighter border border-dark-border'

  return (
    <section className="mb-10">
      <h2 className="text-white font-semibold text-lg mb-1">
        Cached Diagnostics ({rows.length})
      </h2>
      <p className="text-white/40 text-sm mb-3">
        Review, correct, delete, or promote AI/web-search results to verified.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {sortBtn('most_searched',   'Most Searched')}
        {sortBtn('recent_cached',   'Recently Cached')}
        {sortBtn('recent_accessed', 'Recently Accessed')}
        <span className="mx-1 h-5 w-px bg-dark-border" />
        <button
          type="button"
          onClick={() => setReviewOnly(v => !v)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            reviewOnly
              ? 'bg-yellow-500/20 border border-yellow-500/50 text-yellow-300'
              : 'bg-dark-card border border-dark-border text-white/50 hover:text-white/80'
          }`}
        >
          ⚠ Needs Review ({needsReviewCount})
        </button>
      </div>

      {error  && <div className="mb-3 rounded-lg px-4 py-2.5 text-sm bg-red-500/10 border border-red-500/30 text-red-400">{error}</div>}
      {notice && <div className="mb-3 rounded-lg px-4 py-2.5 text-sm bg-green-500/10 border border-green-500/30 text-green-400">{notice}</div>}

      <div className="overflow-x-auto rounded-xl border border-dark-border">
        <table className="w-full">
          <thead className="bg-dark-lighter">
            <tr>
              <th className={th}>Identity</th>
              <th className={th}>Code</th>
              <th className={th}>Source</th>
              <th className={th}>Searches</th>
              <th className={th}>Last Accessed</th>
              <th className={th}>Cache Key</th>
              <th className={th}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-dark-border/50">
            {sorted.map(e => (
              <tr key={e.id} className="hover:bg-dark-lighter/40 transition-colors">
                <td className={td}>
                  {identity(e)}
                  {e.needs_review && (
                    <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold bg-yellow-500/20 text-yellow-300 whitespace-nowrap">
                      ⚠ NEEDS REVIEW
                    </span>
                  )}
                </td>
                <td className={td}>{codeLabel(e)}</td>
                <td className={`${td} text-white/50`}>
                  {e.source ?? '—'}
                  {e.source === 'parts_manager' && e.expires_at && (
                    <span className="block text-xs text-white/30">Expires: {fmtDate(e.expires_at)}</span>
                  )}
                </td>
                <td className={`${td} tabular-nums`}>{e.search_count ?? 0}</td>
                <td className={`${td} text-white/60`}>{fmtDate(e.last_accessed)}</td>
                <td className={`${td} text-white/40 font-mono text-xs max-w-[16rem] truncate`} title={e.cache_key}>{e.cache_key}</td>
                <td className={td}>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setEditEntry(e); setEditText(e.result_html) }}
                      disabled={busyId === e.id}
                      className="px-2.5 py-1 rounded text-xs font-medium bg-dark-lighter border border-dark-border text-white/70 hover:text-white disabled:opacity-40"
                    >
                      Edit
                    </button>
                    {canPromote(e) && (
                      <button
                        type="button"
                        onClick={() => { setPromoteEntry(e); setPromoteForm(promoteDefaults(e)) }}
                        disabled={busyId === e.id}
                        className="px-2.5 py-1 rounded text-xs font-medium bg-green-500/15 border border-green-500/30 text-green-400 hover:bg-green-500/25 disabled:opacity-40"
                      >
                        Promote
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => doDelete(e)}
                      disabled={busyId === e.id}
                      className="px-2.5 py-1 rounded text-xs font-medium bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 disabled:opacity-40"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-white/30 text-sm">No cached diagnostics yet</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Edit modal ── */}
      {editEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setEditEntry(null)}>
          <div className="bg-dark-card border border-dark-border rounded-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-5" onClick={ev => ev.stopPropagation()}>
            <h3 className="text-white font-semibold text-base mb-1">Edit cached result</h3>
            <p className="text-white/40 text-xs mb-3 font-mono truncate" title={editEntry.cache_key}>{editEntry.cache_key}</p>
            <textarea
              value={editText}
              onChange={e => setEditText(e.target.value)}
              rows={18}
              className="w-full px-3 py-2 rounded-lg text-sm text-white bg-dark-lighter border border-dark-border font-mono resize-y"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => setEditEntry(null)} className="px-4 py-2 rounded-lg text-sm text-white/60 hover:text-white">Cancel</button>
              <button type="button" onClick={saveEdit} disabled={busyId === editEntry.id} className="px-4 py-2 rounded-lg text-sm font-medium bg-orange text-white disabled:opacity-50">
                {busyId === editEntry.id ? 'Saving…' : 'Save correction'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Promote modal ── */}
      {promoteEntry && promoteForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => { setPromoteEntry(null); setPromoteForm(null) }}>
          <div className="bg-dark-card border border-dark-border rounded-xl w-full max-w-2xl max-h-[88vh] overflow-y-auto p-5" onClick={ev => ev.stopPropagation()}>
            <h3 className="text-white font-semibold text-base mb-1">Promote to verified</h3>
            <p className="text-white/40 text-xs mb-4">
              Review and correct every field before saving. This writes a green VERIFIED entry to hd_alarm_codes and removes the cached row.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className={fieldLabel}>Manufacturer</label>
                <select value={promoteForm.manufacturer} onChange={e => up('manufacturer', e.target.value)} className={inputCls}>
                  <option value="TK">TK</option>
                  <option value="Carrier">Carrier</option>
                </select>
              </div>
              <div>
                <label className={fieldLabel}>Unit Family *</label>
                <input value={promoteForm.unit_family} onChange={e => up('unit_family', e.target.value)} className={inputCls} placeholder="e.g. Precedent" />
              </div>
              <div>
                <label className={fieldLabel}>Alarm Code</label>
                <input value={promoteForm.alarm_code} onChange={e => up('alarm_code', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={fieldLabel}>Severity</label>
                <select value={promoteForm.severity} onChange={e => up('severity', e.target.value)} className={inputCls}>
                  <option value="immediate">immediate</option>
                  <option value="check">check</option>
                  <option value="maintenance">maintenance</option>
                  <option value="info">info</option>
                </select>
              </div>
              <div>
                <label className={fieldLabel}>Display Text</label>
                <input value={promoteForm.display_text} onChange={e => up('display_text', e.target.value)} className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={fieldLabel}>Book hrs</label>
                  <input value={promoteForm.book_time} onChange={e => up('book_time', e.target.value)} className={inputCls} inputMode="decimal" />
                </div>
                <div>
                  <label className={fieldLabel}>Mobile hrs</label>
                  <input value={promoteForm.mobile_time} onChange={e => up('mobile_time', e.target.value)} className={inputCls} inputMode="decimal" />
                </div>
              </div>
            </div>

            {([
              ['meaning',          'Meaning *'],
              ['common_causes',    'Most Likely Causes'],
              ['diagnostic_steps', 'Diagnostic Steps'],
              ['common_fix',       'Common Fix'],
              ['parts_needed',     'Parts Needed'],
              ['safety_warning',   'Safety Warning'],
              ['field_notes',      'Field Notes'],
            ] as [keyof PromoteForm, string][]).map(([key, label]) => (
              <div key={key} className="mb-3">
                <label className={fieldLabel}>{label}</label>
                <textarea value={promoteForm[key]} onChange={e => up(key, e.target.value)} rows={key === 'meaning' ? 4 : 3} className={`${inputCls} resize-y`} />
              </div>
            ))}

            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => { setPromoteEntry(null); setPromoteForm(null) }} className="px-4 py-2 rounded-lg text-sm text-white/60 hover:text-white">Cancel</button>
              <button type="button" onClick={savePromote} disabled={busyId === promoteEntry.id} className="px-4 py-2 rounded-lg text-sm font-medium bg-green-500/20 border border-green-500/40 text-green-400 hover:bg-green-500/30 disabled:opacity-50">
                {busyId === promoteEntry.id ? 'Promoting…' : 'Save as verified'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
