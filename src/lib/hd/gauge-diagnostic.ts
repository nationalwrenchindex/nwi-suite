export type SuctionStatus = 'vacuum' | 'very_low' | 'low' | 'normal' | 'high' | 'very_high'
export type DischargeStatus = 'very_low' | 'low' | 'normal' | 'high' | 'very_high'
export type DiagSeverity = 'normal' | 'caution' | 'action' | 'immediate'

export const SEVERITY_CONFIG: Record<DiagSeverity, { label: string; color: string; bg: string; border: string }> = {
  normal:    { label: 'Normal',           color: '#22C55E', bg: '#22C55E15', border: '#22C55E40' },
  caution:   { label: 'Caution',          color: '#F59E0B', bg: '#F59E0B15', border: '#F59E0B40' },
  action:    { label: 'Action Required',  color: '#E85D24', bg: '#E85D2415', border: '#E85D2440' },
  immediate: { label: 'Immediate Action', color: '#EF4444', bg: '#EF444415', border: '#EF444440' },
}

export interface GaugeDiagCondition {
  id: string
  category: string
  title: string
  suction: SuctionStatus[]
  discharge: DischargeStatus[]
  severity: DiagSeverity
  priority: number
  whatThisMeans: string
  fieldVerification: string[]
  recommendedAction: string[]
  laborEstimate: string
  recoveryRequired: boolean
  dangerAlert?: boolean
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

export interface GaugeDiagResult {
  id: string
  title: string
  category: string
  severity: DiagSeverity
  whatThisMeans: string
  fieldVerification: string[]
  recommendedAction: string[]
  laborEstimate: string
  recoveryRequired: boolean
}

export interface GaugeDiagOutput {
  suctionStatus: SuctionStatus
  dischargeStatus: DischargeStatus
  primary: GaugeDiagResult | null
  secondary: GaugeDiagResult[]
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
    if (actual < low - spread) return 'very_low'
    if (actual < low)          return 'low'
    if (actual <= high)        return 'normal'
    if (actual <= high + spread) return 'high'
    return 'very_high'
  }
  // Absolute fallback (typical mid-temp setpoint operation)
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
    if (actual < low - spread)    return 'very_low'
    if (actual < low)             return 'low'
    if (actual <= high)           return 'normal'
    if (actual <= high + spread)  return 'high'
    return 'very_high'
  }
  // Absolute fallback
  if (actual < 170) return 'very_low'
  if (actual < 220) return 'low'
  if (actual < 295) return 'normal'
  if (actual < 360) return 'high'
  return 'very_high'
}

// ─── Conditions ───────────────────────────────────────────────────────────────

export const GAUGE_CONDITIONS: GaugeDiagCondition[] = [

  // ── Normal operation ─────────────────────────────────────────────────────────
  {
    id: 'C001',
    category: 'Normal Operation',
    title: 'System Operating Normally',
    suction: ['normal'],
    discharge: ['normal'],
    severity: 'normal',
    priority: 1,
    whatThisMeans: 'Both suction and discharge pressures are within the expected range for current conditions. The refrigeration system is functioning normally.',
    fieldVerification: [
      'Verify box temperature is pulling down toward setpoint at a reasonable rate',
      'Check that supply air temp is 10–15°F below return air temp while running',
      'Confirm no active alarm codes or intermittent faults in unit history',
    ],
    recommendedAction: [
      'No corrective action required',
      'Document gauge readings and current conditions for service record',
      'Continue scheduled PM intervals',
    ],
    laborEstimate: 'No repair required',
    recoveryRequired: false,
  },

  // ── Refrigerant charge — undercharge ─────────────────────────────────────────
  {
    id: 'C002',
    category: 'Refrigerant Charge',
    title: 'Severe Refrigerant Undercharge / Large Leak',
    suction: ['vacuum'],
    discharge: ['very_low', 'low'],
    severity: 'immediate',
    priority: 2,
    whatThisMeans: 'Suction pressure has dropped below atmospheric pressure (vacuum condition). The system has critically low or no refrigerant charge, indicating a major leak or complete refrigerant loss. The compressor is pumping against little or no refrigerant.',
    fieldVerification: [
      'Check sight glass for empty (all bubbles/foam) or dry condition',
      'Perform electronic leak detection at all joints, service ports, evaporator coil, and condenser coil',
      'Inspect drain pan and evaporator area for traces of oil residue indicating leak location',
    ],
    recommendedAction: [
      'Do not add refrigerant until leak is located and repaired',
      'Recover any remaining refrigerant and pressure test system with nitrogen (150 PSI) to locate leak',
      'Repair or replace leaking component',
      'Replace filter drier after any repair',
      'Evacuate system to 250 microns, hold for 30 minutes, recharge to specification',
    ],
    laborEstimate: '3.0–6.0 hours (includes leak repair, drier, and recharge)',
    recoveryRequired: true,
  },

  {
    id: 'C003',
    category: 'Refrigerant Charge',
    title: 'Complete Refrigerant Loss',
    suction: ['vacuum'],
    discharge: ['very_low'],
    severity: 'immediate',
    priority: 1,
    whatThisMeans: 'System is in deep vacuum on both sides — there is essentially no refrigerant present. The compressor is running but cannot build any pressure. This is a complete loss scenario.',
    fieldVerification: [
      'Confirm vacuum on both gauges by checking manifold set',
      'Look for obvious physical damage — broken service port, disconnected line, destroyed coil',
      'Inspect compressor shaft seal area for heavy oil fouling indicating compressor seal failure',
    ],
    recommendedAction: [
      'Shut unit off immediately to prevent compressor damage from running dry',
      'Locate and repair refrigerant loss point before recharging',
      'After repair, install new filter drier, evacuate to 250 microns, and recharge to nameplate weight',
      'Check compressor oil level after recharge — if very low, add oil as specified',
    ],
    laborEstimate: '4.0–8.0 hours depending on leak location',
    recoveryRequired: false,
  },

  {
    id: 'C004',
    category: 'Refrigerant Charge',
    title: 'Severe Refrigerant Undercharge',
    suction: ['very_low'],
    discharge: ['very_low', 'low'],
    severity: 'action',
    priority: 2,
    whatThisMeans: 'Both suction and discharge are significantly below normal, which is a strong indicator of refrigerant undercharge. The system does not have enough refrigerant to fill the circuit properly, causing low mass flow and poor capacity.',
    fieldVerification: [
      'Check sight glass — will show continuous bubbles or foam in liquid line',
      'Check liquid line temperature — should be 10–15°F above ambient; if warm, confirm low charge',
      'Perform leak check at all field connections, service valves, and coils',
    ],
    recommendedAction: [
      'Locate and repair refrigerant leak before adding refrigerant',
      'After repair, replace filter drier, evacuate system to 250 microns',
      'Add refrigerant to nameplate specification weight',
      'Verify pressures return to normal range after charge is complete',
    ],
    laborEstimate: '2.5–5.0 hours (includes leak repair, drier, and recharge)',
    recoveryRequired: true,
  },

  {
    id: 'C005',
    category: 'Refrigerant Charge',
    title: 'Moderate Refrigerant Undercharge',
    suction: ['very_low', 'low'],
    discharge: ['low'],
    severity: 'action',
    priority: 3,
    whatThisMeans: 'Suction is below normal and discharge is low, indicating the system is running short on refrigerant. Capacity and efficiency are reduced. A refrigerant leak is the likely cause.',
    fieldVerification: [
      'Sight glass will show intermittent bubbles in liquid line under load',
      'Check subcooling — will be low or zero at condenser outlet with low charge',
      'Scan all connections, valve stems, and coils with electronic leak detector',
    ],
    recommendedAction: [
      'Find and repair leak before adding refrigerant',
      'Replace filter drier',
      'Evacuate and recharge to nameplate specification',
    ],
    laborEstimate: '2.0–4.0 hours',
    recoveryRequired: true,
  },

  {
    id: 'C006',
    category: 'Refrigerant Charge',
    title: 'Mild Refrigerant Undercharge',
    suction: ['low'],
    discharge: ['low', 'normal'],
    severity: 'caution',
    priority: 3,
    whatThisMeans: 'Suction pressure is slightly below the normal range with discharge at low-normal. The system is slightly undercharged — capacity is reduced and it may struggle to maintain setpoint in warm conditions.',
    fieldVerification: [
      'Sight glass may show occasional bubbles under high heat load',
      'Verify system is fully stabilized (10+ minutes at operating conditions) before taking readings',
      'Perform electronic leak detection on all connections and components',
    ],
    recommendedAction: [
      'Locate and repair refrigerant leak',
      'Replace filter drier',
      'Recover refrigerant, pull vacuum, recharge to nameplate weight',
    ],
    laborEstimate: '1.5–3.0 hours',
    recoveryRequired: true,
  },

  // ── Refrigerant charge — overcharge ──────────────────────────────────────────
  {
    id: 'C007',
    category: 'Refrigerant Charge',
    title: 'Refrigerant Overcharge',
    suction: ['high', 'normal'],
    discharge: ['high'],
    severity: 'caution',
    priority: 5,
    whatThisMeans: 'Discharge pressure is elevated with suction at high-normal to high. This is a classic overcharge pattern — too much refrigerant causes liquid to back up in the condenser, raising head pressure and reducing condenser efficiency.',
    fieldVerification: [
      'Check subcooling at condenser outlet — overcharge typically shows > 20°F subcooling',
      'Verify condenser coil and fan are clean and operating — rule out condenser restriction first',
      'Check sight glass: will show clear (full) liquid line with no bubbles',
    ],
    recommendedAction: [
      'First confirm condenser is clean and fan is running at full speed',
      'If condenser is good, recover system and weigh in refrigerant to nameplate specification',
      'Document refrigerant recovered vs. nameplate charge to confirm overcharge',
    ],
    laborEstimate: '1.0–2.0 hours',
    recoveryRequired: true,
  },

  {
    id: 'C008',
    category: 'Refrigerant Charge',
    title: 'Severe Refrigerant Overcharge',
    suction: ['high', 'very_high'],
    discharge: ['very_high'],
    severity: 'immediate',
    priority: 4,
    whatThisMeans: 'Both suction and discharge are significantly elevated. Severe overcharge causes liquid refrigerant to flood back to the compressor, which can damage compressor internals. High head pressure also stresses the high side of the system.',
    fieldVerification: [
      'Check subcooling — will be extremely high (25°F+) with severe overcharge',
      'Listen for liquid slugging sounds at compressor (gurgling or knocking)',
      'Verify this is not a condenser failure first — look for non-condensables or blocked condenser',
    ],
    recommendedAction: [
      'Shut unit off if compressor sounds are heard to prevent mechanical damage',
      'Recover refrigerant and weigh in exact nameplate specification',
      'After recharge, check compressor oil for dilution — oil may be thinned by liquid refrigerant',
      'Check for any damage to compressor valves from liquid slugging',
    ],
    laborEstimate: '1.5–3.0 hours (recharge); additional if compressor damaged',
    recoveryRequired: true,
  },

  // ── Compressor issues ─────────────────────────────────────────────────────────
  {
    id: 'C009',
    category: 'Compressor',
    title: 'Compressor Discharge Valve Failure',
    suction: ['normal', 'high'],
    discharge: ['very_low', 'low'],
    severity: 'action',
    priority: 4,
    whatThisMeans: 'Suction is at or above normal while discharge is significantly low. This indicates the compressor is not building head pressure effectively. The discharge valve is leaking — allowing high-pressure gas to flow back into the suction side — which equalizes pressures and kills capacity.',
    fieldVerification: [
      'Check equalization time after shutdown — a failed discharge valve will equalize pressures very quickly (under 30 seconds) instead of the normal 5–10 minutes',
      'Feel discharge line temp — should be 50–100°F above ambient; if only warm, compressor is not pumping effectively',
      'Verify refrigerant charge is correct before condemning compressor',
    ],
    recommendedAction: [
      'Recover refrigerant and perform compressor pump-down test to confirm valve leakage',
      'Replace compressor — valve kits are not available for most transport refrigeration compressors',
      'Replace filter drier during compressor replacement',
      'Add specified amount of compressor oil to new compressor before installation',
      'Evacuate and recharge after replacement',
    ],
    laborEstimate: '4.0–6.0 hours (compressor R&R includes recovery and recharge)',
    recoveryRequired: true,
  },

  {
    id: 'C010',
    category: 'Compressor',
    title: 'Compressor Suction Valve Failure',
    suction: ['very_high', 'high'],
    discharge: ['low', 'normal'],
    severity: 'action',
    priority: 5,
    whatThisMeans: 'High suction pressure with low-normal discharge indicates the compressor is not drawing refrigerant efficiently. A failed suction valve prevents the compressor from pulling suction effectively, leaving high pressure on the suction side while reducing what is pumped to the high side.',
    fieldVerification: [
      'Verify refrigerant charge is correct first — overcharge can mimic this pattern',
      'Check equalization time after shutdown',
      'Amp draw at compressor may be lower than spec if valves are significantly damaged',
    ],
    recommendedAction: [
      'Confirm with a pump-down test to verify compressor pumping ability',
      'Replace compressor',
      'Replace filter drier during compressor R&R',
      'Evacuate and recharge to specification',
    ],
    laborEstimate: '4.0–6.0 hours',
    recoveryRequired: true,
  },

  {
    id: 'C011',
    category: 'Compressor',
    title: 'Compressor Complete Failure — Not Pumping',
    suction: ['very_high'],
    discharge: ['very_low'],
    severity: 'immediate',
    priority: 1,
    whatThisMeans: 'Suction pressure is very high and discharge is very low — the compressor is not pumping at all, or so severely internally damaged that pressures are nearly equalized. This is a complete compressor failure requiring immediate replacement.',
    fieldVerification: [
      'Confirm compressor is actually running — check for seized compressor or broken drive components',
      'Check discharge line temp — will be near ambient temperature if compressor is not pumping',
      'Check compressor amp draw — may be abnormally low (open winding) or high (seized)',
    ],
    recommendedAction: [
      'Shut unit off immediately',
      'Determine if compressor is seized, open-circuit, or has internal valve failure',
      'Replace compressor',
      'Flush system if compressor has internally failed (metal contamination)',
      'Replace filter drier, evacuate to 250 microns, and recharge',
    ],
    laborEstimate: '5.0–8.0 hours (includes potential system flush)',
    recoveryRequired: true,
  },

  {
    id: 'C012',
    category: 'Compressor',
    title: 'Worn Compressor — Low Pumping Efficiency',
    suction: ['high'],
    discharge: ['low', 'normal'],
    severity: 'caution',
    priority: 6,
    whatThisMeans: 'Suction is elevated and discharge is lower than expected. The compressor is running but not pumping with full efficiency — worn rings or slightly leaking valves allow high-pressure gas to bypass back, reducing capacity without complete failure.',
    fieldVerification: [
      'Check compressor amp draw against spec — may be lower than normal',
      'Verify refrigerant charge is correct — TXV issues can produce similar readings',
      'Check suction line temp — if very warm, compressor may be overheating from poor pumping',
    ],
    recommendedAction: [
      'Verify charge is correct and TXV is functioning before condemning compressor',
      'Perform compressor pump-down test to quantify pumping ability',
      'Replace compressor if confirmed inefficient',
      'Replace filter drier and recharge during compressor R&R',
    ],
    laborEstimate: '4.0–6.0 hours if compressor replacement is needed',
    recoveryRequired: true,
  },

  {
    id: 'C013',
    category: 'Compressor',
    title: 'Refrigerant Flooding — Liquid to Compressor',
    suction: ['very_high'],
    discharge: ['normal', 'low'],
    severity: 'immediate',
    priority: 2,
    whatThisMeans: 'Very high suction pressure with low-normal discharge suggests liquid refrigerant is entering the compressor. Liquid slugging can destroy compressor valves and pistons rapidly. This may be caused by a stuck-open metering device, failed TXV bulb, or hot gas bypass issue.',
    fieldVerification: [
      'Feel suction line at compressor inlet — if frosted or very cold, liquid is returning to compressor',
      'Listen for knocking or rattling from compressor — liquid slugging produces distinctive metallic sounds',
      'Check TXV and hot gas bypass valve for proper operation',
    ],
    recommendedAction: [
      'Shut unit off immediately if liquid slugging sounds are heard',
      'Diagnose and repair metering device (TXV or EPR) before restarting',
      'After repair, check compressor for damage — listen carefully on restart',
      'If compressor sounds are present after repair, compressor must be replaced',
    ],
    laborEstimate: '2.0–6.0 hours depending on root cause and compressor condition',
    recoveryRequired: true,
  },

  // ── Metering device / TXV ─────────────────────────────────────────────────────
  {
    id: 'C014',
    category: 'Metering Device',
    title: 'TXV Underfeeding — Restricted Metering Device',
    suction: ['very_low'],
    discharge: ['normal', 'low'],
    severity: 'action',
    priority: 3,
    whatThisMeans: 'Low suction pressure with normal or low discharge indicates the metering device (TXV or fixed orifice) is not feeding enough refrigerant into the evaporator. The system has adequate charge but the evaporator is starved. High superheat will be present at the evaporator outlet.',
    fieldVerification: [
      'Measure superheat at evaporator outlet — underfeeding will show high superheat (>25°F)',
      'Check sight glass — should show clear liquid line if charge is adequate',
      'If TXV equipped, check external equalizer line is not blocked or kinked',
    ],
    recommendedAction: [
      'Measure superheat with manifold gauges and thermometer at evaporator outlet',
      'If TXV: adjust superheat setting 1/4 turn open at a time and observe response',
      'If TXV does not respond to adjustment, check TXV power element and bulb contact on suction line',
      'Replace TXV if adjustment and bulb check do not resolve the issue',
      'Replace filter drier after any component replacement',
    ],
    laborEstimate: '2.0–4.0 hours (TXV R&R includes recovery and recharge)',
    recoveryRequired: true,
  },

  {
    id: 'C015',
    category: 'Metering Device',
    title: 'TXV Stuck Closed / No Flow',
    suction: ['vacuum', 'very_low'],
    discharge: ['low', 'very_low'],
    severity: 'action',
    priority: 2,
    whatThisMeans: 'Very low or vacuum suction with low discharge indicates the metering device has failed in the closed position. Refrigerant cannot enter the evaporator — the compressor is pumping down the evaporator side while the high side has refrigerant that cannot flow through.',
    fieldVerification: [
      'Check liquid line temperature before and after filter drier — a large temperature drop across the drier indicates a restriction',
      'Check sight glass — liquid line will show clear (full) with no bubbles if TXV is blocking flow',
      'Feel inlet and outlet of TXV — inlet will be warm/ambient temp, outlet will be very cold if refrigerant is partially flowing through',
    ],
    recommendedAction: [
      'Replace TXV — do not attempt to repair',
      'Replace filter drier during same repair',
      'Evacuate and recharge to specification',
      'Verify superheat after recharge (target 10–20°F at evaporator outlet)',
    ],
    laborEstimate: '2.5–4.0 hours',
    recoveryRequired: true,
  },

  {
    id: 'C016',
    category: 'Metering Device',
    title: 'TXV Overfeeding / Stuck Open',
    suction: ['very_high', 'high'],
    discharge: ['normal', 'high'],
    severity: 'action',
    priority: 3,
    whatThisMeans: 'High suction pressure with normal-high discharge indicates too much refrigerant is passing through the metering device into the evaporator. The evaporator is flooded, superheat is very low or zero, and there is risk of liquid returning to the compressor.',
    fieldVerification: [
      'Measure superheat at evaporator outlet — will be very low (<5°F) or zero with TXV stuck open',
      'Check suction line for frost or excessive sweating indicating liquid return',
      'Verify TXV sensing bulb is properly clamped to suction line and insulated',
    ],
    recommendedAction: [
      'First verify sensing bulb is properly installed — poor bulb contact can cause TXV to flood open',
      'Try adjusting TXV toward closed (clockwise) to raise superheat',
      'If TXV does not respond, replace it',
      'Check for liquid slugging damage to compressor after TXV replacement',
    ],
    laborEstimate: '2.0–4.0 hours',
    recoveryRequired: true,
  },

  {
    id: 'C017',
    category: 'Metering Device',
    title: 'TXV Hunting / Unstable Superheat',
    suction: ['low', 'very_low', 'normal'],
    discharge: ['normal'],
    severity: 'caution',
    priority: 7,
    whatThisMeans: 'Oscillating suction pressure with intermittent in-range readings indicates TXV hunting — the valve is constantly searching for its control point and cannot stabilize. This typically causes intermittent capacity complaints and cycling on low-pressure alarms.',
    fieldVerification: [
      'Watch suction gauge over 5–10 minutes — hunting shows rhythmic swings of 5–15 PSI',
      'Verify external equalizer line is clear and connected at evaporator outlet',
      'Check TXV bulb contact on suction line — loose bulb causes hunting',
    ],
    recommendedAction: [
      'Inspect and tighten TXV sensing bulb on suction line — ensure full contact and insulation wrap',
      'Check external equalizer line for blockage',
      'If issue persists, replace TXV',
    ],
    laborEstimate: '1.0–2.5 hours',
    recoveryRequired: false,
  },

  // ── Filter drier / restrictions ───────────────────────────────────────────────
  {
    id: 'C018',
    category: 'System Restriction',
    title: 'Filter Drier Restriction',
    suction: ['very_low', 'low'],
    discharge: ['normal', 'low'],
    severity: 'action',
    priority: 4,
    whatThisMeans: 'Low suction pressure with normal to low discharge indicates a restriction in the liquid line circuit. A saturated or plugged filter drier is the most common cause — as desiccant becomes saturated with moisture or contamination, it restricts refrigerant flow and starves the evaporator.',
    fieldVerification: [
      'Feel both sides of the filter drier — a significant temperature difference (inlet warm, outlet cold or frosted) confirms restriction',
      'Check sight glass — may show bubbles if restriction is limiting liquid flow',
      'Check how long since last filter drier replacement — driers should be replaced every 2 years or after any open-system repair',
    ],
    recommendedAction: [
      'Replace filter drier',
      'If sight glass shows bubbles after drier replacement, verify refrigerant charge',
      'Replace drier, evacuate to 250 microns, hold 30 minutes, and recharge',
    ],
    laborEstimate: '2.0–3.0 hours (includes recovery, drier replacement, and recharge)',
    recoveryRequired: true,
  },

  {
    id: 'C019',
    category: 'System Restriction',
    title: 'Liquid Line Restriction',
    suction: ['very_low', 'vacuum'],
    discharge: ['normal', 'low'],
    severity: 'action',
    priority: 3,
    whatThisMeans: 'The evaporator is starved of refrigerant due to a blockage in the liquid line circuit. This could be a plugged filter drier, plugged strainer, kinked or flattened liquid line, or a partially closed service valve.',
    fieldVerification: [
      'Locate the restriction by feeling for a temperature drop along the liquid line circuit',
      'Check that all service valves are fully open — cracked service valves are a common overlooked cause',
      'Inspect liquid line for kinks, especially where lines pass through bulkheads',
    ],
    recommendedAction: [
      'Identify and repair restriction — replace filter drier, open service valves, straighten or replace liquid line as needed',
      'After repair, evacuate and recharge',
      'Verify system operation returns to normal',
    ],
    laborEstimate: '1.5–4.0 hours depending on restriction location',
    recoveryRequired: true,
  },

  {
    id: 'C020',
    category: 'System Restriction',
    title: 'Suction Line Restriction',
    suction: ['low'],
    discharge: ['low', 'normal'],
    severity: 'caution',
    priority: 6,
    whatThisMeans: 'A restriction on the suction side reduces the mass of refrigerant the compressor can pull — lowering suction pressure and reducing capacity. Causes include a partially closed suction service valve, kinked suction line, or plugged suction screen.',
    fieldVerification: [
      'Verify suction service valve is fully back-seated (open)',
      'Inspect suction line for kinks or crushing damage',
      'Check suction line strainer/screen if equipped — some units have a strainer before the compressor inlet',
    ],
    recommendedAction: [
      'Open suction service valve fully if partially closed',
      'Repair or replace kinked suction line',
      'Clean or replace suction strainer',
    ],
    laborEstimate: '0.5–2.0 hours',
    recoveryRequired: false,
  },

  // ── Flash gas / liquid line issues ────────────────────────────────────────────
  {
    id: 'C021',
    category: 'System Restriction',
    title: 'Flash Gas in Liquid Line',
    suction: ['low', 'very_low'],
    discharge: ['normal', 'low'],
    severity: 'action',
    priority: 5,
    whatThisMeans: 'Flash gas forms in the liquid line when the refrigerant pressure drops below its saturation pressure before reaching the metering device. This disrupts refrigerant flow and causes the TXV to hunt or underperform. Causes include low subcooling, a restriction before the sight glass, or inadequate liquid line size.',
    fieldVerification: [
      'Sight glass will show bubbles even with adequate charge — bubbles in the sight glass do not always mean low refrigerant',
      'Measure liquid line temperature and compare to saturation pressure — if the refrigerant is flashing, liquid will be warm relative to its pressure',
      'Check subcooling at condenser outlet — should be 10–15°F; low subcooling leads to flash gas',
    ],
    recommendedAction: [
      'If subcooling is low, check refrigerant charge and condenser operation',
      'If a liquid line restriction is causing pressure drop, locate and remove restriction',
      'Verify liquid line is not routed through a hot area that could be heating the liquid line',
    ],
    laborEstimate: '1.0–3.0 hours depending on cause',
    recoveryRequired: false,
  },

  // ── Condenser issues ──────────────────────────────────────────────────────────
  {
    id: 'C022',
    category: 'Condenser',
    title: 'Dirty Condenser Coil — Reduced Airflow',
    suction: ['normal', 'low'],
    discharge: ['high'],
    severity: 'caution',
    priority: 2,
    whatThisMeans: 'Suction pressure is near normal while discharge is elevated. A dirty or restricted condenser coil cannot dissipate heat efficiently, causing discharge pressure and temperature to rise. This is one of the most common causes of high head pressure in transport refrigeration.',
    fieldVerification: [
      'Inspect condenser coil face for dirt, dust, insect nests, and debris buildup — check from the air outlet side (look through the coil)',
      'Feel condenser coil temperature — a dirty coil will be much hotter at the inlet than the outlet',
      'Check condenser fan is running at correct speed and blades are not damaged',
    ],
    recommendedAction: [
      'Clean condenser coil with coil cleaner and low-pressure water rinse — do not use high pressure that can bend fins',
      'Blow out coil with compressed air from outlet to inlet to remove embedded dirt',
      'Clean condenser fan blade and motor shroud of dirt buildup',
      'Check condenser area for obstructions to airflow',
    ],
    laborEstimate: '0.5–1.5 hours (coil cleaning)',
    recoveryRequired: false,
  },

  {
    id: 'C023',
    category: 'Condenser',
    title: 'Condenser Fan Not Running or Slipping Belt',
    suction: ['normal'],
    discharge: ['high', 'very_high'],
    severity: 'action',
    priority: 2,
    whatThisMeans: 'Suction at normal with discharge significantly elevated indicates the condenser is not being cooled effectively. Without airflow, refrigerant cannot condense properly, causing head pressure to rise rapidly. A failed condenser fan motor, broken belt, or slipping drive is the likely cause.',
    fieldVerification: [
      'Confirm condenser fan is spinning at operating speed — a slipping belt may cause reduced speed',
      'Check condenser fan motor for failure — test voltage at motor terminals with unit running',
      'Check belt tension and condition — a worn or glazed belt will slip under load',
    ],
    recommendedAction: [
      'Replace condenser fan motor if failed',
      'Tighten or replace condenser fan belt if slipping or worn',
      'Inspect condenser fan blade — replace if cracked or bent',
    ],
    laborEstimate: '1.5–2.5 hours (motor or belt replacement)',
    recoveryRequired: false,
  },

  {
    id: 'C024',
    category: 'Condenser',
    title: 'Condenser Coil Severely Restricted / Blocked',
    suction: ['normal', 'low'],
    discharge: ['very_high'],
    severity: 'immediate',
    priority: 1,
    whatThisMeans: 'Discharge pressure is dangerously high. The condenser cannot reject heat — the coil is severely blocked, airflow is essentially zero, or both the coil and fan have issues simultaneously. System may trip the high pressure switch or damage high-side components.',
    fieldVerification: [
      'Check if high pressure cutout has tripped — unit may have shut itself off',
      'Inspect condenser coil for complete blockage — packed with debris, damaged fins, or external obstruction',
      'Confirm condenser fan is running and check ambient temperature extremes',
    ],
    recommendedAction: [
      'Do not continue operating until discharge pressure is brought down',
      'Clean or clear condenser coil obstruction',
      'Repair or replace condenser fan',
      'After repair, restart and monitor discharge pressure closely',
    ],
    laborEstimate: '1.0–3.0 hours depending on cause',
    recoveryRequired: false,
  },

  {
    id: 'C025',
    category: 'Condenser',
    title: 'Head Pressure Control Malfunction',
    suction: ['normal'],
    discharge: ['high'],
    severity: 'action',
    priority: 4,
    whatThisMeans: 'The head pressure control (condenser pressure regulator or fan cycling control) is not maintaining discharge pressure correctly. In cold ambient conditions, this causes low head pressure; in warm conditions, a stuck-closed head pressure valve prevents the condenser fan from removing heat properly.',
    fieldVerification: [
      'Check ambient temperature — if above 70°F and head pressure is high, head pressure control is likely stuck or bypassing incorrectly',
      'Inspect head pressure control valve (if equipped) for sticking or incorrect setting',
      'Verify condenser fan cycling is operating correctly if unit uses fan cycling head pressure control',
    ],
    recommendedAction: [
      'In warm ambient: check if head pressure control valve is stuck in closed/restrictive position',
      'Adjust or replace head pressure control valve as needed',
      'Test condenser fan cycling control if applicable',
    ],
    laborEstimate: '1.0–2.5 hours',
    recoveryRequired: false,
  },

  // ── Non-condensables ──────────────────────────────────────────────────────────
  {
    id: 'C026',
    category: 'System Contamination',
    title: 'Non-Condensables in System (Air/Nitrogen)',
    suction: ['normal', 'low'],
    discharge: ['high', 'very_high'],
    severity: 'action',
    priority: 3,
    whatThisMeans: 'Air or nitrogen that cannot condense is trapped in the high side, raising discharge pressure abnormally. Unlike refrigerant overcharge, non-condensables cannot be condensed by the condenser — they sit in the top of the condenser coil and block effective heat transfer.',
    fieldVerification: [
      'Compare actual discharge pressure to theoretical saturation pressure at measured condenser outlet temperature — non-condensables cause discharge pressure to exceed saturation pressure',
      'Check if system has been recently serviced and improperly evacuated, or if nitrogen was used for leak testing without thorough evacuation',
      'Non-condensables are more noticeable in cool ambient conditions',
    ],
    recommendedAction: [
      'Recover refrigerant (non-condensables will vent off during recovery)',
      'Pull deep vacuum — 250 microns minimum, hold for 30 minutes',
      'Recharge with virgin or reclaimed refrigerant to nameplate weight',
      'Replace filter drier after any open-system repair',
    ],
    laborEstimate: '1.5–2.5 hours (recovery, evacuation, recharge)',
    recoveryRequired: true,
  },

  // ── Evaporator issues ─────────────────────────────────────────────────────────
  {
    id: 'C027',
    category: 'Evaporator',
    title: 'Evaporator Coil Iced — Defrost Malfunction',
    suction: ['low', 'very_low'],
    discharge: ['normal', 'low'],
    severity: 'action',
    priority: 3,
    whatThisMeans: 'Low suction pressure with normal discharge pressure is a classic sign of evaporator icing. Ice builds up on the evaporator coil when defrost is not functioning correctly or the trailer door has been left open repeatedly. As ice accumulates, airflow across the coil drops and suction pressure falls.',
    fieldVerification: [
      'Open evaporator access panel and inspect coil for ice buildup',
      'Check defrost cycle — initiate a manual defrost and verify defrost heaters (electric defrost) or hot gas valve (hot gas defrost) are activating',
      'Check evaporator drain pan for proper drainage — a frozen drain will allow ice to accumulate',
    ],
    recommendedAction: [
      'Perform a manual defrost to clear ice buildup',
      'After defrost, diagnose defrost system — check defrost termination thermostat, timer/controller, heaters, or hot gas valve as applicable',
      'Repair defrost system fault to prevent recurrence',
    ],
    laborEstimate: '1.0–3.0 hours (defrost repair after clearing ice)',
    recoveryRequired: false,
  },

  {
    id: 'C028',
    category: 'Evaporator',
    title: 'Dirty Evaporator Coil — Reduced Airflow',
    suction: ['low'],
    discharge: ['normal', 'low'],
    severity: 'caution',
    priority: 4,
    whatThisMeans: 'A dirty evaporator coil restricts airflow across the heat transfer surface, reducing the amount of heat the refrigerant can absorb. Suction pressure drops because the evaporator is not loaded properly. Common in units used to haul produce or other goods that deposit debris on the coil.',
    fieldVerification: [
      'Check evaporator coil face for debris, dust, or product residue blocking airflow',
      'Check evaporator fan blade for accumulated debris or damage',
      'Verify return air grille is clear and not obstructed',
    ],
    recommendedAction: [
      'Clean evaporator coil with appropriate coil cleaner',
      'Clean evaporator fan blade and housing',
      'Check and clean drain pan and drain tube',
    ],
    laborEstimate: '1.0–2.0 hours',
    recoveryRequired: false,
  },

  {
    id: 'C029',
    category: 'Evaporator',
    title: 'Evaporator Fan Not Running',
    suction: ['low', 'very_low'],
    discharge: ['normal'],
    severity: 'action',
    priority: 2,
    whatThisMeans: 'If the evaporator fan is not circulating air across the evaporator coil, heat transfer drops dramatically. The coil may begin to ice over, suction pressure falls, and box temperature rises. The refrigerant system appears to run but cannot deliver cooling to the box.',
    fieldVerification: [
      'Listen for evaporator fan operation — it should be audible in the box',
      'Check evaporator fan motor for power — test voltage at motor terminals',
      'Inspect evaporator fan blade — blade may have detached or may be obstructed',
    ],
    recommendedAction: [
      'Replace evaporator fan motor if failed',
      'Replace fan blade if damaged or missing',
      'Check fan speed control circuit if motor is receiving power but not running',
    ],
    laborEstimate: '1.5–3.0 hours',
    recoveryRequired: false,
  },

  // ── High-pressure safety ──────────────────────────────────────────────────────
  {
    id: 'C030',
    category: 'System Safety',
    title: 'High Pressure Relief Valve Stuck Open',
    suction: ['normal', 'high'],
    discharge: ['very_low', 'low'],
    severity: 'immediate',
    priority: 1,
    whatThisMeans: 'Discharge pressure is very low while suction is normal or high. If the high pressure relief valve has opened and is not reseating, refrigerant is venting from the high side to the suction side (internal bypass) or to atmosphere — causing discharge pressure to collapse.',
    fieldVerification: [
      'Check if unit has tripped a high pressure alarm — the HPV may have opened during a high-pressure event and stuck',
      'Smell for refrigerant around the HPV outlet connection — if venting externally, there will be a refrigerant odor',
      'Feel the HPV body — an open valve will be very cold from refrigerant flowing through it',
    ],
    recommendedAction: [
      'Replace high pressure relief valve — they are not serviceable once they have opened',
      'Diagnose and repair the root cause of the high pressure event that caused the HPV to open',
      'After HPV replacement and root cause repair, check refrigerant charge',
    ],
    laborEstimate: '1.5–3.0 hours',
    recoveryRequired: true,
  },

  {
    id: 'C031',
    category: 'System Safety',
    title: 'DANGER — Discharge Pressure Critically High (>400 PSI)',
    suction: ['normal', 'high', 'very_high', 'low', 'very_low'],
    discharge: ['very_high'],
    severity: 'immediate',
    priority: 0,
    whatThisMeans: 'Discharge pressure exceeds 400 PSI — this is above safe operating limits for transport refrigeration systems (R-404A working pressure ~400 PSI, burst pressure ~600 PSI). High pressure creates risk of refrigerant hose failure, fitting ejection, and injury from high-pressure refrigerant exposure.',
    fieldVerification: [
      'Shut the unit off before doing any inspection near the high side',
      'Do not disconnect any fittings or open any valves until pressure has dropped to a safe level',
      'After shutdown, identify cause: blocked condenser, non-condensables, severe overcharge, or failed head pressure control',
    ],
    recommendedAction: [
      'SHUT OFF UNIT IMMEDIATELY',
      'Do not attempt repairs until high-side pressure drops below 250 PSI after shutdown',
      'Diagnose cause: check condenser for complete blockage, verify refrigerant charge, check for non-condensables',
      'Do not restart until root cause is corrected and system is confirmed safe',
    ],
    laborEstimate: 'Varies by root cause — diagnose before estimating',
    recoveryRequired: false,
    dangerAlert: true,
  },

  // ── Hot gas bypass ────────────────────────────────────────────────────────────
  {
    id: 'C032',
    category: 'Controls',
    title: 'Hot Gas Bypass Valve Stuck Open',
    suction: ['high', 'very_high'],
    discharge: ['normal', 'low'],
    severity: 'action',
    priority: 3,
    whatThisMeans: 'A stuck-open hot gas bypass valve allows hot high-pressure discharge gas to bypass directly back to the suction side. This raises suction pressure, lowers discharge pressure, causes excessive suction superheat, and completely prevents the system from cooling the box.',
    fieldVerification: [
      'Feel the hot gas bypass line — if the valve is stuck open, the bypass line will be hot even in cooling mode',
      'Check for an active defrost signal that may be commanding the hot gas valve to stay open',
      'Verify the hot gas bypass solenoid valve is getting the correct control signal',
    ],
    recommendedAction: [
      'Check control system for a stuck defrost output or wiring fault keeping the valve energized',
      'Test hot gas bypass solenoid coil for proper resistance',
      'Replace hot gas bypass valve if stuck mechanically open',
    ],
    laborEstimate: '1.5–3.0 hours',
    recoveryRequired: true,
  },

  // ── High ambient ──────────────────────────────────────────────────────────────
  {
    id: 'C033',
    category: 'Operating Conditions',
    title: 'Elevated Discharge — High Ambient Operation',
    suction: ['normal'],
    discharge: ['high'],
    severity: 'caution',
    priority: 8,
    whatThisMeans: 'Discharge pressure is above the mid-range target but the suction is normal. In ambient temperatures above 90°F, this is expected behavior — the system works harder to reject heat against the high ambient. If condenser is clean and fan is running, elevated discharge pressure in high ambient is normal.',
    fieldVerification: [
      'Verify ambient temperature — if above 95°F, elevated discharge pressure up to the high end of range is acceptable',
      'Confirm condenser coil is clean and fan is at full speed',
      'Verify system is fully charged by checking sight glass and suction superheat',
    ],
    recommendedAction: [
      'If condenser is clean, fan is running, and charge is correct — this may be normal high-ambient operation',
      'Clean condenser coil if any dirt is present — even partial dirt reduces capacity significantly in high ambient',
      'Shade unit from direct sun exposure if possible during high ambient operation',
    ],
    laborEstimate: 'No repair required if condenser is clean and system is charged',
    recoveryRequired: false,
  },

  {
    id: 'C034',
    category: 'Operating Conditions',
    title: 'Extreme High Ambient — Approach to Limits',
    suction: ['normal', 'high'],
    discharge: ['very_high'],
    severity: 'action',
    priority: 4,
    whatThisMeans: 'Discharge pressure is very high with suction at normal to high. If ambient temperature is extreme (105°F+), this can occur even with a clean system. However, the combination with elevated suction suggests either overcharge or a compounding issue such as partially dirty condenser + high ambient.',
    fieldVerification: [
      'Record exact ambient temperature and compare to unit rated operating range',
      'Inspect condenser for any dirt — at very high ambient, even minor dirt becomes critical',
      'Check refrigerant charge — overcharge + high ambient can cause very high discharge pressure',
    ],
    recommendedAction: [
      'Ensure condenser is absolutely clean',
      'Verify charge is not over nameplate specification',
      'If operating above unit rated ambient range, customer should limit loads or operate during cooler hours',
    ],
    laborEstimate: '0.5–1.5 hours (inspection and condenser cleaning)',
    recoveryRequired: false,
  },

  // ── Pulldown / start-up conditions ───────────────────────────────────────────
  {
    id: 'C035',
    category: 'Operating Conditions',
    title: 'Normal Pulldown Operation — High Pressures Expected',
    suction: ['high', 'normal'],
    discharge: ['high', 'normal'],
    severity: 'normal',
    priority: 10,
    whatThisMeans: 'When pulling down a warm box, both suction and discharge pressures will be elevated above steady-state targets. This is normal — the unit is working against a high heat load. Pressures should gradually decrease over 30–90 minutes as the box cools toward setpoint.',
    fieldVerification: [
      'Verify box temperature is actively dropping toward setpoint',
      'Allow 30 minutes of operation then recheck pressures — they should be trending toward normal range',
      'If pressures do not decrease as box cools, investigate for the root cause',
    ],
    recommendedAction: [
      'No immediate action required',
      'Monitor pressures over 30-minute intervals during pulldown',
      'If pressures remain elevated after box reaches within 10°F of setpoint, diagnose for condenser or charge issues',
    ],
    laborEstimate: 'No repair required',
    recoveryRequired: false,
  },

  // ── Oil issues ────────────────────────────────────────────────────────────────
  {
    id: 'C036',
    category: 'System Contamination',
    title: 'Compressor Oil Logged in Evaporator',
    suction: ['low'],
    discharge: ['low', 'normal'],
    severity: 'caution',
    priority: 7,
    whatThisMeans: 'Oil accumulating in the evaporator coil reduces heat transfer efficiency and suction pressure. Oil logging typically occurs after compressor failure (excess oil circulation) or due to oil migration. Symptoms can mimic mild undercharge and low evaporator loading.',
    fieldVerification: [
      'Check compressor oil level — if very low, oil has migrated to the system',
      'Review recent service history for compressor replacement or oil additions',
      'Suction line may feel oily if significant oil is circulating back',
    ],
    recommendedAction: [
      'Perform an oil flush cycle if unit is equipped with this feature',
      'If oil logging is confirmed, system may need to be flushed and oil recharged to specification',
      'Diagnose reason for excess oil circulation to prevent recurrence',
    ],
    laborEstimate: '2.0–4.0 hours if system flush is required',
    recoveryRequired: true,
  },

  // ── Moisture contamination ────────────────────────────────────────────────────
  {
    id: 'C037',
    category: 'System Contamination',
    title: 'Moisture Contamination in System',
    suction: ['very_low', 'low'],
    discharge: ['normal', 'low'],
    severity: 'action',
    priority: 5,
    whatThisMeans: 'Moisture in the refrigerant circuit can freeze at the metering device (particularly in low-temperature applications) causing intermittent blockage. Moisture also causes acid formation in the oil, accelerating compressor wear. This condition may appear and disappear — restriction clears as ice melts, then returns as moisture refreezes.',
    fieldVerification: [
      'Check sight glass moisture indicator — if indicator is yellow or pink, moisture is present',
      'Note if symptoms are intermittent — freeze-ups will clear after unit is off, then return',
      'Check filter drier — a saturated drier indicates moisture has entered the system',
    ],
    recommendedAction: [
      'Replace filter drier immediately',
      'If drier is very saturated, multiple drier replacements may be needed',
      'Recover refrigerant, install new drier, pull deep vacuum (250 microns minimum), recharge',
      'Identify how moisture entered — open service valves, poorly sealed fittings, or contaminated refrigerant',
    ],
    laborEstimate: '2.0–3.0 hours (drier replacement + recharge)',
    recoveryRequired: true,
  },

  // ── EPR / capacity control ────────────────────────────────────────────────────
  {
    id: 'C038',
    category: 'Controls',
    title: 'Evaporator Pressure Regulator (EPR) Malfunction',
    suction: ['very_low', 'low'],
    discharge: ['normal'],
    severity: 'action',
    priority: 5,
    whatThisMeans: 'The EPR valve controls minimum evaporator pressure to prevent freezing of perishable cargo. If the EPR fails in the closed position, it starves the compressor and causes suction pressure to drop. If it fails open, the evaporator may run too cold.',
    fieldVerification: [
      'Check suction pressure against setpoint — EPR should maintain minimum evaporator pressure at a preset value',
      'On units equipped with EPR, feel inlet and outlet of valve for temperature differential',
      'Check EPR control signal if electrically controlled',
    ],
    recommendedAction: [
      'Adjust EPR setting if outside specification range',
      'Replace EPR valve if stuck or not responding to adjustment',
      'After replacement, verify suction pressure maintains correct minimum',
    ],
    laborEstimate: '2.0–3.5 hours',
    recoveryRequired: true,
  },

  // ── Discharge line restriction ────────────────────────────────────────────────
  {
    id: 'C039',
    category: 'System Restriction',
    title: 'Discharge Line Restriction',
    suction: ['normal', 'low'],
    discharge: ['very_low', 'low'],
    severity: 'action',
    priority: 4,
    whatThisMeans: 'Normal suction with very low discharge pressure indicates the high side refrigerant cannot leave the compressor efficiently. A restriction in the discharge line — kinked line, partially closed discharge service valve, or plugged muffler — creates an unusual pressure pattern.',
    fieldVerification: [
      'Verify discharge service valve is fully open (back-seated)',
      'Inspect discharge line for kinks or damage',
      'Feel discharge muffler (if equipped) for abnormal temperature or pressure differential',
    ],
    recommendedAction: [
      'Open discharge service valve fully if cracked closed',
      'Repair or replace kinked discharge line',
      'Replace discharge muffler if restricted',
    ],
    laborEstimate: '0.5–2.5 hours',
    recoveryRequired: false,
  },

  // ── Capacity control / unloader ───────────────────────────────────────────────
  {
    id: 'C040',
    category: 'Controls',
    title: 'Unloader Valve Stuck Open — Reduced Capacity',
    suction: ['normal', 'high'],
    discharge: ['low', 'normal'],
    severity: 'caution',
    priority: 6,
    whatThisMeans: 'If the compressor unloader valve is stuck in the open (unloaded) position, the compressor operates at reduced displacement. Suction pressure rises as the compressor cannot pull down the evaporator, and discharge builds less pressure. The unit will struggle to maintain setpoint under any significant heat load.',
    fieldVerification: [
      'Check for an active control signal commanding the unloader to operate',
      'Verify that the unit controller is not commanding part-load mode when it should be at full capacity',
      'Test unloader solenoid valve function',
    ],
    recommendedAction: [
      'Diagnose control circuit — verify unloader command from controller is correct',
      'Test unloader solenoid coil resistance',
      'Replace unloader valve or solenoid as needed',
    ],
    laborEstimate: '1.5–3.0 hours',
    recoveryRequired: false,
  },
]

// ─── Engine ───────────────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<DiagSeverity, number> = {
  immediate: 0,
  action:    1,
  caution:   2,
  normal:    3,
}

export function runGaugeDiagnostic(input: GaugeDiagInput): GaugeDiagOutput {
  const { actualSuction, actualDischarge, suctionLow, suctionHigh, dischargeLow, dischargeHigh } = input

  const suctionStatus   = classifySuction(actualSuction, suctionLow, suctionHigh)
  const dischargeStatus = classifyDischarge(actualDischarge, dischargeLow, dischargeHigh)

  const dangerAlert = actualDischarge > 400

  const matches = GAUGE_CONDITIONS.filter(c =>
    c.suction.includes(suctionStatus) && c.discharge.includes(dischargeStatus)
  )

  // Sort: severity asc (immediate first), then priority asc
  matches.sort((a, b) => {
    const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    return sevDiff !== 0 ? sevDiff : a.priority - b.priority
  })

  const toResult = (c: GaugeDiagCondition): GaugeDiagResult => ({
    id:               c.id,
    title:            c.title,
    category:         c.category,
    severity:         c.severity,
    whatThisMeans:    c.whatThisMeans,
    fieldVerification: c.fieldVerification,
    recommendedAction: c.recommendedAction,
    laborEstimate:    c.laborEstimate,
    recoveryRequired: c.recoveryRequired,
  })

  const primary   = matches.length > 0 ? toResult(matches[0]) : null
  const secondary = matches.slice(1, 5).map(toResult)

  return { suctionStatus, dischargeStatus, primary, secondary, dangerAlert }
}
