import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { VehicleSpecs, NHTSARecall, VinResult } from '@/types/intel'

type RouteContext = { params: Promise<{ vin: string }> }

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i

// ─── NHTSA helpers ────────────────────────────────────────────────────────────

type NHTSAResultItem = { Variable: string; Value: string | null; VariableId: number }

function field(results: NHTSAResultItem[], name: string): string {
  return results.find((r) => r.Variable === name)?.Value?.trim() ?? ''
}

function parseNHTSADate(raw: string): string {
  // NHTSA dates come as "/Date(1234567890000)/" or ISO strings
  const match = raw.match(/\/Date\((\d+)\)\//)
  if (match) {
    return new Date(parseInt(match[1])).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    })
  }
  if (raw.includes('T') || raw.includes('-')) {
    return new Date(raw).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    })
  }
  return raw
}

// ─── GET /api/vin/[vin] ───────────────────────────────────────────────────────
// Decodes a VIN via NHTSA vPIC, then fetches open recalls for the vehicle.
// Requires authentication (prevents open abuse of the proxy endpoint).
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { vin } = await params
  const upperVin = vin.toUpperCase()

  if (!VIN_RE.test(upperVin)) {
    return NextResponse.json(
      { error: 'Invalid VIN. Must be exactly 17 characters (A–Z, 0–9, no I/O/Q).' },
      { status: 400 },
    )
  }

  // ── Step 1: Decode VIN ────────────────────────────────────────────────────

  let decodeData: { Results: NHTSAResultItem[] }
  try {
    const decodeRes = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${upperVin}?format=json`,
      { next: { revalidate: 3600 } }, // cache for 1 hour
    )
    if (!decodeRes.ok) throw new Error(`NHTSA returned ${decodeRes.status}`)
    decodeData = await decodeRes.json()
  } catch (err) {
    console.error('[GET /api/vin] decode failed:', err)
    return NextResponse.json({ error: 'VIN decode service unavailable. Try again shortly.' }, { status: 502 })
  }

  const results = decodeData.Results ?? []

  const specs: VehicleSpecs = {
    make:               field(results, 'Make'),
    model:              field(results, 'Model'),
    year:               field(results, 'Model Year'),
    trim:               field(results, 'Trim'),
    bodyClass:          field(results, 'Body Class'),
    driveType:          field(results, 'Drive Type'),
    engineCylinders:    field(results, 'Engine Number of Cylinders'),
    displacementL:      field(results, 'Displacement (L)'),
    fuelType:           field(results, 'Fuel Type - Primary'),
    transmissionStyle:  field(results, 'Transmission Style'),
    plantCountry:       field(results, 'Plant Country'),
    vehicleType:        field(results, 'Vehicle Type'),
    errorCode:          field(results, 'Error Code'),
    errorText:          field(results, 'Error Text'),
  }

  // Error code "0" = valid VIN; "1" = invalid check digit (might still decode)
  // Codes "6", "7", "8" etc. indicate serious errors
  const fatalError = ['6', '7', '8', '9', '10', '11'].some(
    (code) => specs.errorCode?.split(',').map((c) => c.trim()).includes(code),
  )
  if (fatalError || (!specs.make && !specs.model)) {
    return NextResponse.json(
      { error: `VIN could not be decoded. ${specs.errorText || 'Please verify the VIN.'}` },
      { status: 422 },
    )
  }

  // ── Step 2: Fetch recalls ─────────────────────────────────────────────────

  let recalls: NHTSARecall[] = []

  if (specs.make && specs.model && specs.year) {
    try {
      const recallRes = await fetch(
        `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(specs.make)}&model=${encodeURIComponent(specs.model)}&modelYear=${specs.year}`,
        { next: { revalidate: 3600 } },
      )
      if (recallRes.ok) {
        const recallData = await recallRes.json()
        recalls = (recallData.results ?? recallData.Results ?? []).map(
          (r: NHTSARecall & { ReportReceivedDate?: string }) => ({
            NHTSACampaignNumber: r.NHTSACampaignNumber ?? '',
            ReportReceivedDate:  parseNHTSADate(r.ReportReceivedDate ?? ''),
            Component:           r.Component   ?? '',
            Summary:             r.Summary     ?? '',
            Consequence:         r.Consequence ?? '',
            Remedy:              r.Remedy      ?? '',
            Manufacturer:        r.Manufacturer ?? '',
            ModelYear:           r.ModelYear   ?? specs.year,
            Make:                r.Make        ?? specs.make,
            Model:               r.Model       ?? specs.model,
          }),
        )
      }
    } catch (err) {
      // Recalls are non-critical — log and continue
      console.warn('[GET /api/vin] recall fetch failed:', err)
    }
  }

  const result: VinResult = {
    vin:            upperVin,
    specs,
    recalls,
    recallCount:    recalls.length,
    hasOpenRecalls: recalls.length > 0,
  }

  return NextResponse.json({ result })
}
