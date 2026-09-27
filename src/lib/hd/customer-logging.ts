import { createServiceClient } from '@/lib/supabase/service'
import type { Address } from '@/lib/address'

const ADDRESS_KEYS = ['address_line1', 'address_line2', 'city', 'state', 'zip'] as const

// Auto-logs the customer from an HD quote/invoice into the per-tech customers
// table. Matches an existing record by user_id + normalized phone or
// case-insensitive email; updates it or creates a new one. Business-looking
// names go into company_name. Returns the customer id, or null on skip/failure
// (never throws — a logging failure must not break the quote/invoice save).

const BUSINESS_RE = /\b(LLC|Inc|Co|Leasing|Fleet|Transport|Logistics)\b/i

function looksLikeBusiness(name: string): boolean {
  if (!name) return false
  if (BUSINESS_RE.test(name)) return true
  // all caps (and contains at least one letter)
  return name === name.toUpperCase() && /[A-Za-z]/.test(name)
}

interface LogParams {
  userId:         string
  customerName?:  string | null
  customerPhone?: string | null
  customerEmail?: string | null
  companyName?:   string | null
  /** The service address as typed on the quote/invoice. See addressColumns below. */
  address?:       Partial<Address> | null
}

/**
 * The address columns to write, blanks dropped.
 *
 * THIS IS THE FIX FOR THE PREFILL THAT NEVER PREFILLED. The HD quote and invoice
 * forms have always populated all five address fields when a customer is picked --
 * that code was never broken. What was broken is that nothing ever PUT an address
 * ON a customer: this function wrote name, phone, email and company and silently
 * dropped the address, so the prefill read five empty columns and the tech retyped
 * an address they had already entered. The paste box made that survivable, which is
 * why it went unnoticed.
 *
 * Blanks are dropped rather than written so a document saved without an address
 * cannot erase the address already on the customer -- same rule the phone/email
 * updates below follow.
 */
function addressColumns(address: Partial<Address> | null | undefined): Record<string, string> {
  if (!address) return {}
  const out: Record<string, string> = {}
  for (const k of ADDRESS_KEYS) {
    const v = address[k]
    if (typeof v === 'string' && v.trim()) out[k] = v.trim()
  }
  return out
}

export async function logHDCustomer(params: LogParams): Promise<string | null> {
  const name            = (params.customerName  ?? '').trim()
  const phone           = (params.customerPhone ?? '').trim()
  const email           = (params.customerEmail ?? '').trim()
  const explicitCompany = (params.companyName   ?? '').trim()

  const effectiveName = name || explicitCompany
  if (!effectiveName || (!phone && !email)) return null

  // Company name: explicit field wins; otherwise infer from a business-looking name.
  const company = explicitCompany || (looksLikeBusiness(name) ? name : null)

  // Split into first/last. A detected business (with no explicit company) keeps
  // the full name as first_name; a person splits normally.
  let firstName: string
  let lastName:  string
  if (!name && company) {
    firstName = company
    lastName  = ''
  } else if (looksLikeBusiness(name) && !explicitCompany) {
    firstName = name
    lastName  = ''
  } else {
    const parts = name.split(/\s+/).filter(Boolean)
    firstName = parts[0] || company || 'Customer'
    lastName  = parts.slice(1).join(' ')
  }

  const phoneDigits = phone.replace(/\D/g, '')

  try {
    const svc = createServiceClient()

    // 1. Look for an existing record — email first (case-insensitive), then
    //    phone (normalized digits).
    let existingId: string | null = null
    if (email) {
      // Escape LIKE metacharacters. '_' is a single-character wildcard, so an
      // unescaped "john_doe@x.com" also matches "johnXdoe@x.com" and can bind an
      // invoice to the wrong person's contact record.
      const emailPattern = email.replace(/[\\%_]/g, m => `\\${m}`)
      const { data } = await svc
        .from('customers')
        .select('id')
        .eq('user_id', params.userId)
        .ilike('email', emailPattern)
        .limit(1)
      if (data && data[0]) existingId = data[0].id as string
    }
    if (!existingId && phoneDigits) {
      const { data } = await svc
        .from('customers')
        .select('id, phone')
        .eq('user_id', params.userId)
        .not('phone', 'is', null)
      // Compare the last TEN digits, not the whole string. Matching in full meant
      // "+18635550100" and "863-555-0100" read as different people, so this function
      // minted a SECOND customers row for someone it already had — and migration 118's
      // ambiguity rule then refused to link either invoice, permanently. Same
      // reconciliation the 118 backfill and getContactSuppressionByPhone already use.
      const want  = phoneDigits.slice(-10)
      const match = want.length < 10
        ? undefined
        : (data ?? []).find(c => ((c.phone as string | null) ?? '').replace(/\D/g, '').slice(-10) === want)
      if (match) existingId = match.id as string
    }

    const now = new Date().toISOString()

    if (existingId) {
      // 2. Update with any new info (don't wipe existing fields with blanks).
      const upd: Record<string, unknown> = { first_name: firstName, last_name: lastName, updated_at: now }
      if (phone)   upd.phone        = phone
      if (email)   upd.email        = email
      if (company) upd.company_name = company
      Object.assign(upd, addressColumns(params.address))
      await svc.from('customers').update(upd).eq('id', existingId).eq('user_id', params.userId)
      return existingId
    }

    // 3. Create a new record.
    const { data, error } = await svc
      .from('customers')
      .insert({
        user_id:      params.userId,
        first_name:   firstName,
        last_name:    lastName,
        phone:        phone || null,
        email:        email || null,
        company_name: company,
        ...addressColumns(params.address),
      })
      .select('id')
      .single()
    if (error) {
      console.error('[hd customer-logging] insert failed', error)
      return null
    }
    return data.id as string
  } catch (err) {
    console.error('[hd customer-logging] failed', err)
    return null
  }
}
