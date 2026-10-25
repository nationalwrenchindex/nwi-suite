// ─── A fill colour, as TEXT that passes WCAG AA on HD's light and dark themes ──
//
// HD screens use one constant per hue for both a tinted background (`${GREEN}20`) and
// the text on it. As a fill those hexes are fine; as text, the 400/500 weights measured
// 2.0-3.7:1 on the light theme. The constant cannot itself become a CSS variable - a
// variable cannot take a hex alpha suffix - so the TEXT use goes through here instead.
//
// A known hue becomes its theme token (globals.css: --hd-positive, --hd-negative,
// --hd-warn, --hd-info, --hd-accent-text, --hd-text-faint). Anything else - a token
// already, white on a fill, a colour this does not know - is returned unchanged.

const TONE: Record<string, string> = {}
const set = (hexes: string[], token: string) => { for (const h of hexes) TONE[h] = `var(--hd-${token})` }
set(['#22c55e', '#16a34a', '#4ade80', '#10b981', '#34d399'], 'positive')
set(['#ef4444', '#dc2626', '#f87171', '#b91c1c'], 'negative')
set(['#f59e0b', '#fbbf24', '#d97706', '#eab308', '#facc15'], 'warn')
set(['#3b82f6', '#2563eb', '#60a5fa', '#1a6baf', '#2969b0', '#0ea5e9', '#38bdf8'], 'info')
set(['#e85d24', '#ff6600', '#f97316', '#fb923c', '#ea580c'], 'accent-text')
set(['#94a3b8', '#9ca3af', '#6b7280', '#64748b'], 'text-faint')

export function textTone(color: string | null | undefined): string | undefined {
  if (color == null) return undefined
  return TONE[color.trim().toLowerCase()] ?? color
}

/**
 * A colour at an opacity, for tints and borders: `${HD_ORANGE}20` written so it also
 * works when the colour is a theme token. A hex alpha suffix on `var(--x)` is invalid
 * CSS and silently drops the property; color-mix gives the same result for a hex and
 * works for a token.
 */
export function tint(color: string | null | undefined, percent: number): string {
  return `color-mix(in srgb, ${color ?? 'transparent'} ${percent}%, transparent)`
}
