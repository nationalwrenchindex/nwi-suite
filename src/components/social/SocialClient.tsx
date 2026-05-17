'use client'

import { useState, useCallback, useEffect } from 'react'

type Platform = 'tiktok' | 'instagram' | 'facebook' | 'linkedin' | 'twitter'
type PostStatus = 'pending' | 'posted' | 'skipped'

interface SocialPost {
  id:                string
  platform:          Platform
  content:           string
  visual_suggestion: string
  image_prompt:      string | null
  image_url:         string | null
  theme:             string
  status:            PostStatus
  created_at:        string
  posted_at:         string | null
}

interface Props {
  initialPosts: SocialPost[]
  todayTheme:   string
  dayName:      string
}

// Platform metadata
const PLATFORM_META: Record<Platform, {
  label:   string
  color:   string
  bgColor: string
  url:     string
  icon:    React.ReactNode
}> = {
  tiktok: {
    label:   'TikTok',
    color:   '#fe2c55',
    bgColor: 'rgba(254,44,85,0.1)',
    url:     'https://www.tiktok.com/upload',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.32 6.32 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.74a4.85 4.85 0 01-1.01-.05z"/>
      </svg>
    ),
  },
  instagram: {
    label:   'Instagram',
    color:   '#e1306c',
    bgColor: 'rgba(225,48,108,0.1)',
    url:     'https://www.instagram.com',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-5 h-5">
        <rect x="2" y="2" width="20" height="20" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  facebook: {
    label:   'Facebook',
    color:   '#1877f2',
    bgColor: 'rgba(24,119,242,0.1)',
    url:     'https://www.facebook.com',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073c0 6.025 4.388 11.02 10.125 11.927v-8.437H7.078v-3.49h3.047V9.428c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.49h-2.796v8.437C19.612 23.093 24 18.098 24 12.073z"/>
      </svg>
    ),
  },
  linkedin: {
    label:   'LinkedIn',
    color:   '#0a66c2',
    bgColor: 'rgba(10,102,194,0.1)',
    url:     'https://www.linkedin.com/feed/',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
      </svg>
    ),
  },
  twitter: {
    label:   'Twitter / X',
    color:   '#ffffff',
    bgColor: 'rgba(255,255,255,0.08)',
    url:     'https://x.com/compose/tweet',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.261 5.632 5.9-5.632zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
      </svg>
    ),
  },
}

const PLATFORM_ORDER: Platform[] = ['tiktok', 'instagram', 'facebook', 'linkedin', 'twitter']

const ASPECT_CLASS: Record<Platform, string> = {
  tiktok:    'aspect-[9/16] max-h-64',
  instagram: 'aspect-square',
  facebook:  'aspect-video',
  linkedin:  'aspect-video',
  twitter:   'aspect-video',
}

function PostCard({
  post,
  imageLoading,
  onUpdate,
}: {
  post:         SocialPost
  imageLoading: boolean
  onUpdate:     (id: string, updates: Partial<SocialPost>) => void
}) {
  const [editing,      setEditing]      = useState(false)
  const [editContent,  setEditContent]  = useState(post.content)
  const [saving,       setSaving]       = useState(false)
  const [copied,       setCopied]       = useState(false)
  const [copiedPrompt, setCopiedPrompt] = useState(false)
  const [downloading,  setDownloading]  = useState(false)

  const meta = PLATFORM_META[post.platform]

  async function handleSkip() {
    const res = await fetch(`/api/social/${post.id}`, {
      method:  'PATCH',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ status: 'skipped' }),
    })
    if (res.ok) {
      const { post: updated } = await res.json()
      onUpdate(post.id, updated)
    }
  }

  async function handlePost() {
    try {
      await navigator.clipboard.writeText(post.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard may be unavailable */ }

    window.open(meta.url, '_blank', 'noopener,noreferrer')

    const res = await fetch(`/api/social/${post.id}`, {
      method:  'PATCH',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ status: 'posted' }),
    })
    if (res.ok) {
      const { post: updated } = await res.json()
      onUpdate(post.id, updated)
    }
  }

  async function handleDownload() {
    if (!post.image_url) return
    setDownloading(true)
    try {
      const res  = await fetch(post.image_url)
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `nwi-${post.platform}-${post.id.slice(0, 8)}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      window.open(post.image_url, '_blank', 'noopener,noreferrer')
    } finally {
      setDownloading(false)
    }
  }

  async function handleSaveEdit() {
    if (!editContent.trim() || editContent === post.content) {
      setEditing(false)
      return
    }
    setSaving(true)
    const res = await fetch(`/api/social/${post.id}`, {
      method:  'PATCH',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ content: editContent }),
    })
    setSaving(false)
    if (res.ok) {
      const { post: updated } = await res.json()
      onUpdate(post.id, updated)
      setEditing(false)
    }
  }

  const isPosted  = post.status === 'posted'
  const isSkipped = post.status === 'skipped'

  return (
    <div
      className={`nwi-card transition-all duration-200 ${
        isPosted  ? 'opacity-60 border-success/30'  :
        isSkipped ? 'opacity-40 border-dark-border/50' : ''
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: meta.bgColor, color: meta.color }}
          >
            {meta.icon}
          </div>
          <div>
            <p className="font-condensed font-bold text-white text-base tracking-wide">{meta.label}</p>
            <p className="text-white/30 text-[11px]">
              {isPosted  && '✓ Posted'}
              {isSkipped && 'Skipped'}
              {!isPosted && !isSkipped && 'Ready to post'}
            </p>
          </div>
        </div>
        {isPosted && (
          <span className="text-xs text-success bg-success/10 border border-success/20 rounded-full px-3 py-1 font-condensed tracking-wide">
            POSTED
          </span>
        )}
        {isSkipped && (
          <span className="text-xs text-white/30 bg-white/5 border border-dark-border rounded-full px-3 py-1 font-condensed tracking-wide">
            SKIPPED
          </span>
        )}
      </div>

      {/* Content */}
      {editing ? (
        <div className="mb-4">
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            rows={6}
            className="w-full bg-dark-input border border-orange/40 rounded-lg px-4 py-3 text-white text-sm leading-relaxed resize-none focus:outline-none focus:border-orange focus:ring-1 focus:ring-orange transition-colors"
            autoFocus
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleSaveEdit}
              disabled={saving}
              className="flex-1 bg-orange hover:bg-orange-hover text-white font-condensed font-semibold text-sm tracking-wider rounded-lg px-4 py-2 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'SAVE'}
            </button>
            <button
              onClick={() => { setEditing(false); setEditContent(post.content) }}
              className="flex-1 bg-dark-lighter border border-dark-border hover:border-white/20 text-white/60 font-condensed font-semibold text-sm tracking-wider rounded-lg px-4 py-2 transition-colors"
            >
              CANCEL
            </button>
          </div>
        </div>
      ) : (
        <div className="mb-4">
          <p className="text-white/80 text-sm leading-relaxed whitespace-pre-wrap">{post.content}</p>
        </div>
      )}

      {/* Visual suggestion */}
      <div className="bg-dark-lighter border border-dark-border rounded-lg px-4 py-3 mb-3">
        <p className="text-white/30 text-[10px] uppercase tracking-widest mb-1">Visual Suggestion</p>
        <p className="text-white/50 text-xs leading-relaxed">{post.visual_suggestion}</p>
      </div>

      {/* Generated image — loading skeleton */}
      {imageLoading && !post.image_url && (
        <div className={`mb-3 rounded-xl border border-orange/20 bg-dark-lighter flex flex-col items-center justify-center gap-2 py-8 ${ASPECT_CLASS[post.platform]}`}>
          <svg className="w-5 h-5 text-orange/60 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          <p className="text-orange/50 text-[10px] font-condensed tracking-wider uppercase">Generating image…</p>
        </div>
      )}

      {/* Generated image — loaded */}
      {post.image_url && (
        <div className="relative mb-3 rounded-xl overflow-hidden border border-dark-border bg-dark-lighter">
          <img
            src={post.image_url}
            alt={`AI generated image for ${meta.label}`}
            className="w-full object-cover"
          />
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5 bg-dark/80 hover:bg-dark border border-white/10 hover:border-orange/40 text-white/60 hover:text-orange font-condensed font-bold text-[10px] tracking-wider rounded-lg px-2.5 py-1.5 backdrop-blur-sm transition-all disabled:opacity-50"
          >
            {downloading ? (
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            ) : (
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            )}
            {downloading ? 'SAVING…' : 'DOWNLOAD'}
          </button>
        </div>
      )}

      {/* Image prompt */}
      {post.image_prompt && (
        <div className="bg-dark-lighter border border-orange/20 rounded-lg px-4 py-3 mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <svg className="w-3.5 h-3.5 text-orange flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <p className="text-orange/80 text-[10px] uppercase tracking-widest font-semibold">Image Prompt</p>
            </div>
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(post.image_prompt ?? '')
                  setCopiedPrompt(true)
                  setTimeout(() => setCopiedPrompt(false), 2000)
                } catch { /* clipboard unavailable */ }
              }}
              className="flex items-center gap-1 text-[10px] font-condensed font-bold tracking-wider text-orange hover:text-white border border-orange/30 hover:border-orange/60 hover:bg-orange/10 rounded-md px-2 py-1 transition-all"
            >
              {copiedPrompt ? (
                <>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  COPIED
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                  COPY IMAGE PROMPT
                </>
              )}
            </button>
          </div>
          <p className="text-white/40 text-[11px] leading-relaxed">{post.image_prompt}</p>
          <p className="text-white/20 text-[10px] mt-2 italic">Paste into Midjourney, DALL-E, or Canva AI</p>
        </div>
      )}

      {/* Actions */}
      {!isPosted && !isSkipped && !editing && (
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={handlePost}
            className="bg-orange hover:bg-orange-hover text-white font-condensed font-bold text-sm tracking-wider rounded-lg py-2.5 transition-colors flex items-center justify-center gap-1.5"
          >
            {copied ? '✓ COPIED' : 'POST NOW'}
          </button>
          <button
            onClick={() => setEditing(true)}
            className="bg-blue/10 hover:bg-blue/20 border border-blue/20 hover:border-blue/40 text-blue-light font-condensed font-bold text-sm tracking-wider rounded-lg py-2.5 transition-colors"
          >
            EDIT
          </button>
          <button
            onClick={handleSkip}
            className="bg-dark-lighter hover:bg-white/5 border border-dark-border hover:border-white/20 text-white/40 font-condensed font-bold text-sm tracking-wider rounded-lg py-2.5 transition-colors"
          >
            SKIP
          </button>
        </div>
      )}

      {(isPosted || isSkipped) && (
        <button
          onClick={async () => {
            const res = await fetch(`/api/social/${post.id}`, {
              method:  'PATCH',
              headers: { 'content-type': 'application/json' },
              body:    JSON.stringify({ status: 'pending' }),
            })
            if (res.ok) {
              const { post: updated } = await res.json()
              onUpdate(post.id, updated)
            }
          }}
          className="w-full bg-dark-lighter hover:bg-white/5 border border-dark-border hover:border-white/20 text-white/30 font-condensed text-xs tracking-wider rounded-lg py-2 transition-colors"
        >
          Restore
        </button>
      )}
    </div>
  )
}

export default function SocialClient({ initialPosts, todayTheme, dayName }: Props) {
  const [posts,            setPosts]            = useState<SocialPost[]>(initialPosts)
  const [generating,       setGenerating]       = useState(false)
  const [generatingImages, setGeneratingImages] = useState(false)
  const [error,            setError]            = useState<string | null>(null)

  const hasAny  = posts.length > 0
  const pending = posts.filter((p) => p.status === 'pending').length
  const posted  = posts.filter((p) => p.status === 'posted').length

  const handleUpdate = useCallback((id: string, updates: Partial<SocialPost>) => {
    setPosts((prev) => prev.map((p) => p.id === id ? { ...p, ...updates } : p))
  }, [])

  // Phase 2: call DALL-E image generation for a set of post IDs
  const fetchImages = useCallback(async (postIds: string[]) => {
    if (postIds.length === 0) return
    setGeneratingImages(true)
    try {
      const res = await fetch('/api/social/generate-images', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ postIds }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        console.error('[SocialClient] generate-images failed:', data.error)
        return
      }
      const { results } = await res.json()
      for (const r of (results ?? [])) {
        if (r.image_url) handleUpdate(r.id, { image_url: r.image_url })
      }
    } catch (err) {
      console.error('[SocialClient] generate-images error:', err)
    } finally {
      setGeneratingImages(false)
    }
  }, [handleUpdate])

  // On mount: auto-generate images for any posts that have image_prompt but no image_url
  // (handles page refresh after a prior image generation failure)
  useEffect(() => {
    const needImages = initialPosts.filter((p) => p.image_prompt && !p.image_url).map((p) => p.id)
    if (needImages.length > 0) fetchImages(needImages)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function generate(force = false) {
    setGenerating(true)
    setError(null)
    try {
      // Phase 1: generate text content via Claude
      const res = await fetch('/api/social/generate', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ force }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Generation failed')
      const newPosts: SocialPost[] = data.posts ?? []
      setPosts(newPosts)

      // Phase 2: generate images for newly created posts (non-blocking)
      const needImages = newPosts.filter((p) => p.image_prompt && !p.image_url).map((p) => p.id)
      if (!data.cached && needImages.length > 0) {
        fetchImages(needImages)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate content')
    } finally {
      setGenerating(false)
    }
  }

  // Sort posts in platform order
  const sortedPosts = [...posts].sort((a, b) => {
    return PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform)
  })

  return (
    <div className="space-y-6">

      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">NWI SOCIAL</h1>
          <p className="text-white/40 text-sm mt-1">
            {dayName}&apos;s theme: <span className="text-orange">{todayTheme}</span>
          </p>
        </div>
        {hasAny && (
          <div className="text-right flex-shrink-0">
            <p className="text-white/30 text-xs">
              {posted}/{posts.length} posted
            </p>
            {pending > 0 && (
              <p className="text-orange text-xs font-condensed tracking-wide">{pending} ready</p>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/40 text-danger rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!hasAny && (
        <div className="nwi-card flex flex-col items-center py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-orange/10 border border-orange/20 flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-orange" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
            </svg>
          </div>
          <p className="font-condensed font-bold text-white text-xl tracking-wide mb-2">No Content Generated Yet</p>
          <p className="text-white/40 text-sm mb-6 max-w-xs">
            Generate today&apos;s platform-specific posts in one click. Content is tailored to the daily theme.
          </p>
          <button
            onClick={() => generate(false)}
            disabled={generating}
            className="btn-primary max-w-xs"
          >
            {generating ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Generating…
              </span>
            ) : 'GENERATE TODAY\'S CONTENT'}
          </button>
        </div>
      )}

      {/* Posts grid */}
      {hasAny && (
        <>
          <div className="space-y-4">
            {sortedPosts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                imageLoading={generatingImages && !!post.image_prompt && !post.image_url}
                onUpdate={handleUpdate}
              />
            ))}
          </div>

          {/* Regenerate button */}
          <div className="pt-2">
            <button
              onClick={() => generate(true)}
              disabled={generating}
              className="w-full bg-dark-card hover:bg-dark-lighter border border-dark-border hover:border-orange/30 text-white/40 hover:text-orange font-condensed text-sm tracking-wider rounded-xl py-3 transition-all duration-200 flex items-center justify-center gap-2"
            >
              {generating ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Regenerating…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                  </svg>
                  Regenerate All Content
                </>
              )}
            </button>
          </div>
        </>
      )}

    </div>
  )
}
