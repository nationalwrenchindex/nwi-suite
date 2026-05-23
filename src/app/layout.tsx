import type { Metadata } from 'next'
import { Barlow, Barlow_Condensed } from 'next/font/google'
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
      <body>{children}</body>
    </html>
  )
}
