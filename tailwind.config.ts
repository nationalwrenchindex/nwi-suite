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
        orange: {
          DEFAULT: '#FF6600',
          hover:   '#E55A00',
          light:   '#FF8533',
          muted:   '#FF660020',
        },
        blue: {
          DEFAULT: '#2969B0',
          hover:   '#1F5090',
          light:   '#3A7FD5',
          muted:   '#2969B020',
        },
        dark: {
          DEFAULT: 'var(--bg-primary)',
          card:    'var(--bg-card)',
          border:  'var(--border-color)',
          input:   'var(--bg-input)',
          lighter: 'var(--bg-lighter)',
        },
        success: '#22c55e',
        danger:  '#ef4444',
      },
      fontFamily: {
        sans:      ['var(--font-barlow)', 'sans-serif'],
        condensed: ['var(--font-barlow-condensed)', 'sans-serif'],
      },
      backgroundImage: {
        'blue-gradient': 'linear-gradient(135deg, #2969B0 0%, #1a3f6f 100%)',
        'orange-gradient': 'linear-gradient(135deg, #FF6600 0%, #cc5200 100%)',
      },
    },
  },
  plugins: [],
}

export default config
