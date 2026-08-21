// NWI brand palette for the Fleet Pro portal.
//
// Fleet Pro originally borrowed the HD suite's #E85D24, which reads as red against
// the dark navy ground rather than as an NWI accent. These are the house colors
// from tailwind.config.ts — the portal uses inline styles like the rest of the HD
// surface, so they are restated here rather than pulled through Tailwind classes.
// blue.light rather than blue.DEFAULT (#2969b0): on the portal's dark navy ground
// the default blue only reaches 3.2:1, short of the 4.5:1 WCAG AA wants for the
// small uppercase wordmark. This is the same brand family, one step brighter.
export const NWI_BLUE   = '#3A7FD5'
export const NWI_ORANGE = '#ff6600'

// Only brand colors live here. Status colors (overdue red, scheduled green, failed
// inspection red) stay as literals in the components that own them — overdue has to
// read as an alarm, and routing it through a brand palette invites someone to
// "harmonize" it later.

/**
 * The wordmark, split across the two brand colors: NWI in blue, Fleet Pro in orange.
 * A component rather than a string so every surface renders it identically — the
 * previous single-color version had drifted into five separate literals.
 */
export function FleetProWordmark({
  className,
  style,
}: {
  className?: string
  style?:     React.CSSProperties
}) {
  return (
    <span className={className} style={style}>
      <span style={{ color: NWI_BLUE }}>NWI</span>{' '}
      <span style={{ color: NWI_ORANGE }}>Fleet Pro</span>
    </span>
  )
}
