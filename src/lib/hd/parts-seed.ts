// NWI HD Suite — Parts Seed Data
// ~210 TK + Carrier + Delco Remy parts with cross-references

export interface SeedPart {
  part_number:   string
  manufacturer:  'Thermo King' | 'Carrier Transicold' | 'Delco Remy' | 'Generic'
  description:   string
  category:      string
  unit_models:   string[]
  notes?:        string
  superseded_by?: string
  field_critical: boolean
}

export interface SeedCrossRef {
  part_number: string
  cross_mfr:   string
  cross_part:  string
  cross_notes?: string
}

export const SEED_PARTS: SeedPart[] = [

  // ─── THERMO KING — STARTERS ──────────────────────────────────────────────────

  {
    part_number: '45-2324',
    manufacturer: 'Thermo King',
    description: 'Starter Assembly — Yanmar 486V Tier 2',
    category: 'starter',
    unit_models: ['SL-200', 'SL-400', 'SL-100', 'TS-600', 'TS-800', 'TS-1000'],
    notes: 'Most common starter on Yanmar-powered TK truck units. Verify engine serial before ordering.',
    field_critical: true,
  },
  {
    part_number: '45-2323',
    manufacturer: 'Thermo King',
    description: 'Starter Assembly — Yanmar 386V',
    category: 'starter',
    unit_models: ['SL-100', 'SL-200', 'MD-100', 'MD-200'],
    field_critical: true,
  },
  {
    part_number: '45-2325',
    manufacturer: 'Thermo King',
    description: 'Starter Assembly — Yanmar 486V Tier 4',
    category: 'starter',
    unit_models: ['SLXi-100', 'SLXi-200', 'SLXi-300', 'SLXi-400'],
    field_critical: true,
  },
  {
    part_number: '45-2317',
    manufacturer: 'Thermo King',
    description: 'Starter Solenoid',
    category: 'starter',
    unit_models: ['SL-200', 'SL-400', 'SLXi-100', 'SLXi-200', 'TS-600'],
    notes: 'Check voltage at 8S wire before condemning solenoid.',
    field_critical: false,
  },

  // ─── THERMO KING — ALTERNATORS ───────────────────────────────────────────────

  {
    part_number: '44-2228',
    manufacturer: 'Thermo King',
    description: 'Alternator 55A — Yanmar 486V Tier 2',
    category: 'alternator',
    unit_models: ['SL-200', 'SL-400', 'TS-600', 'TS-800'],
    notes: 'Load test battery before replacing alternator — weak battery mimics charging failure.',
    field_critical: true,
  },
  {
    part_number: '44-2230',
    manufacturer: 'Thermo King',
    description: 'Alternator 70A — Yanmar 486V Tier 4',
    category: 'alternator',
    unit_models: ['SLXi-100', 'SLXi-200', 'SLXi-300', 'SLXi-400'],
    field_critical: true,
  },
  {
    part_number: '44-2215',
    manufacturer: 'Thermo King',
    description: 'Alternator 55A — Yanmar 386V',
    category: 'alternator',
    unit_models: ['SL-100', 'MD-100', 'MD-200'],
    field_critical: true,
  },
  {
    part_number: '44-5049',
    manufacturer: 'Thermo King',
    description: 'Alternator Bracket Assembly',
    category: 'alternator',
    unit_models: ['SL-200', 'SL-400', 'SLXi-200', 'SLXi-400'],
    field_critical: false,
  },

  // ─── THERMO KING — FUEL SYSTEM ───────────────────────────────────────────────

  {
    part_number: '11-9957',
    manufacturer: 'Thermo King',
    description: 'Fuel Filter — Primary',
    category: 'filter',
    unit_models: ['SL-100', 'SL-200', 'SL-400', 'SLXi-100', 'SLXi-200', 'SLXi-400', 'TS-600', 'TS-800'],
    notes: 'Replace at every 3000-hour PM. Replace immediately if inlet screen found clogged.',
    field_critical: false,
  },
  {
    part_number: '11-9958',
    manufacturer: 'Thermo King',
    description: 'Fuel Filter — Secondary',
    category: 'filter',
    unit_models: ['SL-200', 'SL-400', 'SLXi-200', 'SLXi-400'],
    field_critical: false,
  },
  {
    part_number: '12-0592',
    manufacturer: 'Thermo King',
    description: 'Fuel Solenoid — 8DP Circuit 0.2–0.5 Ohm',
    category: 'solenoid',
    unit_models: ['SL-100', 'SL-200', 'SL-400', 'MD-100', 'MD-200'],
    notes: '8DP wire: 0.2–0.5 ohms. 8D wire: 24–30 ohms. Test between CH wire and solenoid harness.',
    field_critical: true,
  },
  {
    part_number: '12-0600',
    manufacturer: 'Thermo King',
    description: 'Fuel Solenoid — High Speed (Speed Solenoid)',
    category: 'solenoid',
    unit_models: ['SL-200', 'SL-400', 'TS-600', 'TS-800'],
    notes: 'Check diode on solenoid. Check for seized speed plunger before condemning solenoid.',
    field_critical: false,
  },
  {
    part_number: '12-0700',
    manufacturer: 'Thermo King',
    description: 'Solenoid Diode — Install on All Solenoid Replacements',
    category: 'solenoid',
    unit_models: ['SL-100', 'SL-200', 'SL-400', 'SLXi-100', 'SLXi-200', 'SLXi-400', 'TS-600'],
    notes: 'Always install a new diode when replacing any solenoid. Suppresses voltage spike.',
    field_critical: true,
  },
  {
    part_number: '11-0287',
    manufacturer: 'Thermo King',
    description: 'Electric Fuel Pump',
    category: 'fuel_pump',
    unit_models: ['SL-100', 'SL-200', 'MD-100', 'MD-200'],
    notes: 'Check for battery voltage at pump during start attempt before condemning.',
    field_critical: true,
  },
  {
    part_number: '11-0290',
    manufacturer: 'Thermo King',
    description: 'Injection Pump Banjo Bolt Copper Crush Washers — Pack of 10',
    category: 'fuel_pump',
    unit_models: ['SL-100', 'SL-200', 'SL-400', 'SLXi-100', 'SLXi-200', 'MD-100'],
    notes: 'Replace copper crushers on BOTH sides of banjo bolt at every banjo removal. Never reuse.',
    field_critical: true,
  },

  // ─── THERMO KING — GLOW PLUGS ────────────────────────────────────────────────

  {
    part_number: '41-6816',
    manufacturer: 'Thermo King',
    description: 'Glow Plug — Yanmar 486V (Set of 4)',
    category: 'glow_plug',
    unit_models: ['SL-200', 'SL-400', 'SLXi-200', 'SLXi-400', 'TS-600', 'TS-800'],
    notes: 'Test individual plug resistance. Failed glow plugs cause cold-start failure.',
    field_critical: true,
  },
  {
    part_number: '41-6810',
    manufacturer: 'Thermo King',
    description: 'Glow Plug — Yanmar 386V (Set of 3)',
    category: 'glow_plug',
    unit_models: ['SL-100', 'MD-100', 'MD-200'],
    field_critical: true,
  },

  // ─── THERMO KING — BELTS ─────────────────────────────────────────────────────

  {
    part_number: '78-1088',
    manufacturer: 'Thermo King',
    description: 'Alternator Drive Belt — Yanmar 486V',
    category: 'belt',
    unit_models: ['SL-200', 'SL-400', 'TS-600', 'TS-800'],
    notes: 'Inspect at every PM. A glazed belt slips under load without showing visible cracks.',
    field_critical: false,
  },
  {
    part_number: '78-1090',
    manufacturer: 'Thermo King',
    description: 'Condenser Fan Belt — SL Series',
    category: 'belt',
    unit_models: ['SL-100', 'SL-200', 'SL-400'],
    notes: 'Replace all belts as a set when one fails.',
    field_critical: false,
  },
  {
    part_number: '78-1095',
    manufacturer: 'Thermo King',
    description: 'Compressor Drive Belt — SL-200/SL-400',
    category: 'belt',
    unit_models: ['SL-200', 'SL-400'],
    field_critical: false,
  },
  {
    part_number: '78-1100',
    manufacturer: 'Thermo King',
    description: 'Vibrasorber Mounting Belt — Trailer Units',
    category: 'vibrasorber',
    unit_models: ['TS-600', 'TS-800', 'TS-1000'],
    notes: 'Inspect vibrasorber rubber coupling for cracking at every PM.',
    field_critical: false,
  },

  // ─── THERMO KING — COOLING SYSTEM ────────────────────────────────────────────

  {
    part_number: '22-1090',
    manufacturer: 'Thermo King',
    description: 'Thermostat — Yanmar 486V (82°C Opening)',
    category: 'thermostat',
    unit_models: ['SL-200', 'SL-400', 'SLXi-200', 'SLXi-400', 'TS-600', 'TS-800'],
    notes: 'Boil test: should begin opening at ~180°F, fully open by ~200°F.',
    field_critical: false,
  },
  {
    part_number: '22-1085',
    manufacturer: 'Thermo King',
    description: 'Thermostat — Yanmar 386V',
    category: 'thermostat',
    unit_models: ['SL-100', 'MD-100', 'MD-200'],
    field_critical: false,
  },
  {
    part_number: '22-1200',
    manufacturer: 'Thermo King',
    description: 'Water Pump Assembly — Yanmar 486V',
    category: 'water_pump',
    unit_models: ['SL-200', 'SL-400', 'SLXi-200', 'SLXi-400', 'TS-600'],
    notes: 'Check weep hole for coolant leak and shaft for bearing noise and play.',
    field_critical: false,
  },
  {
    part_number: '22-1195',
    manufacturer: 'Thermo King',
    description: 'Water Pump Assembly — Yanmar 386V',
    category: 'water_pump',
    unit_models: ['SL-100', 'MD-100', 'MD-200'],
    field_critical: false,
  },

  // ─── THERMO KING — SENSORS ───────────────────────────────────────────────────

  {
    part_number: '41-1875',
    manufacturer: 'Thermo King',
    description: 'Return Air Temperature Sensor',
    category: 'sensor',
    unit_models: ['SL-100', 'SL-200', 'SL-400', 'SLXi-100', 'SLXi-200', 'SLXi-400', 'TS-600', 'TS-800', 'TS-1000'],
    notes: 'Most common sensor failure. Causes unit to run on false temperature reading.',
    field_critical: false,
  },
  {
    part_number: '41-1877',
    manufacturer: 'Thermo King',
    description: 'Discharge Air Temperature Sensor',
    category: 'sensor',
    unit_models: ['SL-100', 'SL-200', 'SL-400', 'SLXi-100', 'SLXi-200', 'SLXi-400'],
    field_critical: false,
  },
  {
    part_number: '41-1880',
    manufacturer: 'Thermo King',
    description: 'Coolant Temperature Sensor — Yanmar 486V',
    category: 'sensor',
    unit_models: ['SL-200', 'SL-400', 'SLXi-200', 'SLXi-400', 'TS-600', 'TS-800'],
    notes: 'Check resistance against spec. Load test battery before replacing — weak battery causes false coolant readings.',
    field_critical: false,
  },
  {
    part_number: '41-3625',
    manufacturer: 'Thermo King',
    description: 'Oil Pressure Switch',
    category: 'switch',
    unit_models: ['SL-100', 'SL-200', 'SL-400', 'SLXi-100', 'SLXi-200', 'MD-100'],
    notes: 'Alarm 19. Check oil level before diagnosing switch. Never restart unit until root cause confirmed.',
    field_critical: true,
  },
  {
    part_number: '41-3630',
    manufacturer: 'Thermo King',
    description: 'Coolant Level Switch',
    category: 'switch',
    unit_models: ['SL-200', 'SL-400', 'SLXi-200', 'SLXi-400'],
    field_critical: false,
  },
  {
    part_number: '66-6100',
    manufacturer: 'Thermo King',
    description: 'Suction Pressure Transducer',
    category: 'sensor',
    unit_models: ['SL-200', 'SL-400', 'SLXi-200', 'SLXi-400', 'TS-600', 'TS-800'],
    field_critical: false,
  },
  {
    part_number: '66-6102',
    manufacturer: 'Thermo King',
    description: 'Discharge Pressure Transducer',
    category: 'sensor',
    unit_models: ['SL-200', 'SL-400', 'SLXi-200', 'SLXi-400', 'TS-600'],
    field_critical: false,
  },

  // ─── THERMO KING — AIR FILTER ─────────────────────────────────────────────────

  {
    part_number: '11-7060',
    manufacturer: 'Thermo King',
    description: 'Air Filter — Yanmar 486V',
    category: 'filter',
    unit_models: ['SL-200', 'SL-400', 'SLXi-200', 'SLXi-400', 'TS-600', 'TS-800', 'TS-1000'],
    notes: 'Inspect at every service. A collapsed or soot-packed filter causes RPM drop and low speed issues.',
    field_critical: false,
  },
  {
    part_number: '11-7055',
    manufacturer: 'Thermo King',
    description: 'Air Filter — Yanmar 386V',
    category: 'filter',
    unit_models: ['SL-100', 'MD-100', 'MD-200'],
    field_critical: false,
  },

  // ─── THERMO KING — OIL FILTERS ───────────────────────────────────────────────

  {
    part_number: '11-9959',
    manufacturer: 'Thermo King',
    description: 'Engine Oil Filter — Yanmar 486V',
    category: 'filter',
    unit_models: ['SL-200', 'SL-400', 'SLXi-200', 'SLXi-400', 'TS-600', 'TS-800'],
    field_critical: false,
  },
  {
    part_number: '11-9955',
    manufacturer: 'Thermo King',
    description: 'Engine Oil Filter — Yanmar 386V',
    category: 'filter',
    unit_models: ['SL-100', 'MD-100', 'MD-200'],
    field_critical: false,
  },

  // ─── THERMO KING — REFRIGERANT / COMPRESSOR ──────────────────────────────────

  {
    part_number: '66-5000',
    manufacturer: 'Thermo King',
    description: 'Compressor Assembly — X426 (SL Truck)',
    category: 'compressor',
    unit_models: ['SL-200', 'SL-400'],
    notes: 'EPA 608 required for compressor replacement. Recover refrigerant before removal.',
    field_critical: true,
  },
  {
    part_number: '66-5010',
    manufacturer: 'Thermo King',
    description: 'Compressor Assembly — X430 (TS Trailer)',
    category: 'compressor',
    unit_models: ['TS-600', 'TS-800', 'TS-1000'],
    notes: 'EPA 608 required.',
    field_critical: true,
  },
  {
    part_number: '66-5050',
    manufacturer: 'Thermo King',
    description: 'Compressor Shaft Seal Kit',
    category: 'compressor',
    unit_models: ['SL-200', 'SL-400', 'SLXi-200', 'TS-600', 'TS-800'],
    notes: 'Primary refrigerant leak point on high-hour units. Look for oil staining around shaft.',
    field_critical: false,
  },
  {
    part_number: '66-3000',
    manufacturer: 'Thermo King',
    description: 'Receiver Drier',
    category: 'refrigerant',
    unit_models: ['SL-100', 'SL-200', 'SL-400', 'SLXi-100', 'SLXi-200', 'SLXi-400'],
    notes: 'Replace any time system is opened. EPA 608 required.',
    field_critical: false,
  },
  {
    part_number: '66-3010',
    manufacturer: 'Thermo King',
    description: 'Expansion Valve',
    category: 'refrigerant',
    unit_models: ['SL-200', 'SL-400', 'SLXi-200', 'SLXi-400', 'TS-600', 'TS-800'],
    notes: 'EPA 608 required.',
    field_critical: false,
  },
  {
    part_number: '66-2010',
    manufacturer: 'Thermo King',
    description: 'Schrader Valve Cores — Pack of 10',
    category: 'refrigerant',
    unit_models: ['SL-100', 'SL-200', 'SL-400', 'SLXi-100', 'SLXi-200', 'TS-600', 'TS-800'],
    notes: 'Common refrigerant leak source. Check cores at every PM. EPA 608 required.',
    field_critical: false,
  },

  // ─── THERMO KING — CONTROLLER ─────────────────────────────────────────────────

  {
    part_number: '41-8800',
    manufacturer: 'Thermo King',
    description: 'SR-3 Microprocessor Controller',
    category: 'controller',
    unit_models: ['SL-200', 'SL-400', 'SLXi-200', 'SLXi-400'],
    notes: 'Load test battery before condemning controller — weak battery causes false controller faults.',
    field_critical: true,
  },
  {
    part_number: '41-8810',
    manufacturer: 'Thermo King',
    description: 'HMI Display — SR-3 Series',
    category: 'controller',
    unit_models: ['SL-200', 'SL-400', 'SLXi-200', 'SLXi-400'],
    field_critical: false,
  },
  {
    part_number: '41-8820',
    manufacturer: 'Thermo King',
    description: 'SR-2 Microprocessor Controller',
    category: 'controller',
    unit_models: ['SL-100', 'MD-100', 'MD-200'],
    notes: 'Load test battery before condemning controller.',
    field_critical: true,
  },

  // ─── THERMO KING — SLXi SPECIFIC ─────────────────────────────────────────────

  {
    part_number: '41-8850',
    manufacturer: 'Thermo King',
    description: 'SLXi Controller — Tier 4 Engine',
    category: 'controller',
    unit_models: ['SLXi-100', 'SLXi-200', 'SLXi-300', 'SLXi-400'],
    field_critical: true,
  },
  {
    part_number: '78-1110',
    manufacturer: 'Thermo King',
    description: 'Serpentine Drive Belt — SLXi Series',
    category: 'belt',
    unit_models: ['SLXi-100', 'SLXi-200', 'SLXi-300', 'SLXi-400'],
    field_critical: false,
  },

  // ─── THERMO KING — BATTERIES ──────────────────────────────────────────────────

  {
    part_number: '83-1310',
    manufacturer: 'Thermo King',
    description: 'Battery 12V 1050 CCA — Group 31',
    category: 'battery',
    unit_models: ['SL-100', 'SL-200', 'SL-400', 'SLXi-100', 'SLXi-200', 'SLXi-400', 'TS-600', 'TS-800', 'TS-1000'],
    notes: 'Minimum 800 CCA, maximum 1050 CCA. Load test before any electrical diagnosis.',
    field_critical: true,
  },

  // ─── CARRIER TRANSICOLD — STARTERS ───────────────────────────────────────────

  {
    part_number: '30-00400-00',
    manufacturer: 'Carrier Transicold',
    description: 'Starter Assembly — Supra 550/650',
    category: 'starter',
    unit_models: ['Supra 550', 'Supra 650'],
    notes: 'Check voltage at starter during crank attempt before condemning.',
    field_critical: true,
  },
  {
    part_number: '30-00401-00',
    manufacturer: 'Carrier Transicold',
    description: 'Starter Assembly — Supra 750/850',
    category: 'starter',
    unit_models: ['Supra 750', 'Supra 850'],
    field_critical: true,
  },
  {
    part_number: '30-00402-00',
    manufacturer: 'Carrier Transicold',
    description: 'Starter Assembly — Supra 950/960/1250',
    category: 'starter',
    unit_models: ['Supra 950', 'Supra 960', 'Supra 1250'],
    field_critical: true,
  },
  {
    part_number: '30-00410-00',
    manufacturer: 'Carrier Transicold',
    description: 'Starter Assembly — Ultima 53 / X2 Series Trailer',
    category: 'starter',
    unit_models: ['Ultima 53', 'Ultima XT', 'X2 2100', 'X2 2200', 'X2 2500'],
    field_critical: true,
  },

  // ─── CARRIER TRANSICOLD — ALTERNATORS ────────────────────────────────────────

  {
    part_number: '30-00300-00',
    manufacturer: 'Carrier Transicold',
    description: 'Alternator 70A — Supra 550/650',
    category: 'alternator',
    unit_models: ['Supra 550', 'Supra 650'],
    notes: 'Check all drive belts first — broken or slipping belt is the most common charging failure cause on Carrier.',
    field_critical: true,
  },
  {
    part_number: '30-00301-00',
    manufacturer: 'Carrier Transicold',
    description: 'Alternator 70A — Supra 750/850/950',
    category: 'alternator',
    unit_models: ['Supra 750', 'Supra 850', 'Supra 950'],
    field_critical: true,
  },
  {
    part_number: '30-00302-00',
    manufacturer: 'Carrier Transicold',
    description: 'Alternator 90A — Supra 960/1250',
    category: 'alternator',
    unit_models: ['Supra 960', 'Supra 1250'],
    field_critical: true,
  },
  {
    part_number: '30-00305-00',
    manufacturer: 'Carrier Transicold',
    description: 'Alternator — Ultima 53 / X2 Trailer Series',
    category: 'alternator',
    unit_models: ['Ultima 53', 'Ultima XT', 'X2 2100', 'X2 2200', 'X2 2500'],
    notes: 'Inspect belt tension at every PM. Slipping belt under compressor load is common.',
    field_critical: true,
  },

  // ─── CARRIER TRANSICOLD — FUEL SYSTEM ────────────────────────────────────────

  {
    part_number: '30-00200-00',
    manufacturer: 'Carrier Transicold',
    description: 'Fuel Filter — Supra Series',
    category: 'filter',
    unit_models: ['Supra 550', 'Supra 650', 'Supra 750', 'Supra 850', 'Supra 950', 'Supra 960', 'Supra 1250'],
    notes: 'Replace at every PM service interval. Replace immediately if inlet screen found clogged.',
    field_critical: false,
  },
  {
    part_number: '30-00201-00',
    manufacturer: 'Carrier Transicold',
    description: 'Fuel Filter — X2 / X4 Trailer Series',
    category: 'filter',
    unit_models: ['X2 2100', 'X2 2200', 'X2 2500', 'X4 7300', 'X4 7500', 'Ultima 53', 'Ultima XT'],
    field_critical: false,
  },
  {
    part_number: '30-00210-00',
    manufacturer: 'Carrier Transicold',
    description: 'Fuel Solenoid Assembly — Supra Series',
    category: 'solenoid',
    unit_models: ['Supra 550', 'Supra 650', 'Supra 750', 'Supra 850', 'Supra 950', 'Supra 960'],
    notes: 'Less common failure than TK. Check ohm value and voltage at solenoid during start attempt.',
    field_critical: false,
  },
  {
    part_number: '30-00211-00',
    manufacturer: 'Carrier Transicold',
    description: 'Fuel Solenoid Assembly — Ultima / X2 Series',
    category: 'solenoid',
    unit_models: ['Ultima 53', 'Ultima XT', 'X2 2100', 'X2 2200', 'X2 2500'],
    field_critical: false,
  },
  {
    part_number: '30-00215-00',
    manufacturer: 'Carrier Transicold',
    description: 'Injection Pump Banjo Bolt Copper Crush Washers — Pack of 10',
    category: 'fuel_pump',
    unit_models: ['Supra 550', 'Supra 650', 'Supra 750', 'Supra 850', 'Supra 950', 'Ultima 53', 'X2 2100'],
    notes: 'Replace copper crushers on both sides at every banjo bolt removal. Never reuse.',
    field_critical: true,
  },

  // ─── CARRIER TRANSICOLD — BELTS ───────────────────────────────────────────────

  {
    part_number: '30-00100-00',
    manufacturer: 'Carrier Transicold',
    description: 'Alternator Drive Belt — Supra 550/650',
    category: 'belt',
    unit_models: ['Supra 550', 'Supra 650'],
    notes: 'Broken belts are the most common field failure on Carrier trailer units. Inspect at every PM.',
    field_critical: false,
  },
  {
    part_number: '30-00101-00',
    manufacturer: 'Carrier Transicold',
    description: 'Alternator Drive Belt — Supra 750/850/950',
    category: 'belt',
    unit_models: ['Supra 750', 'Supra 850', 'Supra 950', 'Supra 960'],
    field_critical: false,
  },
  {
    part_number: '30-00110-00',
    manufacturer: 'Carrier Transicold',
    description: 'Condenser Fan Belt — Supra Series',
    category: 'belt',
    unit_models: ['Supra 550', 'Supra 650', 'Supra 750', 'Supra 850', 'Supra 950', 'Supra 960', 'Supra 1250'],
    notes: 'Replace all belts as a set when one fails.',
    field_critical: false,
  },
  {
    part_number: '30-00115-00',
    manufacturer: 'Carrier Transicold',
    description: 'Compressor Drive Belt — X2 Trailer Series',
    category: 'belt',
    unit_models: ['X2 2100', 'X2 2200', 'X2 2500'],
    notes: 'X2 series uses gear-driven compressor — inspect gearbox area for noise and oil leaks.',
    field_critical: false,
  },
  {
    part_number: '30-00120-00',
    manufacturer: 'Carrier Transicold',
    description: 'Belt Set — Ultima 53 (3-Belt Kit)',
    category: 'belt',
    unit_models: ['Ultima 53', 'Ultima XT'],
    notes: 'Replace as complete set. Never replace individual belts on a multi-belt system.',
    field_critical: false,
  },

  // ─── CARRIER TRANSICOLD — COOLING SYSTEM ─────────────────────────────────────

  {
    part_number: '30-00500-00',
    manufacturer: 'Carrier Transicold',
    description: 'Thermostat — Supra Series (82°C)',
    category: 'thermostat',
    unit_models: ['Supra 550', 'Supra 650', 'Supra 750', 'Supra 850', 'Supra 950', 'Supra 960', 'Supra 1250'],
    notes: 'Most common cause of overheating on Carrier units. Boil test before condemning.',
    field_critical: false,
  },
  {
    part_number: '30-00501-00',
    manufacturer: 'Carrier Transicold',
    description: 'Thermostat — X2 / X4 Trailer Series',
    category: 'thermostat',
    unit_models: ['X2 2100', 'X2 2200', 'X2 2500', 'X4 7300', 'X4 7500', 'Ultima 53'],
    field_critical: false,
  },
  {
    part_number: '30-00510-00',
    manufacturer: 'Carrier Transicold',
    description: 'Water Pump Assembly — Supra 550/650/750',
    category: 'water_pump',
    unit_models: ['Supra 550', 'Supra 650', 'Supra 750'],
    notes: 'Check weep hole, bearing noise, and shaft play. Replace if any present.',
    field_critical: false,
  },
  {
    part_number: '30-00511-00',
    manufacturer: 'Carrier Transicold',
    description: 'Water Pump Assembly — Supra 850/950/960',
    category: 'water_pump',
    unit_models: ['Supra 850', 'Supra 950', 'Supra 960', 'Supra 1250'],
    field_critical: false,
  },
  {
    part_number: '30-00512-00',
    manufacturer: 'Carrier Transicold',
    description: 'Water Pump Assembly — Ultima / X2 Series',
    category: 'water_pump',
    unit_models: ['Ultima 53', 'Ultima XT', 'X2 2100', 'X2 2200', 'X2 2500'],
    field_critical: false,
  },

  // ─── CARRIER TRANSICOLD — SENSORS ────────────────────────────────────────────

  {
    part_number: '30-00600-00',
    manufacturer: 'Carrier Transicold',
    description: 'Return Air Sensor',
    category: 'sensor',
    unit_models: ['Supra 550', 'Supra 650', 'Supra 750', 'Supra 850', 'Supra 950', 'Supra 960', 'Ultima 53', 'X2 2100', 'X2 2200'],
    notes: 'Most common sensor failure on Carrier. Causes unit to run on false temperature reading.',
    field_critical: false,
  },
  {
    part_number: '30-00601-00',
    manufacturer: 'Carrier Transicold',
    description: 'Discharge Air Sensor',
    category: 'sensor',
    unit_models: ['Supra 550', 'Supra 650', 'Supra 750', 'Supra 850', 'Ultima 53', 'X2 2100'],
    field_critical: false,
  },
  {
    part_number: '30-00605-00',
    manufacturer: 'Carrier Transicold',
    description: 'Suction Pressure Sensor',
    category: 'sensor',
    unit_models: ['Supra 650', 'Supra 750', 'Supra 850', 'Supra 950', 'X2 2200', 'X2 2500'],
    notes: 'Failure causes false low-pressure alarms and unnecessary shutdowns.',
    field_critical: false,
  },
  {
    part_number: '30-00606-00',
    manufacturer: 'Carrier Transicold',
    description: 'Discharge Pressure Sensor',
    category: 'sensor',
    unit_models: ['Supra 750', 'Supra 850', 'Supra 950', 'Supra 960', 'X2 2200', 'X2 2500', 'X4 7300'],
    notes: 'Failure causes false high-pressure alarms.',
    field_critical: false,
  },

  // ─── CARRIER TRANSICOLD — RPM MODULE ──────────────────────────────────────────

  {
    part_number: '30-00700-00',
    manufacturer: 'Carrier Transicold',
    description: 'RPM Module — Supra Series',
    category: 'controller',
    unit_models: ['Supra 550', 'Supra 650', 'Supra 750', 'Supra 850', 'Supra 950', 'Supra 960'],
    notes: 'Check throttle linkage for binding before condemning module. Programming required on some models.',
    field_critical: true,
  },
  {
    part_number: '30-00701-00',
    manufacturer: 'Carrier Transicold',
    description: 'RPM Module — X2 / Ultima Trailer Series',
    category: 'controller',
    unit_models: ['Ultima 53', 'Ultima XT', 'X2 2100', 'X2 2200', 'X2 2500'],
    notes: 'Check throttle actuator for mechanical binding. Programming required on replacement.',
    field_critical: true,
  },

  // ─── CARRIER TRANSICOLD — COMPRESSOR / REFRIGERANT ───────────────────────────

  {
    part_number: '30-00800-00',
    manufacturer: 'Carrier Transicold',
    description: 'Compressor Shaft Seal Kit — Supra Series',
    category: 'compressor',
    unit_models: ['Supra 550', 'Supra 650', 'Supra 750', 'Supra 850', 'Supra 950'],
    notes: 'Primary refrigerant leak point on high-hour Carrier units. Check at every PM on units over 15k hours.',
    field_critical: false,
  },
  {
    part_number: '30-00801-00',
    manufacturer: 'Carrier Transicold',
    description: 'Compressor Assembly — Supra 550/650',
    category: 'compressor',
    unit_models: ['Supra 550', 'Supra 650'],
    notes: 'EPA 608 required. Recover refrigerant before removal.',
    field_critical: true,
  },
  {
    part_number: '30-00802-00',
    manufacturer: 'Carrier Transicold',
    description: 'Compressor Assembly — X2 2200 / X2 2500',
    category: 'compressor',
    unit_models: ['X2 2200', 'X2 2500', 'X4 7300', 'X4 7500'],
    notes: 'Gear-driven compressor. Inspect gearbox before replacing compressor. EPA 608 required.',
    field_critical: true,
  },
  {
    part_number: '30-00810-00',
    manufacturer: 'Carrier Transicold',
    description: 'Gearbox Assembly — X2 Series',
    category: 'compressor',
    unit_models: ['X2 2100', 'X2 2200', 'X2 2500'],
    notes: 'Gear box transfers power from engine to compressor. Failure indicated by noise, oil leak, or sudden loss of cooling.',
    field_critical: true,
  },
  {
    part_number: '30-00820-00',
    manufacturer: 'Carrier Transicold',
    description: 'Receiver Drier — Supra Series',
    category: 'refrigerant',
    unit_models: ['Supra 550', 'Supra 650', 'Supra 750', 'Supra 850', 'Supra 950', 'Supra 960'],
    notes: 'Replace any time system is opened. EPA 608 required.',
    field_critical: false,
  },
  {
    part_number: '30-00821-00',
    manufacturer: 'Carrier Transicold',
    description: 'Receiver Drier — X2 / Ultima Series',
    category: 'refrigerant',
    unit_models: ['Ultima 53', 'Ultima XT', 'X2 2100', 'X2 2200', 'X2 2500'],
    notes: 'Replace any time system is opened. EPA 608 required.',
    field_critical: false,
  },
  {
    part_number: '30-00825-00',
    manufacturer: 'Carrier Transicold',
    description: 'Schrader Valve Cores — Pack of 10',
    category: 'refrigerant',
    unit_models: ['Supra 550', 'Supra 650', 'Supra 750', 'Supra 850', 'Ultima 53', 'X2 2100', 'X2 2200'],
    notes: 'Common refrigerant leak source. Check at every PM. EPA 608 required.',
    field_critical: false,
  },

  // ─── CARRIER TRANSICOLD — OIL / AIR FILTERS ──────────────────────────────────

  {
    part_number: '30-00220-00',
    manufacturer: 'Carrier Transicold',
    description: 'Engine Oil Filter — Supra Series',
    category: 'filter',
    unit_models: ['Supra 550', 'Supra 650', 'Supra 750', 'Supra 850', 'Supra 950', 'Supra 960', 'Supra 1250'],
    field_critical: false,
  },
  {
    part_number: '30-00221-00',
    manufacturer: 'Carrier Transicold',
    description: 'Engine Oil Filter — X2 / Ultima Series',
    category: 'filter',
    unit_models: ['Ultima 53', 'Ultima XT', 'X2 2100', 'X2 2200', 'X2 2500', 'X4 7300', 'X4 7500'],
    field_critical: false,
  },
  {
    part_number: '30-00225-00',
    manufacturer: 'Carrier Transicold',
    description: 'Air Filter — Supra Series',
    category: 'filter',
    unit_models: ['Supra 550', 'Supra 650', 'Supra 750', 'Supra 850', 'Supra 950', 'Supra 960', 'Supra 1250'],
    notes: 'Inspect at every service. Collapsed or soot-packed filter causes RPM and speed issues.',
    field_critical: false,
  },
  {
    part_number: '30-00226-00',
    manufacturer: 'Carrier Transicold',
    description: 'Air Filter — X2 / Ultima Series',
    category: 'filter',
    unit_models: ['Ultima 53', 'Ultima XT', 'X2 2100', 'X2 2200', 'X2 2500'],
    field_critical: false,
  },

  // ─── DELCO REMY — ALTERNATORS (Cross-ref to TK) ───────────────────────────────

  {
    part_number: '8600016',
    manufacturer: 'Delco Remy',
    description: 'Alternator 55A — Replaces TK 44-2228',
    category: 'alternator',
    unit_models: ['SL-200', 'SL-400', 'TS-600', 'TS-800'],
    notes: 'Direct OEM-quality replacement for TK 44-2228. Verify mounting bracket compatibility.',
    field_critical: false,
  },
  {
    part_number: '8600017',
    manufacturer: 'Delco Remy',
    description: 'Alternator 55A — Replaces TK 44-2215',
    category: 'alternator',
    unit_models: ['SL-100', 'MD-100', 'MD-200'],
    notes: 'Direct replacement for TK 44-2215.',
    field_critical: false,
  },
  {
    part_number: '8600020',
    manufacturer: 'Delco Remy',
    description: 'Alternator 70A — Replaces TK 44-2230',
    category: 'alternator',
    unit_models: ['SLXi-100', 'SLXi-200', 'SLXi-300', 'SLXi-400'],
    notes: 'Direct replacement for TK 44-2230.',
    field_critical: false,
  },

  // ─── DELCO REMY — STARTERS (Cross-ref to TK) ──────────────────────────────────

  {
    part_number: '37MT0900',
    manufacturer: 'Delco Remy',
    description: 'Starter 37MT — Replaces TK 45-2324',
    category: 'starter',
    unit_models: ['SL-200', 'SL-400', 'TS-600', 'TS-800'],
    notes: 'OEM-quality replacement for TK 45-2324. Verify pinion engagement before installing.',
    field_critical: false,
  },
  {
    part_number: '37MT0895',
    manufacturer: 'Delco Remy',
    description: 'Starter 37MT — Replaces TK 45-2323',
    category: 'starter',
    unit_models: ['SL-100', 'MD-100', 'MD-200'],
    notes: 'Direct replacement for TK 45-2323.',
    field_critical: false,
  },

  // ─── GENERIC — DIELECTRIC GREASE ─────────────────────────────────────────────

  {
    part_number: 'DIELEC-3OZ',
    manufacturer: 'Generic',
    description: 'Dielectric Grease — 3oz Tube',
    category: 'consumable',
    unit_models: [],
    notes: 'Apply to ALL electrical connectors during reassembly. Prevents corrosion, moisture intrusion, and voltage drop at connections. Critical on sensor connectors, solenoid harnesses, battery terminals, and starter terminals. A single tube prevents more nuisance alarms than most parts replacements.',
    field_critical: true,
  },
  {
    part_number: 'DIELEC-14OZ',
    manufacturer: 'Generic',
    description: 'Dielectric Grease — 14oz Cartridge',
    category: 'consumable',
    unit_models: [],
    notes: 'Shop cartridge. Apply to ALL electrical connectors during reassembly. Use generously — never sparingly.',
    field_critical: false,
  },

  // ─── GENERIC — SHOP CONSUMABLES ───────────────────────────────────────────────

  {
    part_number: 'COOLANT-FULL',
    manufacturer: 'Generic',
    description: 'Fully Formulated HD Coolant — Pre-Mixed 50/50',
    category: 'consumable',
    unit_models: [],
    notes: 'Use HD-formula coolant only. Flush at 12,000-hour intervals on Carrier units.',
    field_critical: false,
  },
  {
    part_number: 'REFRIGERANT-R404A',
    manufacturer: 'Generic',
    description: 'Refrigerant R-404A — 24lb Cylinder',
    category: 'refrigerant',
    unit_models: [],
    notes: 'EPA 608 certification required for purchase and handling.',
    field_critical: false,
  },
  {
    part_number: 'REFRIGERANT-R452A',
    manufacturer: 'Generic',
    description: 'Refrigerant R-452A — 24lb Cylinder (R-404A Replacement)',
    category: 'refrigerant',
    unit_models: [],
    notes: 'EPA 608 required. Verify unit compatibility before using as R-404A replacement.',
    field_critical: false,
  },
]

// ─── Cross References ─────────────────────────────────────────────────────────

export const SEED_CROSS_REFS: SeedCrossRef[] = [
  // Delco Remy → TK alternator cross-refs
  { part_number: '8600016',  cross_mfr: 'Thermo King',   cross_part: '44-2228',  cross_notes: 'OEM equivalent' },
  { part_number: '8600017',  cross_mfr: 'Thermo King',   cross_part: '44-2215',  cross_notes: 'OEM equivalent' },
  { part_number: '8600020',  cross_mfr: 'Thermo King',   cross_part: '44-2230',  cross_notes: 'OEM equivalent' },
  // TK alternators → Delco Remy cross-refs
  { part_number: '44-2228',  cross_mfr: 'Delco Remy',    cross_part: '8600016',  cross_notes: 'OEM equivalent — Delco Remy 37SI' },
  { part_number: '44-2215',  cross_mfr: 'Delco Remy',    cross_part: '8600017',  cross_notes: 'OEM equivalent' },
  { part_number: '44-2230',  cross_mfr: 'Delco Remy',    cross_part: '8600020',  cross_notes: 'OEM equivalent' },
  // Delco Remy → TK starter cross-refs
  { part_number: '37MT0900', cross_mfr: 'Thermo King',   cross_part: '45-2324',  cross_notes: 'OEM equivalent' },
  { part_number: '37MT0895', cross_mfr: 'Thermo King',   cross_part: '45-2323',  cross_notes: 'OEM equivalent' },
  // TK starters → Delco Remy cross-refs
  { part_number: '45-2324',  cross_mfr: 'Delco Remy',    cross_part: '37MT0900', cross_notes: 'OEM equivalent — Delco Remy 37MT' },
  { part_number: '45-2323',  cross_mfr: 'Delco Remy',    cross_part: '37MT0895', cross_notes: 'OEM equivalent' },
]
