// NWI HD Suite — Complete Parts Database Seed
// All part numbers verified from source data provided by Brock Fleeman
// DO NOT MODIFY PART NUMBERS — these are exact OEM references

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function seedHDParts() {
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const parts = [
    // ── THERMO KING STARTERS ──────────────────────────────────────────────────
    { part_number: '45-2324', manufacturer: 'Thermo King', description: 'Starter Assembly — Yanmar 486V Tier 2', category: 'starter', unit_models: ['SB-190','SB-200','SB-210','SB-300','SB-310','SL-100','SL-200','SL-300','SL-400','Precedent G-700'], engine: 'Yanmar 486V Tier 2', notes: 'Most common TK trailer starter. Verify engine serial before ordering.' },
    { part_number: '45-2323', manufacturer: 'Thermo King', description: 'Starter Assembly — Yanmar 486E Tier 1', category: 'starter', unit_models: ['SB-110','MD-II'], engine: 'Yanmar 486E Tier 1', superseded_by: '45-2324', notes: 'Superseded — order 45-2324 instead' },
    { part_number: '45-2326', manufacturer: 'Thermo King', description: 'Starter Assembly — Yanmar 370/376 Tier 2/4', category: 'starter', unit_models: ['T-600','T-680','T-800','T-1000','MD-200','MD-300'], engine: 'Yanmar 370/376 Tier 2/4' },
    { part_number: '45-2176', manufacturer: 'Thermo King', description: 'Starter Assembly — Yanmar 270 Tier 1', category: 'starter', unit_models: ['TriPac pre-July 2006','Heat King'], engine: 'Yanmar 270 Tier 1' },
    { part_number: '45-2325', manufacturer: 'Thermo King', description: 'Starter Assembly — Yanmar DI SE Legacy', category: 'starter', unit_models: ['SB-II','SB-III','Super II'], engine: 'Yanmar DI SE' },
    { part_number: '44-2918', manufacturer: 'Thermo King', description: 'Starter Assembly — Isuzu C201 2.2L', category: 'starter', unit_models: ['SB-I','SB-II','Sentry','Super NWD'], engine: 'Isuzu C201 2.2L' },
    { part_number: '45-1718', manufacturer: 'Thermo King', description: 'Starter Assembly — TriPac APU', category: 'starter', unit_models: ['TriPac'], engine: 'Yanmar TK270 TK370' },
    { part_number: '45-1688', manufacturer: 'Thermo King', description: 'Starter Assembly — Yanmar 482 486E', category: 'starter', engine: 'Yanmar 482 486E' },
    { part_number: '45-1993', manufacturer: 'Thermo King', description: 'Starter Assembly — Isuzu 2.2DI', category: 'starter', engine: 'Isuzu 2.2DI SE' },
    { part_number: '45-1251', manufacturer: 'Thermo King', description: 'Starter Assembly — Yanmar 235', category: 'starter', engine: 'Yanmar 235' },
    { part_number: '45-1285', manufacturer: 'Thermo King', description: 'Starter Assembly — Isuzu C201', category: 'starter', engine: 'Isuzu C201' },

    // ── THERMO KING ALTERNATORS ───────────────────────────────────────────────
    { part_number: '45-2592', manufacturer: 'Thermo King', description: 'Alternator 37 Amp Standard', category: 'alternator', unit_models: ['SB-200','SB-300','SB-III','Super II'], specs: { amp: 37 }, notes: 'Load test battery before replacing alternator — weak battery mimics charging failure' },
    { part_number: '45-2591', manufacturer: 'Thermo King', description: 'Alternator 120 Amp High Output', category: 'alternator', unit_models: ['SB-200','SB-300','SB-III','Super II'], specs: { amp: 120 } },
    { part_number: '45-2775', manufacturer: 'Thermo King', description: 'Alternator 120 Amp', category: 'alternator', unit_models: ['SB-200','SB-300'], specs: { amp: 120 } },
    { part_number: '45-2597', manufacturer: 'Thermo King', description: 'Alternator 65 Amp — TriPac APU', category: 'alternator', unit_models: ['TriPac'], specs: { amp: 65 } },
    { part_number: '40-1157', manufacturer: 'Thermo King', description: 'Alternator — TriPac APU', category: 'alternator', unit_models: ['TriPac'] },
    { part_number: '45-2672', manufacturer: 'Thermo King', description: 'Alternator — TriPac APU', category: 'alternator', unit_models: ['TriPac'] },
    { part_number: '45-2697', manufacturer: 'Thermo King', description: 'Alternator 65 Amp — Precedent Series', category: 'alternator', unit_models: ['Precedent C-600','Precedent S-600','Precedent S-700'], specs: { amp: 65 } },
    { part_number: '45-2699', manufacturer: 'Thermo King', description: 'Alternator 120 Amp — Precedent Series', category: 'alternator', unit_models: ['Precedent C-600','Precedent S-600','Precedent S-700'], specs: { amp: 120 } },

    // ── THERMO KING BELTS — SB Series ─────────────────────────────────────────
    { part_number: '78-0629', manufacturer: 'Thermo King', description: 'Belt Engine to Idler Drive — SB Series', category: 'belt', unit_models: ['SB-100','SB-110','SB-130','SB-190','SB-200','SB-210','SB-III'], notes: '87 inch Cogged V-Belt — Gates BX84 — Dayco L587' },
    { part_number: '78-1341', manufacturer: 'Thermo King', description: 'Belt Alternator Water Pump — Yanmar 486', category: 'belt', unit_models: ['SB-100','SB-110','SB-130','SB-190','SB-200','SB-210'], engine: 'Yanmar 486', notes: 'Gates 9455 — Dayco 17455' },
    { part_number: '78-0603', manufacturer: 'Thermo King', description: 'Belt Condenser Blower Fan — SB Series', category: 'belt', unit_models: ['SB-100','SB-110','SB-130','SB-190','SB-200','SB-210','SB-II','SB-III'], notes: 'Gates AX43 — Dayco 15430' },
    { part_number: '78-1968', manufacturer: 'Thermo King', description: 'Belt Water Pump — SB with Electric Standby', category: 'belt', unit_models: ['SB-200','SB-210','SB-230','SMX','SL'], notes: 'Replaces 78-1340' },
    { part_number: '78-1340', manufacturer: 'Thermo King', description: 'Belt Water Pump', category: 'belt', superseded_by: '78-1968' },
    { part_number: '78-1360', manufacturer: 'Thermo King', description: 'Belt Alternator — Multi-Temp Units', category: 'belt', unit_models: ['SB-110','SB-200','SB-210','SB-400'] },
    { part_number: '78-1484', manufacturer: 'Thermo King', description: 'Belt Alternator 65 Amp with Idler Pulley', category: 'belt' },
    { part_number: '78-1543', manufacturer: 'Thermo King', description: 'Belt Alternator 120 Amp with 2 inch Pulley', category: 'belt' },
    { part_number: '78-1634', manufacturer: 'Thermo King', description: 'Belt Alternator Compressor 120 Amp No Idler', category: 'belt', unit_models: ['TriPac'] },
    { part_number: '78-1655', manufacturer: 'Thermo King', description: 'Belt Alternator 65 Amp Without Idler', category: 'belt' },

    // ── THERMO KING BELTS — Precedent Series ─────────────────────────────────
    { part_number: '78-1859', manufacturer: 'Thermo King', description: 'Belt Generator Alternator — Precedent C-600', category: 'belt', unit_models: ['Precedent C-600'] },
    { part_number: '78-1876', manufacturer: 'Thermo King', description: 'Belt Generator to Alternator — Precedent S-600', category: 'belt', unit_models: ['Precedent S-600'] },
    { part_number: '78-1875', manufacturer: 'Thermo King', description: 'Belt Generator — Precedent S-600', category: 'belt', unit_models: ['Precedent S-600'], notes: 'Replaces 78-1844' },
    { part_number: '78-1844', manufacturer: 'Thermo King', description: 'Belt Generator — Precedent S-600', category: 'belt', unit_models: ['Precedent S-600'], superseded_by: '78-1875' },
    { part_number: '78-1858', manufacturer: 'Thermo King', description: 'Belt Generator — Precedent C-600', category: 'belt', unit_models: ['Precedent C-600'] },
    { part_number: '78-1860', manufacturer: 'Thermo King', description: 'Belt Motor to Clutch 19HP — Precedent S-600', category: 'belt', unit_models: ['Precedent S-600'] },
    { part_number: '78-1833', manufacturer: 'Thermo King', description: 'Belt Alternator 12HP — Precedent', category: 'belt', unit_models: ['Precedent C-600','Precedent S-600'] },
    { part_number: '78-1845', manufacturer: 'Thermo King', description: 'Belt Motor to Clutch 12HP — Precedent', category: 'belt', unit_models: ['Precedent C-600','Precedent S-600'] },
    { part_number: '78-1877', manufacturer: 'Thermo King', description: 'Belt Standby Motor — Precedent Series 12HP SmartPower', category: 'belt', unit_models: ['Precedent C-600','Precedent S-600'] },

    // ── THERMO KING BELTS — T-Series Truck Units ──────────────────────────────
    { part_number: '78-1724', manufacturer: 'Thermo King', description: 'Belt Engine to Motor Jackshaft — T-Series', category: 'belt', unit_models: ['T-580R','T-600R','T-800R','T-880R'] },
    { part_number: '78-1822', manufacturer: 'Thermo King', description: 'Belt Motor to Compressor — T-Series', category: 'belt', unit_models: ['T-560R','T-600R','T-680R','T-800M','T-800R','T-880R'] },
    { part_number: '78-1668', manufacturer: 'Thermo King', description: 'Belt Engine to Motor — T-600 T-800 TSA 370', category: 'belt', unit_models: ['T-600','T-800'], engine: 'Yanmar TSA 370' },
    { part_number: '78-1669', manufacturer: 'Thermo King', description: 'Belt Motor to Compressor — T-1000 T-1200', category: 'belt', unit_models: ['T-1000','T-1000M','T-1000R','T-1200','T-1200R'] },
    { part_number: '78-1626', manufacturer: 'Thermo King', description: 'Belt Engine to Motor — SLX 100', category: 'belt', unit_models: ['SLX-100'] },
    { part_number: '78-1681', manufacturer: 'Thermo King', description: 'Belt Motor to Compressor — T-600 T-800 370 Engine', category: 'belt', unit_models: ['T-600','T-800'] },
    { part_number: '78-1686', manufacturer: 'Thermo King', description: 'Belt Motor to Compressor — T-800R TSA ESA', category: 'belt', unit_models: ['T-800R'] },
    { part_number: '78-1688', manufacturer: 'Thermo King', description: 'Belt Motor to Compressor — T-800R Spectrum', category: 'belt', unit_models: ['T-800R Spectrum'] },
    { part_number: '78-1689', manufacturer: 'Thermo King', description: 'Belt Engine to Motor — T-100 TSA 376 Scroll', category: 'belt', unit_models: ['T-100'] },
    { part_number: '78-1690', manufacturer: 'Thermo King', description: 'Belt Motor to Compressor — T-1000 ESA 376', category: 'belt', unit_models: ['T-1000','T-1000M'] },
    { part_number: '78-1691', manufacturer: 'Thermo King', description: 'Belt Engine Motor — T-1000 Spectrum ESA', category: 'belt', unit_models: ['T-1000 Spectrum'] },
    { part_number: '78-1692', manufacturer: 'Thermo King', description: 'Belt Motor to Compressor — T-1000R Spectrum ESA', category: 'belt', unit_models: ['T-1000R Spectrum'] },
    { part_number: '78-1701', manufacturer: 'Thermo King', description: 'Belt Motor to Compressor — T-1200R ESA', category: 'belt', unit_models: ['T-1200R'] },
    { part_number: '78-1723', manufacturer: 'Thermo King', description: 'Belt Motor to Compressor — T-1200R Spectrum', category: 'belt', unit_models: ['T-1200R Spectrum'] },
    { part_number: '78-1736', manufacturer: 'Thermo King', description: 'Belt Water Pump — T-1000 T-1200 Series', category: 'belt', unit_models: ['T-100','T-1000','T-1000R','T-1200R'] },

    // ── THERMO KING BELTS — KD MD RD TD Series ───────────────────────────────
    { part_number: '78-1083', manufacturer: 'Thermo King', description: 'Belt Engine to Compressor — KDII MDII', category: 'belt', unit_models: ['KDII','MDII'] },
    { part_number: '78-1366', manufacturer: 'Thermo King', description: 'Belt Engine to Compressor — MD-100/200', category: 'belt', unit_models: ['KDII','MDII','MD-100','MD-200'] },
    { part_number: '78-1367', manufacturer: 'Thermo King', description: 'Belt Engine to Compressor — MD-300', category: 'belt', unit_models: ['KDII','MDII','MD-300'] },
    { part_number: '78-679', manufacturer: 'Thermo King', description: 'Belt Water Pump — KDII MDII', category: 'belt', unit_models: ['KDII','MDII'] },
    { part_number: '78-684', manufacturer: 'Thermo King', description: 'Belt Evaporator Fan — MD-100/200/300', category: 'belt', unit_models: ['KDII','MDII','MD-100','MD-200','MD-300'] },
    { part_number: '78-689', manufacturer: 'Thermo King', description: 'Belt Motor Jackshaft Compressor — KDII MDII', category: 'belt', unit_models: ['KDII','MDII'] },
    { part_number: '78-698', manufacturer: 'Thermo King', description: 'Belt Alternator to Evaporator Fan — KDII MDII', category: 'belt', unit_models: ['KDII','MDII'] },
    { part_number: '78-700', manufacturer: 'Thermo King', description: 'Belt Alternator to Evap Fan — MD-100/200/300', category: 'belt', unit_models: ['KDII','MDII','MD-100','MD-200','MD-300'] },

    // ── THERMO KING BELTS — SMX SL Series ────────────────────────────────────
    { part_number: '78-1085', manufacturer: 'Thermo King', description: 'Belt Alternator to Clutch — SMX SL', category: 'belt', unit_models: ['SMX','SL'] },
    { part_number: '78-1089', manufacturer: 'Thermo King', description: 'Belt Water Pump — SMX SL', category: 'belt', unit_models: ['SMX','SL'] },
    { part_number: '78-1486', manufacturer: 'Thermo King', description: 'Belt Engine to Jackshaft — SMX SL', category: 'belt', unit_models: ['SMX','SL'] },
    { part_number: '78-1487', manufacturer: 'Thermo King', description: 'Belt Clutch — SMX SL set of 2', category: 'belt', unit_models: ['SMX','SL'] },
    { part_number: '78-1488', manufacturer: 'Thermo King', description: 'Belt Motor to Jackshaft — SMX SL after 12/93', category: 'belt', unit_models: ['SMX','SL'] },
    { part_number: '78-1000', manufacturer: 'Thermo King', description: 'Belt Fan Drive — Super II', category: 'belt', unit_models: ['Super II'] },
    { part_number: '78-835', manufacturer: 'Thermo King', description: 'Belt Water Pump — Super II', category: 'belt', unit_models: ['Super II'] },

    // ── THERMO KING FILTERS ───────────────────────────────────────────────────
    { part_number: '37-11-9342', manufacturer: 'Thermo King', description: 'Fuel Filter', category: 'filter', subcategory: 'fuel' },
    { part_number: '37-11-9341', manufacturer: 'Thermo King', description: 'Fuel Filter EMI', category: 'filter', subcategory: 'fuel', notes: 'Replaces 37-11-9098' },
    { part_number: '37-11-9098', manufacturer: 'Thermo King', description: 'Fuel Filter', category: 'filter', subcategory: 'fuel', superseded_by: '37-11-9341' },
    { part_number: '37-11-9954', manufacturer: 'Thermo King', description: 'Fuel Filter — SB-130 SB-230 SB-330', category: 'filter', subcategory: 'fuel', unit_models: ['SB-130','SB-230','SB-330'] },
    { part_number: '37-11-9965', manufacturer: 'Thermo King', description: 'Fuel Filter — Precedent S-600 S-610', category: 'filter', subcategory: 'fuel', unit_models: ['Precedent S-600','Precedent S-610'] },
    { part_number: '37-11-9967', manufacturer: 'Thermo King', description: 'Fuel Filter Secondary — Precedent after June 2021', category: 'filter', subcategory: 'fuel', unit_models: ['Precedent S-600','Precedent S-610DE','Precedent S-610M','Precedent S-700','Precedent S-750i'], notes: 'Units built after June 2021' },
    { part_number: '37-11-9969', manufacturer: 'Thermo King', description: 'Fuel Filter Primary — Precedent after June 2021', category: 'filter', subcategory: 'fuel', unit_models: ['Precedent S-600','Precedent S-610DE','Precedent S-610M','Precedent S-700','Precedent S-750i'], notes: 'Units built after June 2021' },
    { part_number: '37-11-6182E', manufacturer: 'Thermo King', description: 'Oil Filter', category: 'filter', subcategory: 'oil' },
    { part_number: '37-11-9099', manufacturer: 'Thermo King', description: 'Oil Filter', category: 'filter', subcategory: 'oil' },
    { part_number: '37-11-9959', manufacturer: 'Thermo King', description: 'Oil Filter — Precedent SLX', category: 'filter', subcategory: 'oil', unit_models: ['Precedent C-600','Precedent S-600','Precedent S-700','Precedent S-750i','Precedent S-610','SLX'] },
    { part_number: '37-11-9961', manufacturer: 'Thermo King', description: 'Oil Filter Severe Duty — Precedent SLX', category: 'filter', subcategory: 'oil', unit_models: ['Precedent C-600','Precedent S-600','Precedent S-700','Precedent S-750i','Precedent S-610','SLX'] },
    { part_number: '37-11-9059', manufacturer: 'Thermo King', description: 'Air Filter', category: 'filter', subcategory: 'air' },
    { part_number: '37-11-9300', manufacturer: 'Thermo King', description: 'Air Filter Economy — SB Series', category: 'filter', subcategory: 'air', unit_models: ['SB-100','SB-200','SB-300','SB-400'] },
    { part_number: '37-11-9955', manufacturer: 'Thermo King', description: 'Air Filter — Precedent SLX', category: 'filter', subcategory: 'air', unit_models: ['Precedent C-600','Precedent S-600','Precedent S-700','Precedent S-750i','Precedent S-610','SLX'] },
    { part_number: '37-22-1376', manufacturer: 'Thermo King', description: 'Compressor Oil Filter — X430P Internal', category: 'filter', subcategory: 'compressor', notes: 'Precedent units with X430P compressor — internal filter' },
    { part_number: '37-13-864', manufacturer: 'Thermo King', description: 'Fuel Filter Inline — TriPac', category: 'filter', subcategory: 'fuel', unit_models: ['TriPac'] },
    { part_number: '37-13-649', manufacturer: 'Thermo King', description: 'Fuel Filter Inline', category: 'filter', subcategory: 'fuel' },

    // ── THERMO KING THERMOSTATS ───────────────────────────────────────────────
    { part_number: '37-11-7702', manufacturer: 'Thermo King', description: 'Water Thermostat — Isuzu C201 2.2DI', category: 'thermostat', engine: 'Isuzu C201 2.2DI', notes: 'Use gasket 37-33-487 — sold separately' },
    { part_number: '37-13-954', manufacturer: 'Thermo King', description: 'Water Thermostat 160F — Yanmar 270 370 376', category: 'thermostat', engine: 'Yanmar 270 370 376', specs: { temp_f: 160, temp_c: 71 } },
    { part_number: '37-12-947', manufacturer: 'Thermo King', description: 'Water Thermostat 180F — Yanmar 486', category: 'thermostat', engine: 'Yanmar 486', specs: { temp_f: 180 } },
    { part_number: '37-13-385', manufacturer: 'Thermo King', description: 'Water Thermostat 160F Tier 2 — Yanmar 486V', category: 'thermostat', engine: 'Yanmar 486V Tier 2', specs: { temp_f: 160, temp_c: 71 } },
    { part_number: '37-11-7975', manufacturer: 'Thermo King', description: 'Water Thermostat — Yanmar 366 374', category: 'thermostat', engine: 'Yanmar 366 374' },
    { part_number: '37-11-9621', manufacturer: 'Thermo King', description: 'Water Thermostat — Yanmar 388 395', category: 'thermostat', engine: 'Yanmar 388 395' },

    // ── THERMO KING WATER PUMPS ───────────────────────────────────────────────
    { part_number: '37-13-508', manufacturer: 'Thermo King', description: 'Water Pump — Yanmar 235 353', category: 'water_pump', engine: 'Yanmar 235 353' },
    { part_number: '37-11-9356', manufacturer: 'Thermo King', description: 'Water Pump — Isuzu 2.2DI includes O-ring', category: 'water_pump', engine: 'Isuzu 2.2DI' },
    { part_number: '37-11-4576', manufacturer: 'Thermo King', description: 'Water Pump with Gasket — Isuzu C201', category: 'water_pump', engine: 'Isuzu C201' },
    { part_number: '37-13-506', manufacturer: 'Thermo King', description: 'Water Pump — SB-210', category: 'water_pump', unit_models: ['SB-210'] },
    { part_number: '37-13-507', manufacturer: 'Thermo King', description: 'Water Pump — Yanmar 395', category: 'water_pump', engine: 'Yanmar 395' },
    { part_number: '37-13-2269', manufacturer: 'Thermo King', description: 'Water Pump — Yanmar 270 370 376', category: 'water_pump', engine: 'Yanmar 270 370 376' },
    { part_number: '37-13-2270', manufacturer: 'Thermo King', description: 'Water Pump — Yanmar 376 380', category: 'water_pump', engine: 'Yanmar 376 380' },
    { part_number: '37-13-2572', manufacturer: 'Thermo King', description: 'Water Pump New Version — Yanmar 486', category: 'water_pump', engine: 'Yanmar 486', unit_models: ['SB-200','SB-210','SB-300','SB-310','SL-100','SL-200','SL-300','SL-400'] },
    { part_number: '37-13-2576', manufacturer: 'Thermo King', description: 'Water Pump with Adapter Plate — Yanmar 488', category: 'water_pump', engine: 'Yanmar 488', notes: 'IMPORTANT — requires new adapter plate between cylinder head and water pump — adapter plate now included with pump' },

    // ── THERMO KING EGR SYSTEM ────────────────────────────────────────────────
    { part_number: '37-13-1258', manufacturer: 'Thermo King', description: 'EGR Cooler Kit with Gaskets — Before June 2021', category: 'egr', unit_models: ['Precedent C-600','Precedent S-600','Precedent S-610','Precedent S-700'], notes: 'Units built BEFORE June 2021 only' },
    { part_number: '37-13-2850', manufacturer: 'Thermo King', description: 'EGR Cooler with Gaskets — After June 2021', category: 'egr', unit_models: ['Precedent S-600','Precedent S-610','Precedent S-700'], notes: 'Units built AFTER June 2021 — S-600 S-610 S-700' },
    { part_number: '37-203-799', manufacturer: 'Thermo King', description: 'EGR Cleaning Kit with Gaskets and Cleaner', category: 'egr', notes: 'Complete kit — includes all gaskets plus EGR cleaner — required at 3000 engine hours on TK488 engine' },
    { part_number: '37-EGR-KIT', manufacturer: 'Thermo King', description: 'EGR Gasket Kit — All Gaskets Without Cleaner', category: 'egr', notes: 'All EGR gaskets — order EGR-CLEANER separately if needed' },
    { part_number: '37-33-4963', manufacturer: 'Thermo King', description: 'EGR Valve In Gasket', category: 'egr' },
    { part_number: '37-33-4964', manufacturer: 'Thermo King', description: 'EGR Cooler to Exhaust Gasket', category: 'egr' },
    { part_number: '37-33-4965', manufacturer: 'Thermo King', description: 'EGR Pipe Gasket', category: 'egr' },
    { part_number: '37-33-4967', manufacturer: 'Thermo King', description: 'EGR Valve Out Gasket', category: 'egr' },
    { part_number: '37-33-4968', manufacturer: 'Thermo King', description: 'EGR Cooler to Elbow Gasket', category: 'egr' },
    { part_number: '37-33-6712', manufacturer: 'Thermo King', description: 'EGR Cooler Gasket — After June 2021', category: 'egr', notes: 'Units built after June 2021' },
    { part_number: '37-13-2032', manufacturer: 'Thermo King', description: 'EGR Lower Coolant Hose — Engine to EGR Cooler', category: 'egr', unit_models: ['Precedent C-600','Precedent S-600','Precedent S-700'] },
    { part_number: '37-13-2040', manufacturer: 'Thermo King', description: 'EGR Coolant Hose — EGR Cooler to Tube', category: 'egr', unit_models: ['Precedent C-600','Precedent S-600','Precedent S-700'] },
    { part_number: '37-13-2041', manufacturer: 'Thermo King', description: 'EGR Coolant Hose — Water Pump to EGR Tube', category: 'egr', unit_models: ['Precedent C-600','Precedent S-600','Precedent S-700'] },

    // ── THERMO KING HEAD GASKET ───────────────────────────────────────────────
    { part_number: '37-33-6021', manufacturer: 'Thermo King', description: 'Head Gasket — Yanmar 486V and 488 Engine REV6', category: 'gasket', engine: 'Yanmar 486V 488', unit_models: ['Precedent C-600','Precedent S-600','Precedent S-610','Precedent S-700','Precedent S-710','Precedent S-750i','SB-110','SB-210','SB-230','SB-330','SLX'], notes: 'FIELD CRITICAL — Supersedes 33-4122 33-4515 33-4517 33-5056 — KNOWN HIGH FAILURE RATE on 486V engine — commonly needed at 3000 engine hours and above — install dry with no sealant — torque in star pattern from center out' },

    // ── THERMO KING VIBRASORBERS ──────────────────────────────────────────────
    { part_number: '37-61-5901', manufacturer: 'Thermo King', description: 'Vibrasorber Suction Side — Precedent Series', category: 'vibrasorber', unit_models: ['Precedent C-600','Precedent S-600','Precedent S-610','Precedent S-700'], notes: 'FIELD CRITICAL — fails frequently on high hour units — stock 3 to 4 per model on truck — replace suction AND discharge together — inspect for oil staining at crimp ends' },
    { part_number: '37-61-6428', manufacturer: 'Thermo King', description: 'Vibrasorber Discharge Side — Precedent Series', category: 'vibrasorber', unit_models: ['Precedent C-600','Precedent S-600','Precedent S-610','Precedent S-700'], notes: 'FIELD CRITICAL — replace both vibrasorbers simultaneously — check for oil staining at crimp ends — failed engine mounts accelerate vibrasorber failure' },
    { part_number: '37-66-5784', manufacturer: 'Thermo King', description: 'Vibrasorber Discharge — SB Series and Super II', category: 'vibrasorber', unit_models: ['SB-200','SB-210','SB-300','SB-310','Super II'] },
    { part_number: '37-66-6024-SS', manufacturer: 'Thermo King', description: 'Vibrasorber Suction — SB Units', category: 'vibrasorber', unit_models: ['SB-200','SB-210','SB-300','SB-310'] },
    { part_number: '37-66-1224', manufacturer: 'Thermo King', description: 'Vibrasorber Discharge', category: 'vibrasorber' },

    // ── THERMO KING ENGINE MOUNTS ─────────────────────────────────────────────
    { part_number: '37-13-1207', manufacturer: 'Thermo King', description: 'Vibration Shock Mount Front — Precedent', category: 'mount', unit_models: ['Precedent C-600','Precedent S-600','Precedent S-610','Precedent S-700'] },
    { part_number: '37-13-1210', manufacturer: 'Thermo King', description: 'Vibration Shock Mount Rear — Precedent', category: 'mount', unit_models: ['Precedent C-600','Precedent S-600','Precedent S-610','Precedent S-700'] },
    { part_number: '37-13-1214', manufacturer: 'Thermo King', description: 'Vibration Shock Mount — Precedent', category: 'mount', unit_models: ['Precedent C-600','Precedent S-600','Precedent S-610','Precedent S-700'] },
    { part_number: '37-92-8822', manufacturer: 'Thermo King', description: 'Vibration Mount — T TS MD RD Truck Units', category: 'mount', unit_models: ['T-series','TS-series','MD-series','RD-series'] },
    { part_number: '37-99-4820', manufacturer: 'Thermo King', description: 'Vibration Mount — KDII MDII RDII TDII Super II', category: 'mount', unit_models: ['KDII','MDII','RDII','TDII','Super II'] },
    { part_number: '37-91-4043', manufacturer: 'Thermo King', description: 'Snubber Mount — Sentry II Super II SB Series', category: 'mount', unit_models: ['Sentry II','Super II','SB-III','SB-100','SB-200','SB-300','SB-400'] },
    { part_number: '37-91-4159', manufacturer: 'Thermo King', description: 'Vibration Mount — Sentry II Super II SB Series', category: 'mount', unit_models: ['Sentry II','Super II','SB-III','SB-100','SB-200','SB-300','SB-400'] },
    { part_number: '37-91-7709', manufacturer: 'Thermo King', description: 'Vibration Mount — Sentry Super II SB II III', category: 'mount', unit_models: ['Sentry','Super II','SB-II','SB-III','SB-100','SB-200','SB-300','SB-400'] },
    { part_number: '37-99-1433', manufacturer: 'Thermo King', description: 'Vibration Mount — Super II Sentry SB Series', category: 'mount', unit_models: ['Super II','Sentry','SB-I','SB-II','SB-III','SB-100','SB-200','SB-300','SB-400'] },
    { part_number: '37-91-2281', manufacturer: 'Thermo King', description: 'Engine Vibration Mount', category: 'mount' },
    { part_number: '37-92-8893', manufacturer: 'Thermo King', description: 'Engine Vibration Mount', category: 'mount', notes: 'Replaces 37-91-2338' },

    // ── THERMO KING SOLENOIDS ─────────────────────────────────────────────────
    { part_number: '66-8560', manufacturer: 'Thermo King', description: 'Pilot Solenoid Valve', category: 'solenoid', subcategory: 'pilot', unit_models: ['SLXi','TS-series','SLX','KD-series','MD-series','RD-series','TD-series','SL-series','SLXE'], notes: 'FIELD CRITICAL — pilot solenoid failure causes Code 67 — test coil 10-30 ohms' },
    { part_number: '66-7636', manufacturer: 'Thermo King', description: 'Pilot Solenoid Valve', category: 'solenoid', subcategory: 'pilot', unit_models: ['SLXi','Spectrum','SB-series','SLX','B-series','SL-series','V-series','T-series'], notes: 'FIELD CRITICAL — pilot solenoid failure causes Code 67 — test coil 10-30 ohms' },
    { part_number: '37-44-6424', manufacturer: 'Thermo King', description: 'Starter Solenoid — Isuzu C201 2.2DI', category: 'solenoid', subcategory: 'starter', engine: 'Isuzu C201 2.2DI' },
    { part_number: '37-44-6544', manufacturer: 'Thermo King', description: 'Speed Shut Off Solenoid', category: 'solenoid', subcategory: 'speed' },
    { part_number: '37-44-6727', manufacturer: 'Thermo King', description: 'Injection Pump Solenoid', category: 'solenoid', subcategory: 'fuel' },
    { part_number: '37-42-100', manufacturer: 'Thermo King', description: 'Fuel Shut Off Solenoid', category: 'solenoid', subcategory: 'fuel' },
    { part_number: '37-41-5459-KIT', manufacturer: 'Thermo King', description: 'Speed Solenoid Kit', category: 'solenoid', subcategory: 'speed' },
    { part_number: '37-41-9081-KIT', manufacturer: 'Thermo King', description: 'Throttle Solenoid Kit', category: 'solenoid', subcategory: 'throttle' },
    { part_number: '37-44-9181-KIT', manufacturer: 'Thermo King', description: 'Speed Solenoid Kit', category: 'solenoid', subcategory: 'speed', notes: 'Same as 41-1566' },
    { part_number: '37-44-2756', manufacturer: 'Thermo King', description: 'Solenoid Diode', category: 'solenoid', subcategory: 'electrical', notes: 'FIELD CRITICAL — always install new diode when replacing any solenoid — suppresses voltage spike that damages controller' },
    { part_number: '37-44-6823', manufacturer: 'Thermo King', description: 'Starter Solenoid — Isuzu C201 2.2DI', category: 'solenoid', subcategory: 'starter', engine: 'Isuzu C201 2.2DI' },

    // ── THERMO KING PRESSURE SWITCHES AND SENSORS ────────────────────────────
    { part_number: '37-41-3669', manufacturer: 'Thermo King', description: 'High Pressure Cutout Switch HPCO', category: 'switch', subcategory: 'pressure' },
    { part_number: '37-41-3845', manufacturer: 'Thermo King', description: 'High Pressure Cutout Switch', category: 'switch', subcategory: 'pressure' },
    { part_number: '37-41-3847', manufacturer: 'Thermo King', description: 'High Pressure Cutout Switch', category: 'switch', subcategory: 'pressure' },
    { part_number: '37-42-708', manufacturer: 'Thermo King', description: 'High Pressure Cutout Switch — Precedent SLX', category: 'switch', subcategory: 'pressure', unit_models: ['Precedent C-600','Precedent S-600','Precedent S-610','Precedent S-700','SLX'] },
    { part_number: '37-42-2282', manufacturer: 'Thermo King', description: 'Suction Pressure Transducer — Low Side ETV', category: 'sensor', subcategory: 'pressure', unit_models: ['SB-series with ETV'] },
    { part_number: '37-42-2827', manufacturer: 'Thermo King', description: 'Discharge Pressure Transducer — High Side', category: 'sensor', subcategory: 'pressure' },
    { part_number: '37-41-6538', manufacturer: 'Thermo King', description: 'Water Temperature Sensor', category: 'sensor', subcategory: 'temperature' },
    { part_number: '37-41-6539', manufacturer: 'Thermo King', description: 'Water Temperature Sensor', category: 'sensor', subcategory: 'temperature' },
    { part_number: '37-41-7068', manufacturer: 'Thermo King', description: 'Coolant Temperature Sensor', category: 'sensor', subcategory: 'temperature' },
    { part_number: '37-41-2842', manufacturer: 'Thermo King', description: 'Coolant Level Sensor', category: 'sensor', subcategory: 'level' },
    { part_number: '37-44-6016', manufacturer: 'Thermo King', description: 'RPM Sensor', category: 'sensor', subcategory: 'rpm' },
    { part_number: '37-44-9298', manufacturer: 'Thermo King', description: 'RPM Sensor', category: 'sensor', subcategory: 'rpm' },
    { part_number: '37-40-974', manufacturer: 'Thermo King', description: 'Temperature Sensor Graded', category: 'sensor', subcategory: 'temperature' },
    { part_number: '37-40-975', manufacturer: 'Thermo King', description: 'Temperature Sensor Ungraded', category: 'sensor', subcategory: 'temperature' },
    { part_number: '37-42-4989', manufacturer: 'Thermo King', description: 'Intake Air Temperature Sensor — Precedent S-Series', category: 'sensor', subcategory: 'temperature', unit_models: ['Precedent S-600','Precedent S-610','Precedent S-700','Precedent S-750i'] },
    { part_number: '37-42-530', manufacturer: 'Thermo King', description: 'RPM Sensor — Precedent S-Series', category: 'sensor', subcategory: 'rpm', unit_models: ['Precedent S-600','Precedent S-610','Precedent S-700','Precedent S-750i'] },

    // ── THERMO KING FUEL PUMPS AND GLOW PLUGS ────────────────────────────────
    { part_number: '37-41-7059-FA', manufacturer: 'Thermo King', description: 'Fuel Pump Assembly', category: 'fuel_pump', notes: 'Replaces 37-41-2638 and 37-41-7251' },
    { part_number: '37-42-989', manufacturer: 'Thermo King', description: 'Fuel Pump', category: 'fuel_pump', notes: 'Replaces 37-41-7251' },
    { part_number: '37-42-351', manufacturer: 'Thermo King', description: 'Fuel Pump — Facet SS', category: 'fuel_pump' },
    { part_number: '37-42-3304', manufacturer: 'Thermo King', description: 'Fuel Pump', category: 'fuel_pump' },
    { part_number: '37-41-7370', manufacturer: 'Thermo King', description: 'Glow Plug — Isuzu 2.2DI', category: 'glow_plug', engine: 'Isuzu 2.2DI' },
    { part_number: '37-42-916', manufacturer: 'Thermo King', description: 'Glow Plug — Truck Units', category: 'glow_plug' },

    // ── THERMO KING REFRIGERATION SYSTEM ─────────────────────────────────────
    { part_number: '37-61-6283', manufacturer: 'Thermo King', description: 'Expansion Valve R-404A — SB Units', category: 'refrigeration', subcategory: 'txv', unit_models: ['SB-series'] },
    { part_number: '37-61-600', manufacturer: 'Thermo King', description: 'Filter Drier — 8 and 10 Fittings', category: 'refrigeration', subcategory: 'drier' },
    { part_number: '37-61-800', manufacturer: 'Thermo King', description: 'Filter Drier — 6 Fitting 90 Degree', category: 'refrigeration', subcategory: 'drier' },
    { part_number: '37-61-3316', manufacturer: 'Thermo King', description: 'Filter Drier with Binary Switch — Before Oct 2006', category: 'refrigeration', subcategory: 'drier', notes: 'Before October 2006' },
    { part_number: '37-61-6630', manufacturer: 'Thermo King', description: 'Filter Drier Assembly — After Oct 2006', category: 'refrigeration', subcategory: 'drier', notes: 'After October 2006' },
    { part_number: '37-67-2654', manufacturer: 'Thermo King', description: 'Receiver Tank — SB Series', category: 'refrigeration', subcategory: 'receiver', unit_models: ['SB-III','SB-110','SB-190','SB-200','SB-210','SB-310','SB-330','SB-400'] },
    { part_number: '37-67-2687', manufacturer: 'Thermo King', description: 'Receiver Tank — Precedent Series', category: 'refrigeration', subcategory: 'receiver', unit_models: ['Precedent C-600','Precedent S-600','Precedent S-700','Precedent S-750i'] },
    { part_number: '37-67-3218', manufacturer: 'Thermo King', description: 'Condenser Roadside — Precedent S-600 S-700 C-600', category: 'refrigeration', subcategory: 'condenser', unit_models: ['Precedent C-600','Precedent S-600','Precedent S-700'] },
    { part_number: '37-67-3219', manufacturer: 'Thermo King', description: 'Condenser Curbside — Precedent S-600 S-700 C-600', category: 'refrigeration', subcategory: 'condenser', unit_models: ['Precedent C-600','Precedent S-600','Precedent S-700'] },

    // ── CARRIER TRANSICOLD STARTERS ───────────────────────────────────────────
    { part_number: '25-15198-00', manufacturer: 'Carrier Transicold', description: 'Starter Assembly 1.4KW — Supra 950 960', category: 'starter', unit_models: ['Supra 950','Supra 960'] },
    { part_number: '25-15371-00', manufacturer: 'Carrier Transicold', description: 'Starter Assembly — Supra 550 560', category: 'starter', unit_models: ['Supra 550','Supra 560'] },
    { part_number: '25-15520-00', manufacturer: 'Carrier Transicold', description: 'Starter Assembly — Maxima 4-91TV Engine', category: 'starter', unit_models: ['Maxima 1000','Maxima 1200','Maxima 1300'], engine: 'Kubota CT4-91TV' },
    { part_number: '25-34525-00', manufacturer: 'Carrier Transicold', description: 'Starter Assembly — CT2-29 Engine Supra 322-550', category: 'starter', unit_models: ['Supra 322','Supra 422','Supra 444','Supra 522','Supra 544','Supra 550'], engine: 'Kubota CT2-29' },
    { part_number: '25-35465-00', manufacturer: 'Carrier Transicold', description: 'Starter Assembly — Supra 650 to 860', category: 'starter', unit_models: ['Supra 650','Supra 660','Supra 750','Supra 760','Supra 850','Supra 860'] },
    { part_number: '25-38750-00', manufacturer: 'Carrier Transicold', description: 'Starter Assembly 1.4KW — CT4-114 Engine', category: 'starter', unit_models: ['Thunderbird','Phoenix Advantage','Eagle Plus'], engine: 'Kubota CT4-114' },
    { part_number: '25-39135-00', manufacturer: 'Carrier Transicold', description: 'Starter Assembly — Genset Units', category: 'starter', unit_models: ['Genset'] },
    { part_number: '25-39476-00', manufacturer: 'Carrier Transicold', description: 'Starter Assembly Tier 4', category: 'starter' },
    { part_number: '25-39587-00', manufacturer: 'Carrier Transicold', description: 'Starter Assembly — Vector 6500 6600', category: 'starter', unit_models: ['Vector 6500','Vector 6600'] },
    { part_number: '25-39610-00', manufacturer: 'Carrier Transicold', description: 'Starter Assembly APU — CT2-29 ComfortPro 6000', category: 'starter', unit_models: ['ComfortPro 6000'], engine: 'Kubota CT2-29' },
    { part_number: '25-39700-00', manufacturer: 'Carrier Transicold', description: 'Starter Assembly 2.2KW Denso Style', category: 'starter', notes: 'Replaces 25-39316-01' },

    // ── CARRIER TRANSICOLD ALTERNATORS ───────────────────────────────────────
    { part_number: '30-00556-04', manufacturer: 'Carrier Transicold', description: 'Alternator 70 Amp CCW with Pulley — X2 X4', category: 'alternator', unit_models: ['X2 2100','X2 2500','X4 7300','X4 7500'], specs: { amp: 70, rotation: 'CCW' } },
    { part_number: '30-00556-01', manufacturer: 'Carrier Transicold', description: 'Alternator 70 Amp CCW No Pulley — X2 X4', category: 'alternator', unit_models: ['X2 2100','X2 2500','X4 7300','X4 7500'], specs: { amp: 70, rotation: 'CCW' }, notes: 'Pulley sold separately — 50-01168-03' },
    { part_number: '30-01114-02', manufacturer: 'Carrier Transicold', description: 'Alternator 105 Amp', category: 'alternator', specs: { amp: 105 }, notes: 'Replaces 30-00409-11 and 30-00409-63' },
    { part_number: '30-01114-12', manufacturer: 'Carrier Transicold', description: 'Alternator 65 Amp CW', category: 'alternator', specs: { amp: 65, rotation: 'CW' }, notes: 'Replaces 30-00409-18' },
    { part_number: '30-01114-27', manufacturer: 'Carrier Transicold', description: 'Alternator 70 Amp', category: 'alternator', specs: { amp: 70 }, notes: 'Replaces 30-01114-07' },
    { part_number: '30-01114-34', manufacturer: 'Carrier Transicold', description: 'Alternator 105 Amp 14V', category: 'alternator', specs: { amp: 105, volt: 14 } },
    { part_number: '30-60147-50', manufacturer: 'Carrier Transicold', description: 'Alternator 150 Amp 10 Groove — Supra S5 S6 S7 S8', category: 'alternator', unit_models: ['Supra S5','Supra S6','Supra S7','Supra S8'], specs: { amp: 150 } },
    { part_number: '30-60147-51', manufacturer: 'Carrier Transicold', description: 'Alternator 110 Amp 10 Groove — Supra S5 S6 S7 S8', category: 'alternator', unit_models: ['Supra S5','Supra S6','Supra S7','Supra S8'], specs: { amp: 110 } },
    { part_number: '96-101-21K', manufacturer: 'Carrier Transicold', description: 'Alternator 60 Amp — APU 600X', category: 'alternator', unit_models: ['APU 600X'], specs: { amp: 60 } },
    { part_number: '96-111-02K', manufacturer: 'Carrier Transicold', description: 'Alternator 40 Amp — APU 500X', category: 'alternator', unit_models: ['APU 500X'], specs: { amp: 40 } },

    // ── CARRIER TRANSICOLD BELTS — Supra Truck Units ──────────────────────────
    { part_number: '25-33023-00', manufacturer: 'Carrier Transicold', description: 'Belt Water Pump — Supra 922 944 950 Genesis R90', category: 'belt', unit_models: ['Supra 922','Supra 944','Supra 950','Genesis R90'] },
    { part_number: '25-34856-00', manufacturer: 'Carrier Transicold', description: 'Belt Motor to Compressor — Supra 550 422', category: 'belt', unit_models: ['Supra 550','Supra 422'] },
    { part_number: '50-01145-00', manufacturer: 'Carrier Transicold', description: 'Belt Engine to Compressor — Supra 422', category: 'belt', unit_models: ['Supra 422'] },
    { part_number: '50-00178-58', manufacturer: 'Carrier Transicold', description: 'Belt Compressor to Motor — Supra 922 945 950 set of 2', category: 'belt', unit_models: ['Supra 922','Supra 945','Supra 950'] },
    { part_number: '50-01166-01', manufacturer: 'Carrier Transicold', description: 'Belt Engine to Compressor — Supra 922 950 Euro Phoenix', category: 'belt', unit_models: ['Supra 922','Supra 946','Supra 950','Euro Phoenix','Genesis R90'], notes: 'Replaces 50-01166-00' },
    { part_number: '50-01166-00', manufacturer: 'Carrier Transicold', description: 'Belt Engine to Compressor', category: 'belt', superseded_by: '50-01166-01' },
    { part_number: '50-01170-00', manufacturer: 'Carrier Transicold', description: 'Belt Motor to Compressor — Supra 550 650 750', category: 'belt', unit_models: ['Supra 550','Supra 650','Supra 750'] },
    { part_number: '50-60006-02', manufacturer: 'Carrier Transicold', description: 'Belt Alternator — Supra 622-744 922 947 Genesis R70', category: 'belt', unit_models: ['Supra 622','Supra 644','Supra 722','Supra 744','Supra 922','Supra 947','Genesis R70'] },
    { part_number: '50-60296-01', manufacturer: 'Carrier Transicold', description: 'Belt Water Pump — Supra 622-850 Maxima', category: 'belt', unit_models: ['Supra 622','Supra 644','Supra 722','Supra 744','Supra 650','Supra 750','Supra 844','Supra 850','Maxima 1000','Maxima 1200'] },
    { part_number: '50-01169-53', manufacturer: 'Carrier Transicold', description: 'Belt Engine to Compressor — Supra 844 850 set of 2', category: 'belt', unit_models: ['Supra 844','Supra 850'] },

    // ── CARRIER TRANSICOLD BELTS — X2 X4 Vector ──────────────────────────────
    { part_number: '50-00178-16', manufacturer: 'Carrier Transicold', description: 'Belt Compressor Drive — X4 7300 7500 Ultima', category: 'belt', unit_models: ['X4 7300','X4 7500','Ultima'] },
    { part_number: '50-00178-19', manufacturer: 'Carrier Transicold', description: 'Belt Lower Drive — X2 X4 Vector Ultima XTC', category: 'belt', unit_models: ['X2 2100','X2 2500','X4 7300','X4 7500','Vector','Ultima XTC','Ultra XTC'] },
    { part_number: '50-00178-24', manufacturer: 'Carrier Transicold', description: 'Belt Drive Condenser Fan — X2 X4 Vector Extra XT', category: 'belt', unit_models: ['X2 2100','X2 2500','X4 7300','X4 7500','Vector','Extra XT','Ultra XTC'] },
    { part_number: '50-00162-25', manufacturer: 'Carrier Transicold', description: 'Belt Alternator — X2 X4 Vector Supra 650 750', category: 'belt', unit_models: ['X2 2100','X2 2500','X4 7300','X4 7500','Vector','Supra 650','Supra 750'], notes: 'Use 50-01180-02 — out of stock' },
    { part_number: '50-00178-27', manufacturer: 'Carrier Transicold', description: 'Belt Upper Condenser Fan — X4 Series', category: 'belt', unit_models: ['X4 7300','X4 7500'] },

    // ── CARRIER TRANSICOLD BELTS — Trailer Units ──────────────────────────────
    { part_number: '50-00162-04', manufacturer: 'Carrier Transicold', description: 'Belt Water Pump — Advantage Eagle Phoenix Extra Genesis Ultra', category: 'belt', unit_models: ['Advantage','Eagle','Phoenix','Extra','Genesis TM900','Genesis TM1000','Genset','Thunderbird','Ultima','Ultra'] },
    { part_number: '50-00178-07', manufacturer: 'Carrier Transicold', description: 'Belt Condenser Fan — Extra Genesis Phoenix Ultra', category: 'belt', unit_models: ['Extra','Genesis TM900','Genesis TM1000','Optima','Phoenix Ultra XL','Ultra'] },
    { part_number: '50-00178-08', manufacturer: 'Carrier Transicold', description: 'Belt Compressor Drive — Extra XT Genesis Phoenix Ultra', category: 'belt', unit_models: ['Extra XT','Genesis TM900','Genesis TM1000','Phoenix Ultra XL','Ultra'] },
    { part_number: '50-00178-51', manufacturer: 'Carrier Transicold', description: 'Belt Standby Motor — Ultra Extra Phoenix set of 2', category: 'belt', unit_models: ['Ultra','Extra','Phoenix Ultra XL'] },
    { part_number: '50-00179-20', manufacturer: 'Carrier Transicold', description: 'Belt Alternator — Genesis TM900 TM1000 Phoenix Ultra', category: 'belt', unit_models: ['Genesis TM900','Genesis TM1000','Optima','Phoenix Ultra XL','Supra 950','Ultra'] },
    { part_number: '50-00162-53', manufacturer: 'Carrier Transicold', description: 'Belt Engine to Compressor — Supra 622-750 Genesis R70 set of 2', category: 'belt', unit_models: ['Supra 622','Supra 644','Supra 722','Supra 744','Supra 750','Genesis R70'] },

    // ── CARRIER TRANSICOLD FILTERS ────────────────────────────────────────────
    { part_number: '30-01079-01', manufacturer: 'Carrier Transicold', description: 'Fuel Filter', category: 'filter', subcategory: 'fuel', notes: 'Replaces 30-01123-00' },
    { part_number: '30-01123-00', manufacturer: 'Carrier Transicold', description: 'Fuel Filter', category: 'filter', subcategory: 'fuel', superseded_by: '30-01079-01' },
    { part_number: '30-01090-05', manufacturer: 'Carrier Transicold', description: 'Fuel Filter', category: 'filter', subcategory: 'fuel', notes: 'Replaces 30-01090-01' },
    { part_number: '30-01090-04', manufacturer: 'Carrier Transicold', description: 'Fuel Filter with Drain', category: 'filter', subcategory: 'fuel' },
    { part_number: '30-00304-00', manufacturer: 'Carrier Transicold', description: 'Oil Filter', category: 'filter', subcategory: 'oil' },
    { part_number: '30-00463-00', manufacturer: 'Carrier Transicold', description: 'Oil Filter', category: 'filter', subcategory: 'oil' },
    { part_number: '30-60143-00', manufacturer: 'Carrier Transicold', description: 'Oil Filter — Supra S6 S7 S8 S10', category: 'filter', subcategory: 'oil', unit_models: ['Supra S6','Supra S7','Supra S8','Supra S10'] },
    { part_number: '30-01121-00', manufacturer: 'Carrier Transicold', description: 'Oil Filter Extended Life — Supra 560-960', category: 'filter', subcategory: 'oil', unit_models: ['Supra 560','Supra 660','Supra 760','Supra 860','Supra 960'] },
    { part_number: '96-952-02K', manufacturer: 'Carrier Transicold', description: 'Oil Filter — APU 500X', category: 'filter', subcategory: 'oil', unit_models: ['APU 500X'] },
    { part_number: '30-00471-20', manufacturer: 'Carrier Transicold', description: 'Air Filter — X2 2100 2500 X4 7300 7500', category: 'filter', subcategory: 'air', unit_models: ['X2 2100','X2 2500','X4 7300','X4 7500'] },
    { part_number: '30-60148-20', manufacturer: 'Carrier Transicold', description: 'Air Filter — Supra S6 S8 S9', category: 'filter', subcategory: 'air', unit_models: ['Supra S6','Supra S8','Supra S9'] },

    // ── CARRIER TRANSICOLD THERMOSTATS ────────────────────────────────────────
    { part_number: '25-39236-01', manufacturer: 'Carrier Transicold', description: 'Water Thermostat', category: 'thermostat' },
    { part_number: '25-34309-01', manufacturer: 'Carrier Transicold', description: 'Engine Thermostat', category: 'thermostat' },
    { part_number: '25-37559-01', manufacturer: 'Carrier Transicold', description: 'Water Thermostat — CT4-134 DI Engine', category: 'thermostat', engine: 'Kubota CT4-134 DI' },

    // ── CARRIER TRANSICOLD WATER PUMPS ────────────────────────────────────────
    { part_number: '25-34935-00', manufacturer: 'Carrier Transicold', description: 'Water Pump — CT2-29 Engine Supra 322-550', category: 'water_pump', engine: 'Kubota CT2-29', unit_models: ['Supra 322','Supra 422','Supra 444','Supra 522','Supra 544','Supra 550'] },
    { part_number: '25-34330-00', manufacturer: 'Carrier Transicold', description: 'Water Pump — CT2-29 CT3-44 Before Serial 6E0001', category: 'water_pump', engine: 'Kubota CT2-29 CT3-44', notes: 'Before serial 6E0001' },
    { part_number: '25-15366-00', manufacturer: 'Carrier Transicold', description: 'Water Pump — CT3-44 CT2-29 Tier 4', category: 'water_pump', engine: 'Kubota CT3-44 CT2-29 Tier 4' },
    { part_number: '25-33024-00', manufacturer: 'Carrier Transicold', description: 'Water Pump — CT3-69 Tier II Supra 844-960', category: 'water_pump', engine: 'Kubota CT3-69 Tier II', unit_models: ['Supra 844','Supra 850','Supra 860','Supra 922','Supra 944','Supra 950','Supra 960'] },
    { part_number: '25-15425-00', manufacturer: 'Carrier Transicold', description: 'Water Pump — CT4-91 Maxima', category: 'water_pump', engine: 'Kubota CT4-91', unit_models: ['Maxima 1000','Maxima 1200','Maxima 1300'] },
    { part_number: '25-37581-10', manufacturer: 'Carrier Transicold', description: 'Water Pump — CT4-134 DI Tier 1 Early Tier 2', category: 'water_pump', engine: 'Kubota CT4-134 DI', unit_models: ['Genesis TM900','Genesis TM1000','Phoenix Ultra','Ultima 53'] },
    { part_number: '25-15568-00', manufacturer: 'Carrier Transicold', description: 'Water Pump with Gasket — CT4-134 DI Tier 4 ESC', category: 'water_pump', engine: 'Kubota CT4-134 DI Tier 4', notes: 'Electronic Speed Control units' },

    // ── CARRIER TRANSICOLD SOLENOIDS ──────────────────────────────────────────
    { part_number: '22-02804-00', manufacturer: 'Carrier Transicold', description: 'Unloader Valve Coil Assembly 12V 15W', category: 'solenoid', subcategory: 'unloader', unit_models: ['Supra 922','Supra 944','Supra 950','Maxima 1000','Maxima 1200','Phoenix Ultra'], specs: { volt: 12, watt: 15, ohm: 9.6 }, notes: 'For 05G and 05K twin-port compressors — cross ref 22-02804-02 — resistance 9.6 ohms — check resistance before condemning' },
    { part_number: '22-02579-00', manufacturer: 'Carrier Transicold', description: 'Solenoid Valve Coil 12V — SV1 SV2 SV3 SV4', category: 'solenoid', subcategory: 'sv_valve', specs: { volt: 12 } },
    { part_number: '25-38773-00', manufacturer: 'Carrier Transicold', description: 'Speed Stop Solenoid — X2 X4 Series', category: 'solenoid', subcategory: 'speed', unit_models: ['X2 2100','X2 2500','X4 7300','X4 7500'] },
    { part_number: '25-38109-06', manufacturer: 'Carrier Transicold', description: 'Injection Pump Shut Off Solenoid', category: 'solenoid', subcategory: 'fuel' },
    { part_number: '25-15230-01', manufacturer: 'Carrier Transicold', description: 'Fuel Shut Off Solenoid — 3-69 4-91 Engine', category: 'solenoid', subcategory: 'fuel', engine: 'Kubota 3-69 4-91' },
    { part_number: '96-153-01K', manufacturer: 'Carrier Transicold', description: 'Fuel Shut Off Solenoid APU Gen X 600X', category: 'solenoid', subcategory: 'fuel', unit_models: ['APU 600X'] },

    // ── CARRIER TRANSICOLD SENSORS ────────────────────────────────────────────
    { part_number: '22-02973-06', manufacturer: 'Carrier Transicold', description: 'Thermistor Sensor — Return Air Evaporator', category: 'sensor', subcategory: 'temperature', unit_models: ['Maxima 2','Maxima II','Maxima 1000','Maxima 1200','Maxima 1200MT','Maxima 1300','Maxima 1300MT','Vector 1800','Vector 1850','Vector 1800MT'], notes: 'Cross ref 12-00566-55 — 12-00566-52 — 22-60010-01' },
    { part_number: '22-02973-10', manufacturer: 'Carrier Transicold', description: 'Thermistor Sensor', category: 'sensor', subcategory: 'temperature' },
    { part_number: '12-00352-13', manufacturer: 'Carrier Transicold', description: 'Suction Pressure Transducer — Low Side', category: 'sensor', subcategory: 'pressure', unit_models: ['Vector 1350','Vector 1550','Vector 1800','Vector 1850','Vector 1950','Vector 6500','Vector 6600','Ultra','Ultra XTC','X2 2100','X2 2500'], notes: 'Supersedes 12-00352-03' },
    { part_number: '12-00352-14', manufacturer: 'Carrier Transicold', description: 'Discharge Pressure Transducer — High Side', category: 'sensor', subcategory: 'pressure', unit_models: ['Vector 1350','Vector 1550','Vector 1800','Vector 1850','Vector 1950','Supra 422','Supra 550','Supra 622','Supra 644','Supra 650','Supra 722','Supra 744','Supra 750','Supra 844','Supra 850','Supra 922','Supra 944','Supra 950','Maxima 1000','Maxima 1200','Maxima 1300','Genesis R70','Genesis R90','Ultra','X4 7300','X4 7500'], notes: 'Replaces 12-00352-03 and 12-00352-04' },

    // ── CARRIER TRANSICOLD PRESSURE SWITCHES ──────────────────────────────────
    { part_number: '12-00334-00', manufacturer: 'Carrier Transicold', description: 'Compressor Unloader Pressure Switch', category: 'switch', subcategory: 'pressure', unit_models: ['Supra 544','Supra 750','Supra 850','Vector'], notes: 'Interchangeable with 12-00334-01 — green and white wire termination' },
    { part_number: '12-00334-01', manufacturer: 'Carrier Transicold', description: 'Compressor Unloader Pressure Switch', category: 'switch', subcategory: 'pressure', unit_models: ['Supra 544','Supra 750','Supra 850','Vector'], notes: 'Interchangeable with 12-00334-00' },

    // ── CARRIER TRANSICOLD MECHANICAL DRIVE ───────────────────────────────────
    { part_number: '48-50005-01', manufacturer: 'Carrier Transicold', description: 'Drive Coupling 05G with Hardware Yellow', category: 'mechanical', subcategory: 'coupling', notes: 'Replaces 48-50005-00 — for 05G compressor' },
    { part_number: '48-50005-00', manufacturer: 'Carrier Transicold', description: 'Drive Coupling 05G 6-bolt', category: 'mechanical', subcategory: 'coupling', superseded_by: '48-50005-01' },
    { part_number: '48-50003-00', manufacturer: 'Carrier Transicold', description: 'Drive Coupling 05G 4-bolt', category: 'mechanical', subcategory: 'coupling' },
    { part_number: '50-01171-01', manufacturer: 'Carrier Transicold', description: 'Clutch Truck Unit — Supra 229 Engine', category: 'mechanical', subcategory: 'clutch', unit_models: ['Supra 550','Supra 560'], engine: 'Kubota CT2-29' },
    { part_number: '50-01171-00', manufacturer: 'Carrier Transicold', description: 'Clutch Truck Unit — Supra 344 Engine', category: 'mechanical', subcategory: 'clutch', unit_models: ['Supra 622','Supra 644','Supra 650','Supra 660'], engine: 'Kubota CT3-44' },
    { part_number: '50-01171-02', manufacturer: 'Carrier Transicold', description: 'Clutch Truck Unit — Supra 369 Engine', category: 'mechanical', subcategory: 'clutch', unit_models: ['Supra 922','Supra 944','Genesis R90'], engine: 'Kubota CT3-69' },
    { part_number: '50-01173-03', manufacturer: 'Carrier Transicold', description: 'Clutch Assembly Condenser Fan — Ultra XTC X2 X4', category: 'mechanical', subcategory: 'clutch', unit_models: ['Ultra XTC','X2 2100','X2 2500','X4 7300','X4 7500'], notes: 'Replaces 50-01173-00' },
    { part_number: '50-01173-00', manufacturer: 'Carrier Transicold', description: 'Clutch Condenser Fan XT XTC', category: 'mechanical', subcategory: 'clutch', superseded_by: '50-01173-03' },

    // ── THERMO KING T-SERIES CLUTCH ───────────────────────────────────────────
    { part_number: '37-107-349', manufacturer: 'Thermo King', description: 'Clutch Assembly — T-Series Truck Units Centrifugal', category: 'mechanical', subcategory: 'clutch', unit_models: ['T-580R','T-600R','T-680R','T-800R','T-880R','T-1000','T-1000R','T-1080S','T-1200R'], notes: 'CENTRIFUGAL clutch — NOT electric or magnetic — engages via RPM and centrifugal force on clutch shoes — diagnose shoe wear and drum glazing not coil resistance or air gap', field_critical: true },
  ]

  // Cross references
  const crossRefs = [
    // Delco Remy — TK Starters
    { part_number: '45-2324', cross_mfr: 'Delco Remy', cross_part: '93591' },
    { part_number: '45-2324', cross_mfr: 'Delco Remy', cross_part: '93584' },
    { part_number: '45-1718', cross_mfr: 'Delco Remy', cross_part: '93597' },
    { part_number: '45-1688', cross_mfr: 'Delco Remy', cross_part: '93553' },
    // Delco Remy — TK Alternators
    { part_number: '45-2592', cross_mfr: 'Delco Remy', cross_part: '93070' },
    { part_number: '45-2591', cross_mfr: 'Delco Remy', cross_part: '93082' },
    { part_number: '45-2597', cross_mfr: 'Delco Remy', cross_part: '93095' },
    { part_number: '45-2699', cross_mfr: 'Delco Remy', cross_part: '93094' },
    // Delco Remy — Carrier Alternators
    { part_number: '30-01114-02', cross_mfr: 'Delco Remy', cross_part: '93091' },
    { part_number: '30-01114-12', cross_mfr: 'Delco Remy', cross_part: '93074' },
    { part_number: '30-01114-27', cross_mfr: 'Delco Remy', cross_part: '93076' },
    { part_number: '30-00556-04', cross_mfr: 'Delco Remy', cross_part: '93105' },
    // Carrier OEM cross refs
    { part_number: '22-02973-06', cross_mfr: 'Carrier OEM', cross_part: '12-00566-55' },
    { part_number: '22-02973-06', cross_mfr: 'Carrier OEM', cross_part: '12-00566-52' },
    { part_number: '22-02973-06', cross_mfr: 'Carrier OEM', cross_part: '22-60010-01' },
    { part_number: '12-00352-13', cross_mfr: 'Carrier OEM', cross_part: '12-00352-03' },
    { part_number: '12-00352-14', cross_mfr: 'Carrier OEM', cross_part: '12-00352-04' },
    { part_number: '22-02804-00', cross_mfr: 'Carrier OEM', cross_part: '22-02804-02' },
    { part_number: '78-1688', cross_mfr: 'Thermo King Legacy', cross_part: '78-1687' },
    { part_number: '78-1688', cross_mfr: 'Cross Reference', cross_part: 'CP10513' },
    { part_number: '45-2324', cross_mfr: 'Hitachi', cross_part: 'S13-407' },
  ]

  // Upsert parts in batches of 50 to avoid request timeout
  const BATCH = 50
  for (let i = 0; i < parts.length; i += BATCH) {
    const { error } = await supabase
      .from('hd_parts')
      .upsert(parts.slice(i, i + BATCH), { onConflict: 'part_number' })
    if (error) {
      console.error('Parts seed error (batch', i, '):', error)
      return { success: false, error: error.message }
    }
  }

  // Upsert cross refs in batches
  for (let i = 0; i < crossRefs.length; i += BATCH) {
    const { error } = await supabase
      .from('hd_parts_cross_ref')
      .upsert(crossRefs.slice(i, i + BATCH), { onConflict: 'part_number,cross_mfr,cross_part' })
    if (error) {
      console.error('Cross ref seed error (batch', i, '):', error)
      return { success: false, error: error.message }
    }
  }

  return { success: true, parts_count: parts.length, xref_count: crossRefs.length }
}