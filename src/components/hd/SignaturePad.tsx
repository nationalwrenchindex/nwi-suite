'use client'

// Self-contained signature capture for HD inspection sign-off.
//
// DOTInspectionForm and PMChecklistClient each grew their own inline canvas
// wired to a fixed element id, which meant two of them could never coexist on a
// page. This owns its own ref instead, so a page can host more than one, and it
// hands the caller a PNG data URL rather than making them reach for the canvas.
//
// Those two existing forms are deliberately left alone — they work, and
// rewriting a signed-document code path to share a component is not worth the
// regression risk here.

import { useCallback, useEffect, useRef, useState } from 'react'

const HD_ORANGE = '#F26B21'

export default function SignaturePad({
  onChange,
  height = 140,
}: {
  /** Receives a PNG data URL, or null when cleared. */
  onChange: (dataUrl: string | null) => void
  height?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [hasInk, setHasInk] = useState(false)

  // Kept in a ref so the drawing effect never re-subscribes when the parent
  // re-renders with a new callback identity.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const clear = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasInk(false)
    onChangeRef.current(null)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Backing store scaled to DPR, or the signature is blurry on phones — which
    // is where these are actually signed.
    const dpr = window.devicePixelRatio || 1
    canvas.width  = canvas.clientWidth  * dpr
    canvas.height = canvas.clientHeight * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.strokeStyle = HD_ORANGE
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    let drawing = false
    let inked   = false

    const pos = (e: MouseEvent | TouchEvent) => {
      const rect = canvas.getBoundingClientRect()
      const src = 'touches' in e ? e.touches[0] : (e as MouseEvent)
      return { x: src.clientX - rect.left, y: src.clientY - rect.top }
    }
    const start = (e: MouseEvent | TouchEvent) => {
      e.preventDefault()
      drawing = true
      const { x, y } = pos(e)
      ctx.beginPath()
      ctx.moveTo(x, y)
    }
    const draw = (e: MouseEvent | TouchEvent) => {
      if (!drawing) return
      e.preventDefault()
      const { x, y } = pos(e)
      ctx.lineTo(x, y)
      ctx.stroke()
      if (!inked) { inked = true; setHasInk(true) }
    }
    // Emit on stroke end rather than per-point: toDataURL is expensive and the
    // caller only needs the finished mark.
    const end = () => {
      if (!drawing) return
      drawing = false
      if (inked) onChangeRef.current(canvas.toDataURL('image/png'))
    }

    canvas.addEventListener('mousedown',  start)
    canvas.addEventListener('mousemove',  draw)
    canvas.addEventListener('mouseup',    end)
    canvas.addEventListener('mouseleave', end)
    canvas.addEventListener('touchstart', start, { passive: false })
    canvas.addEventListener('touchmove',  draw,  { passive: false })
    canvas.addEventListener('touchend',   end)
    return () => {
      canvas.removeEventListener('mousedown',  start)
      canvas.removeEventListener('mousemove',  draw)
      canvas.removeEventListener('mouseup',    end)
      canvas.removeEventListener('mouseleave', end)
      canvas.removeEventListener('touchstart', start)
      canvas.removeEventListener('touchmove',  draw)
      canvas.removeEventListener('touchend',   end)
    }
  }, [])

  return (
    <div>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height, background: '#0f1820', border: '1px solid #1e3040', borderRadius: 8, touchAction: 'none' }}
      />
      <div className="flex items-center justify-between mt-1.5">
        <p className="text-white/25 text-xs">
          {hasInk ? 'Signed' : 'Sign above using a finger, stylus or mouse'}
        </p>
        <button type="button" onClick={clear} className="text-white/40 hover:text-white text-xs underline">
          Clear
        </button>
      </div>
    </div>
  )
}
