import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getRoadieDeliveryStatus, isRoadieEnabled } from '@/lib/roadie/client'

export const dynamic = 'force-dynamic'

// Maps a Roadie shipment state to our parts_deliveries.status enum.
function mapRoadieStatus(roadie: string): string | null {
  const s = roadie.toLowerCase()
  if (s.includes('deliver') && !s.includes('undeliver')) return 'delivered'
  if (s.includes('pickup') || s.includes('picked'))      return 'picked_up'
  if (s.includes('transit') || s.includes('en_route') || s.includes('enroute') || s.includes('assigned')) return 'dispatched'
  if (s.includes('cancel'))                              return 'cancelled'
  if (s.includes('fail') || s.includes('return'))       return 'failed'
  return null
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const deliveryId = req.nextUrl.searchParams.get('deliveryId')
  if (!deliveryId) return NextResponse.json({ error: 'deliveryId required' }, { status: 400 })

  const { data: delivery, error } = await supabase
    .from('parts_deliveries')
    .select('id, user_id, status, roadie_delivery_id, roadie_tracking_url, roadie_eta_minutes, roadie_driver_name, roadie_driver_phone')
    .eq('id', deliveryId)
    .maybeSingle()
  if (error || !delivery) return NextResponse.json({ error: 'Delivery not found' }, { status: 404 })
  if (delivery.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Live-refresh from Roadie once a driver has been dispatched.
  if (isRoadieEnabled() && delivery.roadie_delivery_id) {
    try {
      const live = await getRoadieDeliveryStatus(delivery.roadie_delivery_id)
      const mapped = mapRoadieStatus(live.status)
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (mapped)               patch.status              = mapped
      if (live.driverName)      patch.roadie_driver_name  = live.driverName
      if (live.driverPhone)     patch.roadie_driver_phone = live.driverPhone
      if (live.etaMinutes != null) patch.roadie_eta_minutes = live.etaMinutes
      if (mapped === 'delivered') patch.delivered_at = new Date().toISOString()

      await supabase.from('parts_deliveries').update(patch).eq('id', delivery.id)

      return NextResponse.json({
        status:      mapped ?? delivery.status,
        driverName:  live.driverName  ?? delivery.roadie_driver_name  ?? null,
        driverPhone: live.driverPhone ?? delivery.roadie_driver_phone ?? null,
        etaMinutes:  live.etaMinutes  ?? delivery.roadie_eta_minutes  ?? null,
        trackingUrl: delivery.roadie_tracking_url ?? null,
      })
    } catch (e) {
      console.error('[parts-delivery/status] Roadie status failed', e)
    }
  }

  return NextResponse.json({
    status:      delivery.status,
    driverName:  delivery.roadie_driver_name  ?? null,
    driverPhone: delivery.roadie_driver_phone ?? null,
    etaMinutes:  delivery.roadie_eta_minutes  ?? null,
    trackingUrl: delivery.roadie_tracking_url ?? null,
  })
}
