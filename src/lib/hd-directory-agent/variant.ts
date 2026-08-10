// HD directory agent variant — binds the generic reply handling in
// src/lib/directory-agent/reply.ts to the HD tables, number, copy and directory.

import type { DirectoryVariant } from '@/lib/directory-agent/reply'
import { createHdListing } from './bd'
import {
  HD_FALLBACK_MESSAGE,
  HD_FROM_NUMBER,
  HD_LISTED_MESSAGE,
  HD_OPTOUT_MESSAGE,
} from './config'

export const HD_VARIANT: DirectoryVariant = {
  label:           'hd-directory-agent',
  prospectsTable:  'hd_directory_prospects',
  optoutsTable:    'hd_directory_optouts',
  // service_category is HD-only — it selects the BD profession on create.
  prospectColumns: 'id, phone, business_name, city, state, status, bd_listing_created, service_category',
  fromNumber:      HD_FROM_NUMBER,
  listedMessage:   HD_LISTED_MESSAGE,
  optOutMessage:   HD_OPTOUT_MESSAGE,
  fallbackMessage: HD_FALLBACK_MESSAGE,
  createListing:   prospect => createHdListing({
    businessName:    prospect.business_name || 'Heavy Duty Service',
    city:            prospect.city,
    state:           prospect.state,
    phone:           prospect.phone,
    serviceCategory: prospect.service_category ?? null,
  }),
}
