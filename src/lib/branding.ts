// Single source of truth for subscriber white-label branding.
//
// There were two logo columns competing:
//
//   profiles.business_logo_url     — written by the real uploader at
//                                    /api/settings/logo (business-logos bucket,
//                                    storage path tracked for deletion). Has
//                                    actual subscriber data.
//   profiles.hd_company_logo_url   — a URL text field in HD settings. Read by
//                                    the DOT form. Never set by anyone.
//
// Rather than add a third path, everything now resolves through here.
// business_logo_url wins because it is the one with an uploader behind it;
// hd_company_logo_url is still honoured so any HD subscriber who pasted a URL
// keeps working, and so the DOT form's existing behaviour is preserved.

export interface Branding {
  /** Company name for the document header. Never empty. */
  name:     string
  /** Public logo URL, or null to fall back to the name in text. */
  logoUrl:  string | null
  phone:    string | null
}

/** Columns any caller must select for resolveBranding to work. */
export const BRANDING_SELECT =
  'business_name, full_name, phone, business_logo_url, hd_company_logo_url'

export interface BrandingSource {
  business_name?:       string | null
  full_name?:           string | null
  phone?:               string | null
  business_logo_url?:   string | null
  hd_company_logo_url?: string | null
}

export function resolveBranding(profile: BrandingSource | null | undefined): Branding {
  const name =
    profile?.business_name?.trim() ||
    profile?.full_name?.trim() ||
    'Your Technician'

  // Uploaded logo first, pasted URL second. Empty strings are treated as unset —
  // the HD settings text field writes '' rather than null when cleared.
  const logoUrl =
    (profile?.business_logo_url?.trim() || null) ??
    (profile?.hd_company_logo_url?.trim() || null)

  return { name, logoUrl: logoUrl || null, phone: profile?.phone?.trim() || null }
}

/**
 * The NWI attribution that stays on customer-facing documents regardless of
 * white-labelling. The subscriber's brand replaces the header; this remains in
 * the footer, which is the distinction the product is built on.
 */
export const NWI_TRADEMARK_FOOTER =
  'Powered by National Wrench Index Suite™ · NWI and National Wrench Index are trademarks of National Wrench Index LLC.'
