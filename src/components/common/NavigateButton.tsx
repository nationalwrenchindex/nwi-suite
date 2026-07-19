'use client'

// Opens the device's maps app to the given address. No Google Maps API or key
// needed — a plain maps URL that the OS hands to Apple/Google Maps.
export default function NavigateButton({
  address,
  className = '',
  compact = false,
}: {
  address?: string | null
  className?: string
  compact?: boolean
}) {
  if (!address || !address.trim()) return null
  const href = `https://www.google.com/maps?q=${encodeURIComponent(address.trim())}`
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg bg-orange hover:bg-orange-hover text-white font-condensed font-semibold tracking-wide transition-colors ${
        compact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'
      } ${className}`}
    >
      <span aria-hidden>📍</span>
      Navigate to Job
    </a>
  )
}
