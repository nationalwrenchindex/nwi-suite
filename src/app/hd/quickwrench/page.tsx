'use client'

import { useState, useEffect, useRef } from 'react'

const HD_ORANGE = '#E85D24'
const HD_BLUE   = '#1A6BAF'

const TK_TRUCK_MODELS   = ['MD-200', 'MD-300', 'T-880', 'T-880S', 'T-1000', 'T-1080S']
const TK_TRAILER_MODELS = ['SB-100', 'SB-200', 'SB-300', 'Precedent C-600', 'Precedent S-600', 'Precedent C-600M']
const CT_TRUCK_MODELS   = ['Supra 960', 'Supra 1250']
const CT_TRAILER_MODELS = ['X2 2100', 'X2 2500', 'X4 7300', 'X4 7500']

type Manufacturer = 'Thermo King' | 'Carrier Transicold'
type UnitType     = 'truck' | 'trailer'
type TKSeverity   = 'ok_to_run' | 'check_specified' | 'immediate_action'

interface TKSource {
  code:           string
  description:    string
  severity:       TKSeverity
  operatorAction: string
  source:         'tk_main' | 'tk_dsr'
}

interface AlarmPattern {
  codes:         string[]
  pattern:       string
  diagnoseFirst: string
  severity:      'critical' | 'warning'
}

interface QWResult {
  alarm_meaning:          string
  severity:               'low' | 'medium' | 'high' | 'critical'
  most_likely_causes:     string[]
  diagnostic_steps:       string[]
  common_fix:             string
  parts_typically_needed: string[]
  safety_warnings:        string[]
  epa_warning:            string | null
  pm_interval_note:       string | null
  sources?:               string[]
}

const AI_SEVERITY_COLORS = {
  low:      '#22C55E',
  medium:   '#F59E0B',
  high:     '#F97316',
  critical: '#EF4444',
}

const TK_SEVERITY_CONFIG: Record<TKSeverity, { label: string; color: string; bg: string; border: string }> = {
  ok_to_run:        { label: 'OK TO RUN',            color: '#22C55E', bg: '#22C55E15', border: '#22C55E40' },
  check_specified:  { label: 'CHECK AS SPECIFIED',   color: '#F59E0B', bg: '#F59E0B15', border: '#F59E0B40' },
  immediate_action: { label: 'TAKE IMMEDIATE ACTION', color: '#EF4444', bg: '#EF444415', border: '#EF444440' },
}

// Safety helpers — if the AI ever returns an object where a string is expected,
// convert it rather than passing it to React directly (which crashes).
function safeStr(val: unknown): string {
  if (val === null || val === undefined) return ''
  if (typeof val === 'string') return val
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

function safeArr(val: unknown): string[] {
  if (!Array.isArray(val)) return []
  return val.map(item =>
    typeof item === 'string' ? item
    : typeof item === 'object' && item !== null ? JSON.stringify(item)
    : String(item ?? '')
  )
}

function TKSeverityBadge({ severity }: { severity: TKSeverity }) {
  const cfg = TK_SEVERITY_CONFIG[severity] ?? TK_SEVERITY_CONFIG.check_specified
  return (
    <span
      className="text-xs font-bold px-2.5 py-0.5 rounded-full tracking-wide whitespace-nowrap"
      style={{ background: cfg.color, color: '#fff' }}
    >
      {cfg.label}
    </span>
  )
}

function PrimaryTKBanner({ src }: { src: TKSource }) {
  const cfg = TK_SEVERITY_CONFIG[src.severity] ?? TK_SEVERITY_CONFIG.check_specified
  return (
    <div
      className="px-5 py-4 flex items-start gap-4"
      style={{ background: cfg.bg, borderBottom: `1px solid ${cfg.border}` }}
    >
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1.5">
          <TKSeverityBadge severity={src.severity} />
          <span className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.4)' }}>
            {src.source === 'tk_dsr' ? 'DSR Code' : 'TK Code'} · TK 40933-8-CH Rev 15
          </span>
        </div>
        <p className="text-white font-semibold text-sm leading-snug">{src.description}</p>
      </div>
    </div>
  )
}

function TKCodeRow({ src }: { src: TKSource }) {
  const cfg = TK_SEVERITY_CONFIG[src.severity] ?? TK_SEVERITY_CONFIG.check_specified
  return (
    <div
      className="rounded-lg p-3"
      style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="font-condensed font-bold text-white text-sm">Code {src.code}</span>
        <TKSeverityBadge severity={src.severity} />
        <span className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
          {src.source === 'tk_dsr' ? 'DSR' : 'TK'} · TK 40933-8-CH Rev 15
        </span>
      </div>
      <p className="text-sm text-white font-medium leading-snug">{src.description}</p>
      <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.55)' }}>
        Operator action: {src.operatorAction}
      </p>
    </div>
  )
}

export default function HDQuickWrenchPage() {
  const [manufacturer,         setManufacturer]        = useState<Manufacturer>('Thermo King')
  const [unitType,             setUnitType]            = useState<UnitType>('trailer')
  const [model,                setModel]               = useState('')
  const [serialNumber,         setSerialNumber]        = useState('')
  const [alarmCode,            setAlarmCode]           = useState('')
  const [additionalAlarmInput, setAdditionalAlarmInput]= useState('')
  const [symptom,              setSymptom]             = useState('')
  const [loading,              setLoading]             = useState(false)
  const [loadingMessage,       setLoadingMessage]      = useState('Looking up alarm codes...')
  const loadingStartRef = useRef<number>(0)
  const [result,               setResult]              = useState<QWResult | null>(null)
  const [tkSources,            setTkSources]           = useState<TKSource[]>([])
  const [alarmPattern,         setAlarmPattern]        = useState<AlarmPattern | null>(null)
  const [disclaimer,           setDisclaimer]          = useState<string | null>(null)
  const [error,                setError]               = useState<string | null>(null)

  const modelOptions =
    manufacturer === 'Thermo King'
      ? unitType === 'truck' ? TK_TRUCK_MODELS : TK_TRAILER_MODELS
      : unitType === 'truck' ? CT_TRUCK_MODELS : CT_TRAILER_MODELS

  useEffect(() => {
    if (!loading) return
    setLoadingMessage('Looking up alarm codes...')
    const interval = setInterval(() => {
      const elapsed = (Date.now() - loadingStartRef.current) / 1000
      if      (elapsed < 5)  setLoadingMessage('Looking up alarm codes...')
      else if (elapsed < 10) setLoadingMessage('Searching technical databases...')
      else if (elapsed < 20) setLoadingMessage('Generating diagnostic analysis...')
      else                   setLoadingMessage('Almost ready — complex multi-alarm analysis takes a moment...')
    }, 1000)
    return () => clearInterval(interval)
  }, [loading])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!model || (!alarmCode && !symptom)) return
    loadingStartRef.current = Date.now()
    setLoading(true)
    setResult(null)
    setTkSources([])
    setAlarmPattern(null)
    setDisclaimer(null)
    setError(null)

    // Parse comma-separated additional codes
    const additionalAlarmCodes = additionalAlarmInput
      .split(',')
      .map(c => c.trim())
      .filter(Boolean)

    try {
      const res = await fetch('/api/hd/quickwrench', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          manufacturer, model, unitType,
          alarmCode, additionalAlarmCodes,
          symptom, serialNumber,
        }),
      })

      // Always parse as text first — if the server returns an HTML error page
      // (Vercel 502, timeout, etc.) res.json() would throw "Unexpected token A"
      const text = await res.text()
      let json: Record<string, unknown> = {}
      try {
        json = JSON.parse(text) as Record<string, unknown>
      } catch {
        throw new Error(
          `Server returned an unexpected response (status ${res.status}). Please try again.`
        )
      }

      if (!res.ok) {
        throw new Error(
          typeof json.error === 'string' ? json.error : `Request failed (${res.status})`
        )
      }

      // Defensively extract each field — guard against undefined/wrong shape
      const rawResult = json.result
      setResult(rawResult != null && typeof rawResult === 'object'
        ? rawResult as QWResult
        : null
      )
      setTkSources(Array.isArray(json.tk_sources) ? json.tk_sources as TKSource[] : [])
      setAlarmPattern(
        json.alarm_pattern != null && typeof json.alarm_pattern === 'object'
          ? json.alarm_pattern as AlarmPattern
          : null
      )
      setDisclaimer(typeof json.disclaimer === 'string' ? json.disclaimer : null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Primary TK source (first code entered)
  const primaryTkSource = tkSources[0] ?? null

  return (
    <main className="flex-1 p-6">
      <div className="max-w-3xl mx-auto space-y-6">

        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
            HD Diagnostic Assistant
          </p>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">HD QUICKWRENCH</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Alarm codes, specs, and repair procedures from a 17-year field veteran.
          </p>
        </div>

        {/* Query form */}
        <form onSubmit={handleSubmit} className="rounded-xl p-6 space-y-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>

          {/* Manufacturer + Unit Type */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                Manufacturer
              </label>
              <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid #1e3040' }}>
                {(['Thermo King', 'Carrier Transicold'] as Manufacturer[]).map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { setManufacturer(m); setModel('') }}
                    className="flex-1 py-2 text-xs font-semibold transition-colors"
                    style={{
                      background: manufacturer === m ? HD_ORANGE : '#162030',
                      color:      manufacturer === m ? '#fff' : 'rgba(255,255,255,0.4)',
                    }}
                  >
                    {m === 'Thermo King' ? 'Thermo King' : 'Carrier'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                Unit Type
              </label>
              <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid #1e3040' }}>
                {(['truck', 'trailer'] as UnitType[]).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => { setUnitType(t); setModel('') }}
                    className="flex-1 py-2 text-xs font-semibold transition-colors capitalize"
                    style={{
                      background: unitType === t ? HD_BLUE : '#162030',
                      color:      unitType === t ? '#fff' : 'rgba(255,255,255,0.4)',
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Model */}
          <div>
            <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Model
            </label>
            <select
              value={model}
              onChange={e => setModel(e.target.value)}
              required
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
              style={{ background: '#162030', border: '1px solid #1e3040' }}
            >
              <option value="">— Select model —</option>
              {modelOptions.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          {/* Serial Number (optional) */}
          <div>
            <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Serial Number <span style={{ color: 'rgba(255,255,255,0.25)' }}>(optional)</span>
            </label>
            <input
              type="text"
              value={serialNumber}
              onChange={e => setSerialNumber(e.target.value)}
              placeholder="Unit serial number"
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20"
              style={{ background: '#162030', border: '1px solid #1e3040' }}
            />
          </div>

          {/* Alarm Code */}
          <div>
            <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Alarm Code
            </label>
            <input
              type="text"
              value={alarmCode}
              onChange={e => setAlarmCode(e.target.value)}
              placeholder="e.g. 10 or HP or P1E"
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20"
              style={{ background: '#162030', border: '1px solid #1e3040' }}
            />
          </div>

          {/* Additional Alarm Codes */}
          <div>
            <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Additional Alarm Codes <span style={{ color: 'rgba(255,255,255,0.25)' }}>(optional)</span>
            </label>
            <input
              type="text"
              value={additionalAlarmInput}
              onChange={e => setAdditionalAlarmInput(e.target.value)}
              placeholder="e.g. 42, 48"
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20"
              style={{ background: '#162030', border: '1px solid #1e3040' }}
            />
            <p className="text-xs mt-1.5" style={{ color: 'rgba(255,255,255,0.3)' }}>
              Enter multiple codes separated by commas — example: 10, 42, 48
            </p>
          </div>

          {/* Symptom */}
          <div>
            <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Symptom / Question
            </label>
            <textarea
              value={symptom}
              onChange={e => setSymptom(e.target.value)}
              rows={3}
              placeholder="Describe what the unit is doing, or ask a technical question…"
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20 resize-none"
              style={{ background: '#162030', border: '1px solid #1e3040' }}
            />
          </div>

          <button
            type="submit"
            disabled={loading || !model || (!alarmCode && !symptom)}
            className="w-full py-3 rounded-xl font-bold text-white text-sm transition-opacity"
            style={{
              background: HD_ORANGE,
              opacity:    loading || !model || (!alarmCode && !symptom) ? 0.5 : 1,
            }}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {loadingMessage}
              </span>
            ) : 'Run HD QuickWrench'}
          </button>
        </form>

        {/* Error */}
        {error && (
          <div className="rounded-xl p-4" style={{ background: '#2d0a0a', border: '1px solid #7f1d1d' }}>
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Result — only render when result is a non-null object */}
        {result !== null && typeof result === 'object' && (
          <div className="space-y-4">

            {/* ── MULTI-ALARM PATTERN BANNER ── */}
            {alarmPattern && (
              <div
                className="rounded-xl overflow-hidden"
                style={{
                  border: alarmPattern.severity === 'critical' ? '2px solid #EF4444' : `2px solid ${HD_ORANGE}`,
                }}
              >
                {/* Banner header */}
                <div
                  className="px-5 py-3 flex items-center gap-3"
                  style={{
                    background: alarmPattern.severity === 'critical' ? '#EF4444' : HD_ORANGE,
                  }}
                >
                  <svg className="w-5 h-5 text-white flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                  <p className="font-condensed font-bold text-white text-base tracking-widest uppercase">
                    Multi-Alarm Pattern Detected
                  </p>
                  <span
                    className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full"
                    style={{ background: 'rgba(0,0,0,0.25)', color: '#fff' }}
                  >
                    {alarmPattern.severity === 'critical' ? 'CRITICAL' : 'WARNING'}
                  </span>
                </div>

                <div
                  className="p-5 space-y-4"
                  style={{
                    background: alarmPattern.severity === 'critical' ? '#1a0505' : '#1a0a00',
                  }}
                >
                  {/* DO NOT diagnose independently */}
                  <div
                    className="rounded-lg px-4 py-3 flex items-start gap-2"
                    style={{
                      background: alarmPattern.severity === 'critical' ? '#EF444420' : `${HD_ORANGE}20`,
                      border:     alarmPattern.severity === 'critical' ? '1px solid #EF444450' : `1px solid ${HD_ORANGE}50`,
                    }}
                  >
                    <span className="font-bold text-sm" style={{ color: alarmPattern.severity === 'critical' ? '#EF4444' : HD_ORANGE }}>
                      DO NOT diagnose these alarms independently — they are related.
                    </span>
                  </div>

                  {/* Pattern description */}
                  <div>
                    <p className="text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Pattern</p>
                    <p className="text-sm text-white leading-relaxed">{alarmPattern.pattern}</p>
                  </div>

                  {/* Diagnose first */}
                  <div className="rounded-lg p-4" style={{ background: '#162030' }}>
                    <p className="text-xs uppercase tracking-widest mb-1.5" style={{ color: alarmPattern.severity === 'critical' ? '#EF4444' : HD_ORANGE }}>
                      Diagnose First
                    </p>
                    <p className="text-sm font-bold text-white leading-relaxed">{alarmPattern.diagnoseFirst}</p>
                  </div>

                  {/* Individual code badges for all codes in pattern */}
                  {tkSources.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>Official TK Definitions</p>
                      {tkSources.map(src => <TKCodeRow key={src.code} src={src} />)}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── SINGLE-ALARM TK OFFICIAL RESULT ── */}
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>

              {/* TK Official Severity Banner (single code or primary code when no pattern) */}
              {primaryTkSource && !alarmPattern && (
                <PrimaryTKBanner src={primaryTkSource} />
              )}

              {/* Operator Action (single code, no pattern) */}
              {primaryTkSource && !alarmPattern && (
                <div
                  className="px-5 py-3 flex items-start gap-2"
                  style={{ background: '#162030', borderBottom: '1px solid #1e3040' }}
                >
                  <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke={HD_ORANGE} strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <p className="text-xs uppercase tracking-widest mb-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Operator Action (TK Official)</p>
                    <p className="text-sm font-medium text-white">{primaryTkSource.operatorAction}</p>
                  </div>
                </div>
              )}

              {/* AI Severity header (shown when no TK source at all) */}
              {!primaryTkSource && (
                <div
                  className="px-5 py-4 flex items-center gap-3"
                  style={{ background: '#162030', borderBottom: '1px solid #1e3040' }}
                >
                  <div
                    className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide"
                    style={{
                      background: `${AI_SEVERITY_COLORS[result.severity] ?? '#6B7280'}25`,
                      color:       AI_SEVERITY_COLORS[result.severity] ?? '#6B7280',
                    }}
                  >
                    {result.severity}
                  </div>
                  <p className="text-white font-semibold text-sm">{safeStr(result.alarm_meaning)}</p>
                </div>
              )}

              <div className="p-5 space-y-5" style={{ background: '#111920' }}>

                {/* Tech analysis label when TK source present */}
                {(primaryTkSource || alarmPattern) && (
                  <div>
                    <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      {alarmPattern ? 'Combined Tech Analysis' : 'Tech Analysis'}
                    </p>
                    <p className="text-sm text-white">{safeStr(result.alarm_meaning)}</p>
                  </div>
                )}

                {/* EPA Warning */}
                {result.epa_warning && (
                  <div className="rounded-lg p-3" style={{ background: '#2d0a0a', border: '1px solid #7f1d1d' }}>
                    <p className="text-xs font-bold text-red-400">⚠ {safeStr(result.epa_warning)}</p>
                  </div>
                )}

                {/* Most likely causes */}
                <div>
                  <p className="text-xs uppercase tracking-widest mb-2" style={{ color: HD_ORANGE }}>Most Likely Causes</p>
                  <ol className="space-y-1">
                    {safeArr(result.most_likely_causes).map((c, i) => (
                      <li key={i} className="flex gap-2 text-sm" style={{ color: 'rgba(255,255,255,0.8)' }}>
                        <span className="font-bold flex-shrink-0" style={{ color: HD_ORANGE }}>{i + 1}.</span>
                        {c}
                      </li>
                    ))}
                  </ol>
                </div>

                {/* Diagnostic steps */}
                <div>
                  <p className="text-xs uppercase tracking-widest mb-2" style={{ color: HD_BLUE }}>Diagnostic Steps</p>
                  <ol className="space-y-1.5">
                    {safeArr(result.diagnostic_steps).map((s, i) => (
                      <li key={i} className="flex gap-2 text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
                        <span
                          className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5"
                          style={{ background: '#1e3040', color: HD_BLUE }}
                        >
                          {i + 1}
                        </span>
                        {s}
                      </li>
                    ))}
                  </ol>
                </div>

                {/* Common fix */}
                <div className="rounded-lg p-4" style={{ background: '#162030' }}>
                  <p className="text-xs uppercase tracking-widest mb-1" style={{ color: '#22C55E' }}>Common Fix</p>
                  <p className="text-sm text-white">{safeStr(result.common_fix)}</p>
                </div>

                {/* Parts */}
                {safeArr(result.parts_typically_needed).length > 0 && (
                  <div>
                    <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'rgba(255,255,255,0.4)' }}>Parts Typically Needed</p>
                    <div className="flex flex-wrap gap-2">
                      {safeArr(result.parts_typically_needed).map((p, i) => (
                        <span
                          key={i}
                          className="text-xs px-2.5 py-1 rounded-full"
                          style={{ background: '#1e3040', color: 'rgba(255,255,255,0.7)' }}
                        >
                          {p}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Safety warnings */}
                {safeArr(result.safety_warnings).length > 0 && (
                  <div>
                    <p className="text-xs uppercase tracking-widest mb-2" style={{ color: '#F59E0B' }}>Safety & Compliance</p>
                    {safeArr(result.safety_warnings).map((w, i) => (
                      <p key={i} className="text-xs mb-1" style={{ color: 'rgba(255,255,255,0.65)' }}>⚠ {w}</p>
                    ))}
                  </div>
                )}

                {/* PM note */}
                {result.pm_interval_note && (
                  <div className="rounded-lg p-3" style={{ background: '#162030', border: '1px solid #1e3040' }}>
                    <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>PM Note</p>
                    <p className="text-xs" style={{ color: 'rgba(255,255,255,0.65)' }}>{safeStr(result.pm_interval_note)}</p>
                  </div>
                )}

                {/* Web search sources */}
                {safeArr(result.sources).length > 0 && (
                  <div>
                    <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'rgba(255,255,255,0.4)' }}>Sources</p>
                    {safeArr(result.sources).map((s, i) => (
                      <p key={i} className="text-xs mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>— {s}</p>
                    ))}
                  </div>
                )}

                {/* Disclaimer */}
                {disclaimer && (
                  <div
                    className="rounded-lg p-3"
                    style={{ background: '#0d1820', border: '1px solid #1e3040' }}
                  >
                    <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.3)' }}>
                      {disclaimer}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
