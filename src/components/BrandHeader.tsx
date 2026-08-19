// Shared white-label header for customer-facing documents and pages.
//
// Logo when one is uploaded, business name in text when not — the fallback is
// the point, since most subscribers never upload anything and a broken image
// icon on an invoice looks worse than plain text.
//
// Deliberately not a client component: every surface using it (work order,
// invoice, inspection report, booking page) renders on the server, and the
// print stylesheets need this in the initial HTML.

import { NWI_TRADEMARK_FOOTER, type Branding } from '@/lib/branding'

export function BrandHeader({
  branding,
  subtitle,
  className = '',
}: {
  branding:  Branding
  /** Document type, e.g. "Invoice INV-2026-0001" or "DOT Annual Inspection". */
  subtitle?: string
  className?: string
}) {
  return (
    <div className={`flex items-center gap-4 ${className}`}>
      {branding.logoUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element -- subscriber logos
           are arbitrary external URLs in a public bucket; next/image would need
           every host allow-listed and buys nothing on a print document. */
        <img
          src={branding.logoUrl}
          alt={branding.name}
          className="h-12 w-auto object-contain flex-shrink-0"
          style={{ maxWidth: 220 }}
        />
      ) : null}
      <div className="min-w-0">
        <p className="font-condensed font-bold text-lg tracking-wide truncate">
          {branding.name}
        </p>
        {branding.phone && (
          <p className="text-xs opacity-60">{branding.phone}</p>
        )}
        {subtitle && (
          <p className="text-xs opacity-50 mt-0.5">{subtitle}</p>
        )}
      </div>
    </div>
  )
}

/**
 * Trademark attribution. Stays on every customer-facing document even when the
 * header is fully white-labelled — only the branding changes, not the credit.
 */
export function BrandFooter({ className = '' }: { className?: string }) {
  return (
    <p className={`text-xs opacity-40 ${className}`}>{NWI_TRADEMARK_FOOTER}</p>
  )
}
