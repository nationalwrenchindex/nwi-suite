'use client'

// ─── Sales tax settings, shared by LD and HD ───────────────────────────────────
// One component, mounted in both settings pages. The wording matters as much as the
// wiring here: a shop owner has to be able to set this correctly without calling
// anyone, so the labels say what is charged rather than naming database columns, and
// the help text says plainly that it is a state-by-state question.
//
// Self-contained: reads and writes /api/user/profile itself, so each settings page
// only has to drop it in.

import { useEffect, useState } from 'react'
import { surfaceFor, type ProductVariant } from '@/components/shared/segment-theme'

interface TaxState {
  tax_parts:      boolean
  tax_labor:      boolean
  tax_rate_parts: string
  tax_rate_labor: string
}

export default function TaxSettingsFields({ variant }: { variant: ProductVariant }) {
  const s = surfaceFor(variant)

  const [state,   setState]   = useState<TaxState | null>(null)
  const [saving,  setSaving]  = useState(false)
  const [msg,     setMsg]     = useState<string | null>(null)
  const [err,     setErr]     = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/user/profile')
        if (!res.ok) throw new Error('Could not load your tax settings.')
        const j = await res.json()
        if (cancelled) return
        setState({
          tax_parts:      j.tax_parts !== false,
          tax_labor:      j.tax_labor === true,
          tax_rate_parts: String(j.tax_rate_parts ?? j.default_tax_percent ?? ''),
          tax_rate_labor: String(j.tax_rate_labor ?? j.default_tax_percent ?? ''),
        })
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Could not load your tax settings.')
      }
    })()
    return () => { cancelled = true }
  }, [])

  function set<K extends keyof TaxState>(key: K, value: TaxState[K]) {
    setState(prev => (prev ? { ...prev, [key]: value } : prev))
    setMsg(null)
  }

  /**
   * One rate typed once. Almost every shop charges the same rate on both, so typing
   * the parts rate carries it to labor as long as labor still matches what parts
   * used to be -- i.e. the owner has not deliberately set a different labor rate.
   * A hand-entered difference is never overwritten.
   */
  function setPartsRate(value: string) {
    setState(prev => {
      if (!prev) return prev
      const mirror = prev.tax_rate_labor === prev.tax_rate_parts || prev.tax_rate_labor === ''
      return { ...prev, tax_rate_parts: value, tax_rate_labor: mirror ? value : prev.tax_rate_labor }
    })
    setMsg(null)
  }

  async function save() {
    if (!state) return
    setErr(null); setMsg(null)

    // Validate the rate for a category only when that category is actually charged.
    // A blank labor rate is normal and correct when labor is not taxed.
    for (const [label, on, raw] of [
      ['parts', state.tax_parts, state.tax_rate_parts],
      ['labor', state.tax_labor, state.tax_rate_labor],
    ] as const) {
      if (!on) continue
      const n = Number(raw)
      if (raw.trim() === '' || !Number.isFinite(n) || n < 0 || n > 99) {
        setErr(`Enter a ${label} tax rate between 0 and 99.`)
        return
      }
    }

    setSaving(true)
    try {
      const res = await fetch('/api/user/profile', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          tax_parts:      state.tax_parts,
          tax_labor:      state.tax_labor,
          // A rate is still sent for an unchecked category so the number is
          // remembered for whenever it gets switched back on.
          tax_rate_parts: Number(state.tax_rate_parts) || 0,
          tax_rate_labor: Number(state.tax_rate_labor) || 0,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Could not save.')
      setMsg('Saved. This applies to new quotes, work orders and invoices.')
      setTimeout(() => setMsg(null), 5000)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save.')
    }
    setSaving(false)
  }

  if (err && !state) return <p className="text-xs text-danger">{err}</p>
  if (!state) return <p className="text-xs" style={s.faint}>Loading tax settings…</p>

  const row = (
    key:      'parts' | 'labor',
    label:    string,
    checked:  boolean,
    rate:     string,
    onCheck:  (v: boolean) => void,
    onRate:   (v: string) => void,
  ) => (
    <div className="flex items-center gap-3 flex-wrap">
      <label className="flex items-center gap-2 cursor-pointer select-none min-w-[13rem]">
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onCheck(e.target.checked)}
          className="w-4 h-4 accent-orange cursor-pointer"
        />
        <span className="text-sm" style={s.text}>{label}</span>
      </label>
      <div className="flex items-center gap-1.5">
        <input
          type="number" min="0" max="99" step="0.001"
          className="nwi-input text-sm w-24"
          placeholder="0"
          value={rate}
          // Disabled, not hidden: the number stays visible so an owner can see what
          // will apply the moment they tick the box back on.
          disabled={!checked}
          style={!checked ? { opacity: 0.45 } : undefined}
          onChange={e => onRate(e.target.value)}
          aria-label={`${label} rate, percent`}
        />
        <span className="text-sm" style={s.faint}>%</span>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {row('parts', 'Charge sales tax on parts', state.tax_parts, state.tax_rate_parts,
          v => set('tax_parts', v), setPartsRate)}
        {row('labor', 'Charge sales tax on labor', state.tax_labor, state.tax_rate_labor,
          v => set('tax_labor', v), v => set('tax_rate_labor', v))}
      </div>

      <p className="text-xs leading-relaxed" style={s.faint}>
        Most states charge sales tax on parts but not on repair labor, as long as labor
        is listed separately on the invoice — which it is here. Some states do tax
        labor. Check what your state requires, or ask your accountant.
      </p>
      <p className="text-xs leading-relaxed" style={s.faint}>
        In HD, the diagnostic fee and the road call fee are treated as labor. Shop
        supplies and disposal or environmental fees are treated as parts.
      </p>
      <p className="text-xs leading-relaxed" style={s.faint}>
        Changing this affects new quotes, work orders and invoices only. Anything
        already sent to a customer keeps the tax it was sent with.
      </p>

      {err && <p className="text-xs text-danger">{err}</p>}
      {msg && <p className="text-xs" style={{ color: '#10b981' }}>{msg}</p>}

      <button
        onClick={save}
        disabled={saving}
        className="px-5 py-2 bg-[#FF6600] hover:bg-[#E55A00] disabled:opacity-50 text-white font-condensed font-bold text-sm rounded-lg transition-colors"
      >
        {saving ? 'Saving…' : 'Save Tax Settings'}
      </button>
    </div>
  )
}
