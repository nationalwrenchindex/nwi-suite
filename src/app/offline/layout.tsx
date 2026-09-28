// The offline page is a client component, so it cannot export metadata itself --
// that is a server-component export. Without this layout it inherited the root
// layout's default title, 'National Wrench Index™'.
//
// That matters because the SERVICE WORKER caches this page and serves it on any
// failed navigation, including one by a subscriber's customer following a link to
// their quote or invoice on a bad connection. A white-label customer meeting NWI's
// name for the first time at the moment the network drops is the worst version of
// this leak, so the title is neutral too, not just the visible header.

import type { Metadata } from 'next'

export const metadata: Metadata = {
  title:  { absolute: 'No Connection' },
  robots: { index: false, follow: false },
}

export default function OfflineLayout({ children }: { children: React.ReactNode }) {
  return children
}
