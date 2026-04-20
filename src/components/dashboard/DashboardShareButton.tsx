'use client'

import { useState } from 'react'
import ShareBookingModal from '@/components/ShareBookingModal'

export default function DashboardShareButton({
  slug,
  businessName,
  techName,
}: {
  slug:         string | null
  businessName: string
  techName:     string
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Share your booking link"
        className="flex items-center gap-1.5 bg-[#FF6600] hover:bg-[#E55A00] text-white font-condensed font-bold text-sm tracking-wide rounded-xl px-3 py-2 transition-colors whitespace-nowrap"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
          <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
        </svg>
        Share Link
      </button>

      <ShareBookingModal
        slug={slug}
        businessName={businessName}
        techName={techName}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
