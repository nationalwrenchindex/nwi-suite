// ─── 404 ──────────────────────────────────────────────────────────────────────
// There was no not-found.tsx, so every 404 fell back to Next's built-in page
// wrapped in the root layout -- which meant the tab read 'National Wrench Index™'.
//
// That page is reached by CUSTOMERS more often than by subscribers: a mistyped or
// expired token on /quote, /invoice or /work-order calls notFound(), and on a
// white-label account the first thing that customer would have seen is the name of
// a company they have no relationship with. So this says nothing about who built
// the software, and offers no link into the application -- a customer has nowhere
// to go in there, and inviting them to "go to your dashboard" is worse than a
// dead end.

import type { Metadata } from 'next'

export const metadata: Metadata = {
  // absolute, or the root layout's '%s | National Wrench Index™' template puts the
  // name straight back on.
  title:  { absolute: 'Not Found' },
  robots: { index: false, follow: false },
}

export default function NotFound() {
  return (
    <div className="min-h-dvh bg-dark flex items-center justify-center px-6">
      <div className="max-w-md text-center space-y-3">
        <p className="font-condensed font-bold text-5xl tracking-wide text-white/25">404</p>
        <h1 className="font-condensed font-bold text-2xl tracking-wide text-white">
          This page isn&rsquo;t here
        </h1>
        <p className="text-sm text-white/50 leading-relaxed">
          The link may have expired, or it may have been mistyped. If someone sent you
          here, ask them for a fresh link &mdash; the one you have cannot be reopened.
        </p>
      </div>
    </div>
  )
}
