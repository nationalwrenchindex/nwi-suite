import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

const FOUNDER_ID = '4a8c046f-7db3-42bb-8422-fd47efb7678c'

const PROCEDURES_SEED = [
  {
    procedure_name: 'Compressor Pump Down',
    category:       'Refrigeration',
    applies_to:     'TK and Carrier — all systems with reciprocating compressors',
    safety_warnings: 'NEVER run a scroll compressor with the suction service valve front seated — this WILL damage the scroll compressor. ALWAYS fully recover all refrigerant before opening a system with a scroll compressor. Disconnect HPCO to prevent remote start. Battery stays connected for testing. Set temperature setpoint to 0°F before performing any test or procedure to keep unit in cool mode.',
    prerequisites:  'Set temperature setpoint to 0°F to keep unit in cool mode. Verify refrigerant level is adequate before starting — a low system gives inaccurate results.',
    steps: 'Step 1 — Attach gauges.\nStep 2 — Run unit minimum 20 minutes to boil all refrigerant out of compressor oil.\nStep 3 — Disconnect both unloader valves at top of both compressor heads.\nStep 4 — With unit RUNNING fully front seat LOW SIDE (SUCTION) service valve ONLY. DO NOT front seat HIGH SIDE (DISCHARGE) service valve while unit is running.\nStep 5 — Once low side pulls into slight vacuum shut unit down.\nStep 6 — Fully front seat discharge side to isolate compressor from rest of unit.\nStep 7 — Open both valves — residual gas from high side brings low side out of vacuum and keeps non-condensables from being sucked into system.\nStep 8 — Always recover any residual into approved vessel before opening system to atmosphere.',
    notes:          'Run and check unit after repairs. Perform full pre-trip. Confirm no active codes. Return unit to service.',
    labor_time:     0.50,
    verified:       true,
  },
  {
    procedure_name: 'Low Side Pump Down',
    category:       'Refrigeration',
    applies_to:     'TK and Carrier — all systems',
    safety_warnings: 'NEVER run a scroll compressor with the suction service valve front seated. ALWAYS fully recover all refrigerant before opening a scroll system. Disconnect HPCO to prevent remote start. A 4-port manifold gauge set is essential for this procedure. Set temperature setpoint to 0°F before beginning.',
    prerequisites:  'Set temperature setpoint to 0°F. Check and record static pressure and ambient temperature before starting. Verify system has adequate refrigerant charge — a low system never gives accurate readings.',
    steps: 'Step 1 — Attach manifold gauges. Run unit minimum 20 minutes to boil all refrigerant from compressor oil.\nStep 2 — Remove service cap — TK at receiver tank, Carrier at king valve. Attach appropriate hose from that port to manifold gauge set.\nStep 3 — With unit still running after 20 minutes front seat receiver tank service valve (TK) or king valve (Carrier) and pump low side (suction) into vacuum. Vacuum target is 0 to -30 on the manifold suction gauge.\nStep 4 — Shut unit off when pumped down.\nStep 5 — Fully front seat high side (discharge) to isolate system from low side.\nStep 6 — Watch suction gauge for 2 minutes in vacuum. Holds vacuum means no leak. Rises to 0 (atmosphere) means low side leak. Rises ABOVE 0 (atmosphere) means leak from high side to low side — valve plates or compressor reed valves.\nStep 7 — To confirm not a false reading from boiling oil — open discharge side while suction still front seated, switch unit back on, pump suction back into vacuum. Once in vacuum shut off and fully front seat discharge again. If it climbs again — confirmed low side leak or leaking valve plates/reed valves.\nStep 8 — Once confirmed holding vacuum with no leaks — open discharge to suction and equalize pressures.\nStep 9 — Recover any pressure above 0 into approved vessel. Keep all CFCs HCFCs HFCs HFOs and hydrocarbons out of atmosphere.\nStep 10 — RETURN TO SERVICE — back seat the discharge valve and open 3 to 1/4 turns — open both discharge and suction service valves to running position.\nStep 11 — Back seat receiver tank valve and remove yellow hose and attach to manifold gauge body. Fully back seat discharge side and snug. With yellow hose capped onto manifold gauge body open discharge manifold knob and suction manifold knob to pull discharge gas from high side to low side to reduce refrigerant loss. Fully back seat suction side. Remove both suction and discharge hoses.',
    notes:          'What you can do during a low side pump down — expansion valve replacement, component replacement (evaporator, pan heater bar, solenoids or valves on the low side that do NOT tap into the discharge side). Run and check unit. Perform full pre-trip. Confirm no active codes. Return unit to service.',
    labor_time:     0.50,
    verified:       true,
  },
  {
    procedure_name: 'Quick Refrigerant Level Check',
    category:       'Refrigeration',
    applies_to:     'TK and Carrier — all systems',
    safety_warnings: 'Disconnect HPCO to prevent remote start. All refrigerant work must be performed by EPA 608 certified technicians only. Never use liquid leak detection spray — use electronic leak detector or UV dye method only. Running undercharged OR overcharged system causes damage — proper refrigerant levels are always a priority. Set temperature setpoint to 0°F before beginning.',
    prerequisites:  'Set temperature setpoint to 0°F. Identify refrigerant type before hooking up — 2022 and newer TK or Carrier is almost certainly R-452A. Pre-2022 is likely R-404A. Older truck units may be R-134A. Very old units may be R-22 (reclaimed only). Use correct PT chart for YOUR refrigerant.',
    steps: 'Step 1 — Attach manifold gauges to unit service valves — suction side and discharge side.\nStep 2 — Check and record static pressure — suction and discharge pressures when equalized (unit off, pressures equal).\nStep 3 — Start unit and run in High Speed Cool for minimum 20 minutes to stabilize system pressures. Low ambient temperature adjustment — if ambient is low cover the condenser to replicate 100°F ambient condition. Refer to refrigerant PT chart for your specific refrigerant to know target pressures.\nStep 4 — Suction pressure should be near appropriate pressure for 0°F box temperature per PT chart for refrigerant in the system.\nStep 5 — Sight glass check — refrigerant should be visible and clear. Ball should be floating at top of sight glass on receiver tank. Bubbling continuously means low charge. Empty sight glass means significantly low charge or empty system.\nStep 6 — If refrigerant is low add slowly to suction side only. Add no more than 30 PSI above actual running suction pressure at a time. Watch sight glass — stop when ball floats at top and sight glass clears.\nStep 7 — Always check refrigerant level before returning any unit to service after any refrigeration repair.',
    notes:          'Refrigerant PT reference — R-404A suction at 0°F box approximately 18-22 PSI discharge at 95°F ambient approximately 225-275 PSI. R-452A suction approximately 16-20 PSI discharge approximately 210-260 PSI. R-134A suction approximately 10-15 PSI discharge approximately 150-200 PSI. R-22 suction approximately 18-22 PSI discharge approximately 200-250 PSI. These are approximate field reference values — always use manufacturer PT chart for exact specs.',
    labor_time:     0.75,
    verified:       true,
  },
  {
    procedure_name: 'Compressor Capacity Test',
    category:       'Refrigeration',
    applies_to:     'TK and Carrier — all systems with reciprocating compressors',
    safety_warnings: 'Disconnect HPCO to prevent remote start. All refrigerant work must be performed by EPA 608 certified technicians only. NEVER run a scroll compressor with suction service valve front seated. Set temperature setpoint to 0°F before beginning.',
    prerequisites:  'Set temperature setpoint to 0°F. Three prerequisites MUST be confirmed before starting — (1) Engine RPMs dialed in — verify and adjust if necessary, wrong RPM gives wrong compressor performance readings. (2) Refrigerant level confirmed full — perform Quick Refrigerant Level Check procedure first, an undercharged system will never pass even with a good compressor. (3) Low side pump down completed — perform Low Side Pump Down procedure to confirm no internal leaks from high side to low side and no leaks to atmosphere.',
    steps: 'Step 1 — Attach manifold gauges to suction and discharge service valves.\nStep 2 — Start unit and operate in High Speed Cool. Cover condenser and build discharge pressure to target — R-404A and R-452A build to 350 PSI, R-134A build to 250 PSI. Ambient temperature needs to be warm to hot. If not sufficient cover condenser to replicate 100°F ambient on discharge side.\nStep 3 — With condenser still covered and discharge holding at target pressure front seat the low side (suction) service valve to begin pumping system down.\nStep 4 — Pump compressor down to -10 inches of vacuum on suction side.\nStep 5 — Record discharge pressure at the moment suction hits -10 vacuum.\nStep 6 — Read the results — R-134A should read 250 PSI at discharge when suction is at -10 vacuum. R-404A and R-452A should read 200-250 PSI or higher at discharge when suction is at -10 vacuum. Below spec pressures indicate failed or failing compressor.\nStep 7 — Back seat suction service valve to return system to normal operation. Follow Low Side Pump Down gauge removal steps to properly remove gauges and minimize refrigerant loss.',
    notes:          'A failing compressor may still cool but will take significantly longer to reach setpoint consuming more fuel and will eventually fail completely often over the road under a full load. Bring this to the customer\'s attention immediately and express repairs with urgency. Document test results on the invoice — record discharge pressure at -10 vacuum and note against spec. This is your proof of condition and protects you legally if customer declines repair and unit fails later. Run and check unit. Perform full pre-trip. Confirm no active codes. Return unit to service.',
    labor_time:     0.25,
    verified:       true,
  },
]

export async function POST(_req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()

  if (!user)                  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.id !== FOUNDER_ID) return NextResponse.json({ error: 'Forbidden' },    { status: 403 })

  const supabase = createServiceClient()

  // connection test
  const { count, error: countError } = await supabase
    .from('hd_procedures')
    .select('*', { count: 'exact', head: true })

  if (countError) {
    return NextResponse.json({
      error:   'Database connection failed — table may not exist or RLS is blocking access.',
      details: countError,
    }, { status: 500 })
  }

  console.log(`[procedures-seed] connection OK — existing row count: ${count}`)

  // delete existing
  const { error: deleteError } = await supabase
    .from('hd_procedures')
    .delete()
    .not('id', 'is', null)

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message, details: deleteError }, { status: 500 })
  }

  // insert all
  const { error: insertError } = await supabase
    .from('hd_procedures')
    .insert(PROCEDURES_SEED)

  if (insertError) {
    return NextResponse.json({ error: insertError.message, details: insertError }, { status: 500 })
  }

  console.log(`[procedures-seed] complete — ${PROCEDURES_SEED.length} procedures seeded`)

  return NextResponse.json({
    success: true,
    count:   PROCEDURES_SEED.length,
    message: `${PROCEDURES_SEED.length} procedures seeded successfully.`,
  })
}
