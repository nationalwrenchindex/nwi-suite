'use client'

import { useEffect, useState } from 'react'
import { documentDefaultsFrom, NO_DOCUMENT_DEFAULTS, type DocumentDefaults } from '@/lib/document-defaults'

/**
 * The shop's LD document defaults (lib/document-defaults), for the client forms.
 *
 * Same contract as useExtrasSettingsState: `loaded` is a THIRD state and must never be
 * collapsed into "the shop bills nothing". Until it is true the defaults are
 * NO_DOCUMENT_DEFAULTS - zeroes, never a rate nobody chose.
 */
export interface DocumentDefaultsState {
  defaults: DocumentDefaults
  loaded:   boolean
  failed:   boolean
}

export function useDocumentDefaults(): DocumentDefaultsState {
  const [state, setState] = useState<DocumentDefaultsState>({ defaults: NO_DOCUMENT_DEFAULTS, loaded: false, failed: false })
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/user/profile')
        if (!res.ok) { if (!cancelled) setState({ defaults: NO_DOCUMENT_DEFAULTS, loaded: true, failed: true }); return }
        const json = await res.json() as Record<string, unknown>
        if (!cancelled) setState({ defaults: documentDefaultsFrom(json), loaded: true, failed: false })
      } catch {
        if (!cancelled) setState({ defaults: NO_DOCUMENT_DEFAULTS, loaded: true, failed: true })
      }
    })()
    return () => { cancelled = true }
  }, [])
  return state
}
