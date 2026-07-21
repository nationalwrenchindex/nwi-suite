import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // LawnPlatform brand palette. The historical `orange` (primary) and
        // `blue` (secondary) token names are retained so the ~30 existing
        // components that reference them recolor to green with zero churn.
        // Original NWI values: orange #FF6600 / blue #2969B0.
        orange: {
          DEFAULT: '#16a34a', // forest green — primary
          '500':   '#16a34a',
          hover:   '#15803d',
          light:   '#4ade80', // light green — secondary accent
          muted:   '#16a34a20',
        },
        blue: {
          DEFAULT: '#15803d', // deep green — secondary CTA
          hover:   '#052e16', // dark green — accent
          light:   '#4ade80',
          muted:   '#15803d20',
        },
        // Literal NWI parent-brand orange, retained ONLY for the legal footer
        // ("Powered by National Wrench Index LLC"). Not used in any UI element.
        nwiParent: {
          DEFAULT: '#FF6600',
        },
        dark: {
          DEFAULT: 'var(--bg-primary)',
          card:    'var(--bg-card)',
          border:  'var(--border-color)',
          input:   'var(--bg-input)',
          lighter: 'var(--bg-lighter)',
        },
        hd: {
          bg:     '#0a0f14',
          card:   '#111920',
          inner:  '#162030',
          border: '#1e3040',
          orange: '#E85D24',
          blue:   '#1A6BAF',
        },
        success: '#22c55e',
        danger:  '#ef4444',
      },
      fontFamily: {
        sans:      ['var(--font-barlow)', 'sans-serif'],
        condensed: ['var(--font-barlow-condensed)', 'sans-serif'],
      },
      backgroundImage: {
        'blue-gradient': 'linear-gradient(135deg, #15803d 0%, #052e16 100%)',
        'orange-gradient': 'linear-gradient(135deg, #16a34a 0%, #052e16 100%)',
      },
    },
  },
  plugins: [],
}

export default config
