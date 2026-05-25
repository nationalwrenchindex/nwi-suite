import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess } from '@/lib/hd-access'

export const metadata = { title: 'OEM Resources — NWI HD Suite' }

const HD_ORANGE = '#E85D24'
const HD_BLUE   = '#1A6BAF'

const RESOURCE_SECTIONS = [
  {
    title: 'Engine Manufacturers',
    color: HD_ORANGE,
    links: [
      { name: 'Cummins QuickServe Online',      url: 'https://quickserve.cummins.com',                    note: 'Free public service manual access — fault codes, component guides, torque specs' },
      { name: 'Detroit Diesel DiagnosticLink',  url: 'https://dda.detroit-diesel.com',                   note: 'DD13, DD15, DD16 — service info, diagnostic procedures' },
      { name: 'Mercedes-Benz Trucks Service',   url: 'https://www.mercedes-benz-trucks.com/en_GB/brand/actions-and-events/truckstore/service.html', note: 'MBE 4000 / OM 926 LA — official service portal' },
      { name: 'PACCAR Engine Service',           url: 'https://www.paccarengines.com',                    note: 'MX-11, MX-13 — PACCAR engine service resources' },
      { name: 'Volvo Trucks Uptime Services',   url: 'https://www.volvotrucks.com/en-en/services/uptime-services.html', note: 'D11, D13, D16 Volvo engine service portal' },
      { name: 'Navistar / International Service',url: 'https://www.internationaltrucks.com/service',      note: 'A26, S13 Integrated Powertrain — service information' },
    ],
  },
  {
    title: 'Axle and Driveline',
    color: HD_BLUE,
    links: [
      { name: 'Meritor Service Manuals',         url: 'https://www.meritor.com/service',                  note: 'Rear axles, front axles, differentials — full service manual library' },
      { name: 'Dana Commercial Vehicle',         url: 'https://www.dana.com/en-us/segments/commercial-vehicle', note: 'Spicer driveshafts, axles, drivetrain components' },
      { name: 'American Axle (AAM)',             url: 'https://www.aam.com',                               note: 'Heavy duty axle and driveline service resources' },
      { name: 'Eaton Driveline Components',      url: 'https://www.eaton.com/us/en-us/catalog/transportation/truck-components/driveline.html', note: 'Fuller transmissions, clutches, driveline service manuals' },
    ],
  },
  {
    title: 'Brake Systems',
    color: '#22C55E',
    links: [
      { name: 'Bendix Technical Library',        url: 'https://www.bendix.com/en/service-tools',          note: 'ABS, air dryers, brake systems — complete technical library' },
      { name: 'Meritor WABCO',                   url: 'https://www.meritorwabco.com',                     note: 'Air management systems, ABS, electronic brake systems' },
      { name: 'Haldex Service Documentation',   url: 'https://www.haldex.com/en/truck-trailer',           note: 'Slack adjusters, foundation brakes, brake chambers' },
    ],
  },
  {
    title: 'Fifth Wheel and Coupling',
    color: '#F59E0B',
    links: [
      { name: 'Holland Group Service',           url: 'https://www.thehollandgroup.com/service',           note: 'Fifth wheels, kingpins, landing gear — service manuals' },
      { name: 'Jost International',              url: 'https://www.jost-world.com/en/service',             note: 'Coupling and connecting systems — technical documentation' },
      { name: 'SAF Holland',                     url: 'https://www.safholland.com/service',                note: 'Fifth wheels, kingpins, slider systems, landing legs' },
    ],
  },
  {
    title: 'Suspension Systems',
    color: '#8B5CF6',
    links: [
      { name: 'Hendrickson International',       url: 'https://www.hendrickson-intl.com/service',          note: 'PRIMAAX, ULTRAA-K, Haulmaax suspension service manuals' },
      { name: 'Watson and Chalin',               url: 'https://www.watsonandchalin.com',                   note: 'Tag, pusher, liftable axle suspension service info' },
      { name: 'Peterbilt Suspension',            url: 'https://www.peterbilt.com/service',                 note: 'OEM suspension specs and service documentation' },
    ],
  },
  {
    title: 'Federal Regulations',
    color: '#EF4444',
    links: [
      { name: 'FMCSA Regulations Hub',           url: 'https://www.fmcsa.dot.gov/regulations',            note: 'Complete FMCSA regulatory library — 49 CFR all parts' },
      { name: '49 CFR Part 396 — Inspection Requirements', url: 'https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-396', note: 'Inspection, repair, and maintenance of motor vehicles' },
      { name: 'CVSA Inspection Programs',        url: 'https://www.cvsa.org/inspection-programs',         note: 'Commercial Vehicle Safety Alliance — inspection procedures and criteria' },
      { name: 'CVSA Out-of-Service Criteria 2024', url: 'https://cvsa.org/wp-content/uploads/2024/01/2024-OOS-Criteria.pdf', note: 'Current out-of-service criteria — North American Standard Inspection' },
    ],
  },
  {
    title: 'EPA and Refrigerant',
    color: '#06B6D4',
    links: [
      { name: 'EPA Section 608 Regulations',     url: 'https://www.epa.gov/section608',                   note: 'Refrigerant handling regulations — certification requirements' },
      { name: 'ESCO Institute (EPA 608 Certs)',  url: 'https://www.escogroup.org',                         note: 'EPA 608 certification testing and study materials' },
      { name: 'MACS Worldwide',                  url: 'https://www.macsw.org',                             note: 'Mobile A/C Society — technical training, service procedures' },
    ],
  },
  {
    title: 'Tire Specifications',
    color: '#64748B',
    links: [
      { name: 'TIA Tire Service Manual',         url: 'https://www.tia.us.com/resources',                 note: 'Tire Industry Association — service, mounting, and safety resources' },
      { name: 'Michelin Truck Tire Service Manual', url: 'https://www.michelinman.com/truck',             note: 'Load ratings, inflation charts, retreading specs' },
    ],
  },
]

export default async function ResourcesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const hasAccess = await checkHDStarterAccess(user.id)
  if (!hasAccess) redirect('/hd/upgrade')

  return (
    <main className="flex-1 p-6 max-w-4xl">

      <div className="mb-6">
        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
          HD Suite — Reference
        </p>
        <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">OEM RESOURCES</h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Direct links to official manufacturer service documentation, federal regulations, and technical libraries.
        </p>
      </div>

      <div className="rounded-xl p-4 mb-6" style={{ background: '#0d1820', border: `1px solid ${HD_ORANGE}30` }}>
        <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.45)' }}>
          <span style={{ color: HD_ORANGE }}>Note:</span>{' '}
          All links open official manufacturer and regulatory websites. Some OEM portals may require account registration
          to access full service manual content. Always verify repair procedures against the specific model year and
          software revision for the unit being serviced.
        </p>
      </div>

      <div className="space-y-4">
        {RESOURCE_SECTIONS.map(section => (
          <div key={section.title} className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>
            <div
              className="px-5 py-3 flex items-center gap-2"
              style={{ background: '#0d1820', borderBottom: '1px solid #1e3040' }}
            >
              <div className="w-2 h-4 rounded-sm flex-shrink-0" style={{ background: section.color }} />
              <p className="font-condensed font-bold text-white tracking-wide text-sm">{section.title.toUpperCase()}</p>
            </div>
            <div className="divide-y" style={{ background: '#111920', borderColor: '#1e3040' }}>
              {section.links.map(link => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-4 px-5 py-4 group transition-colors block"
                  style={{ borderColor: '#1e3040' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#162030')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-white group-hover:underline">
                        {link.name}
                      </p>
                      <svg className="w-3 h-3 flex-shrink-0 opacity-40" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </div>
                    <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      {link.note}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: section.color, opacity: 0.6 }}>
                      {link.url.replace('https://www.', '').replace('https://', '').split('/')[0]}
                    </p>
                  </div>
                  <svg className="w-4 h-4 flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-40 transition-opacity" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-center mt-8 leading-relaxed" style={{ color: 'rgba(255,255,255,0.2)' }}>
        NWI HD Suite is not affiliated with any of the linked manufacturers or agencies.
        Links are provided as a convenience for qualified HD technicians and fleet managers.
      </p>
    </main>
  )
}
