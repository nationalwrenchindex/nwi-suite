'use client'

import { useState, useEffect, useRef } from 'react'

const HD_ORANGE = '#E85D24'
const HD_BLUE   = '#1A6BAF'

interface ModelGroup { group: string; models: string[] }

const TK_TRUCK_GROUPS: ModelGroup[] = [
  { group: 'MD Series',      models: ['MD-100', 'MD-200', 'MD-300'] },
  { group: 'T Series',       models: ['T-590', 'T-690', 'T-690 MAX', 'T-880', 'T-880S', 'T-890', 'T-890 MAX', 'T-1000', 'T-1080S', 'T-1090', 'T-1090 MAX', 'T-1090 Spectrum'] },
  { group: 'T-R Series',     models: ['T-560R', 'T-580R', 'T-600R', 'T-680R', 'T-800R', 'T-880R', 'T-1000R', 'T-1200R'] },
  { group: 'V Series',       models: ['V-220', 'V-320', 'V-520 Nosemount', 'V-520 Rooftop', 'V-800'] },
  { group: 'II Series',      models: ['KDII', 'MDII', 'RDII', 'TDII'] },
  { group: 'B Series',       models: ['B-100'] },
  { group: 'Electric',       models: ['e200', 'E1000'] },
]

const TK_TRAILER_GROUPS: ModelGroup[] = [
  { group: 'SB Series',        models: ['SB-100', 'SB-110', 'SB-130', 'SB-190', 'SB-200', 'SB-210', 'SB-230', 'SB-300', 'SB-310', 'SB-330', 'SB-400'] },
  { group: 'Precedent Series', models: ['Precedent C-600', 'Precedent C-600M', 'Precedent S-600', 'Precedent S-610', 'Precedent S-610M', 'Precedent S-610DE', 'Precedent S-700', 'Precedent S-710', 'Precedent S-750i'] },
  { group: 'SLX / SLXi',      models: ['SLX-100', 'SLX-200', 'SLX-300', 'SLX-400', 'SLXi Local'] },
  { group: 'Classic Series',   models: ['Super II', 'Sentry', 'Sentry II', 'SMX', 'SMX II', 'SMX SR', 'URD', 'URD-III Max'] },
  { group: 'Advancer Series',  models: ['Advancer A-500e'] },
  { group: 'APU',              models: ['TriPac APU'] },
]

const CT_TRUCK_GROUPS: ModelGroup[] = [
  { group: 'Supra Series',   models: ['Supra 322', 'Supra 422', 'Supra 444', 'Supra 522', 'Supra 544', 'Supra 550', 'Supra 560', 'Supra 622', 'Supra 644', 'Supra 650', 'Supra 660', 'Supra 722', 'Supra 744', 'Supra 750', 'Supra 760', 'Supra 822', 'Supra 844', 'Supra 850', 'Supra 860', 'Supra 922', 'Supra 944', 'Supra 950', 'Supra 950MT', 'Supra 960'] },
  { group: 'Supra S Series', models: ['Supra S5', 'Supra S6', 'Supra S7', 'Supra S8', 'Supra S9', 'Supra S10'] },
  { group: 'Neos Series',    models: ['Neos 100S', '20X', '30S', '35X', '40X', '40XR', '50X', '50XR'] },
  { group: 'Supra eCool',    models: ['Supra eCool e9', 'Supra eCool e11'] },
  { group: 'Metrobird',      models: ['Metrobird'] },
]

const CT_TRAILER_GROUPS: ModelGroup[] = [
  { group: 'Eagle / Classic', models: ['Eagle', 'Eagle Plus', 'Extra', 'Extra XT', 'Extra XTC', 'Thunderbird', 'Advantage'] },
  { group: 'Phoenix Series',  models: ['Euro Phoenix', 'Phoenix Ultra', 'Phoenix Ultra XL', 'Phoenix Advantage'] },
  { group: 'Genesis Series',  models: ['Genesis R70', 'Genesis R90', 'Genesis TM900', 'Genesis TM1000', 'Genesis TR100'] },
  { group: 'Mistral Series',  models: ['Mistral 410', 'Mistral 500', 'Mistral 700'] },
  { group: 'Optima / Ultra',  models: ['Optima', 'Ultra', 'Ultra XTC', 'Ultra XL'] },
  { group: 'Ultima Series',   models: ['Ultima 53', 'Ultima XT', 'Ultima XTC'] },
  { group: 'Maxima Series',   models: ['Maxima 1000', 'Maxima 1200', 'Maxima 1200MT', 'Maxima 1300', 'Maxima 1300MT'] },
  { group: 'Vector Series',   models: ['Vector 1350', 'Vector 1550', 'Vector 1800', 'Vector 1800MT', 'Vector 1850', 'Vector 1950', 'Vector 1950MT', 'Vector 6500', 'Vector 6600'] },
  { group: 'X2 / X4 Series',  models: ['X2 2100', 'X2 2500', 'X4 7300', 'X4 7300R', 'X4 7500', 'X4 7500R', 'X4 7700'] },
  { group: 'ComfortPro APU',  models: ['ComfortPro PC5000', 'ComfortPro PC6000'] },
]

const ENGINE_MODELS: Record<string, string[]> = {
  'Cummins':        ['ISB', 'ISC', 'ISL', 'ISX', 'X15', 'X12'],
  'Detroit Diesel': ['DD13', 'DD15', 'DD16', 'Series 60'],
  'Mercedes-Benz':  ['OM936', 'OM470', 'OM471', 'OM473'],
}

const FMI_CODES = [
  { fmi:  0, desc: 'Data valid but above normal operational range' },
  { fmi:  1, desc: 'Data valid but below normal operational range' },
  { fmi:  2, desc: 'Data erratic, intermittent, or incorrect' },
  { fmi:  3, desc: 'Voltage above normal or shorted to high source' },
  { fmi:  4, desc: 'Voltage below normal or shorted to low source' },
  { fmi:  5, desc: 'Current below normal or open circuit' },
  { fmi:  6, desc: 'Current above normal or grounded circuit' },
  { fmi:  7, desc: 'Mechanical system not responding or out of adjustment' },
  { fmi:  8, desc: 'Abnormal frequency, pulse width, or period' },
  { fmi:  9, desc: 'Abnormal update rate' },
  { fmi: 10, desc: 'Abnormal rate of change' },
  { fmi: 11, desc: 'Root cause not known' },
  { fmi: 12, desc: 'Bad intelligent device or component' },
  { fmi: 13, desc: 'Out of calibration' },
  { fmi: 14, desc: 'Special instructions' },
  { fmi: 15, desc: 'Reserved for future assignment' },
]

type Manufacturer  = 'Thermo King' | 'Carrier Transicold'
type UnitType      = 'truck' | 'trailer'
type EngineBrand   = 'Cummins' | 'Detroit Diesel' | 'Mercedes-Benz'
type ActiveTab     = 'reefer' | 'truck'
type TKSeverity    = 'ok_to_run' | 'check_specified' | 'immediate_action'

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

const TK_SEVERITY_CONFIG: Record<TKSeverity, { label: string; color: string; bg: string; border: string }> = {
  ok_to_run:        { label: 'OK TO RUN',             color: '#22C55E', bg: '#22C55E15', border: '#22C55E40' },
  check_specified:  { label: 'CHECK AS SPECIFIED',    color: '#F59E0B', bg: '#F59E0B15', border: '#F59E0B40' },
  immediate_action: { label: 'TAKE IMMEDIATE ACTION', color: '#EF4444', bg: '#EF444415', border: '#EF444440' },
}

// ─── Refrigerant Pressure Calculator ─────────────────────────────────────────

type RefrigerantType = 'R-404A' | 'R-452A'

// [temp°F, low PSI, high PSI]
const SUCTION_REFS: Record<RefrigerantType, [number, number, number][]> = {
  'R-404A': [[-20,2,8],[-10,5,12],[0,8,16],[10,14,22],[20,20,30],[35,32,44],[65,58,72]],
  'R-452A': [[-20,2,7],[-10,4,11],[0,7,14],[10,12,20],[20,18,27],[35,29,40],[65,52,65]],
}
const DISCHARGE_REFS: Record<RefrigerantType, [number, number, number][]> = {
  'R-404A': [[70,185,215],[80,210,240],[90,240,275],[95,260,295],[100,280,320],[105,300,340]],
  'R-452A': [[70,167,194],[80,189,216],[90,216,248],[95,234,266],[100,252,288],[105,270,306]],
}

function interpolatePressure(x: number, refs: [number, number, number][]): [number, number] {
  if (x <= refs[0][0]) return [refs[0][1], refs[0][2]]
  if (x >= refs[refs.length - 1][0]) return [refs[refs.length - 1][1], refs[refs.length - 1][2]]
  for (let i = 0; i < refs.length - 1; i++) {
    if (x >= refs[i][0] && x <= refs[i + 1][0]) {
      const t = (x - refs[i][0]) / (refs[i + 1][0] - refs[i][0])
      return [
        Math.round(refs[i][1] + t * (refs[i + 1][1] - refs[i][1])),
        Math.round(refs[i][2] + t * (refs[i + 1][2] - refs[i][2])),
      ]
    }
  }
  return [refs[refs.length - 1][1], refs[refs.length - 1][2]]
}

// ─── Plain-text section parser ────────────────────────────────────────────────

const SECTION_DEFS = [
  { key: 'ALARM MEANING',      label: 'Alarm Meaning',       color: 'rgba(255,255,255,0.9)', bg: null,      accent: null      },
  { key: 'MOST LIKELY CAUSES', label: 'Most Likely Causes',  color: HD_ORANGE,               bg: null,      accent: HD_ORANGE },
  { key: 'DIAGNOSTIC STEPS',   label: 'Diagnostic Steps',    color: HD_BLUE,                 bg: null,      accent: HD_BLUE   },
  { key: 'COMMON FIX',         label: 'Common Fix',          color: '#22C55E',               bg: '#162030', accent: null      },
  { key: 'PARTS NEEDED',       label: 'Parts Needed',        color: 'rgba(255,255,255,0.4)', bg: null,      accent: null      },
  { key: 'SAFETY WARNINGS',    label: 'Safety & Compliance', color: '#F59E0B',               bg: null,      accent: null      },
  { key: 'PM NOTE',            label: 'PM Note',             color: 'rgba(255,255,255,0.4)', bg: null,      accent: null      },
] as const

type SectionKey = typeof SECTION_DEFS[number]['key']

function parseAnalysis(text: string): Array<{ key: SectionKey; content: string }> {
  const keys = SECTION_DEFS.map(s => s.key)
  const escapedKeys = keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const headerRe = new RegExp(`(${escapedKeys.join('|')}):`, 'g')

  const positions: Array<{ key: SectionKey; contentStart: number; headerStart: number }> = []
  let m
  while ((m = headerRe.exec(text)) !== null) {
    positions.push({ key: m[1] as SectionKey, headerStart: m.index, contentStart: m.index + m[0].length })
  }

  return positions
    .map((pos, i) => ({
      key: pos.key,
      content: text.slice(pos.contentStart, positions[i + 1]?.headerStart ?? text.length).trim(),
    }))
    .filter(s => s.content && s.content.toLowerCase() !== 'none.' && s.content.toLowerCase() !== 'none')
}

function SectionContent({ sectionKey, content }: { sectionKey: SectionKey; content: string }) {
  const def = SECTION_DEFS.find(s => s.key === sectionKey)!

  if (sectionKey === 'MOST LIKELY CAUSES' || sectionKey === 'DIAGNOSTIC STEPS') {
    const lines = content.split('\n').map(l => l.replace(/^\d+\.\s*/, '').trim()).filter(Boolean)
    return (
      <ol className="space-y-1.5">
        {lines.map((line, i) => (
          <li key={i} className="flex gap-2 text-sm" style={{ color: 'rgba(255,255,255,0.82)' }}>
            {sectionKey === 'DIAGNOSTIC STEPS' ? (
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5"
                style={{ background: '#1e3040', color: HD_BLUE }}
              >
                {i + 1}
              </span>
            ) : (
              <span className="font-bold flex-shrink-0" style={{ color: HD_ORANGE }}>{i + 1}.</span>
            )}
            {line}
          </li>
        ))}
      </ol>
    )
  }

  if (sectionKey === 'PARTS NEEDED') {
    const items = content.split('\n').map(l => l.replace(/^[-•]\s*/, '').trim()).filter(Boolean)
    return (
      <div className="flex flex-wrap gap-2">
        {items.map((p, i) => (
          <span key={i} className="text-xs px-2.5 py-1 rounded-full" style={{ background: '#1e3040', color: 'rgba(255,255,255,0.7)' }}>
            {p}
          </span>
        ))}
      </div>
    )
  }

  if (sectionKey === 'SAFETY WARNINGS') {
    const lines = content.split('\n').map(l => l.replace(/^[-•]\s*/, '').trim()).filter(Boolean)
    return (
      <div className="space-y-1">
        {lines.map((w, i) => (
          <p key={i} className="text-xs" style={{ color: 'rgba(255,255,255,0.65)' }}>⚠ {w}</p>
        ))}
      </div>
    )
  }

  const paragraphs = content.split('\n').filter(l => l.trim())
  return (
    <div className="space-y-1">
      {paragraphs.map((p, i) => (
        <p key={i} className="text-sm leading-relaxed" style={{ color: def.color }}>
          {p}
        </p>
      ))}
    </div>
  )
}

// ─── TK UI components ─────────────────────────────────────────────────────────

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

// ─── Manifold Gauge SVG ───────────────────────────────────────────────────────

const G = {
  CX: 100, CY: 100, R: 96,
  BAND_OUT: 92, BAND_IN: 74,
  TICK_MAJ_OUT: 90, TICK_MAJ_IN: 79,
  TICK_MIN_OUT: 90, TICK_MIN_IN: 85,
  LABEL_R: 67,
  NEEDLE: 83, TAIL: 15, HUB: 8,
  START: 135, SWEEP: 270,
} as const

function gAngle(v: number, lo: number, hi: number): number {
  return G.START + Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * G.SWEEP
}

function gXY(r: number, deg: number): { x: number; y: number } {
  const a = deg * Math.PI / 180
  return { x: G.CX + r * Math.cos(a), y: G.CY + r * Math.sin(a) }
}

function gArc(rOut: number, rIn: number, a1: number, a2: number): string {
  const span = ((a2 - a1) % 360 + 360) % 360
  if (span < 0.5) return ''
  const lg = span > 180 ? 1 : 0
  const p1 = gXY(rOut, a1), p2 = gXY(rOut, a2)
  const p3 = gXY(rIn,  a2), p4 = gXY(rIn,  a1)
  const f = (n: number) => n.toFixed(1)
  return `M${f(p1.x)},${f(p1.y)} A${rOut},${rOut} 0 ${lg},1 ${f(p2.x)},${f(p2.y)} L${f(p3.x)},${f(p3.y)} A${rIn},${rIn} 0 ${lg},0 ${f(p4.x)},${f(p4.y)}Z`
}

function ManifoldGauge({
  accentColor, minPsi, maxPsi, majorTicks, minorTicks,
  normalLow, normalHigh, actualPsi,
}: {
  accentColor: string
  minPsi: number; maxPsi: number
  majorTicks: number[]; minorTicks: number[]
  normalLow: number | null; normalHigh: number | null
  actualPsi: number | null
}) {
  const gaugeEnd = G.START + G.SWEEP
  const hasRange = normalLow !== null && normalHigh !== null
  const nLo = hasRange ? gAngle(normalLow!, minPsi, maxPsi) : G.START
  const nHi = hasRange ? gAngle(normalHigh!, minPsi, maxPsi) : G.START

  const hasReading = actualPsi !== null
  const inRange = hasRange && hasReading
    ? actualPsi! >= normalLow! && actualPsi! <= normalHigh!
    : null
  const needleAngle = hasReading ? gAngle(actualPsi!, minPsi, maxPsi) : G.START
  const needleColor = inRange === true ? '#22C55E' : inRange === false ? '#EF4444' : 'rgba(255,255,255,0.85)'

  return (
    <svg viewBox="0 0 200 200" style={{ display: 'block', width: '100%' }}>
      <circle cx={G.CX} cy={G.CY} r={G.R} fill="#0d1820" />
      <circle cx={G.CX} cy={G.CY} r={G.R} fill="none" stroke={accentColor} strokeWidth="2.5" opacity="0.45" />

      {hasRange ? (
        <>
          {nLo > G.START + 0.5 && <path d={gArc(G.BAND_OUT, G.BAND_IN, G.START, nLo)} fill="#EF444428" />}
          <path d={gArc(G.BAND_OUT, G.BAND_IN, nLo, nHi)} fill="#22C55E45" />
          {nHi < gaugeEnd - 0.5 && <path d={gArc(G.BAND_OUT, G.BAND_IN, nHi, gaugeEnd)} fill="#EF444428" />}
        </>
      ) : (
        <path d={gArc(G.BAND_OUT, G.BAND_IN, G.START, gaugeEnd)} fill="#162030" />
      )}

      {minorTicks.map(v => {
        const a = gAngle(v, minPsi, maxPsi)
        const p1 = gXY(G.TICK_MIN_OUT, a), p2 = gXY(G.TICK_MIN_IN, a)
        return <line key={v} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
      })}

      {majorTicks.map(v => {
        const a = gAngle(v, minPsi, maxPsi)
        const p1 = gXY(G.TICK_MAJ_OUT, a), p2 = gXY(G.TICK_MAJ_IN, a)
        const lp = gXY(G.LABEL_R, a)
        return (
          <g key={v}>
            <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
              stroke="rgba(255,255,255,0.65)" strokeWidth="2" strokeLinecap="round" />
            <text x={lp.x} y={lp.y}
              fill="rgba(255,255,255,0.6)" fontSize="9" fontFamily="monospace"
              textAnchor="middle" dominantBaseline="middle">
              {v}
            </text>
          </g>
        )
      })}

      <text x={G.CX} y={G.CY + 25}
        fill={hasReading ? needleColor : 'rgba(255,255,255,0.3)'}
        fontSize="16" fontWeight="bold" fontFamily="monospace"
        textAnchor="middle" dominantBaseline="middle">
        {hasReading ? Math.round(actualPsi!) : '---'}
      </text>
      <text x={G.CX} y={G.CY + 38}
        fill="rgba(255,255,255,0.25)" fontSize="7" fontFamily="monospace"
        textAnchor="middle" letterSpacing="1">
        PSI
      </text>

      <g style={{
        transform: `rotate(${needleAngle}deg)`,
        transformOrigin: `${G.CX}px ${G.CY}px`,
        transition: hasReading ? 'transform 0.45s cubic-bezier(0.34,1.56,0.64,1)' : 'none',
      }}>
        <line x1={G.CX - G.TAIL} y1={G.CY} x2={G.CX} y2={G.CY}
          stroke="rgba(255,255,255,0.25)" strokeWidth="3" strokeLinecap="round" />
        <line x1={G.CX} y1={G.CY} x2={G.CX + G.NEEDLE} y2={G.CY}
          stroke={needleColor} strokeWidth="2" strokeLinecap="round" />
      </g>

      <circle cx={G.CX} cy={G.CY} r={G.HUB} fill={accentColor} opacity="0.65" />
      <circle cx={G.CX} cy={G.CY} r={G.HUB - 2.5} fill="#0d1820" />
    </svg>
  )
}

// ─── Shared analysis card ─────────────────────────────────────────────────────

function AnalysisCard({
  parsedSections,
  analysis,
  disclaimer,
  primaryTkSource,
  alarmPattern,
  tkSources,
}: {
  parsedSections: Array<{ key: SectionKey; content: string }>
  analysis: string
  disclaimer: string | null
  primaryTkSource: TKSource | null
  alarmPattern: AlarmPattern | null
  tkSources: TKSource[]
}) {
  return (
    <div className="space-y-4">
      {alarmPattern && (
        <div
          className="rounded-xl overflow-hidden"
          style={{
            border: alarmPattern.severity === 'critical' ? '2px solid #EF4444' : `2px solid ${HD_ORANGE}`,
          }}
        >
          <div
            className="px-5 py-3 flex items-center gap-3"
            style={{ background: alarmPattern.severity === 'critical' ? '#EF4444' : HD_ORANGE }}
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
            style={{ background: alarmPattern.severity === 'critical' ? '#1a0505' : '#1a0a00' }}
          >
            <div
              className="rounded-lg px-4 py-3"
              style={{
                background: alarmPattern.severity === 'critical' ? '#EF444420' : `${HD_ORANGE}20`,
                border:     alarmPattern.severity === 'critical' ? '1px solid #EF444450' : `1px solid ${HD_ORANGE}50`,
              }}
            >
              <span className="font-bold text-sm" style={{ color: alarmPattern.severity === 'critical' ? '#EF4444' : HD_ORANGE }}>
                DO NOT diagnose these alarms independently — they are related.
              </span>
            </div>

            <div>
              <p className="text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Pattern</p>
              <p className="text-sm text-white leading-relaxed">{alarmPattern.pattern}</p>
            </div>

            <div className="rounded-lg p-4" style={{ background: '#162030' }}>
              <p className="text-xs uppercase tracking-widest mb-1.5" style={{ color: alarmPattern.severity === 'critical' ? '#EF4444' : HD_ORANGE }}>
                Diagnose First
              </p>
              <p className="text-sm font-bold text-white leading-relaxed">{alarmPattern.diagnoseFirst}</p>
            </div>

            {tkSources.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>Official TK Definitions</p>
                {tkSources.map(src => <TKCodeRow key={src.code} src={src} />)}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>
        {primaryTkSource && !alarmPattern && (
          <PrimaryTKBanner src={primaryTkSource} />
        )}

        {primaryTkSource && !alarmPattern && (
          <div
            className="px-5 py-3 flex items-start gap-2"
            style={{ background: '#162030', borderBottom: '1px solid #1e3040' }}
          >
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke={HD_ORANGE} strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-xs uppercase tracking-widest mb-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                Operator Action (TK Official)
              </p>
              <p className="text-sm font-medium text-white">{primaryTkSource.operatorAction}</p>
            </div>
          </div>
        )}

        <div className="p-5 space-y-5" style={{ background: '#111920' }}>
          {parsedSections.length > 0 ? (
            parsedSections.map(({ key, content }) => {
              const def = SECTION_DEFS.find(s => s.key === key)!
              return (
                <div
                  key={key}
                  className={def.bg ? 'rounded-lg p-4' : ''}
                  style={def.bg ? { background: def.bg } : {}}
                >
                  <p className="text-xs uppercase tracking-widest mb-2" style={{ color: def.color }}>
                    {def.label}
                  </p>
                  <SectionContent sectionKey={key} content={content} />
                </div>
              )
            })
          ) : (
            <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.8)' }}>
              {analysis}
            </p>
          )}

          {disclaimer && (
            <div className="rounded-lg p-3" style={{ background: '#0d1820', border: '1px solid #1e3040' }}>
              <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.3)' }}>
                {disclaimer}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HDQuickWrenchPage() {

  // ── Tab ──
  const [activeTab, setActiveTab] = useState<ActiveTab>('reefer')

  // ── Calculator state ──
  const [calcOpen,            setCalcOpen]            = useState(false)
  const [calcAmbient,         setCalcAmbient]         = useState('')
  const [calcSetpoint,        setCalcSetpoint]        = useState('')
  const [calcRefrigerant,     setCalcRefrigerant]     = useState<RefrigerantType>('R-404A')
  const [calcActualBoxTemp,   setCalcActualBoxTemp]   = useState('')
  const [calcActualSuction,   setCalcActualSuction]   = useState('')
  const [calcActualDischarge, setCalcActualDischarge] = useState('')

  // ── Reefer state ──
  const [manufacturer,         setManufacturer]         = useState<Manufacturer>('Thermo King')
  const [unitType,             setUnitType]             = useState<UnitType>('trailer')
  const [model,                setModel]                = useState('')
  const [serialNumber,         setSerialNumber]         = useState('')
  const [alarmCode,            setAlarmCode]            = useState('')
  const [additionalAlarmInput, setAdditionalAlarmInput] = useState('')
  const [symptom,              setSymptom]              = useState('')
  const [loading,              setLoading]              = useState(false)
  const [loadingMessage,       setLoadingMessage]       = useState('Looking up alarm codes...')
  const loadingStartRef = useRef<number>(0)
  const [analysis,             setAnalysis]             = useState<string | null>(null)
  const [tkSources,            setTkSources]            = useState<TKSource[]>([])
  const [alarmPattern,         setAlarmPattern]         = useState<AlarmPattern | null>(null)
  const [disclaimer,           setDisclaimer]           = useState<string | null>(null)
  const [error,                setError]                = useState<string | null>(null)

  // ── Truck state ──
  const [truckBrand,        setTruckBrand]        = useState<EngineBrand>('Cummins')
  const [engineModel,       setEngineModel]       = useState('')
  const [spn,               setSpn]               = useState('')
  const [fmi,               setFmi]               = useState('')
  const [truckSymptom,      setTruckSymptom]      = useState('')
  const [fmiGuideOpen,      setFmiGuideOpen]      = useState(false)
  const [truckLoading,      setTruckLoading]      = useState(false)
  const [truckLoadingMsg,   setTruckLoadingMsg]   = useState('Analyzing fault code...')
  const truckLoadingRef = useRef<number>(0)
  const [truckAnalysis,     setTruckAnalysis]     = useState<string | null>(null)
  const [truckDisclaimer,   setTruckDisclaimer]   = useState<string | null>(null)
  const [truckError,        setTruckError]        = useState<string | null>(null)

  // ── Calculator derived values ──
  const ambientNum       = parseFloat(calcAmbient)
  const setpointNum      = parseFloat(calcSetpoint)
  const actualBoxTempNum = parseFloat(calcActualBoxTemp)
  const hasCalcInputs    = !isNaN(ambientNum) && !isNaN(setpointNum)
  const isPulldown       = !isNaN(actualBoxTempNum) && !isNaN(setpointNum) && actualBoxTempNum > setpointNum + 10
  const suctionTempToUse = isPulldown ? actualBoxTempNum : setpointNum
  const [suctionLow,   suctionHigh]   = hasCalcInputs ? interpolatePressure(suctionTempToUse, SUCTION_REFS[calcRefrigerant])   : [0, 0]
  const [dischargeLow, dischargeHigh] = hasCalcInputs ? interpolatePressure(ambientNum,        DISCHARGE_REFS[calcRefrigerant]) : [0, 0]
  const actualSuction    = parseFloat(calcActualSuction)
  const actualDischarge  = parseFloat(calcActualDischarge)
  const hasSuctionActual    = !isNaN(actualSuction)
  const hasDischargeActual  = !isNaN(actualDischarge)
  const suctionInRange      = hasSuctionActual   && actualSuction   >= suctionLow   && actualSuction   <= suctionHigh
  const dischargeInRange    = hasDischargeActual && actualDischarge >= dischargeLow && actualDischarge <= dischargeHigh

  const modelGroups =
    manufacturer === 'Thermo King'
      ? unitType === 'truck' ? TK_TRUCK_GROUPS : TK_TRAILER_GROUPS
      : unitType === 'truck' ? CT_TRUCK_GROUPS : CT_TRAILER_GROUPS

  const truckModelOptions = ENGINE_MODELS[truckBrand] ?? []

  // ── Loading message effects ──
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

  useEffect(() => {
    if (!truckLoading) return
    setTruckLoadingMsg('Analyzing fault code...')
    const interval = setInterval(() => {
      const elapsed = (Date.now() - truckLoadingRef.current) / 1000
      if      (elapsed < 5)  setTruckLoadingMsg('Analyzing fault code...')
      else if (elapsed < 12) setTruckLoadingMsg('Searching diagnostic databases...')
      else if (elapsed < 22) setTruckLoadingMsg('Generating repair procedure...')
      else                   setTruckLoadingMsg('Almost ready...')
    }, 1000)
    return () => clearInterval(interval)
  }, [truckLoading])

  // ── Reefer submit ──
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!model || (!alarmCode && !symptom)) return
    loadingStartRef.current = Date.now()
    setLoading(true)
    setAnalysis(null)
    setTkSources([])
    setAlarmPattern(null)
    setDisclaimer(null)
    setError(null)

    const additionalAlarmCodes = additionalAlarmInput
      .split(',')
      .map(c => c.trim())
      .filter(Boolean)

    try {
      const res = await fetch('/api/hd/quickwrench', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          mode: 'reefer',
          manufacturer, model, unitType,
          alarmCode, additionalAlarmCodes,
          symptom, serialNumber,
        }),
      })

      const text = await res.text()
      let json: Record<string, unknown> = {}
      try {
        json = JSON.parse(text) as Record<string, unknown>
      } catch {
        throw new Error(`Server returned an unexpected response (status ${res.status}). Please try again.`)
      }

      if (!res.ok) {
        throw new Error(typeof json.error === 'string' ? json.error : `Request failed (${res.status})`)
      }

      setAnalysis(typeof json.analysis === 'string' ? json.analysis : null)
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

  // ── Truck submit ──
  async function handleTruckSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!engineModel || (!spn && !fmi && !truckSymptom)) return
    truckLoadingRef.current = Date.now()
    setTruckLoading(true)
    setTruckAnalysis(null)
    setTruckDisclaimer(null)
    setTruckError(null)

    try {
      const res = await fetch('/api/hd/quickwrench', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          mode: 'truck',
          truckBrand, engineModel, spn, fmi, symptom: truckSymptom,
        }),
      })

      const text = await res.text()
      let json: Record<string, unknown> = {}
      try {
        json = JSON.parse(text) as Record<string, unknown>
      } catch {
        throw new Error(`Server returned an unexpected response (status ${res.status}). Please try again.`)
      }

      if (!res.ok) {
        throw new Error(typeof json.error === 'string' ? json.error : `Request failed (${res.status})`)
      }

      setTruckAnalysis(typeof json.analysis === 'string' ? json.analysis : null)
      setTruckDisclaimer(typeof json.disclaimer === 'string' ? json.disclaimer : null)
    } catch (err) {
      setTruckError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setTruckLoading(false)
    }
  }

  const primaryTkSource = tkSources[0] ?? null
  const parsedSections  = analysis ? parseAnalysis(analysis) : []
  const truckParsedSections = truckAnalysis ? parseAnalysis(truckAnalysis) : []

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

        {/* ── Tab switcher ── */}
        <div className="flex gap-2">
          {([
            { key: 'reefer', label: 'Reefer Unit' },
            { key: 'truck',  label: 'Truck Engine' },
          ] as { key: ActiveTab; label: string }[]).map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors"
              style={activeTab === tab.key
                ? { background: HD_ORANGE, color: '#fff' }
                : { background: '#111920', color: 'rgba(255,255,255,0.45)', border: '1px solid #1e3040' }
              }
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            REEFER TAB
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'reefer' && (
          <>
            {/* ── Refrigerant Pressure Calculator ── */}
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>

              <button
                type="button"
                onClick={() => setCalcOpen(o => !o)}
                className="w-full px-5 py-4 flex items-center gap-3 text-left"
                style={{ background: '#111920' }}
              >
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke={HD_BLUE} strokeWidth={1.8} viewBox="0 0 24 24">
                  <rect x="4" y="2" width="16" height="20" rx="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 6h2m4 0h2M8 10h2m4 0h2M8 14h2m4 0h2M8 18h2m4 0h2" />
                </svg>
                <div className="flex-1">
                  <p className="text-xs uppercase tracking-widest mb-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>Reference Tool</p>
                  <p className="font-condensed font-bold text-white text-lg tracking-wide">Refrigerant Pressure Calculator</p>
                </div>
                <svg
                  className="w-4 h-4 flex-shrink-0 transition-transform duration-200"
                  style={{ color: 'rgba(255,255,255,0.35)', transform: calcOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {calcOpen && (
                <div className="px-5 pb-5 space-y-4" style={{ background: '#111920', borderTop: '1px solid #1e3040' }}>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-4">
                    <div>
                      <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                        Ambient Temp (°F)
                      </label>
                      <input
                        type="number"
                        value={calcAmbient}
                        onChange={e => setCalcAmbient(e.target.value)}
                        placeholder="e.g. 90"
                        className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20"
                        style={{ background: '#162030', border: '1px solid #1e3040' }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                        Box Setpoint (°F)
                      </label>
                      <input
                        type="number"
                        value={calcSetpoint}
                        onChange={e => setCalcSetpoint(e.target.value)}
                        placeholder="e.g. 35"
                        className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20"
                        style={{ background: '#162030', border: '1px solid #1e3040' }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                        Actual Box Temp (°F)
                      </label>
                      <input
                        type="number"
                        value={calcActualBoxTemp}
                        onChange={e => setCalcActualBoxTemp(e.target.value)}
                        placeholder="e.g. 55"
                        className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20"
                        style={{ background: '#162030', border: '1px solid #1e3040' }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                        Refrigerant
                      </label>
                      <select
                        value={calcRefrigerant}
                        onChange={e => setCalcRefrigerant(e.target.value as RefrigerantType)}
                        className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
                        style={{ background: '#162030', border: '1px solid #1e3040' }}
                      >
                        <option value="R-404A">R-404A</option>
                        <option value="R-452A">R-452A</option>
                      </select>
                    </div>
                  </div>

                  {isPulldown && (
                    <div className="rounded-lg p-3 flex gap-3 items-start" style={{ background: '#1a1200', border: '1px solid #F59E0B50' }}>
                      <span style={{ color: '#F59E0B', fontSize: 18, lineHeight: 1.2 }}>⚠</span>
                      <div>
                        <p className="text-xs font-bold mb-0.5" style={{ color: '#F59E0B' }}>PULLDOWN MODE DETECTED</p>
                        <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.6)' }}>
                          Unit is in pulldown mode — pressures will be higher than steady state. This is normal.
                          Suction target is calculated from actual box temp ({actualBoxTempNum}°F) rather than setpoint.
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col items-center gap-2">
                      <ManifoldGauge
                        accentColor={HD_BLUE}
                        minPsi={-30} maxPsi={150}
                        majorTicks={[-30, 0, 30, 60, 90, 120, 150]}
                        minorTicks={[-20, -10, 10, 20, 40, 50, 70, 80, 100, 110, 130, 140]}
                        normalLow={hasCalcInputs ? suctionLow : null}
                        normalHigh={hasCalcInputs ? suctionHigh : null}
                        actualPsi={hasSuctionActual ? actualSuction : null}
                      />
                      <p className="text-xs font-bold tracking-widest" style={{ color: HD_BLUE }}>LOW SIDE SUCTION</p>
                      {hasCalcInputs && (
                        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                          Target: {suctionLow}–{suctionHigh} PSI
                        </p>
                      )}
                      <input
                        type="number"
                        value={calcActualSuction}
                        onChange={e => setCalcActualSuction(e.target.value)}
                        placeholder="Gauge reading (PSI)"
                        className="w-full px-3 py-2 rounded-lg text-sm text-white text-center placeholder-white/20"
                        style={{ background: '#162030', border: '1px solid #1e3040' }}
                      />
                      {hasSuctionActual && hasCalcInputs && (
                        <span className="text-xs font-bold px-3 py-1 rounded-full" style={{
                          background: suctionInRange ? '#22C55E20' : '#EF444420',
                          color:      suctionInRange ? '#22C55E'   : '#EF4444',
                          border:     `1px solid ${suctionInRange ? '#22C55E50' : '#EF444450'}`,
                        }}>
                          {suctionInRange ? 'IN RANGE' : actualSuction < suctionLow ? 'LOW' : 'HIGH'}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-col items-center gap-2">
                      <ManifoldGauge
                        accentColor="#EF4444"
                        minPsi={0} maxPsi={500}
                        majorTicks={[0, 100, 200, 300, 400, 500]}
                        minorTicks={[25, 50, 75, 125, 150, 175, 225, 250, 275, 325, 350, 375, 425, 450, 475]}
                        normalLow={hasCalcInputs ? dischargeLow : null}
                        normalHigh={hasCalcInputs ? dischargeHigh : null}
                        actualPsi={hasDischargeActual ? actualDischarge : null}
                      />
                      <p className="text-xs font-bold tracking-widest" style={{ color: '#EF4444' }}>HIGH SIDE DISCHARGE</p>
                      {hasCalcInputs && (
                        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                          Target: {dischargeLow}–{dischargeHigh} PSI
                        </p>
                      )}
                      <input
                        type="number"
                        value={calcActualDischarge}
                        onChange={e => setCalcActualDischarge(e.target.value)}
                        placeholder="Gauge reading (PSI)"
                        className="w-full px-3 py-2 rounded-lg text-sm text-white text-center placeholder-white/20"
                        style={{ background: '#162030', border: '1px solid #1e3040' }}
                      />
                      {hasDischargeActual && hasCalcInputs && (
                        <span className="text-xs font-bold px-3 py-1 rounded-full" style={{
                          background: dischargeInRange ? '#22C55E20' : '#EF444420',
                          color:      dischargeInRange ? '#22C55E'   : '#EF4444',
                          border:     `1px solid ${dischargeInRange ? '#22C55E50' : '#EF444450'}`,
                        }}>
                          {dischargeInRange ? 'IN RANGE' : actualDischarge < dischargeLow ? 'LOW' : 'HIGH'}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg p-3" style={{ background: '#162030', border: '1px solid #1e3040' }}>
                      <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.35)' }}>Subcooling Target</p>
                      <p className="text-sm font-bold text-white">10–15°F</p>
                    </div>
                    <div className="rounded-lg p-3" style={{ background: '#162030', border: '1px solid #1e3040' }}>
                      <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.35)' }}>Superheat Target</p>
                      <p className="text-sm font-bold text-white">10–20°F</p>
                      <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>at evaporator outlet</p>
                    </div>
                  </div>

                  <p className="text-xs text-center leading-relaxed" style={{ color: 'rgba(255,255,255,0.25)' }}>
                    Visual reference only. Always use calibrated manifold gauges for actual pressure readings.
                    All refrigerant work requires EPA 608 certification.
                  </p>

                  <div className="rounded-lg p-3" style={{ background: '#1a1000', border: '1px solid #F59E0B30' }}>
                    <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>
                      <span style={{ color: '#F59E0B' }}>⚠</span>{' '}
                      Pressure values are reference ranges only. Always verify against unit-specific service documentation.
                      All refrigerant work must be performed by EPA 608 certified technicians only.
                      {calcRefrigerant === 'R-452A' && ' R-452A values are approximate — consult the service manual for your specific unit.'}
                    </p>
                  </div>

                </div>
              )}
            </div>

            {/* ── Reefer query form ── */}
            <form onSubmit={handleSubmit} className="rounded-xl p-6 space-y-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>

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
                  {modelGroups.map(g => (
                    <optgroup key={g.group} label={g.group}>
                      {g.models.map(m => <option key={m} value={m}>{m}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>

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

            {error && (
              <div className="rounded-xl p-4" style={{ background: '#2d0a0a', border: '1px solid #7f1d1d' }}>
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            {analysis !== null && (
              <AnalysisCard
                parsedSections={parsedSections}
                analysis={analysis}
                disclaimer={disclaimer}
                primaryTkSource={primaryTkSource}
                alarmPattern={alarmPattern}
                tkSources={tkSources}
              />
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            TRUCK ENGINE TAB
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'truck' && (
          <>
            {/* ── FMI Reference Guide ── */}
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>
              <button
                type="button"
                onClick={() => setFmiGuideOpen(o => !o)}
                className="w-full px-5 py-4 flex items-center gap-3 text-left"
                style={{ background: '#111920' }}
              >
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke={HD_BLUE} strokeWidth={1.8} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <div className="flex-1">
                  <p className="text-xs uppercase tracking-widest mb-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>SAE J1939 Standard</p>
                  <p className="font-condensed font-bold text-white text-lg tracking-wide">FMI Reference Guide</p>
                </div>
                <svg
                  className="w-4 h-4 flex-shrink-0 transition-transform duration-200"
                  style={{ color: 'rgba(255,255,255,0.35)', transform: fmiGuideOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {fmiGuideOpen && (
                <div className="px-5 pb-5 pt-4 space-y-1" style={{ background: '#111920', borderTop: '1px solid #1e3040' }}>
                  <p className="text-xs mb-3" style={{ color: 'rgba(255,255,255,0.35)' }}>
                    Failure Mode Identifier — defines how a parameter has failed, independent of which parameter (SPN) is faulting.
                  </p>
                  {FMI_CODES.map(({ fmi: f, desc }) => (
                    <div key={f} className="flex gap-3 py-1.5 items-baseline" style={{ borderBottom: '1px solid #1e304050' }}>
                      <span
                        className="text-xs font-bold font-mono flex-shrink-0 w-8 text-right"
                        style={{ color: HD_BLUE }}
                      >
                        {f}
                      </span>
                      <span className="text-xs" style={{ color: 'rgba(255,255,255,0.65)' }}>{desc}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Truck engine form ── */}
            <form onSubmit={handleTruckSubmit} className="rounded-xl p-6 space-y-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>

              {/* Engine Brand */}
              <div>
                <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  Engine Brand
                </label>
                <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid #1e3040' }}>
                  {(['Cummins', 'Detroit Diesel', 'Mercedes-Benz'] as EngineBrand[]).map(b => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => { setTruckBrand(b); setEngineModel('') }}
                      className="flex-1 py-2 text-xs font-semibold transition-colors"
                      style={{
                        background: truckBrand === b ? HD_ORANGE : '#162030',
                        color:      truckBrand === b ? '#fff' : 'rgba(255,255,255,0.4)',
                      }}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>

              {/* Engine Model */}
              <div>
                <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  Engine Model
                </label>
                <select
                  value={engineModel}
                  onChange={e => setEngineModel(e.target.value)}
                  required
                  className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
                  style={{ background: '#162030', border: '1px solid #1e3040' }}
                >
                  <option value="">— Select model —</option>
                  {truckModelOptions.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>

              {/* SPN + FMI */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    SPN <span style={{ color: 'rgba(255,255,255,0.25)' }}>(Suspect Parameter Number)</span>
                  </label>
                  <input
                    type="number"
                    value={spn}
                    onChange={e => setSpn(e.target.value)}
                    placeholder="e.g. 3031"
                    className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20"
                    style={{ background: '#162030', border: '1px solid #1e3040' }}
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    FMI <span style={{ color: 'rgba(255,255,255,0.25)' }}>(Failure Mode Identifier)</span>
                  </label>
                  <input
                    type="number"
                    value={fmi}
                    onChange={e => setFmi(e.target.value)}
                    placeholder="0–15"
                    min="0"
                    max="15"
                    className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20"
                    style={{ background: '#162030', border: '1px solid #1e3040' }}
                  />
                </div>
              </div>

              {/* Symptom */}
              <div>
                <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  Symptom / Question
                </label>
                <textarea
                  value={truckSymptom}
                  onChange={e => setTruckSymptom(e.target.value)}
                  rows={3}
                  placeholder="Describe the fault condition, symptoms, or ask a technical question…"
                  className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20 resize-none"
                  style={{ background: '#162030', border: '1px solid #1e3040' }}
                />
              </div>

              <button
                type="submit"
                disabled={truckLoading || !engineModel || (!spn && !fmi && !truckSymptom)}
                className="w-full py-3 rounded-xl font-bold text-white text-sm transition-opacity"
                style={{
                  background: HD_ORANGE,
                  opacity:    truckLoading || !engineModel || (!spn && !fmi && !truckSymptom) ? 0.5 : 1,
                }}
              >
                {truckLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {truckLoadingMsg}
                  </span>
                ) : 'Run HD QuickWrench'}
              </button>
            </form>

            {truckError && (
              <div className="rounded-xl p-4" style={{ background: '#2d0a0a', border: '1px solid #7f1d1d' }}>
                <p className="text-sm text-red-400">{truckError}</p>
              </div>
            )}

            {truckAnalysis !== null && (
              <AnalysisCard
                parsedSections={truckParsedSections}
                analysis={truckAnalysis}
                disclaimer={truckDisclaimer}
                primaryTkSource={null}
                alarmPattern={null}
                tkSources={[]}
              />
            )}

            {truckAnalysis !== null && (
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>
                <div className="px-5 py-3" style={{ background: '#0d1820', borderBottom: '1px solid #1e3040' }}>
                  <p className="text-xs uppercase tracking-widest font-bold" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    OEM Service Resources
                  </p>
                </div>
                <div className="p-4 space-y-2" style={{ background: '#111920' }}>
                  {(truckBrand === 'Cummins' ? [
                    { name: 'Cummins QuickServe Online',     url: 'https://quickserve.cummins.com',    note: 'Free fault code lookup and service manuals' },
                    { name: 'FMCSA 49 CFR Part 396',         url: 'https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-396', note: 'Federal inspection requirements' },
                  ] : truckBrand === 'Detroit Diesel' ? [
                    { name: 'Detroit Diesel DiagnosticLink', url: 'https://dda.detroit-diesel.com',    note: 'DD13 / DD15 / DD16 service information' },
                    { name: 'FMCSA 49 CFR Part 396',         url: 'https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-396', note: 'Federal inspection requirements' },
                  ] : [
                    { name: 'Mercedes-Benz Trucks Service',  url: 'https://www.mercedes-benz-trucks.com/en_GB/brand/actions-and-events/truckstore/service.html', note: 'MBE 4000 / OM 926 LA service portal' },
                    { name: 'FMCSA 49 CFR Part 396',         url: 'https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-396', note: 'Federal inspection requirements' },
                  ]).map(link => (
                    <a
                      key={link.url}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors"
                      style={{ border: '1px solid #1e3040' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#162030')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white">{link.name}</p>
                        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{link.note}</p>
                      </div>
                      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" style={{ color: 'rgba(255,255,255,0.3)' }}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  ))}
                  <a
                    href="/hd/resources"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-colors"
                    style={{ color: HD_ORANGE, border: `1px solid ${HD_ORANGE}30` }}
                    onMouseEnter={e => (e.currentTarget.style.background = `${HD_ORANGE}10`)}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    View all OEM resources →
                  </a>
                </div>
              </div>
            )}
          </>
        )}

      </div>
    </main>
  )
}
