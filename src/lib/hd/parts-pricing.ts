// HD's parts markup default, plus a re-export of the shared markup math.
//
// sellPrice and lineAmount moved to @/lib/shared/markup when work order segments
// needed them on both products. They are re-exported here so the five existing HD
// importers keep working unchanged — the functions are identical, there is still only
// one implementation, and it now lives somewhere LD can reach without importing from
// a lib/hd path.
//
// NOTE ON THE DEFAULT: 30 is the HD brief's number, and since migration 121 it is
// also the default of `profiles.hd_parts_markup_percent` — the column the HD forms
// seed from. This constant is what they show before that fetch lands and what they
// fall back to if it fails, so the two must stay equal.
//
// It is deliberately NOT `profiles.default_parts_markup_percent` (default 20). That
// column is the LD default and the LD side bills from it, so reading it here meant
// any subscriber who had ever opened LD Settings silently got 20 in HD. Heavy-duty
// parts do not carry light-duty margins; the two suites keep two numbers.
export const DEFAULT_HD_PARTS_MARKUP = 30

export { sellPrice, lineAmount } from '@/lib/shared/markup'
