import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'

// ─── HD truck VIN decode (NHTSA vPIC) ───────────────────────────────────────────
// Mirrors the LD QuickWrench VIN decode pattern but gated on HD access. Returns
// year / make / model / engine for the truck engine diagnostic tab.

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

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  const { vin } = await params
  const upperVin = vin.toUpperCase()

  if (!VIN_RE.test(upperVin)) {
    return NextResponse.json(
      { error: 'VIN not found — please enter vehicle info manually' },
      { status: 400 },
    )
  }

  let decodeData: { Results: NHTSAItem[] }
  try {
    const res = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinextended/${upperVin}?format=json`,
      { next: { revalidate: 3600 }, signal: AbortSignal.timeout(12_000) },
    )
    if (!res.ok) throw new Error(`NHTSA ${res.status}`)
    decodeData = await res.json()
  } catch (err) {
    console.error('[hd/quickwrench/vin] decode failed:', err)
    return NextResponse.json({ error: 'VIN not found — please enter vehicle info manually' }, { status: 502 })
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
      { error: 'VIN not found — please enter vehicle info manually' },
      { status: 422 },
    )
  }

  // Build engine description from available fields (displacement first)
  const cylinders    = field(results, 'Engine Number of Cylinders')
  const displacement = field(results, 'Displacement (L)')
  const fuelType     = field(results, 'Fuel Type - Primary')
  const engineModel  = field(results, 'Engine Model')
  let engine = ''
  if (displacement) engine += `${parseFloat(displacement).toFixed(1)}L `
  if (cylinders)    engine += `${cylinders}-cyl `
  if (fuelType && fuelType !== 'Gasoline') engine += `${fuelType} `
  if (engineModel)  engine += engineModel
  engine = engine.trim()

  return NextResponse.json({
    vehicle: {
      vin:   upperVin,
      year,
      make,
      model,
      engine: engine || null,
    },
  })
}
