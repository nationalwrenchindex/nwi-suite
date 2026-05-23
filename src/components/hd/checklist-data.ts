export type ItemState = 'pass' | 'flag' | 'na' | null

export interface ChecklistItem {
  id:       string
  text:     string
  refWarn?: boolean      // show refrigerant safety warning
  input?:   {            // optional text/number input
    label:     string
    type:      'text' | 'number'
    autoFlag?: { below: number }  // auto-flag if numeric value below threshold
  }
}

export interface ChecklistSection {
  id:       string
  title:    string
  items:    ChecklistItem[]
  showWhen?: '12month' | '24month' | 'multitemp'  // omit = always show
}

export const SAFETY_ITEMS = [
  {
    id:    's1',
    title: 'Electrical Shock',
    text:  'High voltage present. Disconnect shore power and verify unit is de-energized before servicing electrical components.',
  },
  {
    id:    's2',
    title: 'Refrigerant Hazard',
    text:  'R-404A and R-452A are under high pressure and extremely dangerous. EPA 608 certification required. Risk of burns, eye damage, and gas poisoning. Never work alone on refrigerant systems. Always wear proper PPE.',
  },
  {
    id:    's3',
    title: 'Rotating Components',
    text:  'Belts, fans, and pulleys will cause serious injury. Never reach into rotating components. Ensure all guards are in place before startup.',
  },
  {
    id:    's4',
    title: 'Hot Surfaces',
    text:  'Engine, exhaust, and refrigerant components reach extreme temperatures. Allow adequate cool-down time before servicing.',
  },
  {
    id:    's5',
    title: 'Fire Hazard',
    text:  'Fuel, oil, and refrigerant are flammable or combustible under certain conditions. No open flames near the unit.',
  },
  {
    id:    's6',
    title: 'Pinch Points',
    text:  'Unit doors, mounting hardware, and mechanical linkages create pinch hazards.',
  },
  {
    id:    's7',
    title: 'Gas and Fume Exposure',
    text:  'Engine exhaust, refrigerant vapors, and battery gases are toxic. Always service in a well ventilated area.',
  },
  {
    id:    's8',
    title: 'PPE Required',
    text:  'Safety glasses or face shield, work gloves, steel toed boots, and snug fitting clothing required at all times.',
  },
  {
    id:    's9',
    title: 'Extra Shop Rags',
    text:  'Keep a supply on hand. Unexpected sparks happen to even the most experienced technicians. Be prepared.',
  },
] as const

export const CHECKLIST_SECTIONS: ChecklistSection[] = [
  {
    id:    'unit-exam',
    title: 'Section 1 — Unit Examination',
    items: [
      { id: '1-01', text: 'Place all unit switches in the Off position' },
      { id: '1-02', text: 'Check unit doors — open, close and latch properly' },
      { id: '1-03', text: 'Check unit mounting hardware for tightness' },
      { id: '1-04', text: 'Check defrost drain hoses and flapper valves' },
      { id: '1-05', text: 'Check compressor coupler bushings for wear' },
      { id: '1-06', text: 'Check compressor and engine mounts and mounting hardware' },
      { id: '1-07', text: 'Check for refrigerant leaks', refWarn: true },
      { id: '1-08', text: 'Check coolant for leaks' },
      { id: '1-09', text: 'Check air intake hoses and components' },
      { id: '1-10', text: 'Check throttle solenoid plunger, linkage and boot' },
      { id: '1-11', text: 'Check for loose, frayed, or chafed wiring' },
      { id: '1-12', text: 'Check idlers and fan shafts' },
      { id: '1-13', text: 'Check drive belts for condition and tension' },
      { id: '1-14', text: 'Check reset switch circuit in Continuous Run' },
      { id: '1-15', text: 'Check radiator and condenser for cleanliness' },
      { id: '1-16', text: 'Check coolant level and condition' },
      { id: '1-17', text: 'Check engine exhaust system' },
      {
        id:   '1-18',
        text: 'Check battery cranking amps — Below 800 CCA recommend immediate replacement. Battery tester required. HD range: 800 CCA min / 1050 CCA max.',
        input: {
          label: 'Battery CCA',
          type:  'number',
          autoFlag: { below: 800 },
        },
      },
      { id: '1-19', text: 'Check and clean both battery cable connections' },
      { id: '1-20', text: 'Check battery hold-downs' },
      { id: '1-21', text: 'Check compressor clutch' },
      { id: '1-22', text: 'Check cord and plug' },
    ],
  },
  {
    id:    'inside-trailer',
    title: 'Section 2 — Inside Trailer',
    items: [
      { id: '2-01', text: 'Check condition of box insulation and door seals' },
      { id: '2-02', text: 'Check floor drain hoses and flapper valves' },
      { id: '2-03', text: 'Check front bulkhead, floor channels and air chute for airflow restrictions' },
      { id: '2-04', text: 'Check evaporator coil for cleanliness and signs of refrigerant leaks', refWarn: true },
      { id: '2-05', text: 'Check damper door linkage, bushings and springs' },
    ],
  },
  {
    id:       'multi-temp',
    title:    'Section 3 — Multi-Temp Units Only',
    showWhen: 'multitemp',
    items: [
      { id: '3-01', text: 'Check remote evaporators for physical damage' },
      { id: '3-02', text: 'Check for damaged, loose or missing hardware' },
      { id: '3-03', text: 'Check evaporator coil cleanliness' },
      { id: '3-04', text: 'Check defrost drain hoses and flapper valves' },
      { id: '3-05', text: 'Check for signs of refrigerant leaks', refWarn: true },
      { id: '3-06', text: 'Check for loose or frayed wiring' },
      { id: '3-07', text: 'Check compartment bulkheads' },
    ],
  },
  {
    id:    'startup',
    title: 'Section 4 — Initial Start-Up Inspection',
    items: [
      {
        id:   '4-01',
        text: 'Record and clear all alarms',
        input: { label: 'Alarm codes found', type: 'text' },
      },
      { id: '4-02', text: 'Set all compartment setpoints as low as possible' },
      { id: '4-03', text: 'Place unit in Cycle Sentry mode and allow unit to preheat and start' },
      { id: '4-04', text: 'Check glow plug operation during preheat' },
      { id: '4-05', text: 'Check starter operation during start' },
      { id: '4-06', text: 'Check that engine starts quickly and smoothly' },
      { id: '4-07', text: 'Check ammeter for positive charge rate' },
      { id: '4-08', text: 'Check for exhaust leaks' },
    ],
  },
  {
    id:    'running',
    title: 'Section 5 — Running Inspection',
    items: [
      { id: '5-01', text: 'Check for abnormal noise or vibrations' },
      { id: '5-02', text: 'Check operation in high and low speed' },
      { id: '5-03', text: 'Check indicator lights' },
    ],
  },
  {
    id:    'fuel',
    title: 'Section 6 — Fuel Tank Checks During Pulldown',
    items: [
      { id: '6-01', text: 'Check for proper fuel decal' },
      { id: '6-02', text: 'Check fuel tank and fuel lines for leaks' },
      { id: '6-03', text: 'Check fuel tank vent and fuel tank mounts' },
      { id: '6-04', text: 'Drain fuel tank sump' },
    ],
  },
  {
    id:    'pulldown',
    title: 'Section 7 — When Box Temperature Reaches 35°F',
    items: [
      { id: '7-01', text: 'Perform Refrigerant Level Quick Check', refWarn: true },
      { id: '7-02', text: 'Initiate manual defrost in all compartments' },
      { id: '7-03', text: 'Check defrost indicator lights' },
      { id: '7-04', text: 'Check remote evaporator for proper fan mode operation' },
      { id: '7-05', text: 'Check for proper defrost termination' },
      { id: '7-06', text: 'Check compressor oil level', refWarn: true },
      { id: '7-07', text: 'Place all unit switches in the OFF position' },
    ],
  },
  {
    id:    'engine-off',
    title: 'Section 8 — Engine Off Service — Fluid and Filter Change PM',
    items: [
      { id: '8-01', text: 'Drain engine oil' },
      { id: '8-02', text: 'Change engine oil filters' },
      { id: '8-03', text: 'Change fuel filters and water separator' },
      { id: '8-04', text: 'Service air cleaner' },
      { id: '8-05', text: 'Reset engine air restriction indicator' },
      { id: '8-06', text: 'Fill crankcase with approved oil' },
      { id: '8-07', text: 'Bleed air from fuel system' },
    ],
  },
  {
    id:    'restart',
    title: 'Section 9 — Restart Engine',
    items: [
      { id: '9-01', text: 'Check for abnormal noises on startup' },
      { id: '9-02', text: 'Check for proper oil pressure' },
      { id: '9-03', text: 'Check for oil and fuel leaks' },
      { id: '9-04', text: 'Return setpoint to original setting', input: { label: 'Original setpoint', type: 'text' } },
      { id: '9-05', text: 'Place all unit switches in the OFF position' },
      { id: '9-06', text: 'Verify correct engine oil level' },
    ],
  },
  {
    id:    'pretrip',
    title: 'Section 10 — Pre-Trip Test or Unit Self Check',
    items: [
      { id: '10-01', text: 'Run Pre-trip Test or Unit Self Check' },
    ],
  },
  {
    id:    'complete',
    title: 'Section 11 — Complete the Inspection',
    items: [
      { id: '11-01', text: 'Clean unit as necessary' },
      { id: '11-02', text: 'Perform repairs as indicated by these inspections' },
      { id: '11-03', text: 'Complete documentation as required' },
    ],
  },
  {
    id:       '12month',
    title:    'Section 12 — 12 Month Inspections Only',
    showWhen: '12month',
    items: [
      { id: '12-01', text: 'Install gauge set' },
      { id: '12-02', text: 'Adjust setpoint to 0°F and start the unit' },
      {
        id:   '12-03',
        text: 'Test air switch and record value',
        input: { label: 'Air switch — Actual / Spec', type: 'text' },
      },
      {
        id:   '12-04',
        text: 'Test remote evaporator air switches — Center / Rear / Spec',
        input: { label: 'Center / Rear / Spec values', type: 'text' },
      },
      {
        id:   '12-05',
        text: 'Check and adjust high speed RPM',
        input: { label: 'Actual / Spec', type: 'text' },
      },
      {
        id:   '12-06',
        text: 'Check and adjust low speed RPM',
        input: { label: 'Actual / Spec', type: 'text' },
      },
      { id: '12-07', text: 'Perform Controlled Refrigerant Level Check', refWarn: true },
      { id: '12-08', text: 'Check compressor oil sample', refWarn: true },
      { id: '12-09', text: 'Check compressor capacity' },
      { id: '12-10', text: 'Grease damper door linkage, stops and bushings' },
      { id: '12-11', text: 'Check remote evaporator fan motor operation' },
      {
        id:   '12-12',
        text: 'Return setpoint to original setting',
        input: { label: 'Original setpoint', type: 'text' },
      },
    ],
  },
  {
    id:       '24month',
    title:    'Section 13 — 24 Month Inspections Only',
    showWhen: '24month',
    items: [
      { id: '13-01', text: 'Replace filter/drier every 2 years', refWarn: true },
      { id: '13-02', text: 'Replace compressor oil filter every 2 years — except screw compressor units' },
      { id: '13-03', text: 'Change engine coolant every 2 years' },
      { id: '13-04', text: 'Check Throttling Valve or ETV Suction Pressure Regulator' },
    ],
  },
]

export const PM_TYPES = [
  { value: 'dry',                  label: 'Dry Inspection Only (1.0 hr)',           hours: { truck: 1.0,  trailer: 1.0  } },
  { value: '3000hr',               label: 'Full Wet Service — No Belts (2.5 hr)',   hours: { truck: 2.5,  trailer: 2.5  } },
  { value: 'full_belts_trailer',   label: 'Full Wet + Belts — Trailer (3.0 hr)',    hours: { truck: null, trailer: 3.0  } },
  { value: 'full_belts_truck',     label: 'Full Wet + Belts — Truck (3.25 hr)',     hours: { truck: 3.25, trailer: null } },
  { value: '12month',              label: '12-Month Full Inspection',               hours: { truck: 3.25, trailer: 3.0  } },
  { value: '24month',              label: '24-Month Full Inspection',               hours: { truck: 3.25, trailer: 3.0  } },
] as const

export type PMTypeValue = typeof PM_TYPES[number]['value']
