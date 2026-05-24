'use client'

import { useState } from 'react'

const HD_ORANGE = '#E85D24'

export default function HDLaborRateForm({ initialRate }: { initialRate: string | null }) {
  const [rate,    setRate]    = useState(initialRate ?? '')
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function handleSave() {
    if (!rate || isNaN(Number(rate))) { setError('Enter a valid number'); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/hd/settings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ labor_rate: Number(rate) }),
      })
      if (!res.ok) throw new Error('Save failed')
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError('Could not save — try again')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="flex gap-3 items-center">
        <input
          type="number"
          value={rate}
          onChange={e => { setRate(e.target.value); setSaved(false) }}
          placeholder="e.g. 125"
          min="0"
          max="999"
          className="flex-1 px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20"
          style={{ background: '#162030', border: '1px solid #1e3040' }}
        />
        <span className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>/hr</span>
        <button
          onClick={handleSave}
          disabled={saving || !rate}
          className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white transition-opacity"
          style={{ background: HD_ORANGE, opacity: saving || !rate ? 0.5 : 1 }}
        >
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
        </button>
      </div>
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
      {saved && <p className="text-xs mt-1" style={{ color: '#22C55E' }}>Labor rate saved successfully</p>}
    </div>
  )
}
