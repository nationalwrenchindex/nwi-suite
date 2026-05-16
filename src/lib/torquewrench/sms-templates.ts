interface TemplateVars {
  customer_first_name: string
  business_name: string
  review_link: string
}

type TemplateFn = (vars: TemplateVars) => string

const templates: Record<string, TemplateFn> = {
  oil_change: ({ customer_first_name, review_link }) =>
    `Hey ${customer_first_name}! Hope your ride's running smooth after the oil change. Mind dropping a quick review? Really helps small shops like ours: ${review_link}`,

  brake_service: ({ customer_first_name, review_link }) =>
    `Hey ${customer_first_name} — brakes feeling solid? If we did right by you, a quick review would mean a lot: ${review_link}`,

  diagnostic: ({ customer_first_name, review_link }) =>
    `Thanks for letting us diagnose your ride, ${customer_first_name}. If we got you sorted, mind leaving a review? ${review_link}`,

  tire_service: ({ customer_first_name, review_link }) =>
    `Hey ${customer_first_name}, hope the tires are treating you right. Quick favor — could you drop us a Google review? ${review_link}`,

  battery: ({ customer_first_name, review_link }) =>
    `Hey ${customer_first_name} — battery good? If we got you back rolling, a Google review would mean the world to us: ${review_link}`,

  electrical: ({ customer_first_name, review_link }) =>
    `Hey ${customer_first_name} — everything electric running right? If we tracked it down for you, a quick review goes a long way: ${review_link}`,

  cooling_system: ({ customer_first_name, review_link }) =>
    `Hey ${customer_first_name}! Hope the cooling system's holding strong. If we kept things from overheating, a review would be awesome: ${review_link}`,

  transmission: ({ customer_first_name, review_link }) =>
    `Hey ${customer_first_name} — shifting smooth? Transmission work's no small thing. If we took care of you, a review means everything: ${review_link}`,

  suspension: ({ customer_first_name, review_link }) =>
    `Hey ${customer_first_name}! How's the ride feeling? If we got the suspension right, mind dropping a quick review? ${review_link}`,

  exhaust: ({ customer_first_name, review_link }) =>
    `Hey ${customer_first_name} — running quiet now? If we took care of the exhaust, a Google review would really help us out: ${review_link}`,

  tune_up: ({ customer_first_name, review_link }) =>
    `Hey ${customer_first_name}! Feeling that fresh tune-up? If we got your engine humming again, a quick review would mean a lot: ${review_link}`,

  inspection: ({ customer_first_name, review_link }) =>
    `Thanks for trusting us with the inspection, ${customer_first_name}. If we gave you peace of mind, mind sharing a quick review? ${review_link}`,

  towing: ({ customer_first_name, review_link }) =>
    `Hey ${customer_first_name} — glad we could get you moving again. If we took good care of you, a Google review would mean a lot: ${review_link}`,

  mobile_service: ({ customer_first_name, review_link }) =>
    `Hey ${customer_first_name}! Really appreciate you letting us come out to you. If everything's running right, a quick Google review helps us a ton: ${review_link}`,

  ac_service: ({ customer_first_name, review_link }) =>
    `Hey ${customer_first_name}! Hope you're staying cool now. If we got your A/C blowing cold, a quick Google review would really help us out: ${review_link}`,

  coolant_flush: ({ customer_first_name, review_link }) =>
    `Hey ${customer_first_name} — fresh coolant in and running cool? If we took care of you, a Google review would mean a lot: ${review_link}`,

  power_steering: ({ customer_first_name, review_link }) =>
    `Hey ${customer_first_name}! Steering feeling smooth again? If we got you handling right, mind dropping a quick review? ${review_link}`,

  fuel_system: ({ customer_first_name, review_link }) =>
    `Hey ${customer_first_name} — running cleaner now? If the fuel system service did the trick, a Google review would really help: ${review_link}`,

  default: ({ customer_first_name, review_link }) =>
    `Hey ${customer_first_name} — hope everything's running right after today. A quick Google review would really help: ${review_link}`,
}

const SERVICE_TYPE_MAP: Record<string, string> = {
  oil_change:      'oil_change',
  'oil change':    'oil_change',
  brakes:          'brake_service',
  brake_service:   'brake_service',
  'brake service': 'brake_service',
  brake_repair:    'brake_service',
  diagnostic:      'diagnostic',
  diagnostics:     'diagnostic',
  tires:           'tire_service',
  tire_service:    'tire_service',
  'tire service':  'tire_service',
  tire_rotation:   'tire_service',
  battery:         'battery',
  'battery replacement': 'battery',
  electrical:      'electrical',
  'electrical repair': 'electrical',
  cooling:         'cooling_system',
  cooling_system:  'cooling_system',
  'cooling system': 'cooling_system',
  radiator:        'cooling_system',
  transmission:    'transmission',
  'transmission service': 'transmission',
  suspension:      'suspension',
  'suspension repair': 'suspension',
  exhaust:         'exhaust',
  'exhaust repair': 'exhaust',
  tune_up:         'tune_up',
  'tune up':       'tune_up',
  'tune-up':       'tune_up',
  inspection:      'inspection',
  'safety inspection': 'inspection',
  towing:          'towing',
  mobile_service:  'mobile_service',
  'mobile service': 'mobile_service',

  // A/C Service
  'a/c':                    'ac_service',
  'ac':                     'ac_service',
  'a/c service':            'ac_service',
  'ac service':             'ac_service',
  'air conditioning':       'ac_service',
  'ac repair':              'ac_service',
  'a/c repair':             'ac_service',

  // Tire Replacement
  'tire replacement':       'tire_service',
  'tire_replacement':       'tire_service',

  // Engine Diagnostic
  'engine diagnostic':      'diagnostic',
  'engine_diagnostic':      'diagnostic',

  // Coolant Flush
  'coolant flush':          'coolant_flush',
  'coolant_flush':          'coolant_flush',

  // Power Steering
  'power steering':         'power_steering',
  'power steering service': 'power_steering',
  'power_steering_service': 'power_steering',

  // Fuel System
  'fuel system':            'fuel_system',
  'fuel system service':    'fuel_system',
  'fuel_system_service':    'fuel_system',

  // Pre-Purchase Inspection
  'pre-purchase inspection': 'inspection',
  'pre purchase inspection': 'inspection',
  'prepurchase inspection':  'inspection',

  // Other — explicit fallthrough to default
  'other':                  'default',
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
