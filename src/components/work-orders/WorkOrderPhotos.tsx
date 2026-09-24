'use client'

// ─── Work order photos ────────────────────────────────────────────────────────
// Upload path matches app/hd/work-orders/[id]/WorkOrderDetail: the browser
// downscales, uploads straight to storage, then posts the PATH (not a URL) to the
// API. The bucket is private, so display always goes through a signed URL — a
// stored URL would expire and leave a permanently broken image in the record.
//
// Only rendered for a saved work order: a photo needs an id to belong to, and the
// upload path is keyed on it.

import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { compressImage } from '@/lib/image'
import type { WorkOrderPhoto } from '@/types/work-orders'

const BUCKET      = 'work-order-photos'
const SIGNED_TTL  = 3600
const MAX_PHOTOS  = 20

export interface PhotoWithUrl extends WorkOrderPhoto {
  signedUrl: string | null
}

export default function WorkOrderPhotos({
  workOrderId,
  initialPhotos,
  disabled = false,
}: {
  workOrderId:   string
  initialPhotos: PhotoWithUrl[]
  disabled?:     boolean
}) {
  const supabase = createClient()
  const fileRef  = useRef<HTMLInputElement>(null)

  const [photos,    setPhotos]    = useState<PhotoWithUrl[]>(initialPhotos)
  const [caption,   setCaption]   = useState('')
  const [uploading, setUploading] = useState(false)
  const [err,       setErr]       = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    // Cleared immediately so picking the same file twice still fires a change.
    e.target.value = ''
    if (files.length === 0) return

    if (photos.length + files.length > MAX_PHOTOS) {
      setErr(`A work order holds up to ${MAX_PHOTOS} photos.`)
      return
    }

    setUploading(true); setErr(null)
    const added: PhotoWithUrl[] = []
    const failed: string[] = []

    // Sequential rather than Promise.all: a tech picking eight photos on a yard
    // connection does better with one upload at a time than eight competing, and
    // a partial failure then names the file that did not make it.
    for (const file of files) {
      try {
        const blob = await compressImage(file)
        const path = `${workOrderId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`

        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
        if (upErr) throw upErr

        const res = await fetch(`/api/work-orders/${workOrderId}/photos`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ file_url: path, caption: caption.trim() || null }),
        })
        const d = await res.json()
        if (!res.ok) {
          // The object is already in the bucket but nothing references it. Clean up
          // rather than leave a file no screen can reach and no row can delete.
          await supabase.storage.from(BUCKET).remove([path])
          throw new Error(d.error ?? 'Could not save the photo')
        }

        const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL)
        added.push({ ...(d.photo as WorkOrderPhoto), signedUrl: signed?.signedUrl ?? null })
      } catch (e) {
        console.error('[work-order photo]', e)
        failed.push(file.name)
      }
    }

    if (added.length > 0) setPhotos(prev => [...prev, ...added])
    setCaption('')
    if (failed.length > 0) {
      setErr(failed.length === files.length
        ? `Upload failed: ${failed.join(', ')}`
        : `${added.length} uploaded, ${failed.length} failed: ${failed.join(', ')}`)
    }
    setUploading(false)
  }

  async function remove(id: string) {
    setConfirmId(null); setErr(null)
    // Optimistic, with the row put back if the server refuses — a photo that
    // vanishes from the screen but not from the record is the worse outcome.
    const snapshot = photos
    setPhotos(prev => prev.filter(p => p.id !== id))
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/photos?photoId=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
    } catch {
      setPhotos(snapshot)
      setErr('Could not delete that photo.')
    }
  }

  return (
    <div className="space-y-3">
      {err && <div className="alert-error">{err}</div>}

      {photos.length === 0 && !uploading && (
        <p className="text-white/25 text-sm">
          No photos yet. {disabled ? '' : 'Before, during and after — whatever the customer might ask about later.'}
        </p>
      )}

      {photos.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {photos.map(p => (
            <div key={p.id} className="relative group rounded-xl overflow-hidden border border-white/10 bg-white/5">
              {p.signedUrl ? (
                <a href={p.signedUrl} target="_blank" rel="noopener noreferrer">
                  {/* Plain img, not next/image: the source is a short-lived signed
                      URL on a private bucket, which the optimiser cannot cache. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.signedUrl} alt={p.caption ?? 'Work order photo'}
                    className="w-full h-32 object-cover" />
                </a>
              ) : (
                <div className="w-full h-32 flex items-center justify-center text-white/25 text-xs px-2 text-center">
                  Preview unavailable
                </div>
              )}

              {p.caption && (
                <p className="px-2 py-1.5 text-white/60 text-[11px] truncate">{p.caption}</p>
              )}

              {!disabled && (
                confirmId === p.id ? (
                  <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-2 px-2">
                    <p className="text-white text-xs text-center">Delete this photo?</p>
                    <div className="flex gap-2">
                      <button onClick={() => remove(p.id)}
                        className="px-2.5 py-1 rounded bg-danger text-white text-xs font-semibold">Delete</button>
                      <button onClick={() => setConfirmId(null)}
                        className="px-2.5 py-1 rounded border border-white/20 text-white/70 text-xs">Keep</button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmId(p.id)}
                    title="Delete photo"
                    className="absolute top-1.5 right-1.5 p-1.5 rounded-lg bg-black/60 text-white/60 hover:text-danger opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M9 6V4h6v2" />
                    </svg>
                  </button>
                )
              )}
            </div>
          ))}
        </div>
      )}

      {!disabled && (
        <div className="space-y-2">
          <input
            className="nwi-input text-sm"
            placeholder="Caption for the next photo (optional)"
            value={caption}
            onChange={e => setCaption(e.target.value)}
            disabled={uploading}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            onChange={onPick}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || photos.length >= MAX_PHOTOS}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-white/10 border-dashed text-white/40 hover:text-orange hover:border-white/25 text-xs transition-colors disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : photos.length >= MAX_PHOTOS ? `Limit of ${MAX_PHOTOS} reached` : '+ Add Photos'}
          </button>
          <p className="text-white/25 text-[11px]">
            Resized in the browser before upload. Stored privately — links expire after an hour.
          </p>
        </div>
      )}
    </div>
  )
}
