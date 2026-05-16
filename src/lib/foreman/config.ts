// Soft-launch configuration for Foreman.
// Edit FOREMAN_SUBSCRIBER_CAP here to lift or tighten the slot limit.

export const FOREMAN_SUBSCRIBER_CAP = 50

export const FOREMAN_GRACE_PERIOD_DAYS = 30

export const FOREMAN_DEFAULT_AREA_CODE = '336'

export const FOREMAN_WORKING_HOURS_DEFAULT = {
  start: '08:00',
  end:   '18:00',
  days:  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
} as const
