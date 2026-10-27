// Server-side: is this request on the /reefer surface? The middleware sets x-pathname
// to the path being rendered, which for a reused HD page under /reefer is /reefer/...
//
// For narrowing what a REUSED screen shows (equipment types, categories, labels) - never
// for opening a route; that is the gate's job (src/lib/hd-access.ts). Only a reefer
// account can stay on /reefer: the reefer layout sends everyone else away.
import { headers } from 'next/headers'
import { isReeferSurfacePath } from '@/lib/reefer-standalone'

export async function onReeferSurface(): Promise<boolean> {
  return isReeferSurfacePath((await headers()).get('x-pathname'))
}
