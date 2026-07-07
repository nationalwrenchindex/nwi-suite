import { createServiceClient } from '@/lib/supabase/service'

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
      const { data } = await svc
        .from('customers')
        .select('id')
        .eq('user_id', params.userId)
        .ilike('email', email)
        .limit(1)
      if (data && data[0]) existingId = data[0].id as string
    }
    if (!existingId && phoneDigits) {
      const { data } = await svc
        .from('customers')
        .select('id, phone')
        .eq('user_id', params.userId)
        .not('phone', 'is', null)
      const match = (data ?? []).find(c => ((c.phone as string | null) ?? '').replace(/\D/g, '') === phoneDigits)
      if (match) existingId = match.id as string
    }

    const now = new Date().toISOString()

    if (existingId) {
      // 2. Update with any new info (don't wipe existing fields with blanks).
      const upd: Record<string, unknown> = { first_name: firstName, last_name: lastName, updated_at: now }
      if (phone)   upd.phone        = phone
      if (email)   upd.email        = email
      if (company) upd.company_name = company
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
