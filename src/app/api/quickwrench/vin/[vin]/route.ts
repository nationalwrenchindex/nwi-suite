import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { QWVehicle } from '@/types/quickwrench'

type RouteContext = { params: Promise<{ vin: string }> }

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i

type NHTSAItem = { Variable: string; Value: string | null }

function field(results: NHTSAItem[], name: string): string {
  return results.find((r) => r.Variable === name)?.Value?.trim() ?? ''
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { vin } = await params
  const upperVin = vin.toUpperCase()

  if (!VIN_RE.test(upperVin)) {
    return NextResponse.json(
      { error: 'Invalid VIN — must be 17 characters (A–Z, 0–9, no I/O/Q).' },
      { status: 400 },
    )
  }

  let decodeData: { Results: NHTSAItem[] }
  try {
    const res = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinextended/${upperVin}?format=json`,
      { next: { revalidate: 3600 } },
    )
    if (!res.ok) throw new Error(`NHTSA ${res.status}`)
    decodeData = await res.json()
  } catch (err) {
    console.error('[quickwrench/vin] decode failed:', err)
    return NextResponse.json({ error: 'VIN decode service unavailable.' }, { status: 502 })
  }

  const results = decodeData.Results ?? []
  const errorCode = field(results, 'Error Code')
  const make  = field(results, 'Make')
  const model = field(results, 'Model')
  const year  = field(results, 'Model Year')

  const fatal = ['6', '7', '8', '9', '10', '11'].some((c) =>
    errorCode.split(',').map((x) => x.trim()).includes(c),
  )
  if (fatal || (!make && !model)) {
    return NextResponse.json(
      { error: `VIN could not be decoded. ${field(results, 'Error Text') || 'Verify the VIN and try again.'}` },
      { status: 422 },
    )
  }

  // Build engine description from available fields
  const cylinders    = field(results, 'Engine Number of Cylinders')
  const displacement = field(results, 'Displacement (L)')
  const fuelType     = field(results, 'Fuel Type - Primary')
  const engineModel  = field(results, 'Engine Model')
  let engine = ''
  if (displacement) engine += `${displacement}L `
  if (cylinders)    engine += `${cylinders}-cyl `
  if (fuelType && fuelType !== 'Gasoline')  engine += `${fuelType} `
  if (engineModel)  engine += engineModel
  engine = engine.trim() || 'N/A'

  const vehicle: QWVehicle = {
    vin:               upperVin,
    year,
    make,
    model,
    engine,
    trim:              field(results, 'Trim') || undefined,
    driveType:         field(results, 'Drive Type') || undefined,
    transmissionStyle: field(results, 'Transmission Style') || undefined,
    fuelType:          fuelType || undefined,
    bodyClass:         field(results, 'Body Class') || undefined,
  }

  return NextResponse.json({ vehicle })
}
