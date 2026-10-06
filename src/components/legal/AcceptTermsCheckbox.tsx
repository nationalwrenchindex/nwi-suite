'use client'

// The acceptance box shown at signup.
//
// It is NOT the gate. A checkbox and a disabled button are a courtesy to the honest
// user; the refusal that matters is migration 147's trigger, which stops a profile
// completing onboarding without a recorded acceptance no matter what the browser sends.
// This component exists so the person is actually shown what they are agreeing to, and
// so the affirmative act is real rather than implied by use.

import Link from 'next/link'
import { LEGAL_VERSION } from '@/lib/legal'

export default function AcceptTermsCheckbox({
  checked,
  onChange,
  disabled,
  className = '',
}: {
  checked:   boolean
  onChange:  (v: boolean) => void
  disabled?: boolean
  className?: string
}) {
  return (
    <label className={`flex items-start gap-2.5 cursor-pointer select-none ${className}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-white/25 bg-transparent accent-orange"
        required
      />
      <span className="text-white/60 text-xs leading-relaxed">
        I have read and agree to the{' '}
        <Link href="/terms" target="_blank" className="text-orange hover:text-orange-light underline">
          Terms of Service
        </Link>{' '}
        and{' '}
        <Link href="/privacy" target="_blank" className="text-orange hover:text-orange-light underline">
          Privacy Policy
        </Link>
        <span className="text-white/30"> (version {LEGAL_VERSION})</span>.
      </span>
    </label>
  )
}
