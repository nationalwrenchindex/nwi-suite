// GET  /api/user/profile — returns fuel-tracking, MPI, and pricing default profile fields
// PUT  /api/user/profile — updates average_mpg, fuel_type, offer_mpi_on_booking, and/or pricing defaults

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('profiles')
    .select('average_mpg, fuel_type, offer_mpi_on_booking, default_labor_rate, default_parts_markup_percent, default_tax_percent')
    .eq('id', user.id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    average_mpg:                   data?.average_mpg                   ?? null,
    fuel_type:                     data?.fuel_type                     ?? 'gasoline',
    offer_mpi_on_booking:          data?.offer_mpi_on_booking          ?? false,
    default_labor_rate:            data?.default_labor_rate            ?? 125,
    default_parts_markup_percent:  data?.default_parts_markup_percent  ?? 20,
    default_tax_percent:           data?.default_tax_percent           ?? 8.5,
  })
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const update: Record<string, unknown> = {}

  if ('average_mpg' in body) {
    const raw = body.average_mpg
    if (raw === null || raw === '') {
      update.average_mpg = null
    } else {
      const n = Number(raw)
      if (isNaN(n) || n <= 0 || n > 200) {
        return NextResponse.json({ error: 'average_mpg must be a positive number ≤ 200' }, { status: 400 })
      }
      update.average_mpg = Math.round(n * 100) / 100
    }
  }

  if ('fuel_type' in body) {
    const ft = String(body.fuel_type ?? 'gasoline')
    if (!['gasoline', 'diesel'].includes(ft)) {
      return NextResponse.json({ error: 'fuel_type must be gasoline or diesel' }, { status: 400 })
    }
    update.fuel_type = ft
  }

  if ('offer_mpi_on_booking' in body) {
    update.offer_mpi_on_booking = !!body.offer_mpi_on_booking
  }

  if ('default_labor_rate' in body) {
    const n = Number(body.default_labor_rate)
    if (isNaN(n) || n < 0 || n > 9999) {
      return NextResponse.json({ error: 'default_labor_rate must be 0–9999' }, { status: 400 })
    }
    update.default_labor_rate = Math.round(n * 100) / 100
  }

  if ('default_parts_markup_percent' in body) {
    const n = Number(body.default_parts_markup_percent)
    if (isNaN(n) || n < 0 || n > 999) {
      return NextResponse.json({ error: 'default_parts_markup_percent must be 0–999' }, { status: 400 })
    }
    update.default_parts_markup_percent = Math.round(n * 100) / 100
  }

  if ('default_tax_percent' in body) {
    const n = Number(body.default_tax_percent)
    if (isNaN(n) || n < 0 || n > 99) {
      return NextResponse.json({ error: 'default_tax_percent must be 0–99' }, { status: 400 })
    }
    update.default_tax_percent = Math.round(n * 100) / 100
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { error } = await supabase.from('profiles').update(update).eq('id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
