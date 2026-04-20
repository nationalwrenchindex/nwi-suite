'use client'

import { useState } from 'react'
import ShareBookingModal from '@/components/ShareBookingModal'

export default function BookingPageCard({
  slug,
  businessName,
  techName,
}: {
  slug:         string | null
  businessName: string
  techName:     string
}) {
  const [open, setOpen] = useState(false)

  const hasSlug = !!slug

  return (
    <>
      <div className="nwi-card flex flex-col gap-2 transition-colors hover:border-orange/40 hover:bg-orange/5 cursor-default">
        {/* Top row: icon + label */}
        <button
          onClick={() => setOpen(true)}
          aria-label="Share your booking page"
          className="flex items-start gap-3 text-left w-full"
        >
          <div className="w-9 h-9 rounded-xl border bg-[#FF6600]/10 border-[#FF6600]/20 text-[#FF6600] flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
          </div>
          <div className="min-w-0">
            <p className="font-condensed font-bold text-white text-sm tracking-wide">BOOKING PAGE</p>
            <p className="text-white/30 text-[11px] mt-0.5 leading-tight truncate">
              {hasSlug ? `book/${slug}` : 'Set up your booking URL'}
            </p>
          </div>
        </button>

        {/* Share + Preview row */}
        <div className="flex items-center gap-2 pt-1 border-t border-[#333]">
          <button
            onClick={() => setOpen(true)}
            aria-label="Share booking link"
            className="flex-1 flex items-center justify-center gap-1.5 bg-[#FF6600] hover:bg-[#E55A00] text-white font-condensed font-bold text-xs tracking-wide rounded-lg py-1.5 transition-colors"
          >
            Share Link
          </button>
          {hasSlug && (
            <a
              href={`/book/${slug}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Preview booking page in new tab"
              className="flex items-center gap-1 text-white/30 hover:text-white text-xs transition-colors whitespace-nowrap"
              onClick={e => e.stopPropagation()}
            >
              Preview
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
              </svg>
            </a>
          )}
        </div>
      </div>

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
