'use client'

import { useState } from 'react'

const HD_ORANGE = '#E85D24'

interface Props {
  initialFeeType:        'flat' | 'percentage'
  initialFlatFee:        string
  initialPercentageRate: string
  initialGraceDays:      string
  initialSendSms:        boolean
  initialActive:         boolean
}

const inputStyle = { background: '#162030', border: '1px solid #1e3040' }

export default function LateFeeSettingsForm({
  initialFeeType, initialFlatFee, initialPercentageRate, initialGraceDays, initialSendSms, initialActive,
}: Props) {
  const [feeType,   setFeeType]   = useState<'flat' | 'percentage'>(initialFeeType)
  const [flatFee,   setFlatFee]   = useState(initialFlatFee)
  const [rate,      setRate]      = useState(initialPercentageRate)
  const [graceDays, setGraceDays] = useState(initialGraceDays)
  const [sendSms,   setSendSms]   = useState(initialSendSms)
  const [active,    setActive]    = useState(initialActive)
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setSaved(false); setError(null)
    try {
      const res = await fetch('/api/hd/late-fee-settings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fee_type:              feeType,
          flat_fee_amount:       flatFee ? Number(flatFee) : 25,
          percentage_rate:       rate ? Number(rate) : 1.5,
          grace_period_days:     graceDays ? Number(graceDays) : 0,
          send_sms_notification: sendSms,
          active,
        }),
      })
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error ?? 'Save failed')
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      {/* Master on/off */}
      <label className="flex items-center justify-between gap-3 cursor-pointer">
        <div>
          <span className="text-sm font-semibold text-white">Late fees active</span>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>Master switch — turn the whole engine on or off.</p>
        </div>
        <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="w-5 h-5" style={{ accentColor: HD_ORANGE }} />
      </label>

      {/* Fee type toggle */}
      <div>
        <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Fee Type</label>
        <div className="flex gap-2">
          {(['flat', 'percentage'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setFeeType(t)}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold capitalize transition-colors"
              style={feeType === t
                ? { background: HD_ORANGE, color: '#fff', border: `1px solid ${HD_ORANGE}` }
                : { background: '#162030', color: 'rgba(255,255,255,0.6)', border: '1px solid #1e3040' }}
            >
              {t === 'flat' ? 'Flat Fee' : 'Percentage'}
            </button>
          ))}
        </div>
      </div>

      {/* Flat fee amount */}
      {feeType === 'flat' ? (
        <div>
          <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Flat Fee Amount ($)</label>
          <input type="number" min="0" step="0.01" value={flatFee} onChange={e => setFlatFee(e.target.value)}
            placeholder="25.00" className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder-white/20" style={inputStyle} />
        </div>
      ) : (
        <div>
          <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Monthly Rate (% of invoice total)</label>
          <input type="number" min="0" step="0.1" value={rate} onChange={e => setRate(e.target.value)}
            placeholder="1.5" className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder-white/20" style={inputStyle} />
        </div>
      )}

      {/* Grace period */}
      <div>
        <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Grace Period (days past due)</label>
        <input type="number" min="0" step="1" value={graceDays} onChange={e => setGraceDays(e.target.value)}
          placeholder="0" className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder-white/20" style={inputStyle} />
        <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>Days after the due date before a late fee is applied.</p>
      </div>

      {/* Send SMS */}
      <label className="flex items-center justify-between gap-3 cursor-pointer">
        <div>
          <span className="text-sm font-semibold text-white">Send SMS when late fee applied</span>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>Texts the customer that a fee was added.</p>
        </div>
        <input type="checkbox" checked={sendSms} onChange={e => setSendSms(e.target.checked)} className="w-5 h-5" style={{ accentColor: HD_ORANGE }} />
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {saved  && <p className="text-sm" style={{ color: '#22C55E' }}>Late fee settings saved</p>}

      <button type="submit" disabled={saving} className="px-6 py-2.5 rounded-lg text-sm font-semibold text-white" style={{ background: HD_ORANGE, opacity: saving ? 0.6 : 1 }}>
        {saving ? 'Saving…' : 'Save Settings'}
      </button>
    </form>
  )
}
