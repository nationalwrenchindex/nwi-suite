// NWI HD Suite — Parts Reference Cross-Reference Database
// Field data verified by Brock Fleeman, 17-year reefer tech

export interface PartsRefSeedEntry {
  manufacturer:    'TK' | 'Carrier' | 'Both'
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
  verified:        boolean
}

export const PARTS_REFERENCE_SEED: PartsRefSeedEntry[] = [

  // ─── Thermo King Filters ──────────────────────────────────────────────────────

  {
    manufacturer: 'TK', unit_family: 'ALL-TK',
    part_category: 'Filter', part_function: 'Engine Oil Lube',
    oem_part_number: '11-5522',
    baldwin: 'B247', napa_gold: '1348', luber_finer: 'LFP247', donaldson: 'P552849',
    fleetguard: null, wix: null, dayco: null, continental: null, gates: null, notes: null, verified: true,
  },
  {
    manufacturer: 'TK', unit_family: 'ALL-TK',
    part_category: 'Filter', part_function: 'Dual-Flow Lube',
    oem_part_number: '11-7382 / 127382',
    baldwin: 'BD7095', napa_gold: '1809', luber_finer: 'LFP7095', donaldson: 'P557382',
    fleetguard: null, wix: null, dayco: null, continental: null, gates: null, notes: null, verified: true,
  },
  {
    manufacturer: 'TK', unit_family: 'ALL-TK',
    part_category: 'Filter', part_function: 'Engine Oil Spin-on',
    oem_part_number: '11-9182 / 129182',
    baldwin: 'B7375', napa_gold: '7382', luber_finer: 'LFP9182', donaldson: 'P550835',
    fleetguard: null, wix: null, dayco: null, continental: null, gates: null, notes: null, verified: true,
  },
  {
    manufacturer: 'TK', unit_family: 'ALL-TK',
    part_category: 'Filter', part_function: 'Secondary Fuel Filter',
    oem_part_number: '11-3726 / 129341',
    baldwin: 'BF992', napa_gold: '3368', luber_finer: 'LFF992', donaldson: 'P553693',
    fleetguard: null, wix: null, dayco: null, continental: null, gates: null, notes: null, verified: true,
  },
  {
    manufacturer: 'TK', unit_family: 'ALL-TK',
    part_category: 'Filter', part_function: 'Fuel Water Separator',
    oem_part_number: '11-8047 / 12-9342',
    baldwin: 'BF9894', napa_gold: '3962', luber_finer: 'LFF9342SC', donaldson: 'P559125',
    fleetguard: null, wix: null, dayco: null, continental: null, gates: null, notes: null, verified: true,
  },
  {
    manufacturer: 'TK', unit_family: 'TriPac',
    part_category: 'Filter', part_function: 'In-Line Fuel Filter (TriPac APU)',
    oem_part_number: '13864',
    baldwin: 'BF46229', napa_gold: '33007', luber_finer: 'LFF46229', donaldson: 'P550865',
    fleetguard: null, wix: null, dayco: null, continental: null, gates: null,
    notes: 'Also crosses to Donaldson P551065', verified: true,
  },
  {
    manufacturer: 'TK', unit_family: 'ALL-TK',
    part_category: 'Filter', part_function: 'Primary Air Filter',
    oem_part_number: '119300 / 129300',
    baldwin: 'RS5387', napa_gold: '9300', luber_finer: 'LAF9300', donaldson: 'P953446',
    fleetguard: null, wix: null, dayco: null, continental: null, gates: null,
    notes: 'Also available as RS5387 KIT', verified: true,
  },

  // ─── Carrier Transicold Filters ───────────────────────────────────────────────

  {
    manufacturer: 'Carrier', unit_family: 'X2,X4,Vector',
    part_category: 'Filter', part_function: 'Heavy-Duty Full-Flow Spin-On Engine Oil Lube',
    oem_part_number: '30-00463-00',
    baldwin: 'BD7317', napa_gold: '7620', luber_finer: 'LFP780XL', donaldson: 'DBL7349',
    fleetguard: 'LF9028', wix: '57620XE', dayco: null, continental: null, gates: null,
    notes: 'NAPA also offers 7620XE (extended efficiency) and 47620 (Platinum synthetic). Fits X2 7300/7500, X4, Vector series — Kubota and CT491TV engines. NAPA 1604/1607 was incorrect — correct number is 7620.',
    verified: true,
  },
  {
    manufacturer: 'Carrier', unit_family: 'ALL-Carrier',
    part_category: 'Filter', part_function: 'Heavy-Duty Full-Flow Spin-On Engine Oil Lube (Standard)',
    oem_part_number: '2530053 / 25-30053',
    baldwin: 'B163', napa_gold: '1163', luber_finer: 'LFP163', donaldson: 'P550939',
    fleetguard: null, wix: null, dayco: null, continental: null, gates: null,
    notes: 'Also crosses Donaldson P550942. Heavy-duty full-flow spin-on engine oil lube — NOT transmission oil.',
    verified: true,
  },
  {
    manufacturer: 'Carrier', unit_family: 'ALL-Carrier',
    part_category: 'Filter', part_function: 'Engine Oil Spin-on',
    oem_part_number: '20-12-9101',
    baldwin: 'B128', napa_gold: '1128', luber_finer: 'LFP128', donaldson: 'P553746',
    fleetguard: null, wix: null, dayco: null, continental: null, gates: null, notes: null, verified: true,
  },
  {
    manufacturer: 'Carrier', unit_family: 'ALL-Carrier',
    part_category: 'Filter', part_function: 'Secondary Fuel Filter',
    oem_part_number: '20-113693',
    baldwin: 'BF992', napa_gold: '3368', luber_finer: 'LFF992', donaldson: 'P553693',
    fleetguard: null, wix: null, dayco: null, continental: null, gates: null, notes: null, verified: true,
  },
  {
    manufacturer: 'Carrier', unit_family: 'X2,X4',
    part_category: 'Filter', part_function: 'Fuel Filter with Drain',
    oem_part_number: '30-01090-00',
    baldwin: 'BF1223', napa_gold: '13125', luber_finer: 'LFF1223', donaldson: 'P559125',
    fleetguard: 'FF5780', wix: null, dayco: null, continental: null, gates: null,
    notes: 'Also covers -04 and -05 suffix. Baldwin BF1224 also fits. Fleetguard FS1994 also fits.',
    verified: true,
  },
  {
    manufacturer: 'Carrier', unit_family: 'ALL-Carrier',
    part_category: 'Filter', part_function: 'Air Filter',
    oem_part_number: '30-00291-01',
    baldwin: 'PA652', napa_gold: '6652', luber_finer: 'LAF652', donaldson: 'P535396',
    fleetguard: null, wix: null, dayco: null, continental: null, gates: null, notes: null, verified: true,
  },
  {
    manufacturer: 'Carrier', unit_family: 'X2,X4',
    part_category: 'Filter', part_function: 'Air Filter (X2/X4)',
    oem_part_number: '30-00426-27',
    baldwin: 'RS5325', napa_gold: '9325', luber_finer: 'LAF5325', donaldson: 'P601560',
    fleetguard: null, wix: null, dayco: null, continental: null, gates: null,
    notes: 'Also listed as P300042627', verified: true,
  },
  {
    manufacturer: 'Carrier', unit_family: 'ALL-Carrier',
    part_category: 'Filter', part_function: 'Air Filter (Round)',
    oem_part_number: '30-424-05K',
    baldwin: 'RS3715', napa_gold: '6715', luber_finer: 'LAF3715', donaldson: 'P822686',
    fleetguard: null, wix: null, dayco: null, continental: null, gates: null, notes: null, verified: true,
  },
  {
    manufacturer: 'Carrier', unit_family: 'X2,X4',
    part_category: 'Filter', part_function: 'Air Filter (Heavy-Duty)',
    oem_part_number: '30-00471-20',
    baldwin: 'PA5584', napa_gold: '9518', luber_finer: null, donaldson: 'P611858',
    fleetguard: 'AF4219', wix: null, dayco: null, continental: null, gates: null, notes: null, verified: true,
  },

  // ─── Thermo King Belts ────────────────────────────────────────────────────────

  {
    manufacturer: 'TK', unit_family: 'SB-III,SB-200',
    part_category: 'Belt', part_function: 'Fan Drive Belt',
    oem_part_number: '78-0603 / 78-603',
    baldwin: null, napa_gold: null, luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: 'BX59', continental: null, gates: null,
    notes: 'Industrial Cogged V-Belt', verified: true,
  },
  {
    manufacturer: 'TK', unit_family: 'SB series trailer',
    part_category: 'Belt', part_function: 'Lower Drive Belt',
    oem_part_number: '78-629',
    baldwin: null, napa_gold: null, luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: 'L587', continental: 'A-78-629-OE', gates: null,
    notes: 'Heavy-duty utility — 5/8 inch top width x 87 inch OC. Also crosses Continental 5LK870.',
    verified: true,
  },
  {
    manufacturer: 'TK', unit_family: 'Yanmar engine units',
    part_category: 'Belt', part_function: 'Water Pump Belt (Yanmar)',
    oem_part_number: '78-1011',
    baldwin: null, napa_gold: null, luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: '17315', continental: null, gates: null,
    notes: 'Also crosses Dayco 13A0800. Top Cog V-Belt.', verified: true,
  },
  {
    manufacturer: 'TK', unit_family: 'Precedent,SB-210',
    part_category: 'Belt', part_function: 'Alternator Belt',
    oem_part_number: '78-1341',
    baldwin: null, napa_gold: null, luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: '17455DY', continental: null, gates: null,
    notes: 'Also crosses Dayco 13A1155. Top Cog V-Belt.', verified: true,
  },
  {
    manufacturer: 'TK', unit_family: 'TriPac',
    part_category: 'Belt', part_function: 'Water Pump Belt (TriPac APU)',
    oem_part_number: '78-1492',
    baldwin: null, napa_gold: null, luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: '15285', continental: null, gates: null,
    notes: 'Also crosses Dayco 10A0725. Top Cog V-Belt.', verified: true,
  },
  {
    manufacturer: 'TK', unit_family: 'Precedent S-600',
    part_category: 'Belt', part_function: 'Engine to Compressor Belt',
    oem_part_number: '78-1859',
    baldwin: null, napa_gold: null, luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: '5060583', continental: null, gates: null,
    notes: 'Also crosses Dayco 6PK1475. Poly-V Serpentine 6 Rib.', verified: true,
  },
  {
    manufacturer: 'TK', unit_family: 'Precedent C-600',
    part_category: 'Belt', part_function: 'Main Drive Serpentine Belt',
    oem_part_number: '78-1876',
    baldwin: null, napa_gold: null, luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: '5060588', continental: null, gates: null,
    notes: 'Also crosses Dayco 6PK1495. Poly-V Serpentine 6 Rib.', verified: true,
  },
  {
    manufacturer: 'TK', unit_family: 'ALL-TK',
    part_category: 'Belt', part_function: 'Evaporator Fan Belt',
    oem_part_number: '78-0684',
    baldwin: null, napa_gold: null, luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: '17435', continental: null, gates: null,
    notes: 'Also crosses Dayco 13A1105. Top Cog V-Belt.', verified: true,
  },

  // ─── Carrier Transicold Belts ─────────────────────────────────────────────────

  {
    manufacturer: 'Carrier', unit_family: 'X4 7300,X4 7500',
    part_category: 'Belt', part_function: 'Lower Compressor Drive Belt (X4)',
    oem_part_number: '50-00178-16',
    baldwin: null, napa_gold: null, luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: 'BX62', continental: 'BX62', gates: null,
    notes: 'Industrial Cogged V-Belt — raw edge cogged ONLY. Never use smooth-backed belt — will fail under 05G compressor clutch engagement loads.',
    verified: true,
  },
  {
    manufacturer: 'Carrier', unit_family: 'X2 1800,X2 2100,X2 2500',
    part_category: 'Belt', part_function: 'Lower Compressor Drive Belt (X2)',
    oem_part_number: '50-00178-19',
    baldwin: null, napa_gold: null, luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: 'BX64', continental: 'BX64', gates: null,
    notes: 'Industrial Cogged V-Belt — raw edge cogged ONLY.', verified: true,
  },
  {
    manufacturer: 'Carrier', unit_family: 'X4 7300,X4 7500',
    part_category: 'Belt', part_function: 'Upper Condenser Fan Belt (X4)',
    oem_part_number: '50-00178-27',
    baldwin: null, napa_gold: null, luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: 'BX58', continental: 'BX58', gates: null,
    notes: 'Industrial Cogged V-Belt.', verified: true,
  },
  {
    manufacturer: 'Carrier', unit_family: 'X2 1800,X2 2100',
    part_category: 'Belt', part_function: 'Upper Condenser Fan Belt (X2 1800/2100)',
    oem_part_number: '50-00178-24',
    baldwin: null, napa_gold: null, luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: 'BX60', continental: 'BX60', gates: null,
    notes: 'Industrial Cogged V-Belt.', verified: true,
  },
  {
    manufacturer: 'Carrier', unit_family: 'X2 2500',
    part_category: 'Belt', part_function: 'Upper Condenser Fan Belt (X2 2500)',
    oem_part_number: '50-00178-26',
    baldwin: null, napa_gold: null, luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: 'BX61', continental: 'BX61', gates: null,
    notes: 'Industrial Cogged V-Belt.', verified: true,
  },
  {
    manufacturer: 'Carrier', unit_family: 'X2,X4,Vector,Supra',
    part_category: 'Belt', part_function: 'Alternator and Water Pump Belt',
    oem_part_number: '50-01180-02',
    baldwin: null, napa_gold: null, luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: '17380', continental: '13AV0965', gates: null,
    notes: 'STOCK THIS instead of 50-00162-25. Updated EPDM compound resists dry rotting and belt flutter under high-idle engine configurations. Universal across all X2 X4 and Vector platforms.',
    verified: true,
  },
  {
    manufacturer: 'Carrier', unit_family: 'X2 early Tier 2,X2 Tier 4i',
    part_category: 'Belt', part_function: 'Kubota Engine Water Pump Belt',
    oem_part_number: '25-15363-00',
    baldwin: null, napa_gold: null, luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: '15330', continental: '10AV0840', gates: null,
    notes: 'Early X2 Kubota engine only.', verified: true,
  },
  {
    manufacturer: 'Carrier', unit_family: 'Vector 8500,Vector 8600',
    part_category: 'Belt', part_function: 'Water Pump Belt (current)',
    oem_part_number: '50-01198-00',
    baldwin: null, napa_gold: null, luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: '15330', continental: '10AV0840', gates: null,
    notes: 'Current supercession for modern Vector water pump. Extended service intervals. E-Drive units — this and 50-01180-02 are the ONLY two belts needed for complete Vector coverage.',
    verified: true,
  },
  {
    manufacturer: 'Carrier', unit_family: 'Vector 1800,Vector 6500,Vector 6600',
    part_category: 'Belt', part_function: 'Water Pump Belt (legacy)',
    oem_part_number: '50-60330-03',
    baldwin: null, napa_gold: null, luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: '15330', continental: '10AV0840', gates: null,
    notes: 'Legacy Vector water pump belt.', verified: true,
  },
  {
    manufacturer: 'Carrier', unit_family: 'Supra',
    part_category: 'Belt', part_function: 'Alternator Notched Belt',
    oem_part_number: '50-00162-22',
    baldwin: null, napa_gold: null, luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: '17390', continental: '13AV0990', gates: null,
    notes: 'Top Cog V-Belt.', verified: true,
  },
  {
    manufacturer: 'Carrier', unit_family: 'ALL-Carrier',
    part_category: 'Belt', part_function: 'Alternator Compressor Serpentine',
    oem_part_number: '50-60480-01',
    baldwin: null, napa_gold: null, luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: '5060453', continental: '6PK1150', gates: null,
    notes: 'Poly-V Serpentine 6 Rib.', verified: true,
  },
  {
    manufacturer: 'Carrier', unit_family: 'Carrier Kubota V2203,V1505',
    part_category: 'Belt', part_function: 'Water Pump Belt (Kubota)',
    oem_part_number: '50-60329-06',
    baldwin: null, napa_gold: null, luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: '15330', continental: '10AV0840', gates: null,
    notes: 'Top Cog V-Belt.', verified: true,
  },

  // ─── Carrier Transicold Thermostats ──────────────────────────────────────────

  {
    manufacturer: 'Carrier', unit_family: 'Supra,Maxima',
    part_category: 'Thermostat', part_function: 'Engine Thermostat 180F',
    oem_part_number: '25-15003-00 / 29-70181-00',
    baldwin: null, napa_gold: 'THM 180442', luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: null, continental: null, gates: null,
    notes: 'Also crosses NAPA 244-180. Kubota CT229 CT344 CT491 engines. Operating temp 180F (82C).',
    verified: true,
  },
  {
    manufacturer: 'Carrier', unit_family: 'X2,X4',
    part_category: 'Thermostat', part_function: 'Engine Thermostat 180F (X2/X4)',
    oem_part_number: '25-39236-00 / -01',
    baldwin: null, napa_gold: 'THM PM1708235180', luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: null, continental: null, gates: null,
    notes: 'Kubota V2203-DI engine. X2 and X4 trailer units. Operating temp 180F (82C).',
    verified: true,
  },
  {
    manufacturer: 'Carrier', unit_family: 'Vector',
    part_category: 'Thermostat', part_function: 'Engine Thermostat 195F',
    oem_part_number: '25-34309-01',
    baldwin: null, napa_gold: 'THM 372195', luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: null, continental: null, gates: null,
    notes: 'Also crosses NAPA 265-195. Kubota Tier 4 Vector small case variant. Operating temp 195F (90C). Do NOT substitute 180F thermostat — Tier 4 engines run hotter by design.',
    verified: true,
  },

  // ─── Thermo King Thermostats ──────────────────────────────────────────────────

  {
    manufacturer: 'TK', unit_family: 'Precedent,SB series',
    part_category: 'Thermostat', part_function: 'Engine Thermostat 160F',
    oem_part_number: '11-9683 / 119683',
    baldwin: null, napa_gold: 'THM 520090', luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: null, continental: null, gates: null,
    notes: 'Also crosses NAPA 4048-90. Yanmar TK486 and TK486V engines. Operating temp 160F (71C).',
    verified: true,
  },
  {
    manufacturer: 'TK', unit_family: 'SB-III,Super II legacy',
    part_category: 'Thermostat', part_function: 'Engine Thermostat 160F (Legacy)',
    oem_part_number: '13-0393 / 130393',
    baldwin: null, napa_gold: 'THM 160003', luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: null, continental: null, gates: null,
    notes: 'Also crosses NAPA 300-160. Yanmar 3.74 and 3.95 engines. Legacy SB-III and Super II units. Operating temp 160F (71C).',
    verified: true,
  },
  {
    manufacturer: 'TK', unit_family: 'TriPac',
    part_category: 'Thermostat', part_function: 'Engine Thermostat 180F (TriPac APU)',
    oem_part_number: '11-7922',
    baldwin: null, napa_gold: 'THM 458180', luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: null, continental: null, gates: null,
    notes: 'Also crosses NAPA 655-180. TriPac APU Yanmar 2-cylinder engines. Operating temp 180F (82C).',
    verified: true,
  },

  // ─── Hardware / Common Parts ──────────────────────────────────────────────────

  {
    manufacturer: 'TK', unit_family: 'ALL-TK',
    part_category: 'Hardware', part_function: 'Copper Crush Washers — Fuel Inlet Screen',
    oem_part_number: '55-0381',
    baldwin: null, napa_gold: null, luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: null, continental: null, gates: null,
    notes: 'Aftermarket spec — ID 12mm OD 16-18mm Thickness 1.0-1.5mm. Replace every time fuel inlet screen is removed. Two required per service.',
    verified: true,
  },

  // ─── Stocking Notes ───────────────────────────────────────────────────────────

  {
    manufacturer: 'Carrier', unit_family: 'X2,X4',
    part_category: 'Stocking Note', part_function: 'X Series Mobile Truck Stocking Rule',
    oem_part_number: null,
    baldwin: null, napa_gold: null, luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: null, continental: null, gates: null,
    notes: 'Stock these 7 belt numbers for complete X2 and X4 coverage — 50-00178-16, 50-00178-19, 50-00178-27, 50-00178-24, 50-00178-26, 50-01180-02, 25-15363-00. Always buy raw-edge cogged BX style — never smooth-backed for compressor drive belts.',
    verified: true,
  },
  {
    manufacturer: 'Carrier', unit_family: 'Vector',
    part_category: 'Stocking Note', part_function: 'Vector Mobile Truck Stocking Rule',
    oem_part_number: null,
    baldwin: null, napa_gold: null, luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: null, continental: null, gates: null,
    notes: 'Vector units use E-Drive all-electric technology. NO compressor drive belts. NO condenser fan belts. Stock ONLY 50-01198-00 (water pump) and 50-01180-02 (alternator) for complete Vector belt coverage.',
    verified: true,
  },
  {
    manufacturer: 'Carrier', unit_family: 'ALL-Carrier',
    part_category: 'Stocking Note', part_function: 'Alternator Belt Supercession',
    oem_part_number: null,
    baldwin: null, napa_gold: null, luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: null, continental: null, gates: null,
    notes: 'Always stock 50-01180-02 NOT 50-00162-25. Updated EPDM compound resists dry rotting and belt flutter under high-idle engine configurations.',
    verified: true,
  },
  {
    manufacturer: 'Both', unit_family: 'ALL',
    part_category: 'Stocking Note', part_function: 'Water Pump Advisory',
    oem_part_number: null,
    baldwin: null, napa_gold: null, luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: null, continental: null, gates: null,
    notes: 'Water pumps for TK and Carrier units are proprietary designs with no reliable aftermarket cross-reference. Order OEM from authorized TK or Carrier dealer. For Carrier Kubota engine units Kubota dealers may also stock. Always specify unit model serial number and engine type when ordering. Aftermarket water pumps have frequent fitment issues — OEM only recommended.',
    verified: true,
  },
  {
    manufacturer: 'Both', unit_family: 'ALL',
    part_category: 'Stocking Note', part_function: 'Thermostat Temperature Warning',
    oem_part_number: null,
    baldwin: null, napa_gold: null, luber_finer: null, donaldson: null,
    fleetguard: null, wix: null, dayco: null, continental: null, gates: null,
    notes: 'Always verify operating temperature spec before replacing thermostat. TK Yanmar engines typically run 160F. Carrier Kubota standard engines run 180F. Carrier Tier 4 engines run 195F. Installing wrong temperature thermostat causes Code 18 high coolant temp shutdowns or poor fuel efficiency and carbon buildup. Do not substitute temperatures.',
    verified: true,
  },
]
