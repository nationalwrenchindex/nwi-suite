export interface ConditionMultiplier {
  rating:      number
  label:       string
  multiplier:  number
  description: string
}

export const CONDITION_MULTIPLIERS: ConditionMultiplier[] = [
  { rating: 1, label: 'Showroom', multiplier: 0.9,  description: 'Nearly perfect, regular maintenance' },
  { rating: 2, label: 'Good',     multiplier: 1.0,  description: 'Light dust and normal use' },
  { rating: 3, label: 'Average',  multiplier: 1.1,  description: 'Normal dirt and minor stains' },
  { rating: 4, label: 'Dirty',    multiplier: 1.25, description: 'Heavy dirt, pet hair, food' },
  { rating: 5, label: 'Disaster', multiplier: 1.5,  description: 'Extreme neglect, major stains' },
]

export function getMultiplier(rating: number | null | undefined): number {
  if (!rating) return 1.0
  return CONDITION_MULTIPLIERS.find(c => c.rating === rating)?.multiplier ?? 1.0
}

export function getConditionLabel(rating: number | null | undefined): string {
  if (!rating) return 'Not set'
  return CONDITION_MULTIPLIERS.find(c => c.rating === rating)?.label ?? 'Unknown'
}
