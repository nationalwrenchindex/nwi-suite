import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function GET() {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('hd_parts_reference')
    .select('*')
    .order('manufacturer')
    .order('part_category')
    .order('part_function')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ parts: data ?? [] })
}
