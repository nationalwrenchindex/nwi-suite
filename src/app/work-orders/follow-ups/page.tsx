import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'
import FollowUpList, { type FollowUpRow } from './FollowUpList'
import { PARENTS } from '@/lib/segments/parent'

export const metadata = { title: 'Follow-Ups — National Wrench Index Suite™' }

// Two kinds of deferred work, two lists, cross-linked. A declined segment and an
// in-service inspection defect are the same commercial idea and wait the same 30
// days (lib/followups), but they live in different tables with different shapes --
// see the header of components/inspections/DefectFollowUpList for why they are not
// one query.

export default async function FollowUpsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name, business_type, work_orders_enabled')
    .eq('id', user.id)
    .single()

  if (!profile?.business_name) redirect('/onboarding')
  if (profile.work_orders_enabled !== true) redirect('/dashboard')

  // Declined segments nobody has closed out. The partial index added in 137 covers
  // exactly this predicate.
  const { data: rows } = await supabase
    .from('work_order_segments')
    .select(`
      id, sequence, complaint, cause, grand_total, declined_at, followup_due_on, customer_note,
      work_order:work_orders!${PARENTS.ld.fkColumn}(
        id, work_order_number, unit_label,
        customer:customers(first_name, last_name, phone),
        vehicle:vehicles(year, make, model)
      )
    `)
    .eq('user_id', user.id)
    .eq('status', 'declined')
    .is('followup_closed_at', null)
    .order('followup_due_on', { ascending: true, nullsFirst: false })

  type Joined = {
    id: string; sequence: number; complaint: string | null; cause: string | null
    grand_total: number | null; declined_at: string | null; followup_due_on: string | null
    customer_note: string | null
    work_order: {
      id: string; work_order_number: string; unit_label: string | null
      customer: { first_name: string; last_name: string; phone: string | null } | null
      vehicle:  { year: number | null; make: string; model: string } | null
    } | null
  }

  const list: FollowUpRow[] = ((rows ?? []) as unknown as Joined[])
    // A segment whose parent vanished has nothing to follow up on.
    .filter(r => r.work_order != null)
    .map(r => ({
      segment_id:        r.id,
      work_order_id:     r.work_order!.id,
      work_order_number: r.work_order!.work_order_number,
      sequence:          r.sequence,
      complaint:         r.complaint,
      cause:             r.cause,
      grand_total:       r.grand_total,
      declined_at:       r.declined_at,
      followup_due_on:   r.followup_due_on,
      customer_note:     r.customer_note,
      customer_name:     r.work_order!.customer
        ? `${r.work_order!.customer!.first_name} ${r.work_order!.customer!.last_name}`.trim()
        : null,
      customer_phone:    r.work_order!.customer?.phone ?? null,
      unit_label:        r.work_order!.vehicle
        ? [r.work_order!.vehicle!.year, r.work_order!.vehicle!.make, r.work_order!.vehicle!.model].filter(Boolean).join(' ')
        : r.work_order!.unit_label,
    }))

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav
        workOrdersEnabled
        businessName={profile.business_name}
        businessType={(profile as Record<string, unknown>).business_type as string | undefined}
      />
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-6">
        <div className="mb-6">
          <Link href="/work-orders" className="text-white/40 hover:text-orange text-xs transition-colors">
            ← Work Orders
          </Link>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide mt-2">
            FOLLOW-UPS
          </h1>
          <p className="text-white/40 text-sm">
            Work a customer declined. Known truck, known fault, and they have already seen
            the price — the warmest lead a shop has.
          </p>
          {/* The sibling list. A page nobody can reach is a page that does not exist. */}
          <Link
            href="/inspections/follow-ups"
            className="inline-block mt-3 text-orange hover:underline text-sm font-semibold"
          >
            Inspection defects →
          </Link>
        </div>

        <FollowUpList initialRows={list} />
      </main>
    </div>
  )
}
