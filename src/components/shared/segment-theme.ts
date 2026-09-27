// Theme tokens for the shared segment components.
//
// LD and HD use genuinely different surfaces: LD renders through Tailwind's dark.*
// tokens (bg-dark-card / border-dark-border, which resolve to CSS variables), HD
// through its own var(--hd-*) set. Neither can be expressed in the other's classes,
// so a shared component takes a variant and reads its surfaces from here.
//
// Same idea as DirectoryVariant: one implementation, two skins, and no component
// branching on the product for anything other than colour.

export type ProductVariant = 'ld' | 'hd'

export interface SegmentSurface {
  card:     React.CSSProperties
  inner:    React.CSSProperties
  /** Border colour on its own, for rules and dividers. */
  border:   string
  /** Body, muted and faint text — as inline styles, because HD's are alpha-composited
   *  against its own ink variable and cannot be a Tailwind class. */
  text:     React.CSSProperties
  muted:    React.CSSProperties
  faint:    React.CSSProperties
  accent:   string
}

const LD_BORDER = 'rgba(255,255,255,0.10)'

export const SURFACES: Record<ProductVariant, SegmentSurface> = {
  ld: {
    card:   { background: 'var(--bg-card)',    border: `1px solid var(--border-color)` },
    inner:  { background: 'var(--bg-lighter)', border: `1px solid ${LD_BORDER}` },
    border: 'var(--border-color)',
    text:   { color: 'var(--ld-ink, #ffffff)' },
    muted:  { color: 'rgba(255,255,255,0.60)' },
    faint:  { color: 'rgba(255,255,255,0.35)' },
    accent: '#FF6600',
  },
  hd: {
    card:   { background: 'var(--hd-card)',  border: '1px solid var(--hd-border)' },
    inner:  { background: 'var(--hd-inner)', border: '1px solid var(--hd-border)' },
    border: 'var(--hd-border)',
    text:   { color: 'var(--hd-text)' },
    muted:  { color: 'rgba(var(--hd-ink-rgb), 0.60)' },
    faint:  { color: 'rgba(var(--hd-ink-rgb), 0.35)' },
    accent: '#E85D24',
  },
}

/** LD's light mode remaps text-white through globals.css, so LD body text is left as
 *  a Tailwind class where possible. This is for the places that must be inline. */
export function surfaceFor(variant: ProductVariant): SegmentSurface {
  return SURFACES[variant]
}
