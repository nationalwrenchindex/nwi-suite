'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { runGaugeDiagnostic, SEVERITY_CONFIG } from '@/lib/hd/gauge-diagnostic'
import PartsOnTheWay, { type PartInput } from '@/components/parts-delivery/PartsOnTheWay'

// Best-effort parse of the Parts Manager result text into structured parts for
// delivery. Each meaningful line → { name, oem } with any part-number token pulled out.
function extractHDParts(text: string | null): PartInput[] {
  if (!text) return []
  return text.split('\n').map(l => l.trim())
    .filter(l => l.length > 3 && !/^(parts reference|note:|verify|part data|no parts)/i.test(l))
    .slice(0, 12)
    .map(l => {
      const clean = l.replace(/^part number:?\s*/i, '')
      const oemM  = clean.match(/([A-Z0-9]{2,}[-–][A-Z0-9-]{2,}|\b\d{3,}[A-Z0-9-]*)/)
      const name  = clean.split(/—|–| - |:/)[0].trim() || clean.trim()
      return { name: name.slice(0, 80), oem: oemM ? oemM[1].replace('–', '-') : '' }
    })
}

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
  'PACCAR':         ['MX-11', 'MX-13'],
  'Volvo':          ['D11', 'D13', 'D16'],
  'Mack':           ['MP7', 'MP8', 'MP10'],
  'International':   ['A26', 'N13'],
  'Caterpillar':    ['C12', 'C13', 'C15', 'C18', '3406E'],
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

type Manufacturer     = 'Thermo King' | 'Carrier Transicold'
type UnitType         = 'truck' | 'trailer'
type EngineBrand      = 'Cummins' | 'Detroit Diesel' | 'Mercedes-Benz' | 'PACCAR' | 'Volvo' | 'Mack' | 'International' | 'Caterpillar'
type ActiveTab        = 'reefer' | 'truck' | 'electrical' | 'procedures' | 'parts'
type ElectricalTopic  = 'Component Library' | 'Schematic Reading' | 'Fault Tracing' | 'Multimeter Guide' | 'Wire Repair'

const ELECTRICAL_TOPICS: { key: ElectricalTopic; desc: string }[] = [
  { key: 'Component Library', desc: 'Relays, diodes, solenoids, fuses, sensors — how they work and how to test them' },
  { key: 'Schematic Reading', desc: 'Wiring diagrams, connector pinouts, circuit symbols, tracing a circuit' },
  { key: 'Fault Tracing',     desc: 'Systematic diagnosis of open circuits, shorts, high resistance, intermittents' },
  { key: 'Multimeter Guide',  desc: 'Voltage, resistance, current, diode test, voltage drop — step by step' },
  { key: 'Wire Repair',       desc: 'Splicing, connector repair, fusible links, chafe repair, proper methods' },
]
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

interface AlarmCodeResult {
  id:                  string
  manufacturer:        string
  unit_family:         string
  alarm_code:          string | null
  display_text:        string | null
  meaning:             string
  severity:            string
  common_causes:       string | null
  diagnostic_steps:    string | null
  field_notes:         string | null
  common_fix:          string | null
  parts_needed:        string | null
  safety_warning:      string | null
  shore_power_warning: boolean
  wiring_reference:    string | null
  book_time:           number | null
  mobile_time:         number | null
}

const AC_SEVERITY_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  immediate:   { label: 'IMMEDIATE ACTION', color: '#EF4444', bg: '#EF444415', border: '#EF444440' },
  check:       { label: 'CHECK AS SPECIFIED', color: '#F59E0B', bg: '#F59E0B15', border: '#F59E0B40' },
  maintenance: { label: 'MAINTENANCE DUE',  color: '#1A6BAF', bg: '#1A6BAF15', border: '#1A6BAF40' },
  info:        { label: 'INFO',             color: '#22C55E', bg: '#22C55E15', border: '#22C55E40' },
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
  { key: 'SPECIAL TOOLS REQUIRED', label: 'Special Tools Required', color: 'rgba(255,255,255,0.7)', bg: null, accent: null   },
  { key: 'SAFETY WARNINGS',    label: 'Safety & Compliance', color: '#F59E0B',               bg: null,      accent: null      },
  { key: 'PM NOTE',            label: 'PM Note',             color: 'rgba(255,255,255,0.4)', bg: null,      accent: null      },
] as const

type SectionKey = typeof SECTION_DEFS[number]['key']

// Static legal disclaimer for the truck-engine tab. The diagnostic now streams
// plain text, so the disclaimer is set client-side on completion (kept in sync
// with TRUCK_DISCLAIMER in @/lib/hd/truck-diagnostic).
const TRUCK_DISCLAIMER = 'Truck engine diagnostics reference SAE J1939 standard and OEM documentation. Always verify fault codes using OEM diagnostic software — Cummins Insite, Detroit Diesel DiagnosticLink, or Mercedes-Benz Xentry. Fault code definitions and repair procedures vary by engine software version.'

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

// Strip any leading list numbering a source line already carries ("1. ", "2. ",
// or a doubled "1. 1. ") so a renderer that adds its own number never produces
// "1. 1.". Trim first so leading whitespace can't defeat the ^ anchor; the
// required space after the period preserves decimals like "3.5V". Used by EVERY
// numbered-list render path in this file.
const stripListNumber = (line: string) => line.trim().replace(/^(?:\d+\.\s+)+/, '').trim()

function SectionContent({ sectionKey, content }: { sectionKey: SectionKey; content: string }) {
  const def = SECTION_DEFS.find(s => s.key === sectionKey)!

  if (sectionKey === 'MOST LIKELY CAUSES' || sectionKey === 'DIAGNOSTIC STEPS') {
    // Trim FIRST so leading indentation from the Haiku formatter doesn't defeat
    // the ^ anchor, then strip any leading numbering the formatter already added
    // (one or more "N. " groups). The renderer adds its own number, so this
    // prevents double numbering like "1. 1.". Requiring a space after the period
    // preserves decimals such as "3.5V".
    const lines = content
      .split('\n')
      .map(stripListNumber)
      .filter(Boolean)
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

// ─── Safety-first hazard detection ────────────────────────────────────────────
// SAFETY-CRITICAL: hazard warnings must render at the TOP of every result —
// fresh OR cached — before anything else. We detect the hazard categories below
// from the diagnostic text; electrical hazards render NWI orange, all others
// bright red. A tech's life depends on seeing this before they touch anything.

const HAZARD_PATTERNS = {
  highVoltageAC:     /\bVAC\b|\b3[\s-]?phase\b|three[\s-]?phase|\b230\s?V\b|\b460\s?V\b|high voltage|\bAC power\b/i,
  refrigerant:       /refrigerant recovery|recover(?:ing|y)?\s+refrigerant|EPA\s?608|recovery required|open(?:ing)?\s+the\s+system|refrigerant line/i,
  highPressure:      /high pressure|discharge pressure|refrigerant pressure|pressurized/i,
  runningEngine:     /engine running|running engine|live engine|rotating component|engine is running|with the engine running/i,
  generalElectrical: /shore power|contactor|energized|\b3[\s-]?phase\b|high voltage/i,
}

// Returns whether ANY hazard is present, and whether it is an electrical hazard
// (which controls the alert color: orange for electrical, red otherwise).
function detectHazards(text: string): { any: boolean; electrical: boolean } {
  const electrical = HAZARD_PATTERNS.highVoltageAC.test(text) || HAZARD_PATTERNS.generalElectrical.test(text)
  const any =
    electrical ||
    HAZARD_PATTERNS.refrigerant.test(text) ||
    HAZARD_PATTERNS.highPressure.test(text) ||
    HAZARD_PATTERNS.runningEngine.test(text)
  return { any, electrical }
}

const GENERIC_SAFETY = 'THIS REPAIR INVOLVES HAZARDOUS CONDITIONS. Review all safety precautions before beginning work.'

// Procedure-aware electrical classification of a SAFETY WARNINGS section. The
// danger this fixes: a live electrical diagnostic (motor/voltage/contactor
// checks) needs the unit RUNNING, so a blanket "turn it off" warning is
// contradictory. Live testing → ORANGE; unit-off repair → RED; a result that
// contains BOTH phases renders the live (orange) block first and the repair
// (red) block second — never a single generic shutdown warning.
interface SafetyBlock { text: string; label: string; color: string }

const ORANGE_HAZARD = '#16a34a'
const RED_HAZARD    = '#CC0000'
const LIVE_LABEL    = '⚠ LIVE ELECTRICAL HAZARD — READ FIRST'
const OFF_LABEL     = '⚠ ELECTRICAL HAZARD — UNIT MUST BE OFF'
const GENERIC_ELEC_LABEL = '⚠ ELECTRICAL HAZARD — READ FIRST'
const GENERIC_LABEL      = '⚠ SAFETY WARNING — READ FIRST'

// "unit to be running" / "live electrical" / "insulated test leads" → live
const SAFETY_LIVE_RE = /unit to be running|live electrical|insulated test leads/i
// "turn off" / "OFF switch" / "lockout" → unit must be off
const SAFETY_OFF_RE  = /turn off|off switch|lockout/i

function classifySafety(content: string): SafetyBlock[] {
  // Type C — explicit two-phase content: split on the REPAIR PHASE label so the
  // live (diagnostic) phase renders ORANGE first and the repair phase renders
  // RED second. Splitting on the labels keeps the two from contradicting.
  const repairIdx = content.search(/⚠?\s*REPAIR PHASE/i)
  if (/DIAGNOSTIC PHASE/i.test(content) && repairIdx >= 0) {
    const livePart = content.slice(0, repairIdx).trim()
    const offPart  = content.slice(repairIdx).trim()
    const blocks: SafetyBlock[] = []
    if (livePart) blocks.push({ text: livePart, label: LIVE_LABEL, color: ORANGE_HAZARD })
    if (offPart)  blocks.push({ text: offPart,  label: OFF_LABEL,  color: RED_HAZARD })
    if (blocks.length) return blocks
  }

  const isLive = SAFETY_LIVE_RE.test(content)
  const isOff  = SAFETY_OFF_RE.test(content)

  // Both live and shutdown cues but no explicit phase labels (e.g. the labels
  // were dropped during reformatting). Split at the first shutdown cue so the
  // live (orange) and repair (red) blocks NEVER share the same text.
  if (isLive && isOff) {
    const cueIdx    = content.search(SAFETY_OFF_RE)
    const lineStart = cueIdx > 0 ? content.lastIndexOf('\n', cueIdx) : -1
    const splitIdx  = lineStart >= 0 ? lineStart + 1 : cueIdx
    if (splitIdx > 0) {
      const livePart = content.slice(0, splitIdx).trim()
      const offPart  = content.slice(splitIdx).trim()
      const blocks: SafetyBlock[] = []
      if (livePart)                        blocks.push({ text: livePart, label: LIVE_LABEL, color: ORANGE_HAZARD })
      if (offPart && offPart !== livePart) blocks.push({ text: offPart,  label: OFF_LABEL,  color: RED_HAZARD })
      if (blocks.length) return blocks
    }
    // No clean split point — one combined block, never the same text twice.
    return [{ text: content, label: LIVE_LABEL, color: ORANGE_HAZARD }]
  }
  if (isLive) return [{ text: content, label: LIVE_LABEL, color: ORANGE_HAZARD }]
  if (isOff)  return [{ text: content, label: OFF_LABEL,  color: RED_HAZARD }]

  // Non-electrical hazard (refrigerant / pressure / running engine) or generic.
  return [{ text: content, label: GENERIC_LABEL, color: RED_HAZARD }]
}

// High-visibility alert block — always rendered at the very top of a result.
function SafetyAlert({ content, color, label }: { content: string; color: string; label: string }) {
  const lines = content
    .split('\n')
    .map(l => l.replace(/^[-•⚠!\s]+/, '').trim())
    .filter(Boolean)
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: `3px solid ${color}` }} role="alert">
      <div className="px-5 py-4 flex items-start gap-4" style={{ background: color }}>
        <span aria-hidden="true" className="text-white font-bold flex-shrink-0 leading-none" style={{ fontSize: '2.5rem' }}>⚠</span>
        <div className="flex-1">
          <p className="font-condensed font-bold text-white tracking-widest uppercase text-lg mb-2">
            {label}
          </p>
          <div className="space-y-1.5">
            {lines.map((l, i) => (
              <p key={i} className="text-white font-bold text-base leading-snug">{l}</p>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Labor estimate ──────────────────────────────────────────────────────────
// Labor times arrive as trailing plain-text lines in the diagnostic ("Book Time:
// X hours" / "Mobile Field Time: Y hours"), which — having no section header —
// otherwise bleed into the last parsed section (often SAFETY WARNINGS). We
// extract them for a dedicated block and strip the lines from the sections.

const HD_LABOR_RATE = 125

// Lines that belong to the labor guide, not to a diagnostic section.
const LABOR_LINE_RE = /^\s*(book time|mobile\s*(?:field\s*)?time|at\s*\$|diagnostic fee|refrigeration recovery(?:\s*(?:and|&)\s*recharge)?|after hours)/i

function stripLaborLines(content: string): string {
  return content
    .split('\n')
    .filter(l => !LABOR_LINE_RE.test(l))
    .join('\n')
    .trim()
}

// Pull book/mobile hours out of the diagnostic text. Returns null when neither
// is present so the block renders nothing.
function extractLaborTimes(text: string): { book: number; mobile: number } | null {
  const bookM   = text.match(/book time:\s*([\d.]+)\s*hours?/i)
  const mobileM = text.match(/mobile\s*(?:field\s*)?time:\s*([\d.]+)\s*hours?/i)
  const book    = bookM   ? parseFloat(bookM[1])   : NaN
  const mobile  = mobileM ? parseFloat(mobileM[1]) : NaN
  if (!Number.isFinite(book) && !Number.isFinite(mobile)) return null
  const b = Number.isFinite(book)   ? book   : mobile
  const m = Number.isFinite(mobile) ? mobile : book
  return { book: b, mobile: m }
}

function LaborEstimate({ book, mobile }: { book: number; mobile: number }) {
  const same = Math.abs(book - mobile) < 0.01
  const fee  = (h: number) => `$${Math.round(h * HD_LABOR_RATE)}`
  return (
    <div className="rounded-lg px-4 py-3" style={{ background: '#0d2137', borderLeft: '3px solid #15803d' }}>
      <p className="text-xs uppercase tracking-widest mb-1.5" style={{ color: '#15803d' }}>
        Labor Estimate
      </p>
      <p className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.85)' }}>
        {same
          ? `Labor Time: ${book.toFixed(1)} hours`
          : `Book Time: ${book.toFixed(1)} hours  |  Mobile Field Time: ${mobile.toFixed(1)} hours`}
      </p>
      <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.55)' }}>
        At ${HD_LABOR_RATE}/hr: {same ? fee(mobile) : `${fee(book)} to ${fee(mobile)}`}
      </p>
    </div>
  )
}

// ─── Parts Manager ───────────────────────────────────────────────────────────
// One-tap targeted parts lookup. The button replaces itself with the parts
// result inline (no navigation); the X dismisses the result and restores the
// button. Rendered above Create Quote on every diagnostic result.

function PartsManager({
  loading, error, result, onRun, onClear,
}: {
  loading: boolean
  error:   string | null
  result:  string | null
  onRun:   () => void
  onClear: () => void
}) {
  return (
    <>
      {result === null ? (
        <button
          type="button"
          onClick={onRun}
          disabled={loading}
          className="w-full py-3 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-60"
          style={{ background: '#15803d', minHeight: 48 }}
        >
          {loading ? 'Looking up parts…' : 'Parts Manager'}
        </button>
      ) : (
        <div className="rounded-lg overflow-hidden" style={{ background: '#0d1f35', borderLeft: '3px solid #15803d' }}>
          <div className="flex items-start justify-between gap-3 px-4 pt-3">
            <p className="text-xs uppercase tracking-widest" style={{ color: '#15803d' }}>Parts Manager</p>
            <button
              type="button"
              onClick={onClear}
              aria-label="Dismiss parts"
              className="flex-shrink-0 text-lg leading-none"
              style={{ color: 'rgba(255,255,255,0.4)' }}
            >
              ×
            </button>
          </div>
          <div className="px-4 pt-2 pb-3 space-y-1">
            {result.split('\n').map((line, i) =>
              line.trim()
                ? <p key={i} className="text-sm leading-snug" style={{ color: 'rgba(255,255,255,0.85)' }}>{line}</p>
                : <div key={i} className="h-1.5" />
            )}
          </div>
          <div className="px-4 pb-3">
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
              Parts data is AI-generated. Verify part numbers with your TK or Carrier dealer before ordering.
            </p>
          </div>
        </div>
      )}
      {error && (
        <div className="rounded-lg px-4 py-2.5 text-sm" style={{ background: '#2d0a0a', border: '1px solid #7f1d1d', color: '#f87171' }}>
          {error}
        </div>
      )}
    </>
  )
}

// ─── Suggested Repairs ───────────────────────────────────────────────────────
// Master + custom repair labor items, matched to the diagnostic's category.
// Tapping an item selects it; selected items become labor lines in the quote.

interface RepairItem {
  id:                     string
  description:            string
  category:               string | null
  applies_to:             string
  mobile_hours:           number | null
  shop_hours:             number | null
  requires_refrigeration: boolean
  refrigeration_service:  string | null
  refrigeration_hours:    number | null
  notes:                  string | null
  is_master:              boolean
}

// Best-effort map of a diagnostic result to a repair-item category. Returns null
// (no filter → show all) when nothing matches, so relevant repairs are never hidden.
function guessRepairCategory(text: string): string | null {
  const t = (text || '').toLowerCase()
  if (/refrigerant|compressor|discharge pressure|suction|evacuat|drier|\bcharge\b|r-404|r-452|epa\s?608|3-way valve|\betv\b|pump down|high pressure/.test(t)) return 'refrigeration'
  if (/\bmotor\b|contactor|alternator|\brelay\b|\bsolenoid\b|\bvac\b|energized|electrical|voltage/.test(t)) return 'electrical'
  if (/\bfuel\b|injector/.test(t)) return 'fuel'
  if (/\bsensor\b|thermistor|probe/.test(t)) return 'sensors'
  if (/\begr\b|coolant|head gasket/.test(t)) return 'engine'
  if (/\bbelt\b|clutch|bearing/.test(t)) return 'mechanical'
  return null
}

function SuggestedRepairs({
  loading, items, selectedIds, onToggle,
}: {
  loading:     boolean
  items:       RepairItem[]
  selectedIds: string[]
  onToggle:    (id: string) => void
}) {
  if (!loading && items.length === 0) return null
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>
      <div className="px-4 py-3" style={{ background: '#0d1820', borderBottom: '1px solid #1e3040' }}>
        <p className="text-xs uppercase tracking-widest" style={{ color: HD_ORANGE }}>Suggested Repairs</p>
        <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>Tap the repairs performed — they’ll be added to the quote.</p>
      </div>
      {loading ? (
        <p className="px-4 py-4 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>Loading repairs…</p>
      ) : (
        <div className="divide-y" style={{ borderColor: '#1e3040' }}>
          {items.map(item => {
            const sel = selectedIds.includes(item.id)
            const hrs = item.mobile_hours != null ? `${item.mobile_hours} hrs mobile` : ''
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onToggle(item.id)}
                className="w-full text-left px-4 py-3 flex items-start gap-3 transition-colors"
                style={{
                  background: sel ? `${HD_ORANGE}22` : 'transparent',
                  borderLeft: sel ? `3px solid ${HD_ORANGE}` : '3px solid transparent',
                }}
              >
                <span
                  className="mt-0.5 w-4 h-4 rounded flex-shrink-0 flex items-center justify-center text-[10px] font-bold"
                  style={{ background: sel ? HD_ORANGE : '#162030', color: '#fff', border: sel ? 'none' : '1px solid #1e3040' }}
                >
                  {sel ? '✓' : ''}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm" style={{ color: sel ? '#fff' : 'rgba(255,255,255,0.8)' }}>
                    {item.description}
                    {!item.is_master && <span className="ml-1.5 text-[10px] uppercase" style={{ color: HD_BLUE }}>custom</span>}
                  </span>
                  <span className="block text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    {[hrs, item.requires_refrigeration ? `+ Refrigeration Service ${item.refrigeration_service ?? ''}`.trim() : null].filter(Boolean).join('  ·  ')}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
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
  codeStatus = 'ai',
}: {
  parsedSections: Array<{ key: SectionKey; content: string }>
  analysis: string
  disclaimer: string | null
  primaryTkSource: TKSource | null
  alarmPattern: AlarmPattern | null
  tkSources: TKSource[]
  codeStatus?: 'verified' | 'ai' | 'unverified'
}) {
  // SAFETY-FIRST: pull any SAFETY WARNINGS section out of the normal flow and
  // render it at the very top; detect hazard categories from the full text to
  // pick the alert color and to generate a generic warning when hazards are
  // present but no explicit safety section exists. Applies to fresh AND cached
  // results (both render through this card), so a cached result with a buried
  // safety warning shows the same top-of-page alert as a fresh one.
  // Labor times get their own block below; strip their lines from every section
  // so they never render inside the safety warning (or any other) section.
  const laborTimes    = extractLaborTimes(analysis)
  const safetySection = parsedSections.find(s => s.key === 'SAFETY WARNINGS')
  const safetyContent = safetySection ? stripLaborLines(safetySection.content) : ''
  const bodySections  = parsedSections
    .filter(s => s.key !== 'SAFETY WARNINGS')
    .map(s => ({ ...s, content: stripLaborLines(s.content) }))
    .filter(s => s.content.length > 0)
  const hazards       = detectHazards(analysis)
  // Procedure-aware safety blocks: classify the extracted SAFETY WARNINGS
  // section (live → orange, unit-off → red, both phases → orange then red);
  // otherwise show a generic warning when hazard keywords are detected.
  const safetyBlocks: SafetyBlock[] = safetyContent
    ? classifySafety(safetyContent)
    : hazards.any
      ? [{
          text:  GENERIC_SAFETY,
          label: hazards.electrical ? GENERIC_ELEC_LABEL : GENERIC_LABEL,
          color: hazards.electrical ? ORANGE_HAZARD : RED_HAZARD,
        }]
      : []

  return (
    <div className="space-y-4">
      {safetyBlocks.map((b, i) => (
        <SafetyAlert key={i} content={b.text} color={b.color} label={b.label} />
      ))}

      {/* Labor Estimate — its own block, between the safety warning and the
          alarm meaning. Never inside the safety block. */}
      {laborTimes && <LaborEstimate book={laborTimes.book} mobile={laborTimes.mobile} />}

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
          {/* Provenance badge — green = verified DB entry, yellow = AI assisted,
              neutral blue = code could not be verified anywhere */}
          {(tkSources.length > 0 || codeStatus === 'verified') ? (
            <span
              className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full tracking-wide"
              style={{ background: '#0f2f1c', color: '#34D399', border: '1px solid #1c5c34' }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#34D399' }} />
              VERIFIED DATABASE ENTRY
            </span>
          ) : codeStatus === 'unverified' ? (
            <span
              className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full tracking-wide"
              style={{ background: '#172534', color: '#93C5FD', border: '1px solid #2c4a66' }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#93C5FD' }} />
              CODE NOT FOUND · DOUBLE-CHECK ENTRY
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full tracking-wide"
              style={{ background: '#352a06', color: '#FBBF24', border: '1px solid #6b520f' }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#FBBF24' }} />
              AI ASSISTED · VERIFY BEFORE RELYING
            </span>
          )}
          {bodySections.length > 0 ? (
            bodySections.map(({ key, content }) => {
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
          ) : parsedSections.length === 0 ? (
            <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.8)' }}>
              {analysis}
            </p>
          ) : null}

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

// ─── Visual Reference (image-search buttons) ──────────────────────────────────
// Tightly-scoped Google Images links. Every query is fully qualified with the
// equipment identity the tech already entered and ends with a technical anchor
// term (wiring diagram / location / troubleshooting / diagnostic) so results
// skew to schematics and service content. We NEVER host images — buttons only.

const VR_SKIP_LINE = /^(note:|select a unit model|no parts|parts reference|always replace|verify|inspect|see )/i
const VR_SKIP_NAME = /^(none|n\/a|na|various|tbd|unknown|see above)$/i

// Collapse an ordered list of fields into one space-separated query, skipping
// blanks and collapsing runs of whitespace.
function tightQuery(parts: Array<string | null | undefined>): string {
  return parts
    .map(p => (p ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// SAFETY CRITICAL: safe=active forces Google SafeSearch ON for every link,
// regardless of the tech's own browser setting. Never omit it on any button.
function buildImageSearchUrl(query: string): string {
  const q = query.replace(/\s+/g, ' ').trim()
  return `https://www.google.com/search?tbm=isch&safe=active&q=${encodeURIComponent(q)}`
}

// Clean one parsed line into a tight component name, or null if it's junk.
function cleanComponentName(raw: string): string | null {
  let s = raw.trim()
  if (VR_SKIP_LINE.test(s)) return null
  // "Part Number: 37-33-6021 — Head Gasket Kit" → keep the text after the dash
  if (/part\s*number/i.test(s)) s = s.split(/[—–-]/).slice(1).join('-').trim()
  // Drop trailing detail after an em/en dash or " - " separator
  s = s.split(/\s[—–]\s|\s-\s|—|–/)[0]
  // Strip leading bullets / numbering
  s = s.replace(/^[\s\-•*\d.)]+/, '')
  // Strip dashed part-number tokens (e.g. 37-33-6021) and bracketed flags
  s = s.replace(/\b\d{2,}(?:-\d+)+\b/g, '').replace(/\[[^\]]*\]/g, '')
  // Drop parenthetical asides, collapse whitespace, trim stray punctuation
  s = s.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').replace(/^[\s,;:.\-]+|[\s,;:.\-]+$/g, '').trim()
  if (s.length < 3 || s.length > 40) return null
  if (!/[a-zA-Z]/.test(s)) return null
  if (VR_SKIP_NAME.test(s)) return null
  return s
}

// Extract up to 4 specific suspect components from a parsed diagnostic result —
// preferring the "Parts Needed" list (cleanest names), then the causes section.
function extractComponents(sections: Array<{ key: SectionKey; content: string }>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (name: string | null) => {
    if (!name || out.length >= 4) return
    const k = name.toLowerCase()
    if (seen.has(k)) return
    seen.add(k)
    out.push(name)
  }
  const fromSection = (key: SectionKey) => {
    const sec = sections.find(s => s.key === key)
    if (!sec) return
    sec.content.split('\n').forEach(line => push(cleanComponentName(line)))
  }
  fromSection('PARTS NEEDED')
  if (out.length === 0) fromSection('MOST LIKELY CAUSES')
  return out.slice(0, 4)
}

interface VisualButton { label: string; query: string }

function VisualReference({ buttons }: { buttons: VisualButton[] }) {
  if (buttons.length === 0) return null
  return (
    <div className="rounded-xl p-5" style={{ background: '#0d1820', border: '1px solid #1e3040' }}>
      <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
        Visual Reference
      </p>
      <p className="text-xs mb-3" style={{ color: 'rgba(255,255,255,0.3)' }}>
        Opens Google Images (SafeSearch on) in a new tab — diagrams &amp; component locations.
      </p>
      <div className="flex flex-wrap gap-2">
        {buttons.map((b, i) => (
          <a
            key={i}
            href={buildImageSearchUrl(b.query)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs px-3 py-2 rounded-lg transition-colors"
            style={{ background: '#162030', border: '1px solid #1e3040', color: 'rgba(255,255,255,0.55)' }}
          >
            {b.label}
          </a>
        ))}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HDQuickWrenchPage() {

  const router = useRouter()

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
  const [displayMessage,       setDisplayMessage]       = useState('')
  const [additionalAlarmInput, setAdditionalAlarmInput] = useState('')
  const [symptom,              setSymptom]              = useState('')
  const [loading,              setLoading]              = useState(false)
  const [loadingMessage,       setLoadingMessage]       = useState('Looking up alarm codes...')
  const loadingStartRef = useRef<number>(0)
  const [analysis,             setAnalysis]             = useState<string | null>(null)
  const [tkSources,            setTkSources]            = useState<TKSource[]>([])
  const [codeStatus,           setCodeStatus]           = useState<'verified' | 'ai' | 'unverified'>('ai')
  const [alarmPattern,         setAlarmPattern]         = useState<AlarmPattern | null>(null)
  const [disclaimer,           setDisclaimer]           = useState<string | null>(null)
  const [error,                setError]                = useState<string | null>(null)

  // ── Unit profile / BM lookup state (optional reefer fields) ──
  const [bmNumber,             setBmNumber]             = useState('')   // TK build number
  const [modelNumber,          setModelNumber]          = useState('')   // Carrier build number
  const [engineHours,          setEngineHours]          = useState('')
  const [profileNotes,         setProfileNotes]         = useState('')
  const [includeDiagFee,       setIncludeDiagFee]       = useState(true)

  // ── Parts Manager (shared reefer/truck) ──
  const [partsResult,          setPartsResult]          = useState<string | null>(null)
  const [showDelivery,         setShowDelivery]         = useState(false)
  const [partsLoading,         setPartsLoading]         = useState(false)
  const [partsError,           setPartsError]           = useState<string | null>(null)

  // ── Suggested Repairs (shared reefer/truck) ──
  const [repairItems,          setRepairItems]          = useState<RepairItem[]>([])
  const [repairLoading,        setRepairLoading]        = useState(false)
  const [selectedRepairIds,    setSelectedRepairIds]    = useState<string[]>([])
  const [unitLookupLoading,    setUnitLookupLoading]    = useState(false)
  const [identifiedModel,      setIdentifiedModel]      = useState<string | null>(null)
  const [identifiedRefrigerant, setIdentifiedRefrigerant] = useState<string | null>(null)

  // ── Alarm Code Lookup state ──
  const [acOpen,    setAcOpen]    = useState(false)
  const [acManuf,   setAcManuf]   = useState<'TK' | 'Carrier'>('TK')
  const [acFamily,  setAcFamily]  = useState('All')
  const [acCode,    setAcCode]    = useState('')
  const [acText,    setAcText]    = useState('')
  const [acMode,    setAcMode]    = useState<'code' | 'text'>('code')
  const [acLoading, setAcLoading] = useState(false)
  const [acResults, setAcResults] = useState<AlarmCodeResult[]>([])
  const [acWarning, setAcWarning] = useState<string | null>(null)
  const [acError,   setAcError]   = useState<string | null>(null)

  // ── Truck state ──
  const [vin,               setVin]               = useState('')
  const [vinLoading,        setVinLoading]        = useState(false)
  const [vinError,          setVinError]          = useState<string | null>(null)
  const [vinDecoded,        setVinDecoded]        = useState<string | null>(null)
  const [vehicleYear,       setVehicleYear]       = useState('')
  const [vehicleMake,       setVehicleMake]       = useState('')
  const [vehicleModel,      setVehicleModel]      = useState('')
  const [vehicleEngine,     setVehicleEngine]     = useState('')
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

  // ── Electrical state ──
  const [elecTopic,     setElecTopic]     = useState<ElectricalTopic>('Fault Tracing')
  const [elecQuestion,  setElecQuestion]  = useState('')
  const [elecLoading,   setElecLoading]   = useState(false)
  const [elecLoadingMsg,setElecLoadingMsg]= useState('Searching electrical knowledge base...')
  const elecLoadingRef = useRef<number>(0)
  const [elecAnalysis,  setElecAnalysis]  = useState<string | null>(null)
  const [elecError,     setElecError]     = useState<string | null>(null)

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

  const gaugeDiag = useMemo(() => {
    if (!hasSuctionActual || !hasDischargeActual) return null
    return runGaugeDiagnostic({
      actualSuction,
      actualDischarge,
      suctionLow:    hasCalcInputs ? suctionLow    : undefined,
      suctionHigh:   hasCalcInputs ? suctionHigh   : undefined,
      dischargeLow:  hasCalcInputs ? dischargeLow  : undefined,
      dischargeHigh: hasCalcInputs ? dischargeHigh : undefined,
      ambientTemp:   isNaN(ambientNum)       ? undefined : ambientNum,
      boxTemp:       isNaN(actualBoxTempNum) ? undefined : actualBoxTempNum,
    })
  }, [actualSuction, actualDischarge, hasSuctionActual, hasDischargeActual,
      hasCalcInputs, suctionLow, suctionHigh, dischargeLow, dischargeHigh,
      ambientNum, actualBoxTempNum])

  // Extract pattern/severity outside JSX so TypeScript can narrow without IIFE
  const diagPattern = gaugeDiag ? gaugeDiag.pattern : null
  const diagSev     = diagPattern ? SEVERITY_CONFIG[diagPattern.severity] : null

  const modelGroups =
    manufacturer === 'Thermo King'
      ? unitType === 'truck' ? TK_TRUCK_GROUPS : TK_TRAILER_GROUPS
      : unitType === 'truck' ? CT_TRUCK_GROUPS : CT_TRAILER_GROUPS

  // Whether the current model value is one of the dropdown options — when a BM
  // lookup auto-fills a model that isn't in the canonical list, we inject it as
  // a synthetic option so the <select> can still display it.
  const modelInGroups = modelGroups.some(g => g.models.includes(model))

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

  useEffect(() => {
    if (!elecLoading) return
    setElecLoadingMsg('Searching electrical knowledge base...')
    const interval = setInterval(() => {
      const elapsed = (Date.now() - elecLoadingRef.current) / 1000
      if      (elapsed < 5)  setElecLoadingMsg('Searching electrical knowledge base...')
      else if (elapsed < 12) setElecLoadingMsg('Building field diagnosis...')
      else                   setElecLoadingMsg('Almost ready...')
    }, 1000)
    return () => clearInterval(interval)
  }, [elecLoading])

  // ── Alarm Code Lookup ──
  async function handleAlarmLookup() {
    const codeVal = acCode.trim()
    const textVal = acText.trim()
    if (acMode === 'code' && !codeVal) return
    if (acMode === 'text' && !textVal) return

    setAcLoading(true)
    setAcResults([])
    setAcWarning(null)
    setAcError(null)

    const params = new URLSearchParams({ manufacturer: acManuf })
    const resolvedFamily = acManuf === 'TK' ? '' : acFamily !== 'All' ? acFamily : ''
    if (resolvedFamily) params.set('unit_family', resolvedFamily)
    if (acMode === 'code') params.set('alarm_code', codeVal)
    else params.set('display_text', textVal)

    try {
      const res  = await fetch(`/api/hd/alarm-codes?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Lookup failed')
      setAcResults(data.results ?? [])
      setAcWarning(data.multi_family_warning ?? null)
    } catch (e) {
      setAcError(e instanceof Error ? e.message : 'Lookup failed')
    } finally {
      setAcLoading(false)
    }
  }

  // ── Unit profile / BM lookup ──
  // Fires when a BM (TK) / model number (Carrier) or serial is entered. Looks up
  // the tech's own private profile AND the global BM map, then auto-fills.
  async function lookupUnit() {
    const manufCode = manufacturer === 'Thermo King' ? 'TK' : 'Carrier'
    const build  = (manufCode === 'TK' ? bmNumber : modelNumber).trim()
    const serial = serialNumber.trim()
    if (!build && !serial) return

    setUnitLookupLoading(true)
    try {
      const params = new URLSearchParams({ manufacturer: manufCode })
      if (build)  params.set('bm_number', build)
      if (serial) params.set('serial_number', serial)

      const res = await fetch(`/api/hd/unit-profile?${params}`)
      if (!res.ok) return
      const data = await res.json() as {
        profile: { unit_model?: string | null; refrigerant_type?: string | null; engine_hours?: number | null; notes?: string | null } | null
        bmMap:   { unit_model?: string | null; refrigerant_type?: string | null; known_parts?: string | null } | null
      }

      if (data.bmMap) {
        // Global match — show the green banner and auto-fill the unit model.
        setIdentifiedModel(data.bmMap.unit_model ?? null)
        setIdentifiedRefrigerant(data.bmMap.refrigerant_type ?? null)
        if (data.bmMap.unit_model) setModel(data.bmMap.unit_model)
      } else {
        setIdentifiedModel(null)
        setIdentifiedRefrigerant(null)
      }

      if (data.profile) {
        // The tech's own saved unit — fill engine hours / notes (and model, if
        // the global map didn't already provide one).
        if (data.profile.engine_hours != null) setEngineHours(String(data.profile.engine_hours))
        if (data.profile.notes) setProfileNotes(data.profile.notes)
        if (!data.bmMap && data.profile.unit_model) setModel(data.profile.unit_model)
      }
    } catch {
      // Lookup is a convenience — never block the tech if it fails.
    } finally {
      setUnitLookupLoading(false)
    }
  }

  // ── Reefer submit ──
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!model || (!alarmCode && !symptom)) return
    loadingStartRef.current = Date.now()
    setLoading(true)
    setAnalysis(null)
    setTkSources([])
    setCodeStatus('ai')
    setAlarmPattern(null)
    setDisclaimer(null)
    setError(null)
    setPartsResult(null)   // never show stale parts under a new result
    setPartsError(null)
    setRepairItems([])
    setSelectedRepairIds([])

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
          display_message: displayMessage,
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

      const reeferAnalysis = typeof json.analysis === 'string' ? json.analysis : null
      setAnalysis(reeferAnalysis)
      if (reeferAnalysis) loadRepairItems(guessRepairCategory(reeferAnalysis))
      if (reeferAnalysis) {
        try {
          localStorage.setItem('hd_last_quickwrench_result', JSON.stringify({
            analysis:      reeferAnalysis,
            timestamp:     new Date().toISOString(),
            manufacturer,
            model:         `${manufacturer} ${model}`,
            symptom:       symptom || alarmCode,
          }))
        } catch {}
      }
      setTkSources(Array.isArray(json.tk_sources) ? json.tk_sources as TKSource[] : [])
      setCodeStatus(
        json.code_status === 'verified' || json.code_status === 'unverified'
          ? json.code_status
          : 'ai'
      )
      setAlarmPattern(
        json.alarm_pattern != null && typeof json.alarm_pattern === 'object'
          ? json.alarm_pattern as AlarmPattern
          : null
      )
      setDisclaimer(typeof json.disclaimer === 'string' ? json.disclaimer : null)

      // Auto-save the unit profile (and contribute to the global BM map) — but
      // ONLY when the tech actually entered a BM/serial. Never persist an empty
      // profile. Fire-and-forget: a save failure must not break the diagnostic.
      const manufCode = manufacturer === 'Thermo King' ? 'TK' : 'Carrier'
      const build = (manufCode === 'TK' ? bmNumber : modelNumber).trim()
      if (build || serialNumber.trim()) {
        try {
          await fetch('/api/hd/unit-profile', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              manufacturer:     manufCode,
              serial_number:    serialNumber.trim() || null,
              bm_number:        manufCode === 'TK'      ? (bmNumber.trim()    || null) : null,
              model_number:     manufCode === 'Carrier' ? (modelNumber.trim() || null) : null,
              unit_model:       model || null,
              refrigerant_type: identifiedRefrigerant,
              engine_hours:     engineHours.trim() || null,
              notes:            profileNotes.trim() || null,
            }),
          })
        } catch {}
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ── VIN decode (NHTSA) — optional; auto-populates year/make/model/engine ──
  async function decodeVin() {
    const v = vin.trim().toUpperCase()
    if (v.length !== 17) {
      setVinError('VIN not found — please enter vehicle info manually')
      setVinDecoded(null)
      return
    }
    setVinLoading(true)
    setVinError(null)
    try {
      const res  = await fetch(`/api/hd/quickwrench/vin/${v}`)
      const json = await res.json()
      if (!res.ok || !json.vehicle) {
        setVinError(typeof json.error === 'string' ? json.error : 'VIN not found — please enter vehicle info manually')
        setVinDecoded(null)
        return
      }
      const vehicle = json.vehicle as { year?: string; make?: string; model?: string; engine?: string | null }
      if (vehicle.year)   setVehicleYear(vehicle.year)
      if (vehicle.make)   setVehicleMake(vehicle.make)
      if (vehicle.model)  setVehicleModel(vehicle.model)
      setVehicleEngine(vehicle.engine ?? '')
      setVinDecoded(
        [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') +
        (vehicle.engine ? ` — ${vehicle.engine}` : '')
      )
    } catch {
      setVinError('VIN not found — please enter vehicle info manually')
      setVinDecoded(null)
    } finally {
      setVinLoading(false)
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
    setPartsResult(null)   // never show stale parts under a new result
    setPartsError(null)
    setRepairItems([])
    setSelectedRepairIds([])

    try {
      const res = await fetch('/api/hd/truck-diagnostic', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          truckBrand, engineModel, spn, fmi, symptom: truckSymptom,
          vehicleYear, vehicleMake, vehicleModel, vehicleEngine,
        }),
      })

      // Auth / validation failures come back as JSON, not a stream.
      if (!res.ok || !res.body) {
        let msg = `Request failed (${res.status})`
        try {
          const j = await res.json() as { error?: unknown }
          if (typeof j.error === 'string') msg = j.error
        } catch {}
        throw new Error(msg)
      }

      // Stream the diagnostic text in as it arrives.
      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let acc = ''
      setTruckLoadingMsg('Searching service data…')
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true })
        setTruckAnalysis(acc)   // live update — card renders and grows
      }
      acc += decoder.decode()   // flush any trailing bytes
      setTruckAnalysis(acc)
      setTruckDisclaimer(TRUCK_DISCLAIMER)
      if (acc.trim()) loadRepairItems(guessRepairCategory(acc))

      if (acc.trim()) {
        try {
          localStorage.setItem('hd_last_quickwrench_result', JSON.stringify({
            analysis:      acc,
            timestamp:     new Date().toISOString(),
            manufacturer:  truckBrand,
            model:         `${truckBrand} ${engineModel}`,
            symptom:       truckSymptom || [spn && `SPN ${spn}`, fmi && `FMI ${fmi}`].filter(Boolean).join(' '),
          }))
        } catch {}
      }
    } catch (err) {
      setTruckError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setTruckLoading(false)
    }
  }

  // ── Electrical submit ──
  async function handleElecSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!elecQuestion.trim()) return
    elecLoadingRef.current = Date.now()
    setElecLoading(true)
    setElecAnalysis(null)
    setElecError(null)

    try {
      const res = await fetch('/api/hd/quickwrench', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mode: 'electrical', topic: elecTopic, question: elecQuestion }),
      })
      const text = await res.text()
      let json: Record<string, unknown> = {}
      try { json = JSON.parse(text) as Record<string, unknown> } catch {
        throw new Error(`Server returned an unexpected response (status ${res.status}). Please try again.`)
      }
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : `Request failed (${res.status})`)
      const elecAnalysisResult = typeof json.analysis === 'string' ? json.analysis : null
      setElecAnalysis(elecAnalysisResult)
      if (elecAnalysisResult) {
        try {
          localStorage.setItem('hd_last_quickwrench_result', JSON.stringify({
            analysis:      elecAnalysisResult,
            timestamp:     new Date().toISOString(),
            manufacturer:  'Electrical Systems',
            model:         elecTopic,
            symptom:       elecQuestion,
          }))
        } catch {}
      }
    } catch (err) {
      setElecError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setElecLoading(false)
    }
  }

  const primaryTkSource = tkSources[0] ?? null
  const parsedSections  = analysis ? parseAnalysis(analysis) : []
  const truckParsedSections = truckAnalysis ? parseAnalysis(truckAnalysis) : []
  const elecParsedSections  = elecAnalysis  ? parseAnalysis(elecAnalysis)  : []

  // ── Visual Reference buttons (image search) ──
  // Reefer: ${manufacturer} ${unit_model} ${component} wiring diagram location
  //         + ${manufacturer} ${unit_model} Code ${alarm_code} troubleshooting
  const reeferComponents = analysis ? extractComponents(parsedSections) : []
  const reeferVisualButtons: VisualButton[] = [
    ...reeferComponents.map(c => ({
      label: `${c} — diagram & location`,
      query: tightQuery([manufacturer, model, c, 'wiring diagram location']),
    })),
    ...(alarmCode.trim()
      ? [{
          label: `Code ${alarmCode.trim()} — troubleshooting`,
          query: tightQuery([manufacturer, model, `Code ${alarmCode.trim()}`, 'troubleshooting']),
        }]
      : []),
  ]

  // Truck: ${year} ${make} ${model} ${engine_brand} ${engine_model} ${component} location wiring diagram
  //        + ${engine_brand} ${engine_model} SPN ${spn} FMI ${fmi} diagnostic
  const truckComponents = truckAnalysis ? extractComponents(truckParsedSections) : []
  const truckCodeLabel = [spn.trim() ? `SPN ${spn.trim()}` : null, fmi.trim() ? `FMI ${fmi.trim()}` : null]
    .filter(Boolean).join(' ')
  const truckVisualButtons: VisualButton[] = [
    ...truckComponents.map(c => ({
      label: `${c} — diagram & location`,
      query: tightQuery([vehicleYear, vehicleMake, vehicleModel, truckBrand, engineModel, c, 'location wiring diagram']),
    })),
    ...((spn.trim() || fmi.trim())
      ? [{
          label: `${truckCodeLabel} — diagnostic`,
          query: tightQuery([truckBrand, engineModel, spn.trim() ? `SPN ${spn.trim()}` : null, fmi.trim() ? `FMI ${fmi.trim()}` : null, 'diagnostic']),
        }]
      : []),
  ]

  // ── Push-to-Quote ──
  // Writes the standard hd_guided_diagnostic_prefill object and navigates to the
  // HD quote page, whose existing consumer hook reads the key on mount. We never
  // touch the quote page or its API.
  const DIAG_FEE_LINE = () => ({
    id:                     crypto.randomUUID(),
    type:                   'labor' as const,
    description:            'Diagnostic Fee',
    book_hours:             1.0, book_hours_max:   1.0,
    mobile_hours:           1.0, mobile_hours_max: 1.0,
    requires_refrigeration: false,
    recharge_added:         false,
    part_number: '', quantity: 1, unit_cost: 0,
    amount: 0, amount_max: 0,
  })

  function pushReeferToQuote() {
    if (analysis === null) return
    // Verified labor times aren't present on the client-side tk_sources payload,
    // so this falls back to standard hours; if a book_time/mobile_time ever ships
    // on that payload it is used automatically.
    const src0       = tkSources[0] as (TKSource & { book_time?: number; mobile_time?: number }) | undefined
    const bookTime   = typeof src0?.book_time   === 'number' ? src0.book_time   : null
    const mobileTime = typeof src0?.mobile_time === 'number' ? src0.mobile_time : null

    const code      = alarmCode.trim()
    const disp      = displayMessage.trim()
    const codeLabel = code ? `Code ${code}` : 'Diagnostic'

    const prefill = {
      complaint:         `${manufacturer} ${model} — ${codeLabel}${disp ? ': ' + disp : ''}`,
      diagnosis:         '',
      notes: [
        bmNumber     ? `BM Number: ${bmNumber}`       : null,
        serialNumber ? `Serial: ${serialNumber}`      : null,
        engineHours  ? `Engine Hours: ${engineHours}` : null,
        profileNotes ? `Unit Notes: ${profileNotes}`  : null,
      ].filter(Boolean).join(' | ') || '',
      unit_manufacturer: manufacturer,
      unit_model:        model,
      unit_serial:       serialNumber || '',
      unit_year:         '',
      truck_make:        '',
      truck_model:       '',
      truck_year:        '',
      vin:               '',
      lineItems: [
        {
          id:                     crypto.randomUUID(),
          type:                   'labor' as const,
          description:            `HD Diagnostic & Repair — ${manufacturer} ${model} ${codeLabel}${disp ? ' (' + disp + ')' : ''}`,
          book_hours:             bookTime   ?? 1.0,
          book_hours_max:         bookTime   ?? 1.5,
          mobile_hours:           mobileTime ?? 1.5,
          mobile_hours_max:       mobileTime ?? 2.0,
          requires_refrigeration: false,
          recharge_added:         false,
          part_number: '', quantity: 1, unit_cost: 0,
          amount: 0, amount_max: 0,
        },
        ...buildRepairLines(),
        ...(includeDiagFee ? [DIAG_FEE_LINE()] : []),
      ],
    }
    try { localStorage.setItem('hd_guided_diagnostic_prefill', JSON.stringify(prefill)) } catch {}
    router.push('/hd/quotes/new')
  }

  function pushTruckToQuote() {
    if (truckAnalysis === null) return
    const spnV      = spn.trim()
    const fmiV      = fmi.trim()
    const codeLabel = [spnV && `SPN ${spnV}`, fmiV && `FMI ${fmiV}`].filter(Boolean).join(' ') || 'Diagnostic'
    const vehicle   = [vehicleYear, vehicleMake, vehicleModel].map(v => v.trim()).filter(Boolean).join(' ')

    const prefill = {
      complaint:         `${truckBrand} ${engineModel} — ${codeLabel}`,
      diagnosis:         '',
      notes: [
        vehicle      ? `Vehicle: ${vehicle}`      : null,
        truckSymptom ? `Symptom: ${truckSymptom}` : null,
      ].filter(Boolean).join(' | ') || '',
      unit_manufacturer: truckBrand,
      unit_model:        engineModel,
      unit_serial:       '',
      lineItems: [
        {
          id:                     crypto.randomUUID(),
          type:                   'labor' as const,
          description:            `Truck Engine Diagnostic & Repair — ${truckBrand} ${engineModel} ${codeLabel}`,
          book_hours:             1.0, book_hours_max:   1.5,
          mobile_hours:           1.5, mobile_hours_max: 2.0,
          requires_refrigeration: false,
          recharge_added:         false,
          part_number: '', quantity: 1, unit_cost: 0,
          amount: 0, amount_max: 0,
        },
        ...buildRepairLines(),
        ...(includeDiagFee ? [DIAG_FEE_LINE()] : []),
      ],
    }
    try { localStorage.setItem('hd_guided_diagnostic_prefill', JSON.stringify(prefill)) } catch {}
    router.push('/hd/quotes/new')
  }

  // ── Parts Manager lookups ──
  async function runPartsManager(payload: Record<string, string>) {
    setPartsLoading(true)
    setPartsError(null)
    setPartsResult(null)
    try {
      const res  = await fetch('/api/hd/parts-manager', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({})) as { parts?: unknown; error?: unknown }
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : `Parts lookup failed (${res.status})`)
      setPartsResult(typeof json.parts === 'string' ? json.parts : '')
    } catch (e) {
      setPartsError(e instanceof Error ? e.message : 'Parts lookup failed. Please try again.')
    } finally {
      setPartsLoading(false)
    }
  }

  function runReeferPartsManager() {
    if (analysis === null) return
    runPartsManager({
      manufacturer,
      model,
      alarmCode:      alarmCode.trim(),
      displayMessage: displayMessage.trim(),
      unitType,
      serialNumber:   serialNumber.trim(),
    })
  }

  function runTruckPartsManager() {
    if (truckAnalysis === null) return
    const code = [spn.trim() ? `SPN ${spn.trim()}` : null, fmi.trim() ? `FMI ${fmi.trim()}` : null].filter(Boolean).join(' ')
    runPartsManager({
      manufacturer:   truckBrand,
      model:          engineModel,
      alarmCode:      code,
      displayMessage: truckSymptom.trim(),
      unitType:       'truck',
      serialNumber:   '',
    })
  }

  const clearParts = () => { setPartsResult(null); setPartsError(null) }

  // ── Suggested Repairs ──
  async function loadRepairItems(category: string | null) {
    setRepairLoading(true)
    setRepairItems([])
    setSelectedRepairIds([])
    try {
      const url = category ? `/api/hd/repair-items?category=${encodeURIComponent(category)}` : '/api/hd/repair-items'
      const res = await fetch(url)
      const json = await res.json().catch(() => ({})) as { items?: unknown }
      setRepairItems(Array.isArray(json.items) ? json.items as RepairItem[] : [])
    } catch {
      setRepairItems([])
    } finally {
      setRepairLoading(false)
    }
  }

  const toggleRepair = (id: string) =>
    setSelectedRepairIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])

  // Build labor lines for the selected repair items. A refrigeration repair also
  // adds its refrigeration service as a separate labor line.
  function buildRepairLines() {
    const lines: ReturnType<typeof DIAG_FEE_LINE>[] = []
    for (const item of repairItems.filter(it => selectedRepairIds.includes(it.id))) {
      const mobile = Number(item.mobile_hours ?? 0)
      const book   = Number(item.shop_hours ?? item.mobile_hours ?? 0)
      lines.push({
        id:                     crypto.randomUUID(),
        type:                   'labor' as const,
        description:            item.description,
        book_hours:             book, book_hours_max:   book,
        mobile_hours:           mobile, mobile_hours_max: mobile,
        requires_refrigeration: item.requires_refrigeration,
        recharge_added:         false,
        part_number: '', quantity: 1, unit_cost: 0, amount: 0, amount_max: 0,
      })
      if (item.requires_refrigeration && item.refrigeration_hours) {
        const rh = Number(item.refrigeration_hours)
        lines.push({
          id:                     crypto.randomUUID(),
          type:                   'labor' as const,
          description:            `Refrigeration Service ${item.refrigeration_service ?? ''} — recover, evacuate & charge`.replace(/\s+/g, ' ').trim(),
          book_hours:             rh, book_hours_max:   rh,
          mobile_hours:           rh, mobile_hours_max: rh,
          requires_refrigeration: true,
          recharge_added:         true,
          part_number: '', quantity: 1, unit_cost: 0, amount: 0, amount_max: 0,
        })
      }
    }
    return lines
  }

  return (
    <main className="flex-1 p-4 sm:p-6">
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
        <div className="flex flex-wrap gap-2">
          {([
            { key: 'reefer',      label: 'Reefer Unit'        },
            { key: 'truck',       label: 'Truck Engine'       },
            { key: 'electrical',  label: 'Electrical Systems' },
            { key: 'procedures',  label: 'Procedures'         },
            { key: 'parts',       label: 'Parts Ref'          },
          ] as { key: ActiveTab; label: string }[]).map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => { setActiveTab(tab.key); setPartsResult(null); setPartsError(null); setRepairItems([]); setSelectedRepairIds([]) }}
              className="flex-1 sm:flex-none px-5 py-3 rounded-lg text-sm font-semibold transition-colors"
              style={activeTab === tab.key
                ? { background: HD_ORANGE, color: '#fff', minHeight: 44 }
                : { background: '#111920', color: 'rgba(255,255,255,0.45)', border: '1px solid #1e3040', minHeight: 44 }
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
            {/* ── Alarm Code Lookup ── */}
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>

              <button
                type="button"
                onClick={() => setAcOpen(o => !o)}
                className="w-full px-5 py-4 flex items-center gap-3 text-left"
                style={{ background: '#111920' }}
              >
                <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke={HD_ORANGE} strokeWidth={1.8} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <div className="flex-1">
                  <p className="text-xs uppercase tracking-widest mb-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>Verified Database</p>
                  <p className="font-condensed font-bold text-white text-lg tracking-wide">Alarm Code Lookup</p>
                </div>
                <svg
                  className="w-4 h-4 flex-shrink-0 transition-transform duration-200"
                  style={{ color: 'rgba(255,255,255,0.35)', transform: acOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {acOpen && (
                <div className="px-5 pb-5 space-y-4" style={{ background: '#111920', borderTop: '1px solid #1e3040' }}>

                  {/* Manufacturer toggle */}
                  <div className="pt-4">
                    <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'rgba(255,255,255,0.4)' }}>Manufacturer</p>
                    <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid #1e3040' }}>
                      {(['TK', 'Carrier'] as const).map(m => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => { setAcManuf(m); setAcFamily('All'); setAcResults([]); setAcWarning(null); setAcError(null) }}
                          className="flex-1 py-2.5 text-sm font-semibold transition-colors"
                          style={acManuf === m
                            ? { background: HD_ORANGE, color: '#fff' }
                            : { background: '#162030', color: 'rgba(255,255,255,0.45)' }}
                        >
                          {m === 'TK' ? 'Thermo King' : 'Carrier Transicold'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Carrier unit family */}
                  {acManuf === 'Carrier' && (
                    <div>
                      <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'rgba(255,255,255,0.4)' }}>Unit Model Family</p>
                      <div className="flex gap-2 flex-wrap">
                        {(['All', 'X2', 'Vector'] as const).map(f => (
                          <button
                            key={f}
                            type="button"
                            onClick={() => { setAcFamily(f); setAcResults([]); setAcWarning(null) }}
                            className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
                            style={acFamily === f
                              ? { background: HD_BLUE, color: '#fff' }
                              : { background: '#162030', color: 'rgba(255,255,255,0.45)', border: '1px solid #1e3040' }}
                          >
                            {f === 'All' ? 'All Models' : f}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Search mode toggle */}
                  <div>
                    <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'rgba(255,255,255,0.4)' }}>Search By</p>
                    <div className="flex gap-2">
                      {([
                        { key: 'code', label: 'Alarm Code Number' },
                        { key: 'text', label: 'Description / Keyword' },
                      ] as { key: 'code' | 'text'; label: string }[]).map(opt => (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => { setAcMode(opt.key); setAcResults([]); setAcWarning(null); setAcError(null) }}
                          className="flex-1 py-2 rounded-lg text-xs font-semibold transition-colors"
                          style={acMode === opt.key
                            ? { background: '#1e3040', color: '#fff', border: `1px solid ${HD_ORANGE}` }
                            : { background: '#162030', color: 'rgba(255,255,255,0.4)', border: '1px solid #1e3040' }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Search input */}
                  {acMode === 'code' ? (
                    <div>
                      <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                        Alarm Code Number
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={acCode}
                          onChange={e => setAcCode(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleAlarmLookup()}
                          placeholder={acManuf === 'TK' ? 'e.g. 10, 25, 89' : 'e.g. A00073, A05036'}
                          className="flex-1 px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20"
                          style={{ background: '#162030', border: '1px solid #1e3040', fontFamily: 'monospace' }}
                        />
                        <button
                          type="button"
                          onClick={handleAlarmLookup}
                          disabled={acLoading || !acCode.trim()}
                          className="px-5 py-2.5 rounded-lg text-sm font-bold transition-colors"
                          style={{ background: acLoading || !acCode.trim() ? '#1e3040' : HD_ORANGE, color: '#fff', minWidth: 80 }}
                        >
                          {acLoading ? '...' : 'Look Up'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                        Description or Keyword
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={acText}
                          onChange={e => setAcText(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleAlarmLookup()}
                          placeholder="e.g. High Discharge, Alternator, ETV"
                          className="flex-1 px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20"
                          style={{ background: '#162030', border: '1px solid #1e3040' }}
                        />
                        <button
                          type="button"
                          onClick={handleAlarmLookup}
                          disabled={acLoading || !acText.trim()}
                          className="px-5 py-2.5 rounded-lg text-sm font-bold transition-colors"
                          style={{ background: acLoading || !acText.trim() ? '#1e3040' : HD_ORANGE, color: '#fff', minWidth: 80 }}
                        >
                          {acLoading ? '...' : 'Search'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Multi-family warning */}
                  {acWarning && (
                    <div className="rounded-lg px-4 py-3" style={{ background: '#1a1000', border: '1px solid #F59E0B40' }}>
                      <p className="text-sm" style={{ color: '#F59E0B' }}>⚠ {acWarning}</p>
                    </div>
                  )}

                  {/* Error */}
                  {acError && (
                    <div className="rounded-lg px-4 py-3" style={{ background: '#1a0000', border: '1px solid #EF444440' }}>
                      <p className="text-sm" style={{ color: '#EF4444' }}>{acError}</p>
                    </div>
                  )}

                  {/* No results */}
                  {!acLoading && !acError && acResults.length === 0 && (acCode.trim() || acText.trim()) && (
                    <p className="text-sm text-center py-2" style={{ color: 'rgba(255,255,255,0.35)' }}>
                      No results found. Try a different code or keyword.
                    </p>
                  )}

                  {/* Results */}
                  {acResults.map(r => {
                    const sev = AC_SEVERITY_CONFIG[r.severity] ?? AC_SEVERITY_CONFIG.check
                    // Strip any leading numbering the DB stored ("1. ", "2. ") so the
                    // renderer's own number is never added on top → no "1. 1." doubling.
                    // Split causes on comma OR newline so numbered newline lists split too.
                    const steps = r.diagnostic_steps ? r.diagnostic_steps.split('\n').map(stripListNumber).filter(Boolean) : []
                    const causes = r.common_causes ? r.common_causes.split(/[,\n]/).map(stripListNumber).filter(Boolean) : []
                    return (
                      <div key={r.id} className="rounded-xl overflow-hidden" style={{ border: `1px solid ${sev.border}` }}>

                        {/* Header */}
                        <div className="px-4 py-3 flex items-start justify-between gap-3" style={{ background: sev.bg }}>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              {r.alarm_code && (
                                <span
                                  className="text-sm font-bold px-2.5 py-0.5 rounded"
                                  style={{ background: '#0d1820', color: HD_ORANGE, fontFamily: 'monospace', border: `1px solid ${HD_ORANGE}40` }}
                                >
                                  {r.manufacturer === 'TK' ? `Code ${r.alarm_code}` : r.alarm_code}
                                </span>
                              )}
                              <span
                                className="text-xs font-bold px-2.5 py-0.5 rounded-full tracking-wide"
                                style={{ background: sev.color, color: '#fff' }}
                              >
                                {sev.label}
                              </span>
                              {acManuf === 'Carrier' && (
                                <span className="text-xs px-2 py-0.5 rounded" style={{ background: '#162030', color: 'rgba(255,255,255,0.5)' }}>
                                  {r.unit_family}
                                </span>
                              )}
                            </div>
                            <p className="font-bold text-white text-sm leading-snug">{r.display_text ?? r.meaning}</p>
                          </div>
                        </div>

                        {/* Meaning */}
                        <div className="px-4 py-3" style={{ borderTop: '1px solid #1e3040' }}>
                          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.35)' }}>Alarm Meaning</p>
                          <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.85)' }}>{r.meaning}</p>
                        </div>

                        {/* Shore power warning — always first if applicable */}
                        {r.shore_power_warning && (
                          <div className="px-4 py-3" style={{ background: '#1a0505', borderTop: '1px solid #EF444440' }}>
                            <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: '#EF4444' }}>⚡ High Voltage Warning</p>
                            <p className="text-sm leading-relaxed" style={{ color: '#EF4444' }}>
                              Shore power on this unit operates at 460–480V three-phase. This is LETHAL VOLTAGE.
                              Only qualified electricians may work on shore power connections.
                              Disconnect and lock out power before servicing the power inlet.
                            </p>
                          </div>
                        )}

                        {/* Safety warning */}
                        {r.safety_warning && (
                          <div className="px-4 py-3" style={{ borderTop: '1px solid #1e3040' }}>
                            <p className="text-xs uppercase tracking-widest mb-1" style={{ color: '#F59E0B' }}>⚠ Safety</p>
                            <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.7)' }}>{r.safety_warning}</p>
                          </div>
                        )}

                        {/* Battery warning — always shown */}
                        <div className="px-4 py-3" style={{ background: '#0d1c10', borderTop: '1px solid #22C55E30' }}>
                          <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: '#22C55E' }}>🔋 Field Protocol</p>
                          <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.6)' }}>
                            Always perform a battery load test before any other diagnosis on TK and Carrier units.
                            A weak battery causes false sensor readings and false alarm codes on microprocessor controlled units.
                          </p>
                        </div>

                        {/* Most likely causes */}
                        {causes.length > 0 && (
                          <div className="px-4 py-3" style={{ borderTop: '1px solid #1e3040' }}>
                            <p className="text-xs uppercase tracking-widest mb-2" style={{ color: HD_ORANGE }}>Most Likely Causes</p>
                            <ol className="space-y-1">
                              {causes.map((c, i) => (
                                <li key={i} className="flex gap-2 text-sm" style={{ color: 'rgba(255,255,255,0.8)' }}>
                                  <span className="font-bold flex-shrink-0" style={{ color: HD_ORANGE }}>{i + 1}.</span>
                                  {c}
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}

                        {/* Diagnostic steps */}
                        {steps.length > 0 && (
                          <div className="px-4 py-3" style={{ borderTop: '1px solid #1e3040' }}>
                            <p className="text-xs uppercase tracking-widest mb-2" style={{ color: HD_BLUE }}>Diagnostic Steps</p>
                            <ol className="space-y-2">
                              {steps.map((step, i) => (
                                <li key={i} className="flex gap-2 text-sm" style={{ color: 'rgba(255,255,255,0.82)' }}>
                                  <span
                                    className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5"
                                    style={{ background: '#1e3040', color: HD_BLUE }}
                                  >
                                    {i + 1}
                                  </span>
                                  {step}
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}

                        {/* Common fix */}
                        {r.common_fix && (
                          <div className="px-4 py-3" style={{ background: '#162030', borderTop: '1px solid #1e3040' }}>
                            <p className="text-xs uppercase tracking-widest mb-1" style={{ color: '#22C55E' }}>Common Fix</p>
                            <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.85)' }}>{r.common_fix}</p>
                          </div>
                        )}

                        {/* Parts needed */}
                        {r.parts_needed && r.parts_needed !== 'None' && (
                          <div className="px-4 py-3" style={{ borderTop: '1px solid #1e3040' }}>
                            <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'rgba(255,255,255,0.4)' }}>Parts Needed</p>
                            <div className="flex flex-wrap gap-1.5">
                              {r.parts_needed.split(',').map(p => p.trim()).filter(Boolean).map((p, i) => (
                                <span key={i} className="text-xs px-2.5 py-1 rounded-full" style={{ background: '#1e3040', color: 'rgba(255,255,255,0.7)' }}>
                                  {p}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Wiring reference */}
                        {r.wiring_reference && (
                          <div className="px-4 py-3" style={{ borderTop: '1px solid #1e3040' }}>
                            <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.35)' }}>Wiring Reference</p>
                            <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)' }}>{r.wiring_reference}</p>
                          </div>
                        )}

                        {/* Field notes */}
                        {r.field_notes && (
                          <div className="px-4 py-3" style={{ background: '#0d1820', borderTop: '1px solid #1e3040' }}>
                            <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.35)' }}>Field Notes</p>
                            <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>{r.field_notes}</p>
                          </div>
                        )}

                        {/* Labor estimate */}
                        {(r.book_time != null || r.mobile_time != null) && (
                          <div className="px-4 py-2.5 flex items-center gap-4" style={{ background: '#162030', borderTop: '1px solid #1e3040' }}>
                            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={1.5} viewBox="0 0 24 24">
                              <circle cx="12" cy="12" r="10" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" />
                            </svg>
                            {r.book_time != null && (
                              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                                <span className="font-semibold" style={{ color: 'rgba(255,255,255,0.5)' }}>Book: </span>
                                {r.book_time}h
                              </p>
                            )}
                            {r.mobile_time != null && (
                              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                                <span className="font-semibold" style={{ color: 'rgba(255,255,255,0.5)' }}>Mobile: </span>
                                {r.mobile_time}h
                              </p>
                            )}
                          </div>
                        )}

                      </div>
                    )
                  })}

                  <p className="text-xs text-center" style={{ color: 'rgba(255,255,255,0.2)' }}>
                    Field-verified data · Battery load test required before all diagnoses
                  </p>
                </div>
              )}
            </div>

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

                  {/* ── Gauge Diagnostic Engine ── */}
                  {gaugeDiag && (
                    <div className="space-y-3">

                      {/* Danger alert — discharge > 400 PSI */}
                      {gaugeDiag.dangerAlert && (
                        <div className="rounded-lg p-4 flex gap-3 items-start" style={{ background: '#1a0000', border: '2px solid #EF4444' }}>
                          <span style={{ fontSize: 20, lineHeight: 1.2, flexShrink: 0 }}>⛔</span>
                          <div>
                            <p className="text-sm font-bold mb-1" style={{ color: '#EF4444' }}>DANGER — DISCHARGE CRITICALLY HIGH (&gt;400 PSI)</p>
                            <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.75)' }}>
                              Shut unit off immediately. Do not disconnect fittings or open any valves until discharge pressure drops below 250 PSI.
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Pattern result card — diagPattern and diagSev are pre-extracted above */}
                      {diagPattern && diagSev && (
                        <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${diagSev.border}` }}>

                          {/* Header */}
                          <div className="px-4 pt-4 pb-3" style={{ background: '#162030' }}>
                            <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
                              Pressure Pattern
                            </p>
                            <p className="font-bold text-white text-base leading-tight mb-3">
                              {diagPattern.patternLabel}
                            </p>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-bold px-3 py-1 rounded-full"
                                style={{ background: diagSev.color + '25', color: diagSev.color, border: `1px solid ${diagSev.color}50` }}>
                                {diagSev.label.toUpperCase()}
                              </span>
                              {diagPattern.recoveryRequired && (
                                <span className="text-xs px-2.5 py-1 rounded-full"
                                  style={{ background: '#F59E0B18', color: '#F59E0B', border: '1px solid #F59E0B40' }}>
                                  Recovery Required
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Most likely causes */}
                          <div className="px-4 py-4" style={{ background: '#111920', borderTop: '1px solid #1e3040' }}>
                            <p className="text-xs uppercase tracking-widest mb-3" style={{ color: 'rgba(255,255,255,0.35)' }}>
                              Most Likely Causes — Ranked by Probability
                            </p>
                            <ol className="space-y-2">
                              {diagPattern.causes.map((cause, i) => (
                                <li key={i} className="flex gap-3 text-sm leading-snug">
                                  <span className="w-5 h-5 rounded flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5"
                                    style={{
                                      background: i === 0 ? HD_ORANGE + '25' : '#1e3040',
                                      color:      i === 0 ? HD_ORANGE        : 'rgba(255,255,255,0.35)',
                                    }}>
                                    {i + 1}
                                  </span>
                                  <span style={{ color: i === 0 ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.6)' }}>
                                    {stripListNumber(cause)}
                                  </span>
                                </li>
                              ))}
                            </ol>
                          </div>

                          {/* Field verification */}
                          <div className="px-4 py-4" style={{ background: '#111920', borderTop: '1px solid #1e3040' }}>
                            <p className="text-xs uppercase tracking-widest mb-3" style={{ color: 'rgba(255,255,255,0.35)' }}>
                              Field Verification
                            </p>
                            <ul className="space-y-2">
                              {diagPattern.fieldVerification.map((step, i) => (
                                <li key={i} className="flex gap-2 text-sm leading-snug" style={{ color: 'rgba(255,255,255,0.75)' }}>
                                  <span className="flex-shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full" style={{ background: HD_BLUE }} />
                                  {step}
                                </li>
                              ))}
                            </ul>
                          </div>

                          {/* Recommended action */}
                          <div className="px-4 py-4" style={{ background: '#111920', borderTop: '1px solid #1e3040' }}>
                            <p className="text-xs uppercase tracking-widest mb-3" style={{ color: 'rgba(255,255,255,0.35)' }}>
                              Recommended Action
                            </p>
                            <ol className="space-y-2">
                              {diagPattern.recommendedAction.map((step, i) => (
                                <li key={i} className="flex gap-3 text-sm leading-snug" style={{ color: 'rgba(255,255,255,0.82)' }}>
                                  <span className="font-bold flex-shrink-0 mt-0.5" style={{ color: HD_ORANGE, minWidth: '1.1rem' }}>{i + 1}.</span>
                                  {stripListNumber(step)}
                                </li>
                              ))}
                            </ol>
                          </div>

                          {/* Refrigerant note */}
                          {(diagPattern.refrigerantNote || calcRefrigerant === 'R-452A') && (
                            <div className="px-4 py-3" style={{ background: '#0f1a12', borderTop: '1px solid #1e3040' }}>
                              {diagPattern.refrigerantNote && (
                                <p className="text-xs leading-relaxed mb-1.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
                                  <span className="font-bold" style={{ color: '#22C55E' }}>Refrigerant Note: </span>
                                  {diagPattern.refrigerantNote}
                                </p>
                              )}
                              {calcRefrigerant === 'R-452A' && (
                                <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.6)' }}>
                                  <span className="font-bold" style={{ color: '#F59E0B' }}>R-452A: </span>
                                  Never top off after a leak — fractionation changes the blend ratio. Full recovery and recharge to nameplate weight required.
                                </p>
                              )}
                            </div>
                          )}

                          {/* Labor estimate */}
                          <div className="px-4 py-3 flex items-center gap-2" style={{ background: '#162030', borderTop: '1px solid #1e3040' }}>
                            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={1.5} viewBox="0 0 24 24">
                              <circle cx="12" cy="12" r="10" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" />
                            </svg>
                            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                              <span className="font-semibold" style={{ color: 'rgba(255,255,255,0.5)' }}>Labor estimate: </span>
                              {diagPattern.laborEstimate}
                            </p>
                          </div>

                        </div>
                      )}

                      <p className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
                        Diagnostic guidance only. Verify all readings with calibrated instruments before performing repairs.
                      </p>
                    </div>
                  )}

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

            {/* ── Guided Diagnostics ── */}
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>
              <div className="px-5 py-3" style={{ background: '#0d1820', borderBottom: '1px solid #1e3040' }}>
                <p className="text-xs uppercase tracking-widest font-bold" style={{ color: 'rgba(255,255,255,0.35)' }}>
                  Guided Diagnostics
                </p>
              </div>
              <div className="p-3" style={{ background: '#111920' }}>
                <a
                  href="/hd/quickwrench/guided?alarm=25"
                  className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-colors"
                  style={{
                    background: '#162030',
                    border:     '1px solid #1e3040',
                    color:      'rgba(255,255,255,0.8)',
                    minHeight:  48,
                    textDecoration: 'none',
                  }}
                >
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded"
                    style={{ background: HD_ORANGE + '20', color: HD_ORANGE, fontFamily: 'monospace', border: `1px solid ${HD_ORANGE}40` }}
                  >
                    CODE 25
                  </span>
                  <span>Guided Diagnostic — Alternator Check</span>
                  <svg className="w-4 h-4 ml-auto flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </a>
              </div>
            </div>

            {/* ── Reefer query form ── */}
            <form onSubmit={handleSubmit} className="rounded-xl p-6 space-y-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    Manufacturer
                  </label>
                  <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid #1e3040' }}>
                    {(['Thermo King', 'Carrier Transicold'] as Manufacturer[]).map(m => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => { setManufacturer(m); setModel(''); setIdentifiedModel(null); setIdentifiedRefrigerant(null) }}
                        className="flex-1 text-xs font-semibold transition-colors"
                        style={{
                          background: manufacturer === m ? HD_ORANGE : '#162030',
                          color:      manufacturer === m ? '#fff' : 'rgba(255,255,255,0.4)',
                          minHeight: 44,
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
                        className="flex-1 text-xs font-semibold transition-colors capitalize"
                        style={{
                          background: unitType === t ? HD_BLUE : '#162030',
                          color:      unitType === t ? '#fff' : 'rgba(255,255,255,0.4)',
                          minHeight: 44,
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
                  {model && !modelInGroups && (
                    <option value={model}>{model} (identified)</option>
                  )}
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
                  onBlur={lookupUnit}
                  placeholder="Unit serial number"
                  className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20"
                  style={{ background: '#162030', border: '1px solid #1e3040' }}
                />
              </div>

              {/* ── Unit identification (optional) — BM (TK) / Model number (Carrier) ── */}
              {manufacturer === 'Thermo King' ? (
                <div>
                  <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    BM Number <span style={{ color: 'rgba(255,255,255,0.25)' }}>(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={bmNumber}
                    onChange={e => setBmNumber(e.target.value)}
                    onBlur={lookupUnit}
                    placeholder="e.g. 953xxx — identifies the unit model"
                    className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20"
                    style={{ background: '#162030', border: '1px solid #1e3040' }}
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    Model Number <span style={{ color: 'rgba(255,255,255,0.25)' }}>(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={modelNumber}
                    onChange={e => setModelNumber(e.target.value)}
                    onBlur={lookupUnit}
                    placeholder="Build / model number — identifies the unit model"
                    className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20"
                    style={{ background: '#162030', border: '1px solid #1e3040' }}
                  />
                </div>
              )}

              {/* Green "unit identified" banner, sourced from the global BM map */}
              {identifiedModel && (
                <div className="rounded-lg px-4 py-3 flex items-center gap-2" style={{ background: '#0f2f1c', border: '1px solid #1c5c34' }}>
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#34D399' }} />
                  <p className="text-sm font-medium" style={{ color: '#34D399' }}>
                    Unit identified — {identifiedModel}{identifiedRefrigerant ? `, ${identifiedRefrigerant}` : ''}
                  </p>
                </div>
              )}
              {unitLookupLoading && (
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>Looking up unit…</p>
              )}

              {/* Engine hours + notes (optional) — saved to the tech's private profile */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    Engine Hours <span style={{ color: 'rgba(255,255,255,0.25)' }}>(optional)</span>
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={engineHours}
                    onChange={e => setEngineHours(e.target.value)}
                    placeholder="e.g. 12450"
                    className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20"
                    style={{ background: '#162030', border: '1px solid #1e3040' }}
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    Unit Notes <span style={{ color: 'rgba(255,255,255,0.25)' }}>(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={profileNotes}
                    onChange={e => setProfileNotes(e.target.value)}
                    placeholder="Private notes for this unit"
                    className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20"
                    style={{ background: '#162030', border: '1px solid #1e3040' }}
                  />
                </div>
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
                  Unit Display Message
                </label>
                <input
                  type="text"
                  value={displayMessage}
                  onChange={e => setDisplayMessage(e.target.value)}
                  placeholder="Enter exactly what your unit display shows"
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
                codeStatus={codeStatus}
              />
            )}

            {analysis !== null && <VisualReference buttons={reeferVisualButtons} />}

            {analysis !== null && (
              <PartsManager
                loading={partsLoading}
                error={partsError}
                result={partsResult}
                onRun={runReeferPartsManager}
                onClear={clearParts}
              />
            )}

            {analysis !== null && (
              <button
                type="button"
                onClick={() => setShowDelivery(true)}
                className="w-full py-3 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-2"
                style={{ background: '#15803d', minHeight: 48 }}
              >
                <span>🚚</span> Get Parts Delivered
              </button>
            )}

            {analysis !== null && (
              <SuggestedRepairs
                loading={repairLoading}
                items={repairItems}
                selectedIds={selectedRepairIds}
                onToggle={toggleRepair}
              />
            )}

            {analysis !== null && (
              <div className="space-y-2.5">
                <label className="flex items-center gap-2 text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  <input
                    type="checkbox"
                    checked={includeDiagFee}
                    onChange={e => setIncludeDiagFee(e.target.checked)}
                    className="w-3.5 h-3.5"
                    style={{ accentColor: '#16a34a' }}
                  />
                  Include Diagnostic Fee
                </label>
                <button
                  type="button"
                  onClick={pushReeferToQuote}
                  className="w-full py-3 rounded-lg text-sm font-semibold text-white transition-colors"
                  style={{ background: '#16a34a', minHeight: 48 }}
                >
                  Create Quote
                </button>
              </div>
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

              {/* VIN decode (optional) — auto-populates year/make/model/engine */}
              <div>
                <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  VIN <span style={{ color: 'rgba(255,255,255,0.25)' }}>(optional — auto-decodes vehicle info)</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={vin}
                    onChange={e => { setVin(e.target.value.toUpperCase()); setVinError(null) }}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); decodeVin() } }}
                    maxLength={17}
                    placeholder="17-character VIN"
                    className="flex-1 min-w-0 px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20 font-mono tracking-widest uppercase"
                    style={{ background: '#162030', border: '1px solid #1e3040' }}
                  />
                  <button
                    type="button"
                    onClick={decodeVin}
                    disabled={vinLoading || vin.trim().length !== 17}
                    className="px-4 py-2.5 rounded-lg text-sm font-bold text-white whitespace-nowrap transition-opacity"
                    style={{ background: HD_BLUE, opacity: vinLoading || vin.trim().length !== 17 ? 0.5 : 1 }}
                  >
                    {vinLoading ? 'Decoding…' : 'Decode'}
                  </button>
                </div>
                {vinError && (
                  <p className="text-xs mt-1.5" style={{ color: '#F59E0B' }}>{vinError}</p>
                )}
                {vinDecoded && !vinError && (
                  <p className="text-xs mt-1.5" style={{ color: '#22C55E' }}>✓ {vinDecoded} — confirm or edit below before running.</p>
                )}
              </div>

              {/* Vehicle — Year / Make / Model / Engine (editable; override decoded values) */}
              <div>
                <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  Vehicle <span style={{ color: 'rgba(255,255,255,0.25)' }}>(year, make, model — for vehicle-specific results)</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <input
                    type="text"
                    value={vehicleYear}
                    onChange={e => setVehicleYear(e.target.value)}
                    placeholder="Year — e.g. 2020"
                    className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20"
                    style={{ background: '#162030', border: '1px solid #1e3040' }}
                  />
                  <input
                    type="text"
                    value={vehicleMake}
                    onChange={e => setVehicleMake(e.target.value)}
                    placeholder="Make — e.g. Freightliner"
                    className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20"
                    style={{ background: '#162030', border: '1px solid #1e3040' }}
                  />
                  <input
                    type="text"
                    value={vehicleModel}
                    onChange={e => setVehicleModel(e.target.value)}
                    placeholder="Model — e.g. Cascadia"
                    className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20"
                    style={{ background: '#162030', border: '1px solid #1e3040' }}
                  />
                  <input
                    type="text"
                    value={vehicleEngine}
                    onChange={e => setVehicleEngine(e.target.value)}
                    placeholder="Engine — e.g. 12.8L"
                    className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20"
                    style={{ background: '#162030', border: '1px solid #1e3040' }}
                  />
                </div>
              </div>

              {/* Engine Brand */}
              <div>
                <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  Engine Brand
                </label>
                <div className="grid grid-cols-3 rounded-lg overflow-hidden" style={{ border: '1px solid #1e3040' }}>
                  {(Object.keys(ENGINE_MODELS) as EngineBrand[]).map(b => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => { setTruckBrand(b); setEngineModel('') }}
                      className="text-xs font-semibold transition-colors px-1 leading-tight"
                      style={{
                        background: truckBrand === b ? HD_ORANGE : '#162030',
                        color:      truckBrand === b ? '#fff' : 'rgba(255,255,255,0.4)',
                        minHeight: 44,
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

            {truckAnalysis !== null && <VisualReference buttons={truckVisualButtons} />}

            {truckAnalysis !== null && (
              <PartsManager
                loading={partsLoading}
                error={partsError}
                result={partsResult}
                onRun={runTruckPartsManager}
                onClear={clearParts}
              />
            )}

            {truckAnalysis !== null && (
              <button
                type="button"
                onClick={() => setShowDelivery(true)}
                className="w-full py-3 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-2"
                style={{ background: '#15803d', minHeight: 48 }}
              >
                <span>🚚</span> Get Parts Delivered
              </button>
            )}

            {truckAnalysis !== null && (
              <SuggestedRepairs
                loading={repairLoading}
                items={repairItems}
                selectedIds={selectedRepairIds}
                onToggle={toggleRepair}
              />
            )}

            {truckAnalysis !== null && (
              <div className="space-y-2.5">
                <label className="flex items-center gap-2 text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  <input
                    type="checkbox"
                    checked={includeDiagFee}
                    onChange={e => setIncludeDiagFee(e.target.checked)}
                    className="w-3.5 h-3.5"
                    style={{ accentColor: '#16a34a' }}
                  />
                  Include Diagnostic Fee
                </label>
                <button
                  type="button"
                  onClick={pushTruckToQuote}
                  className="w-full py-3 rounded-lg text-sm font-semibold text-white transition-colors"
                  style={{ background: '#16a34a', minHeight: 48 }}
                >
                  Create Quote
                </button>
              </div>
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

        {/* ══════════════════════════════════════════════════════════════════════
            ELECTRICAL SYSTEMS TAB
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'electrical' && (
          <>
            {/* Topic selector */}
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>
              <div className="px-5 py-3" style={{ background: '#0d1820', borderBottom: '1px solid #1e3040' }}>
                <p className="text-xs uppercase tracking-widest font-bold" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  Select Topic
                </p>
              </div>
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-2" style={{ background: '#111920' }}>
                {ELECTRICAL_TOPICS.map(t => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setElecTopic(t.key)}
                    className="text-left px-4 py-3 rounded-lg transition-colors"
                    style={elecTopic === t.key
                      ? { background: `${HD_ORANGE}20`, border: `1px solid ${HD_ORANGE}60`, minHeight: 44 }
                      : { background: '#0d1820',         border: '1px solid #1e3040',         minHeight: 44 }
                    }
                  >
                    <p
                      className="text-sm font-semibold leading-tight"
                      style={{ color: elecTopic === t.key ? HD_ORANGE : 'rgba(255,255,255,0.75)' }}
                    >
                      {t.key}
                    </p>
                    <p className="text-xs mt-0.5 leading-snug" style={{ color: 'rgba(255,255,255,0.35)' }}>
                      {t.desc}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Question form */}
            <form
              onSubmit={handleElecSubmit}
              className="rounded-xl p-6 space-y-5"
              style={{ background: '#111920', border: '1px solid #1e3040' }}
            >
              <div>
                <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  {elecTopic === 'Component Library'  && 'Which component do you need to understand or test?'}
                  {elecTopic === 'Schematic Reading'  && 'What do you need help reading or understanding?'}
                  {elecTopic === 'Fault Tracing'      && 'Describe the fault — what is not working and what you have checked so far'}
                  {elecTopic === 'Multimeter Guide'   && 'What do you need to test and what meter function are you unsure about?'}
                  {elecTopic === 'Wire Repair'        && 'Describe the wire or connector damage that needs repair'}
                </label>
                <textarea
                  value={elecQuestion}
                  onChange={e => setElecQuestion(e.target.value)}
                  rows={4}
                  placeholder={
                    elecTopic === 'Component Library' ? 'e.g. How does a relay work and how do I test one with a multimeter?' :
                    elecTopic === 'Schematic Reading' ? 'e.g. How do I trace the power feed for a circuit from the fuse panel to the load?' :
                    elecTopic === 'Fault Tracing'     ? 'e.g. ABS light on, sensor resistance checks good, but fault code keeps coming back when I wiggle the harness...' :
                    elecTopic === 'Multimeter Guide'  ? 'e.g. How do I perform a voltage drop test on a ground strap?' :
                    'e.g. Wire chafed through at a grommet — what is the proper way to repair it?'
                  }
                  className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20 resize-none"
                  style={{ background: '#162030', border: '1px solid #1e3040' }}
                />
              </div>

              <button
                type="submit"
                disabled={elecLoading || !elecQuestion.trim()}
                className="w-full py-3 rounded-xl font-bold text-white text-sm transition-opacity"
                style={{ background: HD_ORANGE, opacity: elecLoading || !elecQuestion.trim() ? 0.5 : 1 }}
              >
                {elecLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {elecLoadingMsg}
                  </span>
                ) : `Ask HD QuickWrench — ${elecTopic}`}
              </button>
            </form>

            {elecError && (
              <div className="rounded-xl p-4" style={{ background: '#2d0a0a', border: '1px solid #7f1d1d' }}>
                <p className="text-sm text-red-400">{elecError}</p>
              </div>
            )}

            {elecAnalysis !== null && (
              <AnalysisCard
                parsedSections={elecParsedSections}
                analysis={elecAnalysis}
                disclaimer={null}
                primaryTkSource={null}
                alarmPattern={null}
                tkSources={[]}
              />
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            PROCEDURES TAB
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'procedures' && (
          <ProceduresPanel />
        )}

        {activeTab === 'parts' && (
          <PartsReferencePanel />
        )}

      </div>

      {showDelivery && (
        <PartsOnTheWay
          suite="hd"
          parts={extractHDParts(partsResult)}
          vehicleInfo={{
            unitManufacturer: manufacturer,
            unitModel:        model,
          }}
          techPhone=""
          onClose={() => setShowDelivery(false)}
          onDeliveryDispatched={() => { /* tech sees tracking in-modal */ }}
        />
      )}
    </main>
  )
}

// ─── Procedures Panel ─────────────────────────────────────────────────────────

const PROCEDURE_CARDS = [
  {
    id: 'pump-down',
    name: 'Compressor Pump Down',
    category: 'Refrigeration',
    appliesTo: 'TK and Carrier — reciprocating compressors only',
    labor: '0.50 hr',
    safetyWarnings: [
      'NEVER run a scroll compressor with the suction service valve front seated — this WILL damage the scroll compressor.',
      'ALWAYS fully recover all refrigerant before opening a system with a scroll compressor.',
      'Disconnect HPCO to prevent remote start. Battery stays connected for testing.',
      'Set temperature setpoint to 0°F before beginning.',
    ],
    prerequisites: 'Set setpoint to 0°F. Verify refrigerant level is adequate before starting — a low system gives inaccurate results.',
    steps: [
      'Attach gauges.',
      'Run unit minimum 20 minutes to boil all refrigerant out of compressor oil.',
      'Disconnect both unloader valves at top of both compressor heads.',
      'With unit RUNNING fully front seat LOW SIDE (SUCTION) service valve ONLY. DO NOT front seat HIGH SIDE (DISCHARGE) service valve while unit is running.',
      'Once low side pulls into slight vacuum shut unit down.',
      'Fully front seat discharge side to isolate compressor from rest of unit.',
      'Open both valves — residual gas from high side brings low side out of vacuum and keeps non-condensables from being sucked into system.',
      'Always recover any residual into approved vessel before opening system to atmosphere.',
    ],
    notes: 'Run and check unit. Perform full pre-trip. Confirm no active codes. Return unit to service.',
  },
  {
    id: 'low-side-pump-down',
    name: 'Low Side Pump Down',
    category: 'Refrigeration',
    appliesTo: 'TK and Carrier — all systems',
    labor: '0.50 hr',
    safetyWarnings: [
      'NEVER run a scroll compressor with the suction service valve front seated.',
      'ALWAYS fully recover all refrigerant before opening a scroll system.',
      'Disconnect HPCO to prevent remote start.',
      'A 4-port manifold gauge set is essential for this procedure.',
      'Set temperature setpoint to 0°F before beginning.',
    ],
    prerequisites: 'Set setpoint to 0°F. Check and record static pressure and ambient temperature. Verify system has adequate refrigerant charge.',
    steps: [
      'Attach manifold gauges. Run unit minimum 20 minutes to boil all refrigerant from compressor oil.',
      'Remove service cap — TK at receiver tank, Carrier at king valve. Attach hose from that port to manifold gauge set.',
      'With unit still running, front seat receiver tank service valve (TK) or king valve (Carrier) and pump low side into vacuum. Target: 0 to -30 on suction gauge.',
      'Shut unit off when pumped down.',
      'Fully front seat high side (discharge) to isolate system from low side.',
      'Watch suction gauge for 2 minutes. Holds vacuum = no leak. Rises to 0 = low side leak. Rises ABOVE 0 = high-to-low side leak — valve plates or reed valves.',
      'To confirm: open discharge side while suction still seated, restart unit, pump suction back to vacuum, shut off, seat discharge. If it climbs again — confirmed internal leak.',
      'Once confirmed holding vacuum — open discharge to suction and equalize pressures.',
      'Recover any pressure above 0 into approved vessel. Keep all refrigerants out of atmosphere.',
      'RETURN TO SERVICE — back seat discharge valve 3 to 1/4 turns — open both service valves to running position.',
      'Back seat receiver tank valve. Remove yellow hose, attach to manifold gauge body. Open discharge and suction manifold knobs to pull discharge gas to low side to reduce refrigerant loss. Back seat suction side. Remove all hoses.',
    ],
    notes: 'What you can do during low side pump down — expansion valve replacement, evaporator, pan heater bar, solenoids or valves on the low side that do NOT tap into discharge side. Run and check unit. Perform full pre-trip. Confirm no active codes. Return unit to service.',
  },
  {
    id: 'refrigerant-level',
    name: 'Quick Refrigerant Level Check',
    category: 'Refrigeration',
    appliesTo: 'TK and Carrier — all systems',
    labor: '0.75 hr',
    safetyWarnings: [
      'Disconnect HPCO to prevent remote start.',
      'All refrigerant work must be performed by EPA 608 certified technicians only.',
      'Never use liquid leak detection spray — use electronic leak detector or UV dye only.',
      'Running undercharged OR overcharged system causes damage.',
      'Set temperature setpoint to 0°F before beginning.',
    ],
    prerequisites: 'Identify refrigerant type before hooking up. 2022+ TK or Carrier = almost certainly R-452A. Pre-2022 = likely R-404A. Older truck = R-134A. Very old = R-22 (reclaimed only). Use correct PT chart for YOUR refrigerant.',
    steps: [
      'Attach manifold gauges to unit service valves — suction side and discharge side.',
      'Check and record static pressure — suction and discharge equalized (unit off).',
      'Start unit and run High Speed Cool for minimum 20 minutes to stabilize. Low ambient: cover condenser to replicate 100°F ambient. Use refrigerant PT chart for target pressures.',
      'Suction pressure should be near appropriate pressure for 0°F box temperature per PT chart.',
      'Sight glass check — refrigerant should be clear. Ball should float at top of sight glass. Continuous bubbling = low charge. Empty sight glass = significantly low or empty system.',
      'If low, add slowly to suction side only. Add no more than 30 PSI above actual running suction pressure at a time. Stop when ball floats and sight glass clears.',
      'Always check refrigerant level before returning any unit to service after any refrigeration repair.',
    ],
    notes: 'PT Reference: R-404A suction ~18-22 PSI / discharge ~225-275 PSI at 95°F. R-452A suction ~16-20 PSI / discharge ~210-260 PSI. R-134A suction ~10-15 PSI / discharge ~150-200 PSI. R-22 suction ~18-22 PSI / discharge ~200-250 PSI. Always use manufacturer PT chart for exact specs.',
  },
  {
    id: 'capacity-test',
    name: 'Compressor Capacity Test',
    category: 'Refrigeration',
    appliesTo: 'TK and Carrier — reciprocating compressors only',
    labor: '0.25 hr',
    safetyWarnings: [
      'Disconnect HPCO to prevent remote start.',
      'All refrigerant work must be performed by EPA 608 certified technicians only.',
      'NEVER run a scroll compressor with suction service valve front seated.',
      'Set temperature setpoint to 0°F before beginning.',
    ],
    prerequisites: 'Three prerequisites MUST be confirmed first: (1) Engine RPMs dialed in — wrong RPM gives wrong results. (2) Refrigerant level confirmed full — run Quick Refrigerant Level Check first. (3) Low Side Pump Down completed — confirm no internal leaks before capacity test.',
    steps: [
      'Attach manifold gauges to suction and discharge service valves.',
      'Start unit in High Speed Cool. Cover condenser and build discharge to target — R-404A and R-452A: 350 PSI, R-134A: 250 PSI. Cover condenser to replicate 100°F ambient if needed.',
      'With condenser still covered and discharge holding at target, front seat low side (suction) service valve to begin pumping down.',
      'Pump compressor down to -10 inches of vacuum on suction side.',
      'Record discharge pressure at the moment suction hits -10 vacuum.',
      'Read results — R-134A should read 250 PSI discharge at -10 suction. R-404A and R-452A should read 200-250 PSI or higher discharge at -10 suction. Below spec = failed or failing compressor.',
      'Back seat suction service valve. Follow Low Side Pump Down gauge removal steps to properly remove gauges and minimize refrigerant loss.',
    ],
    notes: 'A failing compressor may still cool but takes significantly longer and will eventually fail completely. Express repairs with urgency. DOCUMENT TEST RESULTS ON THE INVOICE — record discharge pressure at -10 vacuum and note against spec. This is your proof of condition and protects you legally if customer declines repair and unit fails later. Run and check unit. Perform full pre-trip. Confirm no active codes. Return unit to service.',
  },
]

function ProceduresPanel() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = PROCEDURE_CARDS.find(p => p.id === selectedId) ?? null

  if (selected) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setSelectedId(null)}
          className="flex items-center gap-2 text-sm font-semibold"
          style={{ color: 'rgba(255,255,255,0.55)' }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Procedures
        </button>

        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>
          <div className="px-5 py-4" style={{ background: '#162030' }}>
            <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.35)' }}>
              {selected.category} · {selected.appliesTo}
            </p>
            <h2 className="font-condensed font-bold text-xl text-white tracking-wide">{selected.name}</h2>
            <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.35)' }}>Labor: {selected.labor}</p>
          </div>

          <div className="p-5 space-y-5" style={{ background: '#111920' }}>
            {/* Safety warnings */}
            <div className="rounded-lg p-4" style={{ background: '#1a0a00', border: '1px solid #F59E0B40' }}>
              <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: '#F59E0B' }}>⚠ Safety Requirements</p>
              <ul className="space-y-1.5">
                {selected.safetyWarnings.map((w, i) => (
                  <li key={i} className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.75)' }}>
                    • {w}
                  </li>
                ))}
              </ul>
            </div>

            {/* Prerequisites */}
            <div>
              <p className="text-xs uppercase tracking-widest mb-2" style={{ color: HD_ORANGE }}>Prerequisites</p>
              <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.8)' }}>{selected.prerequisites}</p>
            </div>

            {/* Steps */}
            <div>
              <p className="text-xs uppercase tracking-widest mb-3" style={{ color: HD_BLUE }}>Steps</p>
              <ol className="space-y-3">
                {selected.steps.map((step, i) => (
                  <li key={i} className="flex gap-3">
                    <span
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5"
                      style={{ background: '#1e3040', color: HD_BLUE }}
                    >
                      {i + 1}
                    </span>
                    <p className="text-sm leading-relaxed pt-0.5" style={{ color: 'rgba(255,255,255,0.85)' }}>{stripListNumber(step)}</p>
                  </li>
                ))}
              </ol>
            </div>

            {/* Notes */}
            {selected.notes && (
              <div className="rounded-lg p-4" style={{ background: '#162030' }}>
                <p className="text-xs uppercase tracking-widest mb-1.5" style={{ color: '#22C55E' }}>Field Notes / Closeout</p>
                <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.75)' }}>{selected.notes}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.35)' }}>
          Field-Verified · 17-Year Reefer Tech
        </p>
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
          Standard refrigeration procedures. Tap any card for full step-by-step walkthrough.
        </p>
      </div>


      <div className="space-y-3">
        {PROCEDURE_CARDS.map(proc => (
          <button
            key={proc.id}
            type="button"
            onClick={() => setSelectedId(proc.id)}
            className="w-full rounded-xl p-4 text-left transition-opacity active:opacity-70"
            style={{ background: '#111920', border: '1px solid #1e3040' }}
          >
            <div className="flex items-start gap-3">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: '#162030' }}
              >
                <svg className="w-5 h-5" fill="none" stroke={HD_BLUE} strokeWidth={1.8} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-condensed font-bold text-white text-base leading-tight">{proc.name}</p>
                <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  {proc.category} · {proc.appliesTo} · {proc.labor}
                </p>
                <p className="text-xs mt-1.5 font-medium" style={{ color: '#F59E0B' }}>
                  {proc.steps.length} steps
                </p>
              </div>
              <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        ))}
      </div>

      <p className="text-xs text-center" style={{ color: 'rgba(255,255,255,0.2)' }}>
        Field-verified procedures · EPA 608 certification required for all refrigerant work
      </p>
    </div>
  )
}

// ─── Parts Reference Panel ────────────────────────────────────────────────────

interface PartsRefEntry {
  id:              string
  manufacturer:    string
  unit_family:     string | null
  part_category:   string
  part_function:   string
  oem_part_number: string | null
  baldwin:         string | null
  napa_gold:       string | null
  luber_finer:     string | null
  donaldson:       string | null
  fleetguard:      string | null
  wix:             string | null
  dayco:           string | null
  continental:     string | null
  gates:           string | null
  notes:           string | null
}

type PartsFilter = 'all' | 'Filter' | 'Belt' | 'Thermostat' | 'Note' | 'TK' | 'Carrier'

const CHIP_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  baldwin:     { label: 'Baldwin',     bg: '#1A6BAF25', color: '#60A5FA' },
  napa_gold:   { label: 'NAPA Gold',   bg: '#F59E0B25', color: '#F59E0B' },
  luber_finer: { label: 'Luber-finer', bg: '#22C55E25', color: '#4ADE80' },
  donaldson:   { label: 'Donaldson',   bg: '#E85D2425', color: '#FB923C' },
  fleetguard:  { label: 'Fleetguard',  bg: '#EF444425', color: '#F87171' },
  wix:         { label: 'WIX',         bg: '#8B5CF625', color: '#A78BFA' },
  dayco:       { label: 'Dayco',       bg: '#0EA5E925', color: '#38BDF8' },
  continental: { label: 'Continental', bg: '#6B728025', color: '#9CA3AF' },
  gates:       { label: 'Gates',       bg: '#1D4ED825', color: '#93C5FD' },
}

function PartsReferencePanel() {
  const [parts,   setParts]   = useState<PartsRefEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [search,  setSearch]  = useState('')
  const [filter,  setFilter]  = useState<PartsFilter>('all')

  useEffect(() => {
    fetch('/api/hd/parts-reference')
      .then(r => r.json())
      .then(data => { setParts(data.parts ?? []); setLoading(false) })
      .catch(() => { setError('Failed to load parts reference data.'); setLoading(false) })
  }, [])

  const q = search.toLowerCase().trim()

  const byFilter = parts.filter(p => {
    if (filter === 'Filter')     return p.part_category === 'Filter'
    if (filter === 'Belt')       return p.part_category === 'Belt' || p.part_category === 'Stocking Note'
    if (filter === 'Thermostat') return p.part_category === 'Thermostat'
    if (filter === 'Note')       return p.part_category === 'Stocking Note' || p.part_category === 'Hardware'
    if (filter === 'TK')         return p.manufacturer === 'TK'
    if (filter === 'Carrier')    return p.manufacturer === 'Carrier' || p.manufacturer === 'Both'
    return true
  })

  const filtered = byFilter.filter(p => {
    if (!q) return true
    return [
      p.manufacturer, p.unit_family, p.part_category, p.part_function,
      p.oem_part_number, p.baldwin, p.napa_gold, p.luber_finer,
      p.donaldson, p.fleetguard, p.wix, p.dayco, p.continental, p.gates, p.notes,
    ].some(v => v?.toLowerCase().includes(q))
  })

  const stockingNotes = filtered.filter(p => p.part_category === 'Stocking Note' || p.part_category === 'Hardware')
  const regularParts  = filtered.filter(p => p.part_category !== 'Stocking Note' && p.part_category !== 'Hardware')
  const showNotesAtTop = (filter === 'all' || filter === 'Belt') && stockingNotes.length > 0

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <svg className="w-6 h-6 animate-spin mx-auto mb-3" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke={HD_ORANGE} strokeWidth="4" />
            <path className="opacity-75" fill={HD_ORANGE} d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>Loading parts reference...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl p-4" style={{ background: '#2d0a0a', border: '1px solid #7f1d1d' }}>
        <p className="text-sm text-red-400">{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">

      <div>
        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.35)' }}>
          Field-Verified Cross-Reference
        </p>
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
          Find the right part number for whatever supplier is nearby.
        </p>
      </div>

      {/* Search bar */}
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by OEM part number, Baldwin, NAPA, Dayco, description, or unit model…"
        className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/20"
        style={{ background: '#111920', border: '1px solid #1e3040' }}
      />

      {/* Filter buttons */}
      <div className="flex flex-wrap gap-2">
        {([
          { key: 'all',        label: 'All'         },
          { key: 'Filter',     label: 'Filters'     },
          { key: 'Belt',       label: 'Belts'       },
          { key: 'Thermostat', label: 'Thermostats' },
          { key: 'Note',       label: 'Notes'       },
          { key: 'TK',         label: 'TK'          },
          { key: 'Carrier',    label: 'Carrier'     },
        ] as { key: PartsFilter; label: string }[]).map(f => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className="px-4 py-2 rounded-lg text-xs font-semibold transition-colors"
            style={filter === f.key
              ? { background: HD_ORANGE, color: '#fff' }
              : { background: '#111920', color: 'rgba(255,255,255,0.45)', border: '1px solid #1e3040' }
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Stocking notes at top (All and Belts filters) */}
      {showNotesAtTop && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-widest" style={{ color: HD_ORANGE }}>
            Stocking Notes
          </p>
          {stockingNotes.map(note => (
            <div
              key={note.id}
              className="rounded-xl p-4"
              style={{ background: '#1a0a00', border: `1px solid ${HD_ORANGE}40` }}
            >
              <div className="flex items-start gap-2 mb-2">
                <span style={{ color: HD_ORANGE, fontSize: 15, lineHeight: '1.3', flexShrink: 0 }}>⚑</span>
                <p className="font-semibold text-sm leading-snug" style={{ color: HD_ORANGE }}>
                  {note.part_function}
                </p>
              </div>
              {note.notes && (
                <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.75)' }}>
                  {note.notes}
                </p>
              )}
              <div className="flex gap-2 mt-2 flex-wrap">
                <span className="text-xs px-2 py-0.5 rounded" style={{ background: '#162030', color: 'rgba(255,255,255,0.4)' }}>
                  {note.manufacturer === 'Both' ? 'TK + Carrier' : note.manufacturer}
                </span>
                {note.unit_family && note.unit_family !== 'ALL' && (
                  <span className="text-xs px-2 py-0.5 rounded" style={{ background: '#162030', color: 'rgba(255,255,255,0.4)' }}>
                    {note.unit_family}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Notes-only view (filter === Note) */}
      {filter === 'Note' && stockingNotes.length > 0 && (
        <div className="space-y-2">
          {stockingNotes.map(note => (
            <div
              key={note.id}
              className="rounded-xl p-4"
              style={{ background: '#1a0a00', border: `1px solid ${HD_ORANGE}40` }}
            >
              <p className="font-semibold text-sm mb-2" style={{ color: HD_ORANGE }}>
                {note.part_function}
              </p>
              {note.notes && (
                <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.75)' }}>
                  {note.notes}
                </p>
              )}
              <div className="flex gap-2 mt-2 flex-wrap">
                <span className="text-xs px-2 py-0.5 rounded" style={{ background: '#162030', color: 'rgba(255,255,255,0.4)' }}>
                  {note.manufacturer === 'Both' ? 'TK + Carrier' : note.manufacturer}
                </span>
                {note.unit_family && note.unit_family !== 'ALL' && (
                  <span className="text-xs px-2 py-0.5 rounded" style={{ background: '#162030', color: 'rgba(255,255,255,0.4)' }}>
                    {note.unit_family}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Regular parts cards */}
      {regularParts.length === 0 && !showNotesAtTop && filter !== 'Note' && (
        <p className="text-sm text-center py-8" style={{ color: 'rgba(255,255,255,0.3)' }}>
          No results. Try a different search or filter.
        </p>
      )}

      {regularParts.length > 0 && (
        <div className="space-y-3">
          {!q && filter === 'all' && (
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
              {regularParts.length} parts — search or filter to narrow results
            </p>
          )}

          {regularParts.map(part => {
            const chips = ([
              { key: 'baldwin',     val: part.baldwin     },
              { key: 'napa_gold',   val: part.napa_gold   },
              { key: 'luber_finer', val: part.luber_finer },
              { key: 'donaldson',   val: part.donaldson   },
              { key: 'fleetguard',  val: part.fleetguard  },
              { key: 'wix',         val: part.wix         },
              { key: 'dayco',       val: part.dayco       },
              { key: 'continental', val: part.continental },
              { key: 'gates',       val: part.gates       },
            ] as { key: string; val: string | null }[]).filter(c => c.val)

            const mfgColor =
              part.manufacturer === 'TK'      ? '#60A5FA' :
              part.manufacturer === 'Both'    ? '#9CA3AF' : '#FB923C'
            const mfgBg =
              part.manufacturer === 'TK'      ? '#1A6BAF22' :
              part.manufacturer === 'Both'    ? '#6B728022' : '#E85D2422'

            return (
              <div
                key={part.id}
                className="rounded-xl overflow-hidden"
                style={{ border: '1px solid #1e3040' }}
              >
                {/* Header */}
                <div className="px-4 pt-3 pb-3" style={{ background: '#162030' }}>
                  <div className="flex items-start gap-2 justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs mb-1 leading-snug" style={{ color: 'rgba(255,255,255,0.45)' }}>
                        {part.part_function}
                      </p>
                      {part.oem_part_number ? (
                        <p
                          className="font-bold text-2xl leading-tight"
                          style={{ color: HD_ORANGE, fontFamily: 'monospace', wordBreak: 'break-all' }}
                        >
                          {part.oem_part_number}
                        </p>
                      ) : (
                        <p className="text-sm italic" style={{ color: 'rgba(255,255,255,0.3)' }}>
                          No OEM number
                        </p>
                      )}
                    </div>
                    <span
                      className="text-xs font-bold px-2 py-0.5 rounded flex-shrink-0 mt-0.5"
                      style={{ background: mfgBg, color: mfgColor }}
                    >
                      {part.manufacturer === 'Both' ? 'TK+CT' : part.manufacturer}
                    </span>
                  </div>
                  {part.unit_family && (
                    <p className="text-xs mt-1.5" style={{ color: 'rgba(255,255,255,0.3)' }}>
                      {part.unit_family}
                    </p>
                  )}
                </div>

                {/* Cross-reference chips */}
                {chips.length > 0 && (
                  <div className="px-4 py-3" style={{ background: '#111920', borderTop: '1px solid #1e3040' }}>
                    <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'rgba(255,255,255,0.25)' }}>
                      Cross-Reference
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {chips.map(c => {
                        const cfg = CHIP_CONFIG[c.key]
                        return (
                          <div
                            key={c.key}
                            className="flex flex-col px-2.5 py-1.5 rounded-lg"
                            style={{ background: cfg.bg, border: `1px solid ${cfg.color}30` }}
                          >
                            <span className="text-xs font-bold leading-none mb-0.5" style={{ color: cfg.color }}>
                              {cfg.label}
                            </span>
                            <span className="text-xs font-mono text-white leading-none">{c.val}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Notes */}
                {part.notes && (
                  <div className="px-4 py-3" style={{ background: '#0d1820', borderTop: '1px solid #1e3040' }}>
                    <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>
                      {part.notes}
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Disclaimer */}
      <div className="rounded-lg p-3" style={{ background: '#0d1820', border: '1px solid #1e3040' }}>
        <p className="text-xs leading-relaxed text-center" style={{ color: 'rgba(255,255,255,0.2)' }}>
          Part numbers provided for cross-reference and field reference purposes only.
          Always verify fitment for your specific unit model, engine type, and year before ordering.
          National Wrench Index is not responsible for incorrect part selection.
        </p>
      </div>

    </div>
  )
}
