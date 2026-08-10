// Light-duty directory agent variant — the descriptor that binds the generic
// reply handling in ./reply.ts to the LD tables, number, copy and BD directory.

import { createAgentListing } from './bd'
import {
  FALLBACK_MESSAGE,
  LD_FROM_NUMBER,
  LISTED_MESSAGE,
  OPTOUT_MESSAGE,
} from './config'
import type { DirectoryVariant } from './reply'

export const LD_VARIANT: DirectoryVariant = {
  label:           'directory-agent',
  prospectsTable:  'directory_prospects',
  optoutsTable:    'directory_optouts',
  prospectColumns: 'id, phone, business_name, city, state, status, bd_listing_created',
  fromNumber:      LD_FROM_NUMBER,
  listedMessage:   LISTED_MESSAGE,
  optOutMessage:   OPTOUT_MESSAGE,
  fallbackMessage: FALLBACK_MESSAGE,
  createListing:   prospect => createAgentListing({
    businessName: prospect.business_name || 'Mobile Mechanic',
    city:         prospect.city,
    state:        prospect.state,
    phone:        prospect.phone,
  }),
}
