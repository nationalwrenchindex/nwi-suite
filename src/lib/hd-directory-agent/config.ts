// Shared constants + copy for the HD directory auto-population agent.
//
// Mirror of src/lib/directory-agent/config.ts with heavy-duty specifics: a
// service_category taxonomy, per-category outreach copy, the major-corridor
// city list, and a split rating floor.

export type HdServiceCategory =
  | 'truck' | 'trailer' | 'reefer' | 'tire' | 'fuel'
  | 'towing' | 'washout' | 'glass' | 'locksmith' | 'shop'

// Every value the hd_directory_prospects CHECK constraint allows, in the order
// the admin breakdown renders them. trailer/glass/locksmith have no automated
// search terms yet — they exist for manual recategorization.
export const HD_SERVICE_CATEGORIES: readonly HdServiceCategory[] = [
  'truck', 'trailer', 'reefer', 'tire', 'fuel',
  'towing', 'washout', 'glass', 'locksmith', 'shop',
]

export const HD_CATEGORY_LABEL: Record<HdServiceCategory, string> = {
  truck:     'Truck & Diesel',
  trailer:   'Trailer',
  reefer:    'Reefer',
  tire:      'Tire',
  fuel:      'Fuel',
  towing:    'Towing',
  washout:   'Washout',
  glass:     'Glass',
  locksmith: 'Locksmith',
  shop:      'Shop',
}

// What BD's profession_name gets set to when the listing is created.
export const HD_PROFESSION_NAME: Record<HdServiceCategory, string> = {
  truck:     'Heavy Duty Truck Repair',
  trailer:   'Trailer Repair',
  reefer:    'Transport Refrigeration',
  tire:      'Commercial Tire Service',
  fuel:      'Fuel Delivery',
  towing:    'Heavy Duty Towing',
  washout:   'Trailer Washout',
  glass:     'Truck Glass',
  locksmith: 'Truck Locksmith',
  shop:      'Heavy Duty Repair Shop',
}

// ─── Rating floors ───────────────────────────────────────────────────────────
// Mobile operators are held to a higher bar than fixed shops: a roadside call
// is a stranger arriving at a stranded driver, so the trust threshold is
// higher. Fixed shops accumulate walk-in reviews that drag averages down for
// reasons (wait times, pricing) that matter less in an emergency.
export const HD_MIN_RATING_MOBILE = 4.0
export const HD_MIN_RATING_SHOP   = 3.5

export const HD_DEFAULT_RADIUS_METERS = 50000
export const HD_INVITE_BATCH_SIZE     = 25
export const HD_FOLLOW_UP_AFTER_DAYS  = 3

// HD outreach 10DLC number. Falls back to the LD number when no HD-specific
// number is provisioned, so the agent still sends rather than silently failing.
export const HD_FROM_NUMBER = () =>
  process.env.HD_DIRECTORY_AGENT_FROM_NUMBER ??
  process.env.DIRECTORY_AGENT_FROM_NUMBER ??
  '+13362761896'

// ─── Search terms ────────────────────────────────────────────────────────────
// `mobile` selects the rating floor above. Terms are ordered so that when one
// business surfaces under several queries, the more specific category wins:
// dedupe keeps the first match, and 'shop' is deliberately last.
export interface HdSearchTerm {
  query:    string
  category: HdServiceCategory
  mobile:   boolean
}

export const HD_SEARCH_TERMS: readonly HdSearchTerm[] = [
  // Truck and diesel repair
  { query: 'mobile diesel mechanic',       category: 'truck',   mobile: true  },
  { query: 'mobile truck repair',          category: 'truck',   mobile: true  },
  { query: 'mobile semi truck repair',     category: 'truck',   mobile: true  },
  { query: 'heavy duty mobile mechanic',   category: 'truck',   mobile: true  },
  { query: 'roadside truck repair',        category: 'truck',   mobile: true  },
  { query: 'tractor trailer repair',       category: 'truck',   mobile: false },
  { query: 'heavy duty truck shop',        category: 'truck',   mobile: false },
  { query: 'diesel truck repair shop',     category: 'truck',   mobile: false },

  // Transport refrigeration
  { query: 'mobile reefer repair',         category: 'reefer',  mobile: true  },
  { query: 'transport refrigeration repair', category: 'reefer', mobile: false },
  { query: 'Thermo King repair',           category: 'reefer',  mobile: false },
  { query: 'Carrier Transicold repair',    category: 'reefer',  mobile: false },
  { query: 'reefer repair shop',           category: 'reefer',  mobile: false },

  // Tire service
  { query: 'mobile truck tire repair',     category: 'tire',    mobile: true  },
  { query: 'truck tire repair',            category: 'tire',    mobile: false },
  { query: 'commercial truck tire service', category: 'tire',   mobile: false },
  { query: 'semi truck tire',              category: 'tire',    mobile: false },
  { query: 'truck tire shop',              category: 'tire',    mobile: false },

  // Fuel delivery — inherently mobile
  { query: 'diesel fuel delivery',         category: 'fuel',    mobile: true  },
  { query: 'emergency fuel delivery truck', category: 'fuel',   mobile: true  },
  { query: 'mobile fuel delivery',         category: 'fuel',    mobile: true  },

  // Towing and recovery — inherently mobile
  { query: 'heavy duty towing',            category: 'towing',  mobile: true  },
  { query: 'semi truck towing',            category: 'towing',  mobile: true  },
  { query: 'commercial towing',            category: 'towing',  mobile: true  },
  { query: 'big rig towing',               category: 'towing',  mobile: true  },
  { query: 'heavy duty recovery',          category: 'towing',  mobile: true  },

  // Washout — fixed facilities
  { query: 'trailer washout',              category: 'washout', mobile: false },
  { query: 'reefer trailer cleaning',      category: 'washout', mobile: false },
  { query: 'trailer cleaning service',     category: 'washout', mobile: false },

  // Shops and truck stops — last so more specific categories claim first
  { query: 'truck stop',                   category: 'shop',    mobile: false },
  { query: 'heavy duty repair shop',       category: 'shop',    mobile: false },
  { query: 'commercial truck repair',      category: 'shop',    mobile: false },
  { query: 'fleet maintenance shop',       category: 'shop',    mobile: false },
]

// Major truck corridors — the Tuesday search cron sweeps these in order.
export const HD_SEARCH_CITIES: ReadonlyArray<{ city: string; state: string }> = [
  { city: 'Winston-Salem', state: 'NC' },
  { city: 'Charlotte',     state: 'NC' },
  { city: 'Greensboro',    state: 'NC' },
  { city: 'Raleigh',       state: 'NC' },
  { city: 'Columbia',      state: 'SC' },
  { city: 'Charleston',    state: 'SC' },
  { city: 'Richmond',      state: 'VA' },
  { city: 'Atlanta',       state: 'GA' },
  { city: 'Nashville',     state: 'TN' },
  { city: 'Knoxville',     state: 'TN' },
  { city: 'Memphis',       state: 'TN' },
  { city: 'Jacksonville',  state: 'FL' },
  { city: 'Savannah',      state: 'GA' },
  { city: 'Chattanooga',   state: 'TN' },
  { city: 'Birmingham',    state: 'AL' },
]

// ─── Message copy ────────────────────────────────────────────────────────────

const INVITE_BY_CATEGORY: Partial<Record<HdServiceCategory, (name: string) => string>> = {
  truck: name =>
    `Hey ${name} — this is Brock with National Wrench Index HD. ` +
    `I found your heavy duty repair business on Google and wanted to invite you to a free listing on our HD directory at nwihd.com. ` +
    `Fleet managers and drivers search our directory when trucks break down on the road. ` +
    `No commissions. Direct contact only. Reply YES to get listed free or STOP to opt out.`,

  reefer: name =>
    `Hey ${name} — this is Brock with National Wrench Index HD. ` +
    `I found your reefer repair business on Google and wanted to invite you to a free listing at nwihd.com. ` +
    `We connect reefer techs directly with drivers and fleet managers who need emergency cold chain service. ` +
    `Reply YES to get listed free or STOP to opt out.`,

  tire: name =>
    `Hey ${name} — this is Brock with National Wrench Index HD. ` +
    `I found your commercial tire business on Google and wanted to invite you to a free listing at nwihd.com. ` +
    `Drivers search our directory when they need emergency tire service on the road. ` +
    `Reply YES to get listed free or STOP to opt out.`,

  fuel: name =>
    `Hey ${name} — this is Brock with National Wrench Index HD. ` +
    `I found your fuel delivery business on Google and wanted to invite you to a free listing at nwihd.com. ` +
    `Stranded drivers search our directory when they run out of fuel on the road. ` +
    `Reply YES to get listed free or STOP to opt out.`,

  towing: name =>
    `Hey ${name} — this is Brock with National Wrench Index HD. ` +
    `I found your heavy duty towing business on Google and wanted to invite you to a free listing at nwihd.com. ` +
    `Drivers and fleet managers search our directory when they need emergency towing. ` +
    `Reply YES to get listed free or STOP to opt out.`,

  shop: name =>
    `Hey ${name} — this is Brock with National Wrench Index HD. ` +
    `I found your business on Google and wanted to invite you to a free listing on our HD commercial service directory at nwihd.com. ` +
    `Fleet managers and drivers actively search our directory for service locations on major corridors. ` +
    `Reply YES to get listed free or STOP to opt out.`,
}

// trailer, washout, glass, locksmith and anything uncategorized land here.
function genericInvite(name: string): string {
  return (
    `Hey ${name} — this is Brock with National Wrench Index HD. ` +
    `I found your business on Google and wanted to invite you to a free listing on our HD service directory at nwihd.com. ` +
    `No commissions. No middlemen. Direct contact from fleet managers and drivers who need help on the road. ` +
    `Reply YES to get listed free or STOP to opt out.`
  )
}

// Trailer repair reads as truck-and-diesel work to the recipient, so it gets
// that copy rather than the generic fallback.
export function hdInviteMessage(businessName: string, category: string | null): string {
  const key = (category === 'trailer' ? 'truck' : category) as HdServiceCategory | null
  const build = key ? INVITE_BY_CATEGORY[key] : undefined
  return build ? build(businessName) : genericInvite(businessName)
}

export function hdFollowUpMessage(businessName: string): string {
  return (
    `Hey ${businessName} — Brock again from National Wrench Index HD. ` +
    `Just following up on the free directory listing at nwihd.com. ` +
    `Fleet managers and drivers search our directory when trucks break down on the road. ` +
    `Reply YES to get listed or STOP if not interested.`
  )
}

export const HD_LISTED_MESSAGE =
  'You are listed on NWI HD. Search your business name at nwihd.com to find your profile. ' +
  'Fleet managers and drivers will find you when they need help on the road. Welcome. — Brock'

export const HD_OPTOUT_MESSAGE =
  'You have been removed from our list and will not be contacted again. — National Wrench Index HD'

export const HD_FALLBACK_MESSAGE =
  'Reply YES to get your free NWI HD listing or STOP to opt out.'
