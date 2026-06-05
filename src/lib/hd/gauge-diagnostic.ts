export type SuctionStatus = 'vacuum' | 'very_low' | 'low' | 'normal' | 'high' | 'very_high'
export type DischargeStatus = 'very_low' | 'low' | 'normal' | 'high' | 'very_high'
export type DiagSeverity = 'normal' | 'caution' | 'action' | 'immediate'

export const SEVERITY_CONFIG: Record<DiagSeverity, { label: string; color: string; bg: string; border: string }> = {
  normal:    { label: 'Normal',           color: '#22C55E', bg: '#22C55E15', border: '#22C55E40' },
  caution:   { label: 'Investigate',      color: '#F59E0B', bg: '#F59E0B15', border: '#F59E0B40' },
  action:    { label: 'Action Required',  color: '#E85D24', bg: '#E85D2415', border: '#E85D2440' },
  immediate: { label: 'Immediate Action', color: '#EF4444', bg: '#EF444415', border: '#EF444440' },
}

export interface PressurePattern {
  id: string
  patternLabel: string
  suction: SuctionStatus[]
  discharge: DischargeStatus[]
  severity: DiagSeverity
  causes: string[]
  fieldVerification: string[]
  recommendedAction: string[]
  refrigerantNote?: string
  laborEstimate: string
  recoveryRequired: boolean
}

export interface GaugeDiagInput {
  actualSuction: number
  actualDischarge: number
  suctionLow?: number
  suctionHigh?: number
  dischargeLow?: number
  dischargeHigh?: number
  ambientTemp?: number
  boxTemp?: number
}

export interface GaugeDiagOutput {
  suctionStatus: SuctionStatus
  dischargeStatus: DischargeStatus
  isEqualizing: boolean
  pattern: PressurePattern | null
  dangerAlert: boolean
}

// ─── Classification ───────────────────────────────────────────────────────────

export function classifySuction(
  actual: number,
  low?: number,
  high?: number,
): SuctionStatus {
  if (actual < 0) return 'vacuum'
  if (low != null && high != null && high > low) {
    const spread = high - low
    if (actual < low - spread)       return 'very_low'
    if (actual < low)                return 'low'
    if (actual <= high)              return 'normal'
    if (actual <= high + spread)     return 'high'
    return 'very_high'
  }
  // Absolute fallback (mid-temp steady state)
  if (actual < 5)  return 'very_low'
  if (actual < 22) return 'low'
  if (actual < 52) return 'normal'
  if (actual < 72) return 'high'
  return 'very_high'
}

export function classifyDischarge(
  actual: number,
  low?: number,
  high?: number,
): DischargeStatus {
  if (low != null && high != null && high > low) {
    const spread = high - low
    if (actual < low - spread)      return 'very_low'
    if (actual < low)               return 'low'
    if (actual <= high)             return 'normal'
    if (actual <= high + spread)    return 'high'
    return 'very_high'
  }
  // Absolute fallback
  if (actual < 170) return 'very_low'
  if (actual < 220) return 'low'
  if (actual < 295) return 'normal'
  if (actual < 360) return 'high'
  return 'very_high'
}

// ─── Pressure Pattern Matrix ──────────────────────────────────────────────────
// Ordered: most specific / most severe first. Engine returns first match.

export const EQUALIZATION_PATTERN: PressurePattern = {
  id: 'EQ',
  patternLabel: 'Pressures Equalizing — No Differential',
  suction: [],
  discharge: [],
  severity: 'immediate',
  causes: [
    'Compressor not running — check power and control signals',
    'Compressor completely failed internally — full internal bypass',
    'Broken compressor reed valves — cannot build head pressure',
    'Compressor coupling broken or slipping — engine running but compressor not turning',
    'System at rest — normal when unit is switched off',
  ],
  fieldVerification: [
    'Confirm compressor is actually running — listen and feel for vibration at the compressor body',
    'Check compressor coupling or drive belt — engine may be running while compressor is not turning',
    'Watch pressures over 2–3 minutes — a failed compressor will not build differential; a unit starting from rest will slowly build pressure',
  ],
  recommendedAction: [
    'Verify compressor operation before any other refrigeration diagnosis — all other causes are secondary',
    'If compressor is not running, diagnose electrical supply, clutch, or control signal first',
    'If compressor is running but not building differential, perform a pump-down test to confirm internal valve failure',
    'Replace compressor if pump-down confirms internal failure',
    'Replace filter drier and recharge during compressor replacement',
  ],
  refrigerantNote: 'Recovery required before compressor replacement. Weigh out refrigerant and recharge to nameplate weight after repair.',
  laborEstimate: '4.0–6.0 hours (compressor R&R includes recovery and recharge)',
  recoveryRequired: true,
}

export const GAUGE_PATTERNS: PressurePattern[] = [

  // ── P8: Suction VERY LOW (vacuum/near vacuum) ─────────────────────────────
  // Check before LOW+LOW so very_low suction is caught here first
  {
    id: 'P8',
    patternLabel: 'Suction VERY LOW / Pulling Toward Vacuum',
    suction: ['vacuum', 'very_low'],
    discharge: ['very_low', 'low', 'normal'],
    severity: 'immediate',
    causes: [
      'Complete liquid line restriction — king valve closed, liquid line kinked, or TXV completely blocked',
      'Severely low refrigerant charge — almost no refrigerant remaining in system',
      'TXV completely plugged — moisture freeze-up blocking metering device inlet',
      'Filter drier completely blocked — zero flow through drier',
    ],
    fieldVerification: [
      'Feel the liquid line — it should be cool to the touch; if warm (ambient temperature), refrigerant is not flowing',
      'Check king valve and liquid line service valve — confirm both are fully open (back-seated)',
      'Check for frost at the restriction point — frost on the inlet side of a restriction confirms the location',
    ],
    recommendedAction: [
      'Find the restriction point before adding refrigerant — adding charge to a blocked system will not help',
      'Open king valve or liquid line service valve if found partially closed',
      'Replace filter drier if restricted — temperature difference between inlet and outlet confirms',
      'Replace TXV if plugged — moisture freeze-up requires new drier plus full recovery, evacuation, and recharge',
      'Leak check and recharge to nameplate specification after restriction is corrected',
    ],
    refrigerantNote: 'Recovery and full recharge required after any open-system repair. Replace filter drier any time system is opened.',
    laborEstimate: '1.5–4.0 hours depending on restriction location and cause',
    recoveryRequired: true,
  },

  // ── P1: Suction LOW + Discharge HIGH ─────────────────────────────────────
  {
    id: 'P1',
    patternLabel: 'Suction LOW + Discharge HIGH',
    suction: ['low', 'very_low'],
    discharge: ['high', 'very_high'],
    severity: 'action',
    causes: [
      'Dirty or blocked condenser coil — most common cause of this pattern',
      'Condenser fan motor failed or not running at full speed',
      'Condenser airflow restricted — unit in enclosed space recirculating hot air',
      'Non-condensables in system — air or nitrogen introduced during improper service',
      'Overcharged system — too much refrigerant',
      'Discharge check valve partially closed or failing',
      'Discharge service valve partially closed — verify valve position',
    ],
    fieldVerification: [
      'Feel the condenser coil inlet face — a dirty coil will be significantly hotter than a clean one',
      'Confirm condenser fan is running at full speed — check belt tension or motor operation',
      'Look for airflow restriction around the unit — enclosed spaces recirculate hot discharge air',
    ],
    recommendedAction: [
      'Wash condenser coil first — this is the most common cause and the fastest fix to verify',
      'Recheck discharge pressure after cleaning — if it returns to normal, condenser was the cause',
      'If discharge remains high after clean condenser, suspect non-condensables — recover refrigerant fully, pull deep vacuum, recharge to nameplate weight',
      'Verify discharge and check valves are fully open',
    ],
    refrigerantNote: 'If non-condensables suspected: full recovery, deep vacuum (250 microns minimum), and recharge required. Do not attempt to vent non-condensables — EPA 608 violation.',
    laborEstimate: '0.5–1.5 hours (condenser cleaning); 1.5–2.5 hours if recharge required',
    recoveryRequired: false,
  },

  // ── P2: Suction LOW + Discharge LOW ──────────────────────────────────────
  {
    id: 'P2',
    patternLabel: 'Suction LOW + Discharge LOW',
    suction: ['low'],
    discharge: ['low', 'very_low'],
    severity: 'action',
    causes: [
      'Low refrigerant charge — most common cause — active leak in system',
      'Restricted filter drier — temperature drop across drier body confirms restriction',
      'TXV stuck closed or plugged — frost visible at TXV inlet with liquid backed up before it',
      'Liquid line restriction — kinked line, closed valve, or ice at metering device',
      'Compressor discharge valve leaking — high side bleeding back to suction',
      'Cold ambient conditions — both pressures drop in extreme cold — verify against refrigerant chart',
      'System recovering from defrost cycle in cold ambient',
    ],
    fieldVerification: [
      'Check sight glass for bubbles — continuous bubbles under steady-state operation indicate low charge',
      'Feel across the filter drier — a significant temperature drop (inlet warm, outlet cold or frosted) confirms restriction',
      'Perform a system leak check if charge appears low — find the leak before adding refrigerant',
    ],
    recommendedAction: [
      'Perform leak check before adding refrigerant — adding charge to a leaking system is a temporary fix',
      'Replace filter drier if temperature drop across drier body is confirmed',
      'Check TXV if charge is correct — frost at TXV inlet means the valve is not opening properly',
      'Compare readings to refrigerant pressure chart for current ambient — cold ambient naturally lowers both pressures',
      'After repairs, recover, evacuate to 250 microns, and recharge to nameplate weight',
    ],
    refrigerantNote: 'Recovery and recharge required after leak repair or drier replacement. Always pressure test with nitrogen before recharging.',
    laborEstimate: '2.0–4.5 hours (includes leak repair, drier replacement, and recharge)',
    recoveryRequired: true,
  },

  // ── P3: Suction HIGH + Discharge HIGH ────────────────────────────────────
  {
    id: 'P3',
    patternLabel: 'Suction HIGH + Discharge HIGH',
    suction: ['high', 'very_high'],
    discharge: ['high', 'very_high', 'normal'],
    severity: 'action',
    causes: [
      'Overcharged system — too much refrigerant is the most common cause',
      'TXV overfeeding — flooding liquid refrigerant back to compressor suction',
      'Excessive heat load — warm product loaded or door seals failing and letting in ambient air',
      'Hot ambient temperature — both pressures rise in extreme ambient; verify against pressure chart',
      'Non-condensables combined with excess charge',
      'Condenser partially restricted while system is also overcharged',
    ],
    fieldVerification: [
      'Check refrigerant charge weight against nameplate — recover refrigerant and weigh to confirm',
      'Measure superheat at evaporator outlet — overcharge shows low superheat; TXV overfeeding shows very low or zero superheat',
      'Check subcooling at condenser outlet — values above 20°F confirm overcharge; verify product load and door seal condition',
    ],
    recommendedAction: [
      'Check charge weight first — recover refrigerant and compare recovered amount to nameplate specification',
      'If overcharged: recover excess refrigerant and recharge to exact nameplate weight',
      'If charge is correct and suction remains high: check TXV sensing bulb position and superheat setting',
      'Recover small amount at a time and recheck — if pressures drop proportionally, overcharge was the cause',
      'If still elevated after correct charge weight: full recovery, deep vacuum, and recharge to eliminate non-condensables',
    ],
    refrigerantNote: 'Recovery required to correct charge. Weigh in refrigerant to nameplate specification — do not charge by pressure alone.',
    laborEstimate: '1.0–2.5 hours (recharge correction); additional time if TXV replacement needed',
    recoveryRequired: true,
  },

  // ── P4: Suction HIGH + Discharge LOW ─────────────────────────────────────
  {
    id: 'P4',
    patternLabel: 'Suction HIGH + Discharge LOW',
    suction: ['high', 'very_high'],
    discharge: ['low', 'very_low'],
    severity: 'immediate',
    causes: [
      'Compressor valve failure — suction and discharge valves worn and not sealing — most common cause of this pattern',
      'Compressor completely failed internally — high side pressure bypassing back to low side',
      'Broken compressor reed valves — compressor spinning but cannot build head pressure differential',
      'Compressor coupling slipping — engine or motor running at full speed but compressor turning slowly',
    ],
    fieldVerification: [
      'Watch how quickly pressures equalize after shutdown — failed valves equalize in seconds; a healthy compressor takes 5–10 minutes to equalize',
      'Feel the discharge line — should be 50–100°F above ambient when compressor is pumping; near-ambient temperature means no pumping',
      'Check compressor amp draw — a spinning but not pumping compressor may show below-normal amperage',
    ],
    recommendedAction: [
      'Perform a pump-down test to confirm compressor pumping ability before ordering parts',
      'Replace compressor — valve kits are not available for most transport refrigeration compressors',
      'Replace filter drier during compressor replacement',
      'Check and add correct amount of compressor oil to replacement unit per manufacturer specification',
      'Evacuate system to 250 microns after replacement and recharge to nameplate weight',
    ],
    refrigerantNote: 'Full refrigerant recovery required before compressor removal. If compressor failed internally (metal debris), system may require flushing before recharge.',
    laborEstimate: '4.0–6.0 hours (compressor R&R includes recovery, drier, and recharge)',
    recoveryRequired: true,
  },

  // ── P5: Suction NORMAL + Discharge HIGH ──────────────────────────────────
  {
    id: 'P5',
    patternLabel: 'Suction NORMAL + Discharge HIGH',
    suction: ['normal'],
    discharge: ['high', 'very_high'],
    severity: 'caution',
    causes: [
      'Dirty condenser coil — airflow restricted; most common cause',
      'Condenser fan not running at full speed — motor failure or belt slipping',
      'Non-condensables in system — air introduced during improper service or leak repair',
      'High ambient temperature — discharge naturally rises with ambient; compare to refrigerant chart',
      'Overcharge — slight overcharge raises head pressure while suction remains in range',
      'Discharge line restriction — partially closed valve or damaged line',
    ],
    fieldVerification: [
      'Measure actual ambient temperature and compare discharge pressure to the refrigerant chart for that ambient — confirm it is abnormally high',
      'Confirm condenser fan is spinning at operating speed and coil is clean',
      'Feel condenser coil — heavily restricted coil will be extremely hot on the air inlet side',
    ],
    recommendedAction: [
      'Clean condenser coil thoroughly and verify fan operation first',
      'Recheck discharge pressure after cleaning — if normal, condenser was the cause',
      'If still high after clean condenser and correct charge: recover refrigerant fully, pull deep vacuum, recharge to nameplate weight to eliminate non-condensables',
      'Verify all discharge line valves are fully open',
    ],
    refrigerantNote: 'If non-condensables are suspected after condenser cleaning: full recovery, 250-micron vacuum hold, and recharge required.',
    laborEstimate: '0.5–1.5 hours (condenser cleaning); 1.5–2.5 hours if recharge required',
    recoveryRequired: false,
  },

  // ── P6: Suction NORMAL + Discharge LOW ───────────────────────────────────
  {
    id: 'P6',
    patternLabel: 'Suction NORMAL + Discharge LOW',
    suction: ['normal'],
    discharge: ['low', 'very_low'],
    severity: 'caution',
    causes: [
      'Discharge check valve leaking — refrigerant bypassing back from high side to low side',
      'Discharge service valve partially closed — check valve stem position',
      'Cold ambient conditions — discharge pressure drops significantly in cold weather — compare to refrigerant chart',
      'Compressor discharge valve beginning to fail — early stage internal leak',
    ],
    fieldVerification: [
      'Compare discharge pressure to the refrigerant chart for current ambient temperature — cold ambient can produce these readings normally',
      'Verify discharge service valve is fully open (fully back-seated, counterclockwise)',
      'Check equalization rate after shutdown — a leaking discharge check valve will equalize much faster than normal',
    ],
    recommendedAction: [
      'Compare readings to ambient temperature chart first — cold ambient operation may explain low discharge',
      'If abnormal for conditions: open discharge service valve fully if found partially closed',
      'Inspect discharge check valve for proper seating — replace if leaking',
      'Perform compressor pump-down test if check valve checks out — confirms compressor discharge valve condition',
    ],
    laborEstimate: '0.5–2.5 hours depending on cause',
    recoveryRequired: false,
  },

  // ── P7: Suction LOW + Discharge NORMAL ───────────────────────────────────
  {
    id: 'P7',
    patternLabel: 'Suction LOW + Discharge NORMAL',
    suction: ['low'],
    discharge: ['normal'],
    severity: 'caution',
    causes: [
      'Low refrigerant charge — early stage leak, system has not lost enough to affect discharge yet',
      'TXV slightly underfeeding — superheat is elevated at evaporator outlet',
      'Filter drier beginning to restrict — early restriction not yet severe enough to drop discharge',
      'Liquid line partially restricted — small restriction limiting flow to evaporator',
      'TXV sensing bulb losing charge or poor contact — not opening valve fully',
    ],
    fieldVerification: [
      'Check sight glass — occasional bubbles under load indicate low charge or liquid line restriction',
      'Measure superheat at evaporator outlet — elevated superheat (above 25°F) points to TXV underfeeding',
      'Feel across filter drier body — any measurable temperature drop from inlet to outlet warrants replacement',
    ],
    recommendedAction: [
      'Check refrigerant charge — verify sight glass and system superheat',
      'If charge is correct, adjust TXV superheat setting — turn stem counterclockwise 1/4 turn at a time and allow 15 minutes to stabilize',
      'Replace filter drier if temperature drop is confirmed across drier body',
      'Check TXV sensing bulb — verify it is clamped firmly to suction line and insulated',
    ],
    refrigerantNote: 'If charge correction is needed: leak check and repair before recharging. Replace drier and recharge to nameplate weight.',
    laborEstimate: '1.0–3.0 hours depending on whether TXV or charge repair is needed',
    recoveryRequired: false,
  },

  // ── P10: Suction NORMAL + Discharge NORMAL ────────────────────────────────
  {
    id: 'P10',
    patternLabel: 'Suction NORMAL + Discharge NORMAL',
    suction: ['normal'],
    discharge: ['normal'],
    severity: 'normal',
    causes: [
      'System is operating within normal parameters',
    ],
    fieldVerification: [
      'Verify box temperature is pulling down toward setpoint at a normal rate',
      'Confirm no active alarm codes or fault history in the controller',
      'Check that supply air temperature is 10–15°F below return air temperature during operation',
    ],
    recommendedAction: [
      'No corrective action required',
      'Document gauge readings and operating conditions for service record',
      'Continue scheduled PM intervals — replace filter drier per maintenance schedule',
    ],
    laborEstimate: 'No repair required',
    recoveryRequired: false,
  },
]

// ─── Engine ───────────────────────────────────────────────────────────────────

export function runGaugeDiagnostic(input: GaugeDiagInput): GaugeDiagOutput {
  const { actualSuction, actualDischarge, suctionLow, suctionHigh, dischargeLow, dischargeHigh } = input

  const suctionStatus   = classifySuction(actualSuction, suctionLow, suctionHigh)
  const dischargeStatus = classifyDischarge(actualDischarge, dischargeLow, dischargeHigh)

  const dangerAlert = actualDischarge > 400

  // Equalization: differential < 35 PSI and discharge < 180 (not normal operating range)
  const diff = actualDischarge - actualSuction
  const isEqualizing = diff < 35 && actualSuction > 10 && actualDischarge < 180

  let pattern: PressurePattern | null = null

  if (isEqualizing) {
    pattern = EQUALIZATION_PATTERN
  } else {
    pattern = GAUGE_PATTERNS.find(p =>
      p.suction.includes(suctionStatus) && p.discharge.includes(dischargeStatus)
    ) ?? null
  }

  return { suctionStatus, dischargeStatus, isEqualizing, pattern, dangerAlert }
}
