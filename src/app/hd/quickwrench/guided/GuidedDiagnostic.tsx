'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const ORANGE = '#16a34a'
const GREEN  = '#16A34A'
const BG     = '#F4F5F7'
const CARD   = '#FFFFFF'
const BORDER = '#E5E7EB'
const TEXT   = '#1A1A1A'
const MUTED  = '#6B7280'
const RED    = '#DC2626'

// ─── Types ─────────────────────────────────────────────────────────────────

type Condition = 'lt' | 'gte' | 'lte' | 'gt' | 'between'

interface NumberBranch { kind: 'number'; condition: Condition; threshold?: number; min?: number; max?: number; next: string }
interface YesNoBranch  { kind: 'yesno';  answer: 'yes' | 'no'; next: string }
type Branch = NumberBranch | YesNoBranch

interface DiagStep {
  id:        string
  label:     string
  question:  string
  inputType: 'number' | 'yesno'
  unit?:     string
  placeholder?: string
  hint?:     string
  note?:     string
  branches:  Branch[]
}

interface Conclusion {
  id:               string
  title:            string
  rootCause:        string
  repair:           string
  parts:            string[]
  laborDescription: string
  laborBook:        number
  laborBookMax:     number
  laborMobile:      number
  laborMobileMax:   number
  warning?:         string
  complaint:        string
  generateQuote:    boolean
}

interface HistoryEntry {
  stepId:       string
  label:        string
  question:     string
  value:        string
  displayValue: string
  unit?:        string
  pass:         boolean
}

// ─── Diagnostic Tree ────────────────────────────────────────────────────────

const STEPS: Record<string, DiagStep> = {
  step1: {
    id: 'step1', label: 'Battery Load Test',
    question: 'What is the battery voltage under load?',
    inputType: 'number', unit: 'V DC', placeholder: 'e.g. 12.6',
    hint: 'Use a carbon pile or electronic load tester at 50% of rated CCA. Specification: 12.4 V or above.',
    branches: [
      { kind: 'number', condition: 'lt',  threshold: 12.4, next: 'step1a' },
      { kind: 'number', condition: 'gte', threshold: 12.4, next: 'step2'  },
    ],
  },
  step1a: {
    id: 'step1a', label: 'Battery CCA Rating',
    question: 'What is the battery CCA rating?',
    inputType: 'number', unit: 'CCA', placeholder: 'e.g. 750',
    hint: 'Read from your battery load tester or conductance tester. TK trailer minimum specification: 800 CCA.',
    branches: [
      { kind: 'number', condition: 'lt',  threshold: 800, next: 'battery_failed' },
      { kind: 'number', condition: 'gte', threshold: 800, next: 'step2'          },
    ],
  },
  step2: {
    id: 'step2', label: 'Belt Inspection',
    question: 'Is the alternator drive belt intact with proper tension?',
    inputType: 'yesno',
    hint: 'Check for fraying, glazing, or cracking. Press midspan — deflection should not exceed ½ inch.',
    branches: [
      { kind: 'yesno', answer: 'no',  next: 'belt_failed' },
      { kind: 'yesno', answer: 'yes', next: 'step3'       },
    ],
  },
  step3: {
    id: 'step3', label: 'Charging Voltage',
    question: 'With the unit running at high speed, what is the charging voltage at the battery terminals?',
    inputType: 'number', unit: 'V DC', placeholder: 'e.g. 13.8',
    hint: 'Measure directly at battery terminals with unit at full throttle. Normal range: 13.2–14.7 V DC.',
    branches: [
      { kind: 'number', condition: 'lt',      threshold: 13.2,             next: 'step5'           },
      { kind: 'number', condition: 'between', min: 13.2,       max: 14.7,  next: 'intermittent_fault' },
      { kind: 'number', condition: 'gt',      threshold: 14.7,             next: 'step3b'          },
    ],
  },
  step3b: {
    id: 'step3b', label: 'Sense Wire Resistance — Overcharge',
    question: 'What is the resistance of the orange sense wire from alternator to battery positive?',
    inputType: 'number', unit: 'Ω', placeholder: 'e.g. 0.2',
    hint: 'Disconnect both ends. Measure wire resistance only — not through circuit. Charging voltage is above 14.7 V. Normal: 0.5 Ω or less.',
    branches: [
      { kind: 'number', condition: 'gt',  threshold: 0.5, next: 'orange_sense_wire_overcharge' },
      { kind: 'number', condition: 'lte', threshold: 0.5, next: 'voltage_regulator_failed'     },
    ],
  },
  step5: {
    id: 'step5', label: 'Fuse Check — F2 / F20',
    question: 'Are fuses F2 and F20 good?',
    inputType: 'yesno',
    hint: 'Pull and visually inspect each fuse. Replace with the same amperage rating only.',
    note: 'F4 fuse is only present on units equipped with Bosch alternators — check F4 if a Bosch alternator is installed.',
    branches: [
      { kind: 'yesno', answer: 'no',  next: 'blown_fuse' },
      { kind: 'yesno', answer: 'yes', next: 'step6'      },
    ],
  },
  step6: {
    id: 'step6', label: 'Sense Wire Resistance',
    question: 'What is the resistance of the orange sense wire from alternator to battery positive?',
    inputType: 'number', unit: 'Ω', placeholder: 'e.g. 0.1',
    hint: 'Disconnect both ends. Measure wire resistance only. Normal: 0.5 Ω or less.',
    branches: [
      { kind: 'number', condition: 'gt',  threshold: 0.5, next: 'orange_sense_wire' },
      { kind: 'number', condition: 'lte', threshold: 0.5, next: 'step7'             },
    ],
  },
  step7: {
    id: 'step7', label: 'Ground Strap Inspection',
    question: 'Visually inspect the ground strap from unit frame to trailer chassis. Is it clean, tight, and free of corrosion and damage?',
    inputType: 'yesno',
    hint: 'Check both connection points at the unit frame and the trailer chassis rail. Look for corrosion, loose hardware, and damaged strap.',
    branches: [
      { kind: 'yesno', answer: 'no',  next: 'ground_strap'      },
      { kind: 'yesno', answer: 'yes', next: 'alternator_failed' },
    ],
  },
}

const CONCLUSIONS: Record<string, Conclusion> = {
  battery_failed: {
    id: 'battery_failed',
    title: 'Battery Failure',
    rootCause: 'Battery voltage under load and CCA are both below the minimum specification for reliable TK operation.',
    repair: 'Replace battery. Retest charging system after replacement before condemning alternator.',
    parts: ['Group 31 battery — minimum 800 CCA (replace as matched pair on dual battery systems)'],
    laborDescription: 'Battery R&R',
    laborBook: 0.5, laborBookMax: 0.5,
    laborMobile: 1.0, laborMobileMax: 1.0,
    complaint: 'Code 25 — Unit not charging',
    generateQuote: true,
  },
  belt_failed: {
    id: 'belt_failed',
    title: 'Alternator Drive Belt Failure',
    rootCause: 'Alternator drive belt is failed, glazed, or lacking proper tension — alternator cannot generate charge current.',
    repair: 'Replace alternator drive belt. Retest charging voltage after replacement.',
    parts: ['Alternator drive belt — verify part number by unit serial from TK parts catalog'],
    laborDescription: 'Belt R&R fan drive',
    laborBook: 0.5, laborBookMax: 0.5,
    laborMobile: 1.0, laborMobileMax: 1.0,
    complaint: 'Code 25 — Unit not charging',
    generateQuote: true,
  },
  intermittent_fault: {
    id: 'intermittent_fault',
    title: 'Intermittent Fault — No Defect Found',
    rootCause: 'Charging voltage is normal. Code 25 is intermittent — likely connector corrosion or a high-resistance connection in the charging circuit.',
    repair: 'Inspect and clean all connectors in the charging circuit. Apply dielectric grease. Clear code and monitor.',
    parts: ['Dielectric grease'],
    laborDescription: 'Charging system check',
    laborBook: 0.5, laborBookMax: 0.5,
    laborMobile: 1.0, laborMobileMax: 1.0,
    complaint: 'Code 25 — Alternator check — intermittent',
    generateQuote: false,
  },
  orange_sense_wire_overcharge: {
    id: 'orange_sense_wire_overcharge',
    title: 'Orange Sense Wire — High Resistance (Overcharge)',
    rootCause: 'High resistance in the orange sense wire causes the voltage regulator to overcompensate, producing overcharge voltage above 14.7 V.',
    repair: 'Repair or replace the orange sense wire from alternator to battery positive terminal.',
    parts: ['16 gauge wire', 'Heat shrink tubing', 'Dielectric grease'],
    laborDescription: 'Electrical repair',
    laborBook: 0.5, laborBookMax: 0.5,
    laborMobile: 1.0, laborMobileMax: 1.0,
    complaint: 'Code 25 — Overcharge condition',
    generateQuote: true,
  },
  voltage_regulator_failed: {
    id: 'voltage_regulator_failed',
    title: 'Alternator Voltage Regulator Failure',
    rootCause: 'Sense wire resistance is within spec. Overcharge voltage is caused by internal voltage regulator failure inside the alternator.',
    repair: 'Replace alternator with TK OEM unit only. Do not use aftermarket.',
    parts: ['TK OEM alternator — application specific by serial number'],
    laborDescription: 'Alternator R&R',
    laborBook: 1.0, laborBookMax: 1.5,
    laborMobile: 1.5, laborMobileMax: 2.25,
    warning: 'Do not install aftermarket alternator — TK controller communicates through the sense wire circuit. Non-OEM alternators cause ongoing electrical faults.',
    complaint: 'Code 25 — Alternator overcharge',
    generateQuote: true,
  },
  blown_fuse: {
    id: 'blown_fuse',
    title: 'Blown Fuse in Charging Circuit',
    rootCause: 'One or more fuses (F2 or F20) are blown, interrupting power to the charging circuit. On units with a Bosch alternator, F4 may also be blown.',
    repair: 'Replace blown fuse. Identify and correct root cause before returning unit to service.',
    parts: ['Fuses F2, F20 (and F4 if Bosch alternator) — carry spares on service vehicle'],
    laborDescription: 'Electrical repair',
    laborBook: 0.3, laborBookMax: 0.3,
    laborMobile: 0.8, laborMobileMax: 0.8,
    complaint: 'Code 25 — Unit not charging — blown fuse',
    generateQuote: false,
  },
  orange_sense_wire: {
    id: 'orange_sense_wire',
    title: 'Orange Sense Wire — High Resistance',
    rootCause: 'High resistance in the orange sense wire prevents the voltage regulator from receiving accurate battery feedback, causing undercharging.',
    repair: 'Repair or replace the orange sense wire from alternator to battery positive. Retest charging voltage.',
    parts: ['16 gauge wire', 'Heat shrink tubing', 'Dielectric grease'],
    laborDescription: 'Electrical repair',
    laborBook: 0.5, laborBookMax: 0.5,
    laborMobile: 1.0, laborMobileMax: 1.0,
    complaint: 'Code 25 — Unit not charging',
    generateQuote: true,
  },
  ground_strap: {
    id: 'ground_strap',
    title: 'High Resistance Ground Path — Ground Strap',
    rootCause: 'High resistance ground path suspected — ground strap is corroded, loose, or damaged.',
    repair: 'Clean both connection points with a wire brush. Replace ground strap if damaged. Retest charging voltage.',
    parts: ['Ground strap', 'Hardware', 'Dielectric grease'],
    laborDescription: 'Electrical repair',
    laborBook: 0.5, laborBookMax: 0.5,
    laborMobile: 1.0, laborMobileMax: 1.0,
    complaint: 'Code 25 — Unit not charging',
    generateQuote: true,
  },
  alternator_failed: {
    id: 'alternator_failed',
    title: 'Alternator Internal Failure',
    rootCause: 'All other charging circuit components have been eliminated. Alternator has failed internally.',
    repair: 'Replace with TK OEM alternator only. Do not use aftermarket.',
    parts: [
      'TK OEM alternator — application specific by serial number',
      'Cross reference: Delco Remy 93591 → TK 45-2324 (verify by serial before ordering)',
    ],
    laborDescription: 'Alternator R&R',
    laborBook: 1.0, laborBookMax: 1.5,
    laborMobile: 1.5, laborMobileMax: 2.25,
    warning: 'Do not install aftermarket alternator — TK controller communicates through the sense wire circuit. Non-OEM alternators cause ongoing electrical faults.',
    complaint: 'Code 25 — Unit not charging — alternator failure',
    generateQuote: true,
  },
}

const MAX_STEPS = 7

// ─── Helpers ────────────────────────────────────────────────────────────────

function getNextStep(step: DiagStep, value: string): string {
  const num = parseFloat(value)
  for (const branch of step.branches) {
    if (branch.kind === 'yesno') {
      if (branch.answer === value) return branch.next
    } else {
      let hit = false
      switch (branch.condition) {
        case 'lt':      hit = num < branch.threshold!; break
        case 'gte':     hit = num >= branch.threshold!; break
        case 'lte':     hit = num <= branch.threshold!; break
        case 'gt':      hit = num > branch.threshold!; break
        case 'between': hit = num >= branch.min! && num <= branch.max!; break
      }
      if (hit) return branch.next
    }
  }
  return step.branches[step.branches.length - 1].next
}

function isPass(stepId: string, value: string): boolean {
  const n = parseFloat(value)
  switch (stepId) {
    case 'step1':  return n >= 12.4
    case 'step1a': return n >= 800
    case 'step2':  return value === 'yes'
    case 'step3':  return n >= 13.2 && n <= 14.7
    case 'step3b': return n <= 0.5
    case 'step5':  return value === 'yes'
    case 'step6':  return n <= 0.5
    case 'step7':  return value === 'yes'
    default:       return true
  }
}

function buildDiagnosisSummary(history: HistoryEntry[], conclusion: Conclusion): string {
  const tests: string[] = []
  for (const h of history) {
    switch (h.stepId) {
      case 'step1':  tests.push(`Battery load tested at ${h.displayValue}`); break
      case 'step1a': tests.push(`Battery CCA ${h.displayValue}`); break
      case 'step2':  tests.push(`Belt ${h.value === 'yes' ? 'inspected — good condition' : 'found failed or glazed'}`); break
      case 'step3':  tests.push(`Charging voltage ${h.displayValue} at high speed`); break
      case 'step3b': tests.push(`Orange sense wire resistance ${h.displayValue}`); break
      case 'step5':  tests.push(`Fuses F2/F20 ${h.value === 'yes' ? 'all good' : 'found blown'}`); break
      case 'step6':  tests.push(`Sense wire resistance ${h.displayValue}`); break
      case 'step7':  tests.push(`Ground strap ${h.value === 'yes' ? 'inspected — clean and tight' : 'found corroded or damaged'}`); break
    }
  }
  return `${tests.join('. ')}. ${conclusion.rootCause}`
}

function buildStepNotes(history: HistoryEntry[], conclusion: Conclusion): string {
  const lines = [
    'GUIDED DIAGNOSTIC — Code 25 Alternator Check — TK SB Series',
    '',
    ...history.map((h, i) => `Step ${i + 1} — ${h.label}: ${h.displayValue}`),
    '',
    `CONCLUSION: ${conclusion.title}`,
    conclusion.rootCause,
    `Repair: ${conclusion.repair}`,
    `Parts: ${conclusion.parts.join('; ')}`,
  ]
  return lines.join('\n')
}

function fmtLaborHrs(min: number, max: number): string {
  if (min === max) return `${min.toFixed(1)} hr`
  return `${min.toFixed(2)}–${max.toFixed(2)} hr`
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function GuidedDiagnostic({ alarmCode }: { alarmCode: string }) {
  const router = useRouter()
  const [history,       setHistory]      = useState<HistoryEntry[]>([])
  const [currentStepId, setCurrentStep]  = useState('step1')
  const [currentValue,  setCurrentValue] = useState('')
  const [conclusionId,  setConclusionId] = useState<string | null>(null)

  const step       = STEPS[currentStepId]
  const conclusion = conclusionId ? CONCLUSIONS[conclusionId] : null
  const progress   = conclusion
    ? 100
    : Math.min(Math.round((history.length / MAX_STEPS) * 90), 90)

  const canNext =
    currentValue !== '' &&
    (step?.inputType === 'yesno'
      ? currentValue === 'yes' || currentValue === 'no'
      : !isNaN(parseFloat(currentValue)))

  function handleNext() {
    if (!canNext || !step) return
    const nextId = getNextStep(step, currentValue)

    const displayValue =
      step.inputType === 'yesno'
        ? currentValue === 'yes' ? 'Yes' : 'No'
        : `${currentValue} ${step.unit ?? ''}`.trim()

    const entry: HistoryEntry = {
      stepId:       currentStepId,
      label:        step.label,
      question:     step.question,
      value:        currentValue,
      displayValue,
      unit:         step.unit,
      pass:         isPass(currentStepId, currentValue),
    }

    setHistory(h => [...h, entry])

    if (CONCLUSIONS[nextId]) {
      setConclusionId(nextId)
    } else {
      setCurrentStep(nextId)
    }
    setCurrentValue('')
  }

  function handleBack() {
    if (conclusionId) {
      const last = history[history.length - 1]
      setConclusionId(null)
      setCurrentStep(last.stepId)
      setCurrentValue(last.value)
      setHistory(h => h.slice(0, -1))
    } else if (history.length > 0) {
      const last = history[history.length - 1]
      setCurrentStep(last.stepId)
      setCurrentValue(last.value)
      setHistory(h => h.slice(0, -1))
    }
  }

  function handleRestart() {
    setHistory([])
    setCurrentStep('step1')
    setCurrentValue('')
    setConclusionId(null)
  }

  function handleGenerateQuote() {
    if (!conclusion) return
    const prefill = {
      complaint: conclusion.complaint,
      diagnosis: buildDiagnosisSummary(history, conclusion),
      notes:     buildStepNotes(history, conclusion),
      lineItems: [
        {
          description:      'Diagnostic fee — Code 25 alternator check',
          book_hours:       1.0,                      book_hours_max:   1.0,
          mobile_hours:     1.0,                      mobile_hours_max: 1.0,
        },
        ...(conclusion.generateQuote ? [{
          description:      conclusion.laborDescription,
          book_hours:       conclusion.laborBook,     book_hours_max:   conclusion.laborBookMax,
          mobile_hours:     conclusion.laborMobile,   mobile_hours_max: conclusion.laborMobileMax,
        }] : []),
      ],
    }
    try { localStorage.setItem('hd_guided_diagnostic_prefill', JSON.stringify(prefill)) } catch {}
    router.push('/hd/quotes/new')
  }

  return (
    <div style={{ background: BG, minHeight: '100dvh', padding: '24px 16px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link href="/hd/quickwrench" className="text-sm" style={{ color: MUTED }}>
            ← QuickWrench
          </Link>
          <span style={{ color: BORDER }}>/</span>
          <span
            className="text-xs font-bold px-2.5 py-1 rounded-full"
            style={{ background: '#FFF7ED', color: ORANGE, border: '1px solid #FDBA74' }}
          >
            Code {alarmCode}
          </span>
          <span className="font-condensed font-bold text-xl" style={{ color: TEXT }}>
            Alternator Check
          </span>
        </div>

        {/* Progress bar */}
        <div className="mb-6">
          <div className="rounded-full overflow-hidden" style={{ height: 6, background: BORDER }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progress}%`, background: ORANGE }}
            />
          </div>
          {!conclusion ? (
            <p className="text-xs mt-1.5" style={{ color: MUTED }}>
              Step {history.length + 1} &bull; TK SB Series — Code 25 Alternator Check
            </p>
          ) : (
            <p className="text-xs mt-1.5 font-semibold" style={{ color: ORANGE }}>
              Diagnosis complete — {history.length} steps
            </p>
          )}
        </div>

        {/* ── Question card ── */}
        {!conclusion && step && (
          <div className="rounded-2xl overflow-hidden" style={{ background: CARD, border: `1px solid ${BORDER}` }}>

            <div className="px-6 py-3" style={{ background: BG, borderBottom: `1px solid ${BORDER}` }}>
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: MUTED }}>
                {step.label}
              </p>
            </div>

            <div className="p-6 space-y-5">
              <p className="font-condensed font-bold leading-tight" style={{ fontSize: 22, color: TEXT }}>
                {step.question}
              </p>

              {step.hint && (
                <p className="text-sm leading-relaxed" style={{ color: MUTED }}>
                  {step.hint}
                </p>
              )}

              {step.note && (
                <div
                  className="px-3 py-2.5 rounded-lg text-xs leading-relaxed"
                  style={{ background: '#FEF3C7', border: '1px solid #FCD34D', color: '#92400E' }}
                >
                  <span className="font-bold">Note: </span>{step.note}
                </div>
              )}

              {step.inputType === 'number' ? (
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    step="any"
                    value={currentValue}
                    onChange={e => setCurrentValue(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && canNext && handleNext()}
                    placeholder={step.placeholder}
                    autoFocus
                    className="flex-1 rounded-xl px-4 py-3 text-lg font-semibold outline-none"
                    style={{
                      border:     `2px solid ${currentValue ? ORANGE : BORDER}`,
                      background: CARD,
                      color:      TEXT,
                      minHeight:  52,
                    }}
                  />
                  {step.unit && (
                    <span
                      className="text-sm font-semibold px-3 py-2 rounded-lg"
                      style={{ background: '#F9FAFB', color: MUTED, border: `1px solid ${BORDER}`, whiteSpace: 'nowrap' }}
                    >
                      {step.unit}
                    </span>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {(['yes', 'no'] as const).map(answer => (
                    <button
                      key={answer}
                      type="button"
                      onClick={() => setCurrentValue(answer)}
                      className="rounded-xl font-condensed font-bold text-xl transition-all"
                      style={{
                        minHeight:  64,
                        background: currentValue === answer
                          ? (answer === 'yes' ? GREEN : RED)
                          : CARD,
                        color:      currentValue === answer ? '#fff' : TEXT,
                        border:     `2px solid ${currentValue === answer ? (answer === 'yes' ? GREEN : RED) : BORDER}`,
                      }}
                    >
                      {answer === 'yes' ? 'Yes' : 'No'}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleBack}
                  disabled={history.length === 0}
                  className="px-5 py-3 rounded-xl font-semibold text-sm disabled:opacity-30"
                  style={{ background: '#F3F4F6', color: MUTED, minHeight: 48 }}
                >
                  ← Back
                </button>
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={!canNext}
                  className="flex-1 py-3 rounded-xl font-semibold text-sm text-white disabled:opacity-40 transition-colors"
                  style={{ background: canNext ? ORANGE : '#D1D5DB', minHeight: 48 }}
                >
                  Next →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Conclusion card ── */}
        {conclusion && (
          <div className="rounded-2xl overflow-hidden" style={{ background: CARD, border: `1px solid ${BORDER}` }}>

            <div className="px-6 py-5" style={{ background: ORANGE }}>
              <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.7)' }}>
                Code 25 — Root Cause Identified
              </p>
              <p className="font-condensed font-bold text-2xl text-white leading-tight">
                {conclusion.title}
              </p>
            </div>

            <div className="p-6 space-y-6">

              {/* Diagnostic path */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: MUTED }}>
                  Diagnostic Path
                </p>
                <div className="space-y-1.5">
                  {history.map((h, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm"
                      style={{ background: BG, border: `1px solid ${BORDER}` }}
                    >
                      <span
                        className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                        style={{ background: h.pass ? '#DCFCE7' : '#FEE2E2', color: h.pass ? GREEN : RED }}
                      >
                        {h.pass ? '✓' : '✗'}
                      </span>
                      <span className="text-xs" style={{ color: MUTED, minWidth: 140, flexShrink: 0 }}>{h.label}</span>
                      <span className="font-semibold ml-auto text-sm" style={{ color: TEXT }}>{h.displayValue}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Root cause */}
              <div className="p-4 rounded-xl" style={{ background: '#FFF7ED', border: '1px solid #FDBA74' }}>
                <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: ORANGE }}>
                  Root Cause
                </p>
                <p className="text-sm leading-relaxed" style={{ color: TEXT }}>{conclusion.rootCause}</p>
              </div>

              {/* Repair */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: MUTED }}>Recommended Repair</p>
                <p className="text-sm leading-relaxed" style={{ color: TEXT }}>{conclusion.repair}</p>
              </div>

              {/* Parts */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: MUTED }}>Parts Needed</p>
                <ul className="space-y-1.5">
                  {conclusion.parts.map((part, i) => (
                    <li key={i} className="flex gap-2 text-sm" style={{ color: TEXT }}>
                      <span style={{ color: ORANGE, flexShrink: 0 }}>•</span>
                      {part}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Labor estimate */}
              <div className="rounded-xl p-4" style={{ background: BG, border: `1px solid ${BORDER}` }}>
                <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: MUTED }}>
                  Estimated Labor
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs mb-0.5" style={{ color: MUTED }}>Diagnostic fee</p>
                    <p className="font-bold text-base" style={{ color: TEXT }}>1.0 hr mobile</p>
                  </div>
                  <div>
                    <p className="text-xs mb-0.5" style={{ color: MUTED }}>{conclusion.laborDescription}</p>
                    <p className="font-bold text-base" style={{ color: TEXT }}>
                      {fmtLaborHrs(conclusion.laborMobile, conclusion.laborMobileMax)} mobile
                    </p>
                    <p className="text-xs" style={{ color: MUTED }}>
                      Book: {fmtLaborHrs(conclusion.laborBook, conclusion.laborBookMax)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Warning */}
              {conclusion.warning && (
                <div className="rounded-xl p-4" style={{ background: '#FEF3C7', border: '1px solid #FCD34D' }}>
                  <p className="text-xs font-bold uppercase tracking-widest mb-1.5" style={{ color: '#92400E' }}>Warning</p>
                  <p className="text-sm leading-relaxed" style={{ color: '#78350F' }}>{conclusion.warning}</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-col gap-3 pt-2">
                {conclusion.generateQuote && (
                  <button
                    type="button"
                    onClick={handleGenerateQuote}
                    className="w-full py-3.5 rounded-xl font-condensed font-bold text-lg text-white"
                    style={{ background: ORANGE, minHeight: 52 }}
                  >
                    Generate Quote →
                  </button>
                )}
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleBack}
                    className="flex-1 py-3 rounded-xl font-semibold text-sm"
                    style={{ background: '#F3F4F6', color: MUTED, border: `1px solid ${BORDER}`, minHeight: 48 }}
                  >
                    ← Back
                  </button>
                  <button
                    type="button"
                    onClick={handleRestart}
                    className="flex-1 py-3 rounded-xl font-semibold text-sm"
                    style={{ background: '#F3F4F6', color: MUTED, border: `1px solid ${BORDER}`, minHeight: 48 }}
                  >
                    Start Over
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Completed steps summary (during diagnostic) */}
        {!conclusion && history.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: MUTED }}>
              Completed Steps
            </p>
            <div className="space-y-1.5">
              {history.map((h, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm"
                  style={{ background: CARD, border: `1px solid ${BORDER}` }}
                >
                  <span
                    className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                    style={{ background: h.pass ? '#DCFCE7' : '#FEE2E2', color: h.pass ? GREEN : RED }}
                  >
                    {h.pass ? '✓' : '✗'}
                  </span>
                  <span className="text-xs" style={{ color: MUTED, minWidth: 140, flexShrink: 0 }}>{h.label}</span>
                  <span className="font-semibold ml-auto text-sm" style={{ color: TEXT }}>{h.displayValue}</span>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
