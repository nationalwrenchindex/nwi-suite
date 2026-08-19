'use client'

import { useRef, useState } from 'react'

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

  const fileRef = useRef<HTMLInputElement | null>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoError,     setLogoError]     = useState<string | null>(null)

  async function uploadLogo(file: File) {
    setUploadingLogo(true)
    setLogoError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res  = await fetch('/api/settings/logo', { method: 'POST', body: form })
      const json = await res.json() as { url?: string; error?: string }
      if (!res.ok || !json.url) throw new Error(json.error ?? 'Upload failed')
      // Cache-bust: the storage path is stable across replacements, so without
      // this the browser keeps showing the previous logo.
      setLogoUrl(`${json.url}?v=${Date.now()}`)
    } catch (e) {
      setLogoError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploadingLogo(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function removeLogo() {
    setUploadingLogo(true)
    setLogoError(null)
    try {
      const res = await fetch('/api/settings/logo', { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(json.error ?? 'Remove failed')
      }
      setLogoUrl('')
    } catch (e) {
      setLogoError(e instanceof Error ? e.message : 'Remove failed')
    } finally {
      setUploadingLogo(false)
    }
  }

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
          // Logo intentionally omitted: it is uploaded and deleted through
          // /api/settings/logo, which owns the storage object as well as the
          // column. Writing it here too would let a stale form value clobber a
          // freshly uploaded logo.
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

      {/* Company logo — a real upload, not a URL field.
          Asking a mobile mechanic to host an image somewhere and paste a link is
          why nobody had one set. This posts to the same /api/settings/logo
          endpoint the LD suite already uses, so there is one bucket, one column
          and one delete path rather than two half-features. */}
      <div>
        <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Company Logo
        </label>

        <div className="flex items-center gap-3">
          <div
            className="rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ width: 96, height: 64, background: '#162030', border: '1px solid #1e3040' }}
          >
            {logoUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={logoUrl} alt="Company logo" className="max-h-full max-w-full object-contain p-1"
                onError={e => (e.currentTarget.style.display = 'none')} />
            ) : (
              <span className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>No logo</span>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) void uploadLogo(f) }}
            />
            <button
              type="button"
              disabled={uploadingLogo}
              onClick={() => fileRef.current?.click()}
              className="px-4 py-2 rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
              style={{ background: `${HD_ORANGE}18`, color: HD_ORANGE, border: `1px solid ${HD_ORANGE}55` }}
            >
              {uploadingLogo ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Upload logo'}
            </button>
            {logoUrl && !uploadingLogo && (
              <button type="button" onClick={() => void removeLogo()}
                className="text-xs underline" style={{ color: 'rgba(255,255,255,0.4)' }}>
                Remove logo
              </button>
            )}
          </div>
        </div>

        <p className="text-xs mt-2" style={{ color: 'rgba(255,255,255,0.3)' }}>
          Replaces NWI branding on work orders, invoices, inspection reports and your booking page.
          PNG, JPG, WEBP or SVG. If no logo is set, your business name is shown instead.
        </p>
        {logoError && <p className="text-xs mt-1 text-red-400">{logoError}</p>}
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
