'use client'

// The vehicle's odometer at THIS service, on an LD quote, work order or invoice
// (mileage_at_service, migration 184; invoices since 098). One input for all three
// editors. Optional and never blocks a save: blank records no reading and the
// customer's copy prints nothing. The box holds only what is recorded on this
// document - never the vehicle's current mileage.

import { formatOdometer, parseOdometer } from '@/lib/odometer'

export default function OdometerField({ value, onChange, disabled, testId = 'ld-odometer' }: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  testId?: string
}) {
  const parsed = parseOdometer(value)
  return (
    <div>
      <label className="nwi-label" htmlFor={testId}>Odometer (miles)</label>
      <input
        id={testId}
        type="text" inputMode="numeric"
        className="nwi-input text-sm w-full"
        placeholder="Reading at this service (optional)"
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        data-testid={testId}
      />
      <p className={`text-[11px] mt-1 ${parsed === 'invalid' ? 'text-danger' : 'text-white/30'}`}>
        {parsed === 'invalid'
          ? 'Whole miles from 0 to 9,999,999, or leave it blank.'
          : parsed == null
            ? 'Blank records no reading - the customer’s copy prints none.'
            : `Prints on the customer’s copy as Odometer: ${formatOdometer(parsed)} mi.`}
      </p>
    </div>
  )
}
