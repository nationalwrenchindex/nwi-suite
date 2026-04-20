import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Privacy Policy — National Wrench Index Suite™',
}

export default function PrivacyPage() {
  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <LegalNav />

      <main className="flex-1 w-full max-w-3xl mx-auto px-5 sm:px-8 py-12">
        <p className="text-white/30 text-xs uppercase tracking-widest mb-3">Legal</p>
        <h1 className="font-condensed font-bold text-4xl sm:text-5xl text-white tracking-wide mb-2">
          PRIVACY POLICY
        </h1>
        <p className="text-white/40 text-sm mb-10">Last updated: April 20, 2026</p>

        <div className="space-y-10">

          <Section title="1. Overview">
            <p>
              National Wrench Index (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) operates the National Wrench Index
              Suite&#8482; platform. This Privacy Policy explains how we collect, use, share, and protect
              information about you when you use our Service.
            </p>
            <p>
              By using the Service, you agree to the collection and use of information in accordance
              with this policy. If you have questions, contact us at{' '}
              <a href="mailto:edwardfleeman57@gmail.com" className="text-orange hover:text-orange-light">
                edwardfleeman57@gmail.com
              </a>
              .
            </p>
          </Section>

          <Section title="2. Information We Collect">
            <h3 className="font-condensed font-bold text-white text-base tracking-wide mb-2">
              Account & Business Information
            </h3>
            <p>
              When you register for the Service, we collect your name, email address, password
              (hashed), business name, profession type, service area, and any other profile
              information you provide.
            </p>

            <h3 className="font-condensed font-bold text-white text-base tracking-wide mb-2 mt-4">
              Customer & Vehicle Records
            </h3>
            <p>
              As a Subscriber, you may upload or create records for your customers, including their
              names, phone numbers, email addresses, vehicle information, and service history. This
              data belongs to you; we process it solely to deliver the Service on your behalf.
            </p>

            <h3 className="font-condensed font-bold text-white text-base tracking-wide mb-2 mt-4">
              Payment Information
            </h3>
            <p>
              Billing is handled by Stripe. We do not store your full credit card number, CVC, or
              other sensitive payment details on our servers. Stripe may collect and store payment
              information in accordance with their own privacy policy.
            </p>

            <h3 className="font-condensed font-bold text-white text-base tracking-wide mb-2 mt-4">
              Usage Data
            </h3>
            <p>
              We may collect information about how you interact with the Service, including pages
              visited, features used, and actions taken, to improve the platform and diagnose
              technical issues.
            </p>
          </Section>

          <Section title="3. How We Use Your Information">
            <p>We use the information we collect to:</p>
            <ul>
              <li>Create and manage your account and deliver the features of the Service</li>
              <li>Process subscription payments and manage billing</li>
              <li>Send transactional SMS and email notifications to you and your customers on your behalf</li>
              <li>Generate AI-assisted quotes and repair specifications via the QuickWrench&#8482; feature</li>
              <li>Provide customer support and respond to your inquiries</li>
              <li>Monitor and improve the performance, security, and reliability of the Service</li>
              <li>Comply with applicable legal obligations</li>
            </ul>
            <p>
              We do not sell your personal information or your customers&apos; personal information
              to third parties.
            </p>
          </Section>

          <Section title="4. Who We Share Data With">
            <p>
              We share data only with the following trusted service providers, and only to the extent
              necessary to deliver the Service:
            </p>
            <ul>
              <li>
                <strong className="text-white">Stripe</strong> — payment processing and subscription
                billing
              </li>
              <li>
                <strong className="text-white">Twilio</strong> — SMS delivery for appointment
                confirmations, reminders, and other transactional notifications
              </li>
              <li>
                <strong className="text-white">Supabase</strong> — database hosting and
                authentication infrastructure
              </li>
              <li>
                <strong className="text-white">Anthropic</strong> — AI inference for
                QuickWrench&#8482; VIN-to-quote and repair specification features
              </li>
            </ul>
            <p>
              We do not share your data with any other third parties. We do not sell, rent, or
              trade personal information to data brokers, advertisers, or any other entities.
            </p>
          </Section>

          <Section title="5. Data Retention">
            <p>
              We retain your account data, customer records, and business information for as long
              as your account remains active. If you cancel your subscription, your data will be
              retained for 30 days following account closure to allow for potential reactivation
              or data export. After 30 days, all data associated with your account will be
              permanently deleted from our systems.
            </p>
            <p>
              Some information may be retained for longer periods where required by law (for
              example, financial records).
            </p>
          </Section>

          <Section title="6. Security">
            <p>
              We take the security of your data seriously. Our security practices include:
            </p>
            <ul>
              <li>Encrypted data storage and transmission (TLS/HTTPS on all connections)</li>
              <li>Row Level Security (RLS) enforced at the database level — each Subscriber&apos;s
                data is logically isolated from other Subscribers</li>
              <li>Secure authentication via Supabase, with hashed passwords and session management</li>
              <li>Access controls that limit which team members can access production data</li>
            </ul>
            <p>
              No security system is impenetrable. While we follow industry-standard practices, we
              cannot guarantee absolute security. In the event of a data breach that affects your
              information, we will notify you as required by applicable law.
            </p>
          </Section>

          <Section title="7. Your Rights">
            <p>You have the right to:</p>
            <ul>
              <li>
                <strong className="text-white">Access</strong> — request a copy of the personal
                data we hold about you
              </li>
              <li>
                <strong className="text-white">Correction</strong> — request correction of any
                inaccurate or incomplete data
              </li>
              <li>
                <strong className="text-white">Deletion</strong> — request deletion of your
                personal data, subject to legal retention requirements
              </li>
              <li>
                <strong className="text-white">Portability</strong> — request an export of your
                data in a machine-readable format
              </li>
            </ul>
            <p>
              To exercise any of these rights, contact us at{' '}
              <a href="mailto:edwardfleeman57@gmail.com" className="text-orange hover:text-orange-light">
                edwardfleeman57@gmail.com
              </a>
              . We will respond to verified requests within 30 days.
            </p>
          </Section>

          <Section title="8. Cookies">
            <p>
              The Service uses session cookies to maintain your authenticated session while you
              are logged in. These cookies are strictly necessary for the Service to function and
              are deleted when you end your browser session or sign out.
            </p>
            <p>
              We do not use tracking cookies, advertising cookies, or any third-party cookies for
              analytics or behavioral profiling.
            </p>
          </Section>

          <Section title="9. SMS Messaging & Phone Numbers">
            <p>
              Phone numbers collected through the Service — whether from Subscribers during
              registration or from their customers during the booking process — are used solely
              for transactional communications directly related to the Service.
            </p>
            <p>
              Specifically:
            </p>
            <ul>
              <li>Subscriber phone numbers may be used to send account-related notifications</li>
              <li>Customer phone numbers entered by Subscribers or collected via booking forms are
                used only to send appointment-related SMS messages on behalf of the Subscriber</li>
              <li>Phone numbers are <strong className="text-white">never sold</strong> to third parties</li>
              <li>Phone numbers are <strong className="text-white">never used for marketing</strong>{' '}
                without explicit, affirmative opt-in consent</li>
              <li>All SMS messages include a <strong className="text-white">STOP</strong> opt-out
                instruction; any opt-out is respected immediately</li>
            </ul>
          </Section>

          <Section title="10. Children">
            <p>
              The Service is intended for use by adults operating professional businesses. We do
              not knowingly collect personal information from individuals under the age of 18. If
              you believe a minor has provided us with personal information, please contact us and
              we will promptly delete that information.
            </p>
          </Section>

          <Section title="11. Changes to This Policy">
            <p>
              We may update this Privacy Policy from time to time. We will notify you of material
              changes by posting the updated policy on this page with a revised &ldquo;Last updated&rdquo;
              date. Your continued use of the Service after any changes constitutes your acceptance
              of the updated policy.
            </p>
          </Section>

          <Section title="12. Contact">
            <p>
              For privacy-related questions, requests, or concerns, please contact us at:{' '}
              <a href="mailto:edwardfleeman57@gmail.com" className="text-orange hover:text-orange-light">
                edwardfleeman57@gmail.com
              </a>
            </p>
          </Section>

        </div>
      </main>

      <LegalFooter />
    </div>
  )
}

// ─── Shared components ────────────────────────────────────────────────────────

function LegalNav() {
  return (
    <header className="border-b border-dark-border bg-dark-card">
      <div className="max-w-3xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
        <Link href="/login" className="flex items-center gap-3 group">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/nwi-logo.png" alt="National Wrench Index Suite™" className="h-10 w-auto" />
          <span className="hidden sm:block font-condensed font-bold text-sm leading-tight">
            <span style={{ color: '#FF6600' }}>National</span>{' '}
            <span style={{ color: '#2969B0' }}>Wrench Index</span>
            <span className="text-white/70">&#8482;</span>
          </span>
        </Link>
        <Link
          href="/login"
          className="text-white/40 hover:text-white text-xs transition-colors border border-dark-border rounded-lg px-3 py-1.5 hover:border-white/20"
        >
          ← Back to site
        </Link>
      </div>
    </header>
  )
}

function LegalFooter() {
  return (
    <footer className="border-t border-dark-border bg-dark-card mt-12">
      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-white/25 text-xs">
        <p>&copy; {new Date().getFullYear()} National Wrench Index. All rights reserved.</p>
        <div className="flex items-center gap-4">
          <Link href="/terms"   className="hover:text-white/60 transition-colors">Terms</Link>
          <Link href="/privacy" className="hover:text-white/60 transition-colors">Privacy</Link>
          <a href="mailto:edwardfleeman57@gmail.com" className="hover:text-white/60 transition-colors">Contact</a>
        </div>
      </div>
    </footer>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-condensed font-bold text-xl text-white tracking-wide mb-4 pb-2 border-b border-dark-border">
        {title}
      </h2>
      <div className="space-y-3 text-white/65 text-sm leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_li]:leading-relaxed">
        {children}
      </div>
    </section>
  )
}
