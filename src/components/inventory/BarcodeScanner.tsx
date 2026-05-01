'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  onScanned: (barcode: string) => void
  onClose: () => void
}

// BarcodeDetector is not in lib.dom.d.ts yet
declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => {
      detect(source: ImageBitmapSource): Promise<{ rawValue: string; format: string }[]>
    }
  }
}

export function isBarcodeDetectorSupported(): boolean {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window
}

export default function BarcodeScanner({ onScanned, onClose }: Props) {
  const videoRef    = useRef<HTMLVideoElement>(null)
  const rafRef      = useRef<number>(0)
  const streamRef   = useRef<MediaStream | null>(null)
  const [status, setStatus] = useState<'starting' | 'scanning' | 'error'>('starting')
  const [errMsg, setErrMsg] = useState('')

  useEffect(() => {
    if (!isBarcodeDetectorSupported()) {
      setStatus('error')
      setErrMsg('Barcode scanning is not supported on this browser. Try Chrome on Android or Safari on iOS 17.4+.')
      return
    }

    const detector = new window.BarcodeDetector!({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'] })

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        })
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play()
          setStatus('scanning')
          scanLoop()
        }
      } catch (e) {
        setStatus('error')
        setErrMsg(e instanceof Error && e.name === 'NotAllowedError'
          ? 'Camera access denied. Allow camera permission and try again.'
          : 'Could not start camera. Please add the product manually.')
      }
    }

    function scanLoop() {
      if (!videoRef.current || videoRef.current.readyState < 2) {
        rafRef.current = requestAnimationFrame(scanLoop)
        return
      }
      detector.detect(videoRef.current)
        .then(results => {
          if (results.length > 0) {
            stopCamera()
            onScanned(results[0].rawValue)
          } else {
            rafRef.current = requestAnimationFrame(scanLoop)
          }
        })
        .catch(() => {
          rafRef.current = requestAnimationFrame(scanLoop)
        })
    }

    startCamera()

    return () => {
      stopCamera()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function stopCamera() {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  function handleClose() {
    stopCamera()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/80">
        <p className="text-white font-condensed font-bold text-lg tracking-wide">
          SCAN BARCODE
        </p>
        <button
          onClick={handleClose}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Camera view */}
      <div className="flex-1 relative overflow-hidden">
        {status !== 'error' && (
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover"
            playsInline
            muted
          />
        )}

        {/* Scanning overlay */}
        {status === 'scanning' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="relative w-64 h-40">
              {/* Corner brackets */}
              <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-orange" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-orange" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-orange" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-orange" />
              {/* Scan line */}
              <div className="absolute left-0 right-0 h-0.5 bg-orange/70 top-1/2 animate-pulse" />
            </div>
          </div>
        )}

        {/* Starting indicator */}
        {status === 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="w-10 h-10 border-2 border-orange border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-white/60 text-sm">Starting camera…</p>
            </div>
          </div>
        )}

        {/* Error state */}
        {status === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <div className="text-center max-w-xs">
              <div className="w-14 h-14 bg-danger/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-danger" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <p className="text-white font-semibold text-base mb-2">Scanner Unavailable</p>
              <p className="text-white/50 text-sm leading-relaxed">{errMsg}</p>
              <button
                onClick={handleClose}
                className="mt-6 px-6 py-2.5 bg-orange hover:bg-orange-hover text-white font-condensed font-bold text-sm rounded-lg transition-colors"
              >
                Add Manually Instead
              </button>
            </div>
          </div>
        )}
      </div>

      {status === 'scanning' && (
        <div className="px-4 py-4 bg-black/80 text-center">
          <p className="text-white/50 text-sm">Point camera at product barcode</p>
        </div>
      )}
    </div>
  )
}
