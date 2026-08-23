import { ImageResponse } from 'next/og'

// PWA icon generator — /icon/72 ... /icon/512.
//
// There is no image library in this project (no sharp, no canvas) and adding one
// for eight flat tiles is not worth the install weight. next/og renders real PNGs
// through Satori, so the icons are generated from JSX instead of checked in.
//
// Satori supports a useful subset of SVG: basic shapes and <path> with explicit
// fills. It does NOT do filters, masks, gradients-on-strokes, or currentColor
// inheritance, so the wrench below is one plain path with a literal fill.

const NAVY   = '#0f1923'
const PANEL  = '#16232e'
const BORDER = '#1e3040'
const ORANGE = '#ff6600'

// Whitelist, not a range check. An open integer segment lets anyone request
// /icon/100000 and hand Satori a 10-gigapixel canvas, which OOMs the function.
const ALLOWED_SIZES = [72, 96, 128, 144, 152, 192, 384, 512]

// Route handlers are dynamic by default in Next 15; force-static plus
// generateStaticParams prerenders all eight tiles at build time so they are
// served as plain files. dynamicParams:false makes any other segment 404 at the
// routing layer, before this handler ever runs.
export const dynamic = 'force-static'
export const dynamicParams = false

export function generateStaticParams() {
  return ALLOWED_SIZES.map((size) => ({ size: String(size) }))
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ size: string }> },
) {
  const { size: rawSize } = await params
  const size = Number(rawSize)

  // Second gate: dev mode does not prerender, so the handler is reachable with
  // an arbitrary segment there even though dynamicParams:false covers production.
  if (!ALLOWED_SIZES.includes(size)) {
    return new Response('Not found', { status: 404 })
  }

  // Proportions, not pixels — the same tile has to read at 72px and at 512px.
  const panel  = Math.round(size * 0.84)
  const radius = Math.round(size * 0.22)
  const border = Math.max(1, Math.round(size * 0.016))
  const glyph  = Math.round(size * 0.46)

  return new ImageResponse(
    (
      <div
        style={{
          width:          '100%',
          height:         '100%',
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          // Full-bleed background rather than a rounded root: maskable icons get
          // cropped by the launcher, and transparent corners show through as
          // notches under a squircle mask.
          background:     NAVY,
        }}
      >
        <div
          style={{
            width:          panel,
            height:         panel,
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            borderRadius:   radius,
            background:     PANEL,
            border:         `${border}px solid ${BORDER}`,
          }}
        >
          <svg
            width={glyph}
            height={glyph}
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fill={ORANGE}
              d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"
            />
          </svg>
        </div>
      </div>
    ),
    { width: size, height: size },
  )
}
