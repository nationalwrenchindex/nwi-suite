// Seasonal service suggestion system for southeastern US landscapers (Part 14).
// Maps the current month to a list of services worth proactively offering.

export interface SeasonalSuggestion {
  season: string
  services: string[]
}

// month index 0-11 → suggestions
const SEASONAL_BY_MONTH: Record<number, SeasonalSuggestion> = {
  0: { season: 'Winter', services: ['Winter pruning reminder', 'Pre-emergent planning'] },              // Jan
  1: { season: 'Winter', services: ['Winter pruning reminder', 'Pre-emergent planning'] },              // Feb
  2: { season: 'Spring', services: ['Spring cleanup', 'Pre-emergent herbicide application', 'Fertilizing — first application', 'Mulching refresh'] }, // Mar
  3: { season: 'Spring', services: ['Spring cleanup', 'Pre-emergent herbicide application', 'Fertilizing — first application', 'Mulching refresh'] }, // Apr
  4: { season: 'Spring', services: ['Mowing schedule ramp up', 'Grub prevention treatment', 'Irrigation system check'] }, // May
  5: { season: 'Summer', services: ['Mowing schedule ramp up', 'Grub prevention treatment', 'Irrigation system check'] }, // Jun
  6: { season: 'Summer', services: ['Drought stress monitoring', 'Fungicide if needed', 'Mowing frequency adjustment'] }, // Jul
  7: { season: 'Summer', services: ['Drought stress monitoring', 'Fungicide if needed', 'Mowing frequency adjustment'] }, // Aug
  8: { season: 'Fall',   services: ['Aeration and overseeding', 'Fall fertilizing', 'Leaf removal preparation'] },        // Sep
  9: { season: 'Fall',   services: ['Aeration and overseeding', 'Fall fertilizing', 'Leaf removal preparation'] },        // Oct
  10:{ season: 'Fall',   services: ['Final leaf removal', 'Winter prep', 'Equipment winterization reminder'] },           // Nov
  11:{ season: 'Winter', services: ['Final leaf removal', 'Winter prep', 'Equipment winterization reminder'] },           // Dec
}

// Returns the seasonal suggestions for a given month index (defaults to current).
export function getSeasonalSuggestions(monthIndex?: number): SeasonalSuggestion {
  const m = typeof monthIndex === 'number' ? monthIndex : new Date().getMonth()
  return SEASONAL_BY_MONTH[m] ?? { season: '', services: [] }
}

export function currentSeasonLabel(monthIndex?: number): string {
  return getSeasonalSuggestions(monthIndex).season
}
