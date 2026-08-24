'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import QRCode from 'qrcode'
import { NWI_BLUE, NWI_ORANGE } from './brand'

export interface QrStickerUnit {
  unit_id:       string
  unit_number:   string
  manufacturer:  string | null
  model:         string | null
  serial_number: string | null
}

export default function QrStickerClient({
  unit,
  inspectUrl,
}: {
  unit:       QrStickerUnit
  inspectUrl: string
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    QRCode.toDataURL(inspectUrl, {
      // 'H' recovers from ~30% damage. A sticker on a reefer lives outdoors in road
      // salt and diesel film, so the lowest correction level would stop scanning
      // long before the label physically falls off.
      errorCorrectionLevel: 'H',
      margin: 1,
      // Generated well above its printed size so it stays crisp at 300dpi rather
      // than being upscaled by the printer driver.
      width: 1024,
      color: { dark: '#000000', light: '#FFFFFF' },
    })
      .then(url => { if (!cancelled) setDataUrl(url) })
      .catch(() => { if (!cancelled) setError('Could not generate the QR code') })

    return () => { cancelled = true }
  }, [inspectUrl])

  const makeModel = [unit.manufacturer, unit.model].filter(Boolean).join(' ')

  return (
    <>
      {/* Print rules live with the component that needs them. `visibility` rather
          than `display` so the sticker keeps its box while the app chrome around it
          collapses — hiding by display would drag the sticker up into the margin. */}
      <style>{`
        @media print {
          @page { size: 2in 2in; margin: 0; }
          html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
          body * { visibility: hidden !important; }
          #qr-sticker, #qr-sticker * { visibility: visible !important; }
          #qr-sticker {
            position: absolute;
            top: 0; left: 0;
            width: 2in; height: 2in;
            margin: 0;
            border: none !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            background: #fff !important;
          }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="max-w-xl mx-auto">
        {/* Screen-only chrome */}
        <div className="no-print mb-5">
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
            <Link href={`/fleet-pro/units/${unit.unit_id}`} className="hover:underline">&larr; Unit</Link>
          </p>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">QR STICKER</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Prints at 2&Prime; &times; 2&Prime;. Set your printer to Actual Size — any
            &ldquo;fit to page&rdquo; scaling will shrink the code.
          </p>
        </div>

        {/* ── The sticker itself ── */}
        <div
          id="qr-sticker"
          className="mx-auto flex flex-col items-center justify-between text-center"
          style={{
            width:        '2in',
            height:       '2in',
            padding:      '0.08in',
            background:   '#ffffff',
            color:        '#000000',
            border:       '1px solid #1e3040',
            borderRadius: 8,
          }}
        >
          {error ? (
            <p style={{ fontSize: '7pt', color: '#b00' }}>{error}</p>
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL
                  generated at runtime; next/image cannot optimize it and would only
                  add a loader between the canvas and the printer. */}
              <img
                src={dataUrl ?? ''}
                alt={`Pre-trip inspection QR code for unit ${unit.unit_number}`}
                style={{ width: '1.06in', height: '1.06in', display: 'block', marginTop: '0.02in' }}
              />

              <div style={{ lineHeight: 1.15 }}>
                <p style={{ fontSize: '6pt', fontWeight: 600, letterSpacing: '0.02em', margin: 0 }}>
                  Scan to complete pre-trip inspection
                </p>
                <p style={{ fontSize: '9pt', fontWeight: 800, margin: '0.02in 0 0' }}>
                  {unit.unit_number || 'Unit'}
                </p>
                {makeModel && (
                  <p style={{ fontSize: '6pt', margin: 0, color: '#333' }}>{makeModel}</p>
                )}
                {unit.serial_number && (
                  <p style={{ fontSize: '5.5pt', margin: 0, color: '#555' }}>
                    S/N {unit.serial_number}
                  </p>
                )}
              </div>

              <p style={{ fontSize: '5.5pt', fontWeight: 700, letterSpacing: '0.06em', margin: 0 }}>
                <span style={{ color: NWI_BLUE }}>NWI</span>{' '}
                <span style={{ color: NWI_ORANGE }}>FLEET PRO</span>
              </p>
            </>
          )}
        </div>

        {/* Screen-only controls */}
        <div className="no-print mt-6 flex flex-wrap items-center gap-3 justify-center">
          <button
            onClick={() => window.print()}
            disabled={!dataUrl}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-opacity"
            style={{ background: NWI_ORANGE, opacity: dataUrl ? 1 : 0.5 }}
          >
            Print Sticker
          </button>
          {dataUrl && (
            <a
              href={dataUrl}
              download={`qr-${(unit.unit_number || unit.unit_id).replace(/[^\w.-]+/g, '-')}.png`}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold"
              style={{ border: '1px solid #1e3040', color: 'rgba(255,255,255,0.7)' }}
            >
              Download PNG
            </a>
          )}
        </div>

        <p className="no-print text-center text-xs mt-4 break-all" style={{ color: 'rgba(255,255,255,0.3)' }}>
          {inspectUrl}
        </p>
      </div>
    </>
  )
}
