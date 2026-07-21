interface TemplateVars {
  customer_first_name: string
  business_name: string
  review_link: string
}

type TemplateFn = (vars: TemplateVars) => string

// Landscaping review-request SMS templates. Keyed by normalized service type
// (see SERVICE_TYPE_MAP). getSmsBody() selects the best-fit message.
const templates: Record<string, TemplateFn> = {
  lawn_mowing: ({ customer_first_name, business_name, review_link }) =>
    `Hi ${customer_first_name}, thanks for choosing ${business_name} for your lawn care today. If you're happy with how your yard looks, we'd love a quick Google review — it helps us keep serving great customers like you. ${review_link}`,

  seasonal_cleanup: ({ customer_first_name, business_name, review_link }) =>
    `Hi ${customer_first_name}, your seasonal cleanup is done — your property is ready for the season. We'd appreciate a review if you're happy with the work. ${review_link}`,

  fertilizing: ({ customer_first_name, business_name, review_link }) =>
    `Hi ${customer_first_name}, your lawn treatment with ${business_name} is complete. If you're happy with the service, a quick Google review would mean the world to a small business. ${review_link}`,

  trimming: ({ customer_first_name, business_name, review_link }) =>
    `Hi ${customer_first_name}, your trimming and pruning is done and looking sharp. If ${business_name} did right by you, a quick Google review goes a long way. ${review_link}`,

  tree_service: ({ customer_first_name, business_name, review_link }) =>
    `Hi ${customer_first_name}, your tree and shrub work is complete. If you're happy with how everything looks, we'd really appreciate a Google review. ${review_link}`,

  install: ({ customer_first_name, business_name, review_link }) =>
    `Hi ${customer_first_name}, thanks for trusting ${business_name} with your landscape project. If you love the results, a Google review would help us out a ton. ${review_link}`,

  irrigation: ({ customer_first_name, business_name, review_link }) =>
    `Hi ${customer_first_name}, your irrigation service is complete. If everything's running right, a quick Google review would mean a lot to us. ${review_link}`,

  pressure_washing: ({ customer_first_name, business_name, review_link }) =>
    `Hi ${customer_first_name}, hope your property is looking fresh and clean! If you're happy with the pressure washing, a Google review from you would really help ${business_name}. ${review_link}`,

  snow_removal: ({ customer_first_name, business_name, review_link }) =>
    `Hi ${customer_first_name}, you're all cleared and safe to go. If ${business_name} took good care of you, we'd appreciate a quick Google review. ${review_link}`,

  // GENERAL SERVICE — used for any landscaping service without a specific template
  default: ({ customer_first_name, business_name, review_link }) =>
    `Hi ${customer_first_name}, your service is complete. We hope your property looks exactly how you want it. If you have a moment, a Google review means the world to a small business. ${review_link}`,
}

const SERVICE_TYPE_MAP: Record<string, string> = {
  // Mowing / edging
  'lawn mowing':        'lawn_mowing',
  'lawn_mowing':        'lawn_mowing',
  'mowing':             'lawn_mowing',
  'lawn edging':        'lawn_mowing',
  'edging':             'lawn_mowing',

  // Trimming / pruning / shaping
  'trimming and pruning': 'trimming',
  'trimming':           'trimming',
  'pruning':            'trimming',
  'shrub shaping':      'trimming',
  'weed control':       'trimming',

  // Tree work
  'tree trimming':      'tree_service',
  'tree service':       'tree_service',

  // Fertilizing / turf treatments
  'fertilizing':        'fertilizing',
  'aeration':           'fertilizing',
  'overseeding':        'fertilizing',

  // Cleanups
  'leaf removal and cleanup': 'seasonal_cleanup',
  'leaf removal':       'seasonal_cleanup',
  'spring cleanup':     'seasonal_cleanup',
  'fall cleanup':       'seasonal_cleanup',
  'cleanup':            'seasonal_cleanup',
  'mulching':           'seasonal_cleanup',

  // Installs
  'landscape installation': 'install',
  'sod installation':   'install',
  'installation':       'install',

  // Irrigation
  'irrigation service and repair': 'irrigation',
  'irrigation':         'irrigation',

  // Pressure washing / gutters
  'pressure washing':   'pressure_washing',
  'gutter cleaning':    'pressure_washing',

  // Snow
  'snow removal':       'snow_removal',

  // Custom — explicit fallthrough to general default
  'custom service':     'default',
  'other':              'default',
}

export function getSmsBody(
  serviceType: string | null | undefined,
  vars: TemplateVars,
): string {
  const key = serviceType
    ? (SERVICE_TYPE_MAP[serviceType.toLowerCase()] ?? 'default')
    : 'default'
  const fn = templates[key] ?? templates.default
  return fn(vars)
}
