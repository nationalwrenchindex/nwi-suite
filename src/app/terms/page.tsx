import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Terms of Service — National Wrench Index Suite™',
}

export default function TermsPage() {
  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <LegalNav />

      <main className="flex-1 w-full max-w-3xl mx-auto px-5 sm:px-8 py-12">
        <p className="text-white/30 text-xs uppercase tracking-widest mb-3">Legal</p>
        <h1 className="font-condensed font-bold text-4xl sm:text-5xl text-white tracking-wide mb-2">
          TERMS OF SERVICE
        </h1>
        <p className="text-white/40 text-sm mb-10">Last updated: April 20, 2026</p>

        <div className="prose-legal space-y-10">

          <Section title="1. Acceptance of Terms">
            <p>
              By accessing or using the National Wrench Index Suite&#8482; platform (the &ldquo;Service&rdquo;), you agree to
              be bound by these Terms of Service (&ldquo;Terms&rdquo;). If you do not agree to these Terms, do not access
              or use the Service. These Terms constitute a binding legal agreement between you (&ldquo;User&rdquo; or
              &ldquo;Subscriber&rdquo;) and National Wrench Index (&ldquo;Company,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;).
            </p>
            <p>
              We reserve the right to update these Terms at any time. Continued use of the Service after
              changes are posted constitutes your acceptance of the revised Terms.
            </p>
          </Section>

          <Section title="2. Description of Service">
            <p>
              National Wrench Index Suite&#8482; is a software-as-a-service (SaaS) platform designed for
              mobile automotive professionals. The Service includes tools for:
            </p>
            <ul>
              <li>Job scheduling and calendar management</li>
              <li>Customer relationship management (CRM)</li>
              <li>Invoicing and financial tracking</li>
              <li>Vehicle service history management</li>
              <li>AI-powered VIN-to-quote tools (National Wrench Index QuickWrench&#8482;)</li>
              <li>Public booking pages for customer self-scheduling</li>
              <li>Automated SMS and email notifications</li>
            </ul>
            <p>
              The Service is intended for use by licensed automotive professionals operating lawful
              businesses. Features and availability may vary by subscription tier.
            </p>
          </Section>

          <Section title="3. Subscription Plans and Billing">
            <p>
              The Service is offered under several subscription tiers, including Starter, Pro, Full Suite,
              QuickWrench, and Elite plans. Current pricing and plan details are available at{' '}
              <Link href="/pricing" className="text-orange hover:text-orange-light">
                nationalwrenchindex.com/pricing
              </Link>
              .
            </p>
            <p>
              All subscription fees are billed in advance on a monthly or annual basis via Stripe. By
              providing payment information, you authorize us to charge your payment method for the
              applicable subscription fee. Fees are non-refundable except as required by applicable law.
            </p>
            <p>
              We reserve the right to modify pricing with at least 30 days&apos; advance notice. Continued use
              of the Service after a price change takes effect constitutes acceptance of the new pricing.
            </p>
          </Section>

          <Section title="4. User Obligations">
            <p>By using the Service, you agree to:</p>
            <ul>
              <li>Provide accurate, current, and complete information during registration and use</li>
              <li>Maintain the security of your account credentials and notify us promptly of any unauthorized access</li>
              <li>Use the Service only for lawful purposes and in compliance with all applicable laws and regulations</li>
              <li>Not resell, sublicense, or otherwise provide access to the Service to third parties without written authorization</li>
              <li>Not attempt to reverse engineer, decompile, or otherwise extract the source code of the Service</li>
              <li>Not use the Service to store or transmit malicious code or to conduct any activity that interferes with the Service&apos;s operation</li>
              <li>Obtain all necessary consents before uploading customer personal data to the platform</li>
            </ul>
          </Section>

          <Section title="5. Account Termination">
            <p>
              Either party may terminate a subscription with at least 30 days&apos; written notice. You may
              cancel your subscription at any time through your account settings or by contacting us at{' '}
              <a href="mailto:edwardfleeman57@gmail.com" className="text-orange hover:text-orange-light">
                edwardfleeman57@gmail.com
              </a>
              .
            </p>
            <p>
              Upon cancellation, your account will remain active through the end of the current billing
              period. Following account closure, your data will be retained for 30 days, after which it
              will be permanently deleted. It is your responsibility to export any data you wish to retain
              before your account is closed.
            </p>
            <p>
              We reserve the right to suspend or terminate accounts that violate these Terms, engage in
              fraudulent activity, or pose a risk to other users or the platform, with or without prior notice.
            </p>
          </Section>

          <Section title="6. Intellectual Property">
            <p>
              <strong className="text-white">National Wrench Index&#8482;</strong>,{' '}
              <strong className="text-white">National Wrench Index Suite&#8482;</strong>, and{' '}
              <strong className="text-white">National Wrench Index QuickWrench&#8482;</strong> are
              trademarks of National Wrench Index. All rights reserved. Unauthorized use of these marks
              is strictly prohibited.
            </p>
            <p>
              The Service, including all software, designs, text, graphics, and other content, is owned
              by National Wrench Index and is protected by applicable intellectual property laws. You are
              granted a limited, non-exclusive, non-transferable license to use the Service solely for
              your internal business purposes during your subscription term.
            </p>
            <p>
              You retain ownership of all data you input into the Service, including customer records,
              job history, and business information. You grant us a limited license to process and store
              that data solely to provide the Service.
            </p>
          </Section>

          <Section title="7. Limitation of Liability">
            <p>
              THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; WITHOUT WARRANTIES OF ANY KIND,
              EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY,
              FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT.
            </p>
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, NATIONAL WRENCH INDEX SHALL NOT BE LIABLE FOR
              ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING OUT OF OR
              RELATED TO YOUR USE OF THE SERVICE, EVEN IF WE HAVE BEEN ADVISED OF THE POSSIBILITY OF
              SUCH DAMAGES.
            </p>
            <p>
              <strong className="text-white">
                Users are solely responsible for verifying all AI-generated repair specifications,
                torque values, part numbers, and technical recommendations produced by the QuickWrench&#8482;
                feature or any other AI-assisted tools within the platform.
              </strong>{' '}
              AI-generated content is provided for informational purposes only and does not constitute
              professional mechanical advice. Always consult manufacturer specifications and exercise
              independent professional judgment before performing any vehicle repair.
            </p>
            <p>
              Our total liability for any claims arising under these Terms shall not exceed the amount
              you paid for the Service in the three months preceding the claim.
            </p>
          </Section>

          <Section title="8. SMS Messaging Consent">
            <p>
              By subscribing to the Service, you consent to receive transactional SMS messages related
              to your account, including booking confirmations, appointment reminders, and service
              notifications.
            </p>
            <p>
              Customers of Subscribers who complete a booking through a Subscriber&apos;s public booking
              page consent to receive SMS notifications related to their appointment at the time of
              booking. All SMS messages sent through the Service include instructions to reply{' '}
              <strong className="text-white">STOP</strong> to opt out of further messages. Standard
              message and data rates may apply.
            </p>
            <p>
              Phone numbers collected through the Service are used solely for transactional
              communications. We do not use customer phone numbers for marketing purposes without
              explicit opt-in consent. See our{' '}
              <Link href="/privacy" className="text-orange hover:text-orange-light">
                Privacy Policy
              </Link>{' '}
              for full details.
            </p>
          </Section>

          <Section title="9. Governing Law">
            <p>
              These Terms shall be governed by and construed in accordance with the laws of the State
              of North Carolina, United States of America, without regard to its conflict of law
              provisions. Any disputes arising under these Terms shall be subject to the exclusive
              jurisdiction of the courts located in North Carolina.
            </p>
          </Section>

          <Section title="10. Contact">
            <p>
              If you have questions about these Terms, please contact us at:{' '}
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
