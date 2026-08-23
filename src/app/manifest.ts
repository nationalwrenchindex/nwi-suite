import type { MetadataRoute } from 'next'

// Next 15 metadata route — serves /manifest.webmanifest.
//
// This supersedes the older static public/site.webmanifest. That file is left in
// place because older links and cached HTML may still point at it, but layout.tsx
// links this route, so this is the manifest browsers actually install from.
//
// Every icon is generated on demand by src/app/icon/[size]/route.tsx rather than
// checked in as a PNG — there is no image tooling in this project, and Satori
// (via next/og) can render the tile at any size we whitelist.

const ICON_SIZES = [72, 96, 128, 144, 152, 192, 384, 512] as const

export default function manifest(): MetadataRoute.Manifest {
  return {
    name:             'NWI Suite',
    short_name:       'NWI',
    description:      'National Wrench Index Suite — jobs, customers, invoices, inspections, and fleet tools for mobile automotive and heavy-duty professionals.',
    theme_color:      '#ff6600',
    background_color: '#0f1923',
    display:          'standalone',
    start_url:        '/dashboard',
    scope:            '/',
    orientation:      'portrait',
    icons: [
      ...ICON_SIZES.map((size) => ({
        src:     `/icon/${size}`,
        sizes:   `${size}x${size}`,
        type:    'image/png',
        purpose: 'any' as const,
      })),
      // Android applies its own mask (circle, squircle, teardrop) to maskable
      // icons. Without a maskable entry it falls back to cropping the 'any' icon
      // into a circle, which shaves the corners off the tile and looks broken.
      // The generated tile is full-bleed with the glyph inside the 80% safe zone,
      // so the same route serves both purposes.
      {
        src:     '/icon/192',
        sizes:   '192x192',
        type:    'image/png',
        purpose: 'maskable',
      },
      {
        src:     '/icon/512',
        sizes:   '512x512',
        type:    'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
