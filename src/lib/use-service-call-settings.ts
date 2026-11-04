'use client'

import { useEffect, useState } from 'react'
import { ldServiceCallFrom, SERVICE_CALL_OFF, type ServiceCallSettings } from '@/lib/service-call'

/**
 * LD's service call default (migration 180), for the LD quote, work order and invoice
 * forms. Same contract as useExtrasSettingsState: `loaded` is a third state, never
 * collapsed into "off".
 *
 * `available` is false when the database does not have migration 180 yet. Then no
 * form offers the fee at all - a fee typed onto a document that cannot record it
 * would be refused on save.
 *
 * Reads the column names /api/user/profile returns for these three (bill_service_call,
 * service_call_fee, service_call_tax) through ldServiceCallFrom.
 */
export interface ServiceCallSettingsState {
  settings:  ServiceCallSettings
  available: boolean
  loaded:    boolean
}

export function useServiceCallSettingsState(): ServiceCallSettingsState {
  const [state, setState] = useState<ServiceCallSettingsState>({ settings: SERVICE_CALL_OFF, available: false, loaded: false })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/user/profile')
        const json = res.ok ? await res.json() as Record<string, unknown> : null
        if (cancelled) return
        setState({
          settings:  json ? ldServiceCallFrom(json) : SERVICE_CALL_OFF,
          available: json?.service_call_available === true,
          loaded:    true,
        })
      } catch {
        if (!cancelled) setState({ settings: SERVICE_CALL_OFF, available: false, loaded: true })
      }
    })()
    return () => { cancelled = true }
  }, [])

  return state
}
