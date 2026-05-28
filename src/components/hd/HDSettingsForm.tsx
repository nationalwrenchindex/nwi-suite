'use client'

import { useState } from 'react'

const HD_ORANGE = '#E85D24'

interface Props {
  initialLaborRate: string | null
  initialTechName:  string | null
  initialEpaCert:   string | null
  initialLogoUrl:   string | null
}

export default function HDSettingsForm({ initialLaborRate, initialTechName, initialEpaCert, initialLogoUrl }: Props) {
  const [laborRate, setLaborRate] = useState(initialLaborRate ?? '')
  const [techName,  setTechName]  = useState(initialTechName  ?? '')
  const [epaCert,   setEpaCert]   = useState(initialEpaCert   ?? '')
  const [logoUrl,   setLogoUrl]   = useState(initialLogoUrl   ?? '')
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
          hd_labor_rate:        laborRate ? Number(laborRate) : null,
          hd_tech_name:         techName  || null,
          hd_epa_cert_number:   epaCert   || null,
          hd_company_logo_url:  logoUrl   || null,
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
          className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder-white/20"
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
          className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder-white/20"
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
          className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder-white/20"
          style={{ background: '#162030', border: '1px solid #1e3040' }}
        />
        <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
          Auto-populates EPA 608 log entries
        </p>
      </div>

      <div>
        <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Company Logo URL
        </label>
        <input
          type="url"
          value={logoUrl}
          onChange={e => setLogoUrl(e.target.value)}
          placeholder="https://example.com/logo.png"
          className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder-white/20"
          style={{ background: '#162030', border: '1px solid #1e3040' }}
        />
        <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
          Appears on DOT inspection reports and printed documents
        </p>
        {logoUrl && (
          <div className="mt-2 p-2 rounded-lg inline-block" style={{ background: '#162030', border: '1px solid #1e3040' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl} alt="Company logo preview" className="h-10 w-auto object-contain" onError={e => (e.currentTarget.style.display = 'none')} />
          </div>
        )}
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
