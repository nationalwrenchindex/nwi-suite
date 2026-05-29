'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

async function compressLogo(file: File): Promise<{ blob: Blob; ext: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const MAX = 800
      let { width, height } = img
      if (width > MAX || height > MAX) {
        const ratio = Math.min(MAX / width, MAX / height)
        width  = Math.round(width  * ratio)
        height = Math.round(height * ratio)
      }
      const canvas = document.createElement('canvas')
      canvas.width  = width
      canvas.height = height
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        blob => blob ? resolve({ blob, ext: 'jpg' }) : reject(new Error('Compression failed')),
        'image/jpeg',
        0.85,
      )
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export default function LogoUploadClient({ initialLogoUrl }: { initialLogoUrl: string | null }) {
  const router = useRouter()
  const [logoUrl,   setLogoUrl]   = useState(initialLogoUrl)
  const [preview,   setPreview]   = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [deleting,  setDeleting]  = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [saved,     setSaved]     = useState(false)
  const [dragOver,  setDragOver]  = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setError(null)
    setSaved(false)
    setPreview(URL.createObjectURL(file))
    setUploading(true)
    try {
      const { blob, ext } = await compressLogo(file)
      const base64 = await blobToBase64(blob)
      const res = await fetch('/api/settings/logo', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ image: base64, ext }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Upload failed')
      // Append cache-bust so the browser fetches fresh even though the storage
      // path (and therefore URL) is the same after upsert.
      setLogoUrl(`${data.url}?v=${Date.now()}`)
      setPreview(null)
      setSaved(true)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
      setPreview(null)
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete() {
    if (!confirm('Remove your business logo?')) return
    setDeleting(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch('/api/settings/logo', { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      setLogoUrl(null)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  const currentImg = preview ?? logoUrl

  return (
    <div className="space-y-6">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-white/40 hover:text-white/70 transition-colors text-sm"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to Settings
      </Link>

      <div className="nwi-card space-y-5">
        {currentImg ? (
          <div className="flex items-start gap-4">
            <div className="w-24 h-24 rounded-xl overflow-hidden border border-dark-border bg-dark-card flex-shrink-0">
              <img src={currentImg} alt="Business logo" className="w-full h-full object-contain p-1" />
            </div>
            <div className="flex-1 space-y-3 pt-1">
              {uploading && (
                <div className="flex items-center gap-2 text-white/60 text-sm">
                  <svg className="animate-spin w-4 h-4 text-orange" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Uploading…
                </div>
              )}
              {!uploading && saved && (
                <p className="text-success text-sm font-medium">Logo saved.</p>
              )}
              {!uploading && logoUrl && (
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => inputRef.current?.click()}
                    disabled={uploading}
                    className="text-sm text-white/60 hover:text-white transition-colors text-left disabled:opacity-50"
                  >
                    Replace image
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="text-sm text-danger hover:underline text-left disabled:opacity-50"
                  >
                    {deleting ? 'Removing…' : 'Remove logo'}
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault()
              setDragOver(false)
              const file = e.dataTransfer.files[0]
              if (file?.type.startsWith('image/')) handleFile(file)
            }}
            onClick={() => !uploading && inputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors
              ${dragOver ? 'border-orange bg-orange/5' : 'border-dark-border hover:border-white/30'}
              ${uploading ? 'cursor-default opacity-60' : ''}`}
          >
            <div className="flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-dark-border flex items-center justify-center">
                {uploading ? (
                  <svg className="animate-spin w-5 h-5 text-orange" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                ) : (
                  <svg className="w-6 h-6 text-white/40" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                  </svg>
                )}
              </div>
              {uploading ? (
                <p className="text-white/60 text-sm">Uploading…</p>
              ) : (
                <>
                  <p className="text-white/70 text-sm font-medium">Drop image here or click to browse</p>
                  <p className="text-white/30 text-xs">JPEG, PNG, or WebP · Max 5 MB · Square or landscape recommended</p>
                </>
              )}
            </div>
          </div>
        )}

        {error && <p className="text-danger text-sm">{error}</p>}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) { handleFile(file); e.target.value = '' }
        }}
      />

      <div className="nwi-card space-y-2">
        <p className="text-white/40 text-xs uppercase tracking-widest mb-3">Where it appears</p>
        <ul className="text-white/60 text-sm space-y-1.5">
          <li className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-orange flex-shrink-0" />
            Your public booking page header
          </li>
          <li className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-orange flex-shrink-0" />
            Customer-facing invoices
          </li>
        </ul>
      </div>
    </div>
  )
}
