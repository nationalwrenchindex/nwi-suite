'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LANDSCAPING_SERVICES } from '@/lib/scheduler'

type Tool = 'plant' | 'lawn' | 'pest' | 'estimate'

const TABS: { key: Tool; label: string; blurb: string; icon: string }[] = [
  { key: 'plant',    label: 'Plant ID',      blurb: 'Identify any plant from a photo',            icon: '🌿' },
  { key: 'lawn',     label: 'Lawn Problem',  blurb: 'Diagnose brown patches, disease & pests',    icon: '🌱' },
  { key: 'pest',     label: 'Pest & Weed',   blurb: 'Identify pests, damage & unknown weeds',     icon: '🐛' },
  { key: 'estimate', label: 'Quick Estimate', blurb: 'Price & time a job in seconds',             icon: '💲' },
]

const PROPERTY_SIZES = [
  { value: 'Small (under 5,000 sq ft)',        label: 'Small · under 5k sq ft' },
  { value: 'Medium (5,000–10,000 sq ft)',      label: 'Medium · 5k–10k sq ft' },
  { value: 'Large (10,000–20,000 sq ft)',      label: 'Large · 10k–20k sq ft' },
  { value: 'Very large (over 20,000 sq ft)',   label: 'Very large · 20k+ sq ft' },
]
const CONDITIONS = ['Excellent', 'Good', 'Fair', 'Poor']

// Downscale an image file to <=1024px longest edge and return base64 (no prefix) + mime.
function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const maxEdge = 1024
      let { width, height } = img
      if (width > maxEdge || height > maxEdge) {
        const scale = maxEdge / Math.max(width, height)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error('Could not process image.')); return }
      ctx.drawImage(img, 0, 0, width, height)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
      URL.revokeObjectURL(url)
      resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' })
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not load image.')) }
    img.src = url
  })
}

// Minimal markdown renderer for ## headers, - bullets, **bold**.
function renderMarkdown(text: string) {
  return text.split('\n').map((line, i) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('## ')) {
      return <h3 key={i} className="font-condensed font-bold text-orange text-lg mt-4 mb-1">{trimmed.slice(3)}</h3>
    }
    if (trimmed.startsWith('# ')) {
      return <h2 key={i} className="font-condensed font-bold text-white text-xl mt-4 mb-1">{trimmed.slice(2)}</h2>
    }
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      return <li key={i} className="ml-4 list-disc text-white/80 text-sm">{bold(trimmed.slice(2))}</li>
    }
    if (!trimmed) return <div key={i} className="h-2" />
    return <p key={i} className="text-white/80 text-sm leading-relaxed">{bold(trimmed)}</p>
  })
}
function bold(s: string) {
  const parts = s.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i} className="text-white font-semibold">{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>,
  )
}

export default function FieldAssistClient({ laborRate }: { laborRate: number }) {
  const router = useRouter()
  const [tab, setTab] = useState<Tool>('plant')

  // Image tools
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [imgData, setImgData] = useState<{ base64: string; mimeType: string } | null>(null)
  const [hint, setHint] = useState('')

  // Estimate tool
  const [serviceType, setServiceType] = useState<string>(LANDSCAPING_SERVICES[0])
  const [propertySize, setPropertySize] = useState(PROPERTY_SIZES[1].value)
  const [condition, setCondition] = useState(CONDITIONS[1])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const isImageTool = tab !== 'estimate'

  function switchTab(t: Tool) {
    setTab(t)
    setResult(null); setError(null); setPreview(null); setImgData(null); setHint('')
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null); setResult(null)
    try {
      const data = await fileToBase64(file)
      setImgData(data)
      setPreview(`data:${data.mimeType};base64,${data.base64}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that image.')
    }
  }

  async function run() {
    setLoading(true); setError(null); setResult(null)
    try {
      const payload = isImageTool
        ? { tool: tab, imageBase64: imgData?.base64, mimeType: imgData?.mimeType, hint }
        : { tool: tab, serviceType, propertySize, condition }
      const res = await fetch('/api/field-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Field Assist failed.')
      setResult(json.result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  function addToQuote() {
    if (!result) return
    // Stash the diagnosis so the Quotes tab / a new quote can prefill notes.
    try {
      sessionStorage.setItem('fieldAssistDraft', JSON.stringify({
        source: tab,
        serviceType: tab === 'estimate' ? serviceType : undefined,
        notes: result,
        createdAt: new Date().toISOString(),
      }))
    } catch { /* ignore storage failure */ }
    router.push('/financials?tab=quotes&fromFieldAssist=1')
  }

  const canRun = isImageTool ? !!imgData : true

  return (
    <div>
      {/* Tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => switchTab(t.key)}
            className={`rounded-xl border px-3 py-3 text-left transition-colors ${
              tab === t.key
                ? 'bg-orange/15 border-orange/50'
                : 'bg-white/5 border-white/10 hover:border-white/20'
            }`}
          >
            <div className="text-xl">{t.icon}</div>
            <div className={`font-condensed font-bold text-sm ${tab === t.key ? 'text-orange' : 'text-white'}`}>{t.label}</div>
            <div className="text-[11px] text-white/40 leading-tight mt-0.5">{t.blurb}</div>
          </button>
        ))}
      </div>

      {/* Tool body */}
      <div className="nwi-card">
        {isImageTool ? (
          <>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onFile} className="hidden" />
            {!preview ? (
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full rounded-xl border-2 border-dashed border-orange/40 bg-orange/5 hover:bg-orange/10 py-12 flex flex-col items-center justify-center gap-2 transition-colors"
              >
                <svg className="w-10 h-10 text-orange" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                <span className="font-condensed font-bold text-white text-lg">Take or Upload a Photo</span>
                <span className="text-white/40 text-xs">Tap to use your camera or pick from your library</span>
              </button>
            ) : (
              <div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="Selected" className="w-full max-h-72 object-contain rounded-xl bg-black/20" />
                <button onClick={() => fileRef.current?.click()} className="mt-2 text-orange text-sm font-medium">
                  Choose a different photo
                </button>
              </div>
            )}
            <input
              value={hint}
              onChange={e => setHint(e.target.value)}
              placeholder="Optional: add a note (e.g. 'front yard, full sun')"
              className="nwi-input mt-3"
            />
          </>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="nwi-label">Service Type</label>
              <select value={serviceType} onChange={e => setServiceType(e.target.value)} className="nwi-input">
                {LANDSCAPING_SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="nwi-label">Property Size</label>
              <select value={propertySize} onChange={e => setPropertySize(e.target.value)} className="nwi-input">
                {PROPERTY_SIZES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="nwi-label">Condition</label>
              <div className="grid grid-cols-4 gap-2">
                {CONDITIONS.map(c => (
                  <button
                    key={c}
                    onClick={() => setCondition(c)}
                    className={`rounded-lg border py-2 text-sm font-medium transition-colors ${
                      condition === c ? 'bg-orange/15 border-orange/50 text-orange' : 'bg-white/5 border-white/10 text-white/60'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <button
          onClick={run}
          disabled={loading || !canRun}
          className="btn-primary mt-4"
        >
          {loading ? 'Analyzing…' : isImageTool ? 'Analyze Photo' : 'Get Estimate'}
        </button>

        {error && (
          <div className="alert-error mt-3">
            {error}
          </div>
        )}
      </div>

      {/* Result */}
      {loading && (
        <div className="nwi-card mt-4 flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-orange border-t-transparent rounded-full animate-spin" />
          <span className="text-white/60 text-sm">Field Assist is analyzing… this takes a few seconds.</span>
        </div>
      )}

      {result && !loading && (
        <div className="nwi-card mt-4">
          <div className="prose-none">{renderMarkdown(result)}</div>
          <button onClick={addToQuote} className="btn-secondary mt-5">
            + Add to Quote
          </button>
        </div>
      )}
    </div>
  )
}
