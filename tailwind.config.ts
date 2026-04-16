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
          DEFAULT: '#1a1a1a',
          card:    '#222222',
          border:  '#333333',
          input:   '#2a2a2a',
          lighter: '#2e2e2e',
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
