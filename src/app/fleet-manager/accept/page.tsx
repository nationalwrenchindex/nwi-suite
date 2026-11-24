// /fleet-manager/accept?token_hash=...&type=invite - where the invitation email lands.
//
// One button, posting to /api/fleet-manager/accept. Rendering this page spends
// nothing: mail scanners that open every link before the person does would otherwise
// use up the one-time token, and the real click would find a dead link.

export const dynamic = 'force-dynamic'

export default async function FleetManagerAccept({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string }> }) {
  const { token_hash, type } = await searchParams
  return (
    <main className="pt-8">
      <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#C2410C' }}>Fleet service history</p>
      <h1 className="mt-1 mb-3 text-2xl font-bold" style={{ color: '#111827' }}>Your fleet&apos;s units and service records</h1>
      {!token_hash ? (
        <p className="text-sm" style={{ color: '#991B1B' }}>This link is missing its code. Open it straight from the email, or ask your service shop to send a new invitation.</p>
      ) : (
        <form method="post" action="/api/fleet-manager/accept">
          <p className="mb-5 text-sm leading-relaxed" style={{ color: '#374151' }}>
            Your service shop has given you access to your fleet&apos;s units, their repair history and the invoices already sent to you.
            Continue to set your password.
          </p>
          <input type="hidden" name="token_hash" value={token_hash} />
          <input type="hidden" name="type" value={type === 'magiclink' ? 'magiclink' : 'invite'} />
          <button type="submit" className="w-full rounded-lg py-3 text-base font-bold text-white" style={{ background: '#C2410C' }}>Continue</button>
        </form>
      )}
    </main>
  )
}
