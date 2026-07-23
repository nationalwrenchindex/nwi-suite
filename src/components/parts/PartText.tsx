'use client'

import { linkifyPartNumbers, partSearchUrl, type PartVendor } from '@/lib/parts/parse-part-numbers'

// Renders a part description with any detected part numbers turned into clickable
// Google search links. Always opens in a new tab so the tech never loses their
// diagnostic. Shared by the LD DiagnosticTools panel and the HD QuickWrench page.

const DEFAULT_LINK_CLS = 'text-orange-400 underline hover:text-orange-300 cursor-pointer'

export default function PartText({
  text,
  vendor = 'auto',
  className,
}: {
  text:       string
  vendor?:    PartVendor
  className?: string
}) {
  const segments = linkifyPartNumbers(text)
  return (
    <>
      {segments.map((seg, i) =>
        seg.type === 'part' ? (
          <a
            key={i}
            href={partSearchUrl(seg.content, vendor)}
            target="_blank"
            rel="noopener noreferrer"
            className={className ?? DEFAULT_LINK_CLS}
          >
            {seg.content}
          </a>
        ) : (
          <span key={i}>{seg.content}</span>
        ),
      )}
    </>
  )
}
