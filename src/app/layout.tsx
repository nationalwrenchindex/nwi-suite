import type { Metadata, Viewport } from 'next'
import { Barlow, Barlow_Condensed } from 'next/font/google'
import InstallPrompt from '@/components/pwa/InstallPrompt'
import ServiceWorkerRegistrar from '@/components/pwa/ServiceWorkerRegistrar'
import './globals.css'

const barlow = Barlow({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-barlow',
  display: 'swap',
})

const barlowCondensed = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-barlow-condensed',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'National Wrench Index\u2122',
    template: '%s | National Wrench Index\u2122',
  },
  description:
    'The all-in-one platform for mobile automotive professionals — manage jobs, customers, invoices, and grow your business.',
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  // Points at the generated route in src/app/manifest.ts, not the older static
  // public/site.webmanifest — that file stays for anything still referencing it.
  manifest: '/manifest.webmanifest',
  applicationName: 'NWI Suite',
  // iOS ignores nearly all of the web manifest. These apple-* meta tags are the
  // only reason an iPhone home-screen launch opens full-screen instead of
  // bouncing into a Safari tab with the chrome still showing.
  appleWebApp: {
    capable:        true,
    title:          'NWI',
    statusBarStyle: 'black-translucent',
  },
  other: {
    // Next 15 renders appleWebApp.capable as the newer `mobile-web-app-capable`
    // only. iOS below 15.4 — still common on the older iPhones techs carry as
    // work phones — reads nothing but the apple- prefixed tag, and without it a
    // home-screen launch opens in a Safari tab instead of full-screen.
    'apple-mobile-web-app-capable': 'yes',
  },
  // Field techs paste job addresses and phone numbers constantly; Safari's
  // auto-detection rewrites them as blue links mid-layout.
  formatDetection: {
    telephone: false,
    address:   false,
  },
}

// Next 15 moved themeColor and viewport out of `metadata`. Leaving them there
// still works but logs an "Unsupported metadata" warning on every build.
export const viewport: Viewport = {
  themeColor:   '#ff6600',
  width:        'device-width',
  initialScale: 1,
  // black-translucent draws the status bar over the page, so the app has to
  // extend into the notch/safe area or the top strip renders as a blank band.
  viewportFit:  'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`dark ${barlow.variable} ${barlowCondensed.variable}`}>
      <head>
        {/* Restore persisted theme before first paint to prevent flash */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('nwi-theme')||'dark';document.documentElement.classList.remove('dark','light');document.documentElement.classList.add(t);}catch(e){}})();` }} />
      </head>
      <body>
        {children}
        <ServiceWorkerRegistrar />
        <InstallPrompt />
      </body>
    </html>
  )
}
