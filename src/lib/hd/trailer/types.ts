// Shared row shape for hd_trailer_reference (migration 124).
//
// The four data modules in this directory each own one system and are loaded together
// by /api/hd/trailer-reference/seed. Keeping the contract here rather than in any one
// module means adding a fifth system later touches no existing file.

/** Top-level grouping. Also what the QuickWrench Trailer Systems filter lists. */
export type TrailerSystem =
  | 'Air Brakes'
  | 'Brake Chambers'
  | 'Slack Adjusters'
  | 'Brake Shoes & Drums'
  | 'ABS'
  | 'Electrical'
  | 'Torque Specs'

export interface TrailerReferenceRow {
  /** One of TrailerSystem. Indexed — it is the primary filter in QuickWrench. */
  system:       TrailerSystem
  /** The specific part or procedure: 'Type 30 Brake Chamber', 'Haldex Code 1-1'. */
  component:    string
  /** What it is or what the code means. The main free-text search target. */
  description:  string
  /** The spec itself when there is one: '450-500', '0.020-0.040', '120-135'. */
  value:        string | null
  /** Unit for `value`: 'ft-lbs', 'PSI', 'inches', 'ohms'. Null when value is null. */
  units:        string | null
  /** Procedure detail, cautions, diagnosis steps. Null when there is nothing to add. */
  notes:        string | null
  /** 'Trailer' for generic entries; a brand when the spec is brand-specific. */
  manufacturer: string
}
