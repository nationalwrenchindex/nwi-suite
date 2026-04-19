export interface DTCEntry {
  code:        string
  description: string
  system:      string
  causes:      string[]
  repair:      string
}

export const DTC_DB: Record<string, DTCEntry> = {
  // ── Camshaft / Crankshaft Correlation ──────────────────────────────────────
  'P0011': { code:'P0011', description:'"A" Camshaft Position — Timing Over-Advanced or System Performance (Bank 1)', system:'Valvetrain / VVT', causes:['Low or dirty engine oil','Failed camshaft phaser','Faulty VVT solenoid / oil control valve','Timing chain stretch'], repair:'Check and change oil first. Inspect VVT solenoid and oil control valve. If symptoms persist, check timing chain stretch.' },
  'P0012': { code:'P0012', description:'"A" Camshaft Position — Timing Over-Retarded (Bank 1)', system:'Valvetrain / VVT', causes:['Low oil pressure','Stuck camshaft phaser','Faulty VVT solenoid'], repair:'Change oil and filter. Test VVT solenoid resistance and operation. Replace if out of spec.' },
  'P0016': { code:'P0016', description:'Crankshaft Position / Camshaft Position — Correlation (Bank 1, Sensor A)', system:'Valvetrain', causes:['Stretched timing chain','Worn timing components','Incorrect cam phaser position','Oil sludge'], repair:'Inspect timing chain and guides. Check for timing chain slack. May require engine teardown for timing component replacement.' },
  'P0017': { code:'P0017', description:'Crankshaft Position / Camshaft Position — Correlation (Bank 1, Sensor B)', system:'Valvetrain', causes:['Stretched timing chain','Worn cam phasers','Low oil pressure'], repair:'Check timing chain slack and cam phaser function. Inspect oil passages for restriction.' },

  // ── O2 Sensor Heater ────────────────────────────────────────────────────────
  'P0030': { code:'P0030', description:'HO2S Heater Control Circuit (Bank 1, Sensor 1)', system:'Exhaust / O2 Sensors', causes:['Failed O2 sensor heater element','Blown fuse','Wiring short or open'], repair:'Check O2 sensor heater circuit fuse. Test heater element resistance (should be 2–30 Ω). Replace sensor if heater open.' },
  'P0036': { code:'P0036', description:'HO2S Heater Control Circuit (Bank 1, Sensor 2)', system:'Exhaust / O2 Sensors', causes:['Failed downstream O2 sensor heater','Wiring damage','Open circuit in heater supply'], repair:'Inspect O2 sensor wiring downstream of catalytic converter. Test heater element and replace sensor if needed.' },

  // ── MAF Sensor ──────────────────────────────────────────────────────────────
  'P0101': { code:'P0101', description:'Mass Air Flow (MAF) Sensor — Range/Performance', system:'Fuel & Air Metering', causes:['Dirty or contaminated MAF sensor','Air intake leak past MAF','Clogged air filter','Damaged sensor wiring'], repair:'Clean MAF sensor with approved MAF cleaner spray. Check for air leaks between MAF and throttle body. Replace filter.' },
  'P0102': { code:'P0102', description:'Mass Air Flow (MAF) Sensor — Circuit Low Input', system:'Fuel & Air Metering', causes:['Failed MAF sensor','Short to ground in signal wire','Severely restricted air filter'], repair:'Inspect MAF wiring for shorts. Test sensor output voltage. Replace MAF sensor if signal is below spec.' },
  'P0103': { code:'P0103', description:'Mass Air Flow (MAF) Sensor — Circuit High Input', system:'Fuel & Air Metering', causes:['Open circuit in MAF signal wire','Failed MAF sensor','Faulty PCM'], repair:'Check MAF wiring for open circuits. Verify sensor reference voltage (5V). Replace MAF sensor if voltage is above spec.' },

  // ── Intake Air / Coolant Temp ───────────────────────────────────────────────
  'P0113': { code:'P0113', description:'Intake Air Temperature (IAT) Sensor — Circuit High Input', system:'Fuel & Air Metering', causes:['Open circuit in IAT signal wire','Failed IAT sensor','Corrosion at connector'], repair:'Inspect IAT sensor connector and wiring. Test sensor resistance vs temperature chart. Replace sensor if out of range.' },
  'P0118': { code:'P0118', description:'Engine Coolant Temperature (ECT) Sensor — Circuit High Input', system:'Cooling System', causes:['Open circuit in ECT wiring','Failed ECT sensor','Corroded connector'], repair:'Check ECT sensor connector for corrosion. Test sensor resistance. Replace sensor if reading high resistance when engine is warm.' },
  'P0128': { code:'P0128', description:'Coolant Temperature Below Thermostat Regulating Temperature', system:'Cooling System', causes:['Stuck-open thermostat','Failed ECT sensor','Low coolant level'], repair:'Replace thermostat (most common fix). Verify ECT sensor accuracy. Check coolant level and condition.' },

  // ── Fuel Trim ───────────────────────────────────────────────────────────────
  'P0171': { code:'P0171', description:'System Too Lean (Bank 1)', system:'Fuel & Air Metering', causes:['Vacuum leak','Faulty MAF sensor','Weak fuel pump / clogged fuel filter','Dirty fuel injectors','Failed O2 sensor'], repair:'Check for vacuum leaks with smoke machine. Clean or replace MAF sensor. Test fuel pressure. Clean injectors.' },
  'P0172': { code:'P0172', description:'System Too Rich (Bank 1)', system:'Fuel & Air Metering', causes:['Faulty MAF sensor reading high','Leaking fuel injectors','Failed O2 sensor stuck rich','High fuel pressure'], repair:'Inspect MAF sensor for contamination. Check fuel injectors for leaks. Test fuel pressure regulator.' },
  'P0174': { code:'P0174', description:'System Too Lean (Bank 2)', system:'Fuel & Air Metering', causes:['Vacuum leak on Bank 2 side','MAF sensor','Weak fuel delivery'], repair:'Same approach as P0171 but focus on Bank 2 (passenger side on most V-engines). Check intake manifold gasket on Bank 2.' },
  'P0175': { code:'P0175', description:'System Too Rich (Bank 2)', system:'Fuel & Air Metering', causes:['MAF contamination','Leaking injectors on Bank 2','Faulty upstream O2 sensor'], repair:'Same approach as P0172 focusing on Bank 2 components.' },

  // ── Misfire ─────────────────────────────────────────────────────────────────
  'P0300': { code:'P0300', description:'Random / Multiple Cylinder Misfire Detected', system:'Ignition / Fuel', causes:['Worn spark plugs','Faulty ignition coils','Clogged fuel injectors','Low compression','Vacuum leak','Failed coil pack'], repair:'Replace spark plugs first. Test each ignition coil. Perform compression and leak-down tests. Check injector pulse.' },
  'P0301': { code:'P0301', description:'Cylinder 1 Misfire Detected', system:'Ignition / Fuel', causes:['Fouled spark plug — Cyl 1','Failed ignition coil — Cyl 1','Clogged injector — Cyl 1','Low compression — Cyl 1'], repair:'Swap coil from Cyl 1 to another cylinder and re-scan. If code follows coil, replace coil. Also inspect plug and injector.' },
  'P0302': { code:'P0302', description:'Cylinder 2 Misfire Detected', system:'Ignition / Fuel', causes:['Fouled spark plug — Cyl 2','Failed ignition coil — Cyl 2','Clogged injector — Cyl 2'], repair:'Isolate by swapping coil. Inspect plug condition. Test injector pulse width.' },
  'P0303': { code:'P0303', description:'Cylinder 3 Misfire Detected', system:'Ignition / Fuel', causes:['Fouled spark plug — Cyl 3','Failed ignition coil — Cyl 3','Low compression — Cyl 3'], repair:'Swap coil and plug from Cyl 3. Perform compression test if misfire persists after ignition repair.' },
  'P0304': { code:'P0304', description:'Cylinder 4 Misfire Detected', system:'Ignition / Fuel', causes:['Fouled spark plug — Cyl 4','Failed ignition coil','Injector issue'], repair:'Swap coil to isolate. Check spark plug condition and gap. Test injector.' },
  'P0305': { code:'P0305', description:'Cylinder 5 Misfire Detected', system:'Ignition / Fuel', causes:['Ignition coil failure','Spark plug','Injector'], repair:'Swap and test coil, plug, injector on Cyl 5.' },
  'P0306': { code:'P0306', description:'Cylinder 6 Misfire Detected', system:'Ignition / Fuel', causes:['Ignition coil failure','Spark plug','Injector','Low compression'], repair:'Swap coil. Inspect plug. Compression test if needed.' },

  // ── Crankshaft / Camshaft Position Sensors ─────────────────────────────────
  'P0335': { code:'P0335', description:'Crankshaft Position (CKP) Sensor A — Circuit Malfunction', system:'Ignition', causes:['Failed CKP sensor','Damaged reluctor wheel','Wiring damage','Sensor gap too large'], repair:'Inspect CKP sensor wiring and connector. Test sensor output with oscilloscope. Check reluctor ring for damage. Replace sensor.' },
  'P0340': { code:'P0340', description:'Camshaft Position (CMP) Sensor A — Circuit Malfunction (Bank 1)', system:'Valvetrain', causes:['Failed CMP sensor','Damaged reluctor wheel on cam','Wiring open or shorted'], repair:'Inspect CMP sensor connector and wiring. Test sensor resistance and output. Replace sensor if no signal.' },
  'P0341': { code:'P0341', description:'Camshaft Position Sensor A — Circuit Range/Performance (Bank 1)', system:'Valvetrain', causes:['Timing chain stretch','Worn cam gear','Intermittent sensor failure'], repair:'Check timing chain condition. Verify cam sensor signal with scope. Inspect cam reluctor wheel.' },

  // ── EGR ─────────────────────────────────────────────────────────────────────
  'P0401': { code:'P0401', description:'Exhaust Gas Recirculation (EGR) — Insufficient Flow', system:'Emissions / EGR', causes:['Carbon-clogged EGR valve','Blocked EGR passages','Failed DPFE sensor','Damaged EGR vacuum lines'], repair:'Clean EGR valve and passages. Test EGR valve operation. Replace DPFE sensor if applicable. Clean intake manifold EGR passages.' },
  'P0402': { code:'P0402', description:'Exhaust Gas Recirculation (EGR) — Excessive Flow', system:'Emissions / EGR', causes:['EGR valve stuck open','Faulty EGR solenoid','Leaking EGR hose'], repair:'Inspect EGR valve for carbon buildup causing it to stick open. Test solenoid. Check for vacuum leaks at EGR.' },

  // ── Catalytic Converter ─────────────────────────────────────────────────────
  'P0420': { code:'P0420', description:'Catalyst System Efficiency Below Threshold (Bank 1)', system:'Emissions / Catalytic Converter', causes:['Worn/failed catalytic converter','Faulty downstream O2 sensor','Rich-running engine damaging cat','Exhaust leak before cat'], repair:'Verify no upstream issues (misfires, rich condition) are damaging cat. Test downstream O2 sensor. Replace catalytic converter if confirmed failed.' },
  'P0421': { code:'P0421', description:'Warm Up Catalyst Efficiency Below Threshold (Bank 1)', system:'Emissions / Catalytic Converter', causes:['Failed warm-up catalyst','Damaged O2 sensor','Engine running issues'], repair:'Check O2 sensor function. Ensure no misfires or rich condition. Replace warm-up catalyst if efficiency confirmed low.' },
  'P0430': { code:'P0430', description:'Catalyst System Efficiency Below Threshold (Bank 2)', system:'Emissions / Catalytic Converter', causes:['Failed Bank 2 catalytic converter','Downstream O2 sensor fault','Engine running rich on Bank 2'], repair:'Same diagnosis as P0420 but for Bank 2 (passenger side on most V-engines).' },

  // ── EVAP ─────────────────────────────────────────────────────────────────────
  'P0440': { code:'P0440', description:'Evaporative Emission Control System Malfunction', system:'EVAP / Fuel Tank', causes:['Loose or damaged gas cap','Faulty purge solenoid','Cracked EVAP hoses','Failed charcoal canister'], repair:'Check and tighten gas cap first. Inspect EVAP hoses and canister. Test purge solenoid. Perform smoke test to locate leak.' },
  'P0441': { code:'P0441', description:'Evaporative Emission Control System — Incorrect Purge Flow', system:'EVAP / Fuel Tank', causes:['Failed purge valve solenoid','Blocked EVAP lines','Faulty PCM output'], repair:'Test purge solenoid operation and resistance. Check EVAP hose routing for kinks or blockage.' },
  'P0442': { code:'P0442', description:'Evaporative Emission Control System — Small Leak Detected', system:'EVAP / Fuel Tank', causes:['Small crack in EVAP hose or canister','Faulty gas cap seal','Vent valve leak'], repair:'Smoke test EVAP system. Check gas cap seal. Inspect charcoal canister and all EVAP hoses.' },
  'P0443': { code:'P0443', description:'Evaporative Emission Control System Purge Control Valve — Circuit', system:'EVAP / Fuel Tank', causes:['Failed purge control solenoid','Open or short in wiring','Failed PCM driver'], repair:'Test purge solenoid resistance (~20–30 Ω typical). Check wiring from PCM to solenoid. Replace solenoid if faulty.' },
  'P0446': { code:'P0446', description:'Evaporative Emission Control System Vent Control Circuit', system:'EVAP / Fuel Tank', causes:['Failed EVAP vent solenoid','Blocked vent hose','Wiring issue'], repair:'Test vent solenoid. Check vent path for obstructions. Inspect wiring.' },
  'P0455': { code:'P0455', description:'Evaporative Emission Control System — Large Leak Detected', system:'EVAP / Fuel Tank', causes:['Missing or loose gas cap','Large crack in EVAP hose','Failed fuel tank pressure sensor','Split charcoal canister'], repair:'Check gas cap first. Perform smoke test to find large leak. Inspect fuel tank, canister, and all EVAP connections.' },
  'P0456': { code:'P0456', description:'Evaporative Emission Control System — Very Small Leak', system:'EVAP / Fuel Tank', causes:['Micro-crack in EVAP line','Gas cap seal wear','Pinhole in fuel tank'], repair:'Perform nitrogen or smoke leak test. May require careful inspection with UV dye.' },

  // ── Vehicle Speed / Idle ────────────────────────────────────────────────────
  'P0500': { code:'P0500', description:'Vehicle Speed Sensor (VSS) — Malfunction', system:'Drivetrain / ABS', causes:['Failed VSS sensor','Damaged tone ring','Wiring damage','Faulty ABS module'], repair:'Inspect VSS sensor and wiring. Check for damaged reluctor wheel on axle or transmission output. Test sensor output.' },
  'P0505': { code:'P0505', description:'Idle Control System — Malfunction', system:'Throttle / Idle', causes:['Dirty or failed idle air control valve','Vacuum leak','Dirty throttle body','Failed throttle position sensor'], repair:'Clean idle air control valve and throttle body. Check for vacuum leaks. On electronic throttle: clean throttle bore and perform idle relearn.' },
  'P0507': { code:'P0507', description:'Idle Control System — RPM High', system:'Throttle / Idle', causes:['Large vacuum leak','Stuck-open idle air control valve','Carbon buildup on throttle plate'], repair:'Perform smoke test for vacuum leaks. Clean throttle body. Test IAC valve.' },

  // ── Computer / PCM ──────────────────────────────────────────────────────────
  'P0606': { code:'P0606', description:'PCM / ECM Processor Fault', system:'Computer / ECM', causes:['Internal PCM failure','Voltage spike damage','Corrupted calibration','Poor PCM ground'], repair:'Check PCM power and ground connections first. Verify no voltage spikes from charging system. PCM may require reprogramming or replacement.' },

  // ── Transmission ────────────────────────────────────────────────────────────
  'P0700': { code:'P0700', description:'Transmission Control System — Malfunction Indicator', system:'Transmission', causes:['Transmission control module fault','Solenoid failure','Internal transmission issue'], repair:'This is a general transmission fault indicator. Retrieve additional transmission-specific codes (P07xx) for specific diagnosis.' },
  'P0715': { code:'P0715', description:'Input/Turbine Speed Sensor A — Circuit Malfunction', system:'Transmission', causes:['Failed input shaft speed sensor','Damaged tone wheel','Wiring fault'], repair:'Inspect transmission speed sensor and wiring. Check tone wheel for damage. Replace sensor if no signal.' },
  'P0720': { code:'P0720', description:'Output Speed Sensor — Circuit Malfunction', system:'Transmission', causes:['Failed output shaft speed sensor','Wiring damage','Damaged tone ring'], repair:'Test output speed sensor resistance and signal. Inspect wiring. Replace sensor if faulty.' },
  'P0740': { code:'P0740', description:'Torque Converter Clutch (TCC) Circuit — Malfunction', system:'Transmission', causes:['Faulty TCC solenoid','Low transmission fluid','Wiring fault','Worn torque converter'], repair:'Check transmission fluid level and condition. Test TCC solenoid. If fluid is contaminated, service transmission first.' },
  'P0750': { code:'P0750', description:'Shift Solenoid A — Malfunction', system:'Transmission', causes:['Failed shift solenoid','Dirty transmission fluid','Internal valve body issue'], repair:'Service transmission fluid and filter. Test solenoid resistance. Replace solenoid or valve body if needed.' },

  // ── Throttle / Pedal ────────────────────────────────────────────────────────
  'P0120': { code:'P0120', description:'Throttle / Pedal Position Sensor A — Circuit Malfunction', system:'Throttle Body / TAC', causes:['Failed TPS','Wiring fault','Dirty throttle body contact'], repair:'Inspect TPS wiring and connector. Test sensor voltage sweep (should be smooth 0.5–4.5V). Clean throttle body. Replace TPS or throttle body assembly.' },
  'P0121': { code:'P0121', description:'Throttle / Pedal Position Sensor A — Range/Performance', system:'Throttle Body / TAC', causes:['TPS out of calibration','Dirty throttle bore','Wiring intermittent'], repair:'Clean throttle body. Perform throttle position relearn if required. Test TPS output sweep for dead spots.' },
  'P0123': { code:'P0123', description:'Throttle / Pedal Position Sensor A — High Input', system:'Throttle Body / TAC', causes:['Short to voltage in TPS signal wire','Failed TPS sending high signal'], repair:'Check for short to power in TPS signal circuit. Replace TPS or throttle body if sensor is faulty.' },

  // ── Knock Sensor ────────────────────────────────────────────────────────────
  'P0325': { code:'P0325', description:'Knock Sensor 1 — Circuit Malfunction (Bank 1)', system:'Ignition', causes:['Failed knock sensor','Loose sensor torque','Wiring fault','Engine bearing noise triggering false knock'], repair:'Check knock sensor torque spec (typically 15–20 ft-lbs). Inspect wiring. Listen for mechanical engine knock. Replace sensor if circuit is faulty.' },
  'P0328': { code:'P0328', description:'Knock Sensor 1 — Circuit High Input (Bank 1)', system:'Ignition', causes:['Open circuit in knock sensor wiring','Failed sensor','Connector corrosion'], repair:'Inspect connector. Test sensor resistance (~4.5–10 MΩ typical). Replace sensor or repair wiring.' },

  // ── Fuel Injector ───────────────────────────────────────────────────────────
  'P0200': { code:'P0200', description:'Injector Circuit — Malfunction', system:'Fuel Injectors', causes:['Open/short in injector wiring','Failed injector','PCM driver fault'], repair:'Test injector resistance (12–16 Ω typical). Check wiring from PCM to injectors. Replace faulty injector.' },
  'P0201': { code:'P0201', description:'Cylinder 1 Injector Circuit — Malfunction', system:'Fuel Injectors', causes:['Failed Cyl 1 injector','Wiring fault at Cyl 1','PCM output fault'], repair:'Test Cyl 1 injector resistance and pulse. Swap injector with another cylinder to confirm. Check wiring.' },

  // ── Battery / Charging ──────────────────────────────────────────────────────
  'P0562': { code:'P0562', description:'System Voltage — Low', system:'Electrical / Charging', causes:['Weak battery','Failing alternator','Poor battery connection','High parasitic draw'], repair:'Load test battery. Test alternator output (should be 13.5–14.7V at idle). Check battery terminal connections. Test for parasitic drain.' },
  'P0563': { code:'P0563', description:'System Voltage — High', system:'Electrical / Charging', causes:['Overcharging alternator','Failed voltage regulator'], repair:'Test charging voltage (should not exceed 15V). Test alternator voltage regulator. Replace alternator if overcharging.' },

  // ── Oxygen Sensors ──────────────────────────────────────────────────────────
  'P0131': { code:'P0131', description:'O2 Sensor Circuit — Low Voltage (Bank 1, Sensor 1)', system:'Exhaust / O2 Sensors', causes:['Lean exhaust condition','Failed upstream O2 sensor','Wiring short to ground','Exhaust leak near sensor'], repair:'Check for exhaust leaks. Test sensor voltage output. Inspect wiring. Replace O2 sensor if voltage is stuck low.' },
  'P0132': { code:'P0132', description:'O2 Sensor Circuit — High Voltage (Bank 1, Sensor 1)', system:'Exhaust / O2 Sensors', causes:['Rich exhaust condition','Failed O2 sensor stuck rich','Short to voltage in signal wire'], repair:'Check for rich running conditions. Test sensor signal. Replace if stuck high.' },
  'P0141': { code:'P0141', description:'O2 Sensor Heater Circuit — Malfunction (Bank 1, Sensor 2)', system:'Exhaust / O2 Sensors', causes:['Failed O2 sensor heater','Blown heater fuse','Open in heater wiring'], repair:'Check fuse for O2 heater circuit. Test heater element resistance. Replace downstream O2 sensor.' },
  'P0161': { code:'P0161', description:'O2 Sensor Heater Circuit — Malfunction (Bank 2, Sensor 2)', system:'Exhaust / O2 Sensors', causes:['Failed downstream O2 sensor heater — Bank 2','Wiring fault'], repair:'Same as P0141 for Bank 2 downstream sensor.' },
}

export function lookupDTC(code: string): DTCEntry | null {
  const normalized = code.trim().toUpperCase()
  return DTC_DB[normalized] ?? null
}

export function getCategoryDescription(code: string): string {
  const c = code.trim().toUpperCase()
  const prefix = c[0]
  const range  = parseInt(c.slice(1, 3), 10)

  const categories: Record<string, string> = {
    P: 'Powertrain',
    B: 'Body',
    C: 'Chassis',
    U: 'Network / Communication',
  }

  let system = categories[prefix] ?? 'Unknown system'

  if (prefix === 'P') {
    if (range < 10)  system = 'Fuel & Air Metering (General)'
    else if (range < 20)  system = 'Fuel & Air Metering'
    else if (range < 30)  system = 'Ignition'
    else if (range < 40)  system = 'Auxiliary Emission Controls'
    else if (range < 50)  system = 'Vehicle Speed / Idle Control'
    else if (range < 60)  system = 'Computer Outputs'
    else if (range < 70)  system = 'Transmission'
    else if (range < 80)  system = 'Transmission'
  }

  return system
}
