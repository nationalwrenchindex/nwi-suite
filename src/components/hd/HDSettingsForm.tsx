'use client'

import { useState } from 'react'

const HD_ORANGE = '#E85D24'

interface Props {
  initialLaborRate: string | null
  initialTechName:  string | null
  initialEpaCert:   string | null
}

export default function HDSettingsForm({ initialLaborRate, initialTechName, initialEpaCert }: Props) {
  const [laborRate, setLaborRate] = useState(initialLaborRate ?? '')
  const [techName,  setTechName]  = useState(initialTechName  ?? '')
  const [epaCert,   setEpaCert]   = useState(initialEpaCert   ?? '')
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const res = await fetch('/api/hd/settings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          hd_labor_rate:       laborRate ? Number(laborRate) : null,
          hd_tech_name:        techName  || null,
          hd_epa_cert_number:  epaCert   || null,
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
      <div>
        <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Labor Rate ($/hr)
        </label>
        <input
          type="number"
          min="0"
          step="0.01"
          value={laborRate}
          onChange={e => setLaborRate(e.target.value)}
          placeholder="125.00"
          className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20"
          style={{ background: '#162030', border: '1px solid #1e3040' }}
        />
      </div>

      <div>
        <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Tech Name
        </label>
        <input
          type="text"
          value={techName}
          onChange={e => setTechName(e.target.value)}
          placeholder="John Smith"
          className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20"
          style={{ background: '#162030', border: '1px solid #1e3040' }}
        />
      </div>

      <div>
        <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
          EPA 608 Certification #
        </label>
        <input
          type="text"
          value={epaCert}
          onChange={e => setEpaCert(e.target.value)}
          placeholder="XXX-XXXXXXXX"
          className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20"
          style={{ background: '#162030', border: '1px solid #1e3040' }}
        />
        <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
          Auto-populates EPA 608 log entries
        </p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {saved  && <p className="text-sm" style={{ color: '#22C55E' }}>Settings saved</p>}

      <button
        type="submit"
        disabled={saving}
        className="px-6 py-2.5 rounded-lg text-sm font-semibold text-white"
        style={{ background: HD_ORANGE, opacity: saving ? 0.6 : 1 }}
      >
        {saving ? 'Saving…' : 'Save Settings'}
      </button>
    </form>
  )
}
