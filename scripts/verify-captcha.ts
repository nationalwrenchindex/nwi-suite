// Part 6 verification: CAPTCHA wiring.
//
// A SOURCE-LEVEL TEST, on purpose. The failure mode here is not a wrong value, it
// is a MISSED CALL SITE — and a missed call site means that auth path stops working
// entirely the moment the Supabase dashboard toggle is flipped. So this enumerates
// every method CAPTCHA covers, finds every call to it in the repo, and fails if any
// one of them does not pass a token and reset afterwards.
//
// No database access. Nothing is enabled anywhere.
//
//   npx tsx scripts/verify-captcha.ts

import fs from 'fs'
import path from 'path'

let pass = 0, fail = 0
function ok(cond: boolean, msg: string) {
  if (cond) pass++; else fail++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`)
}
const hr = (t: string) => { console.log('\n' + '='.repeat(78)); console.log(t); console.log('='.repeat(78)) }

/** Every supabase.auth method Supabase's CAPTCHA protection applies to. */
const COVERED = [
  'signUp',
  'signInWithPassword',
  'signInWithOtp',
  'resetPasswordForEmail',
  'resend',
] as const

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out) }
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}

async function main() {
  const files = walk('src')

  hr('1. EVERY CALL SITE CAPTCHA COVERS — the list, before anything else')
  const sites: { file: string; line: number; method: string; src: string }[] = []

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      for (const m of COVERED) {
        // auth.<method>( — and not a comment line.
        if (new RegExp(`auth\\s*\\.\\s*${m}\\s*\\(`).test(lines[i]) && !/^\s*(\/\/|\*)/.test(lines[i])) {
          sites.push({ file, line: i + 1, method: m, src: text })
        }
      }
    }
  }

  for (const s of sites) {
    console.log(`  ${s.method.padEnd(22)} ${s.file}:${s.line}`)
  }
  console.log(`\n  total call sites: ${sites.length}`)
  ok(sites.length >= 5, `at least the five known call sites were found (${sites.length}) — guards a scan that matched nothing`)

  // THE LIST, pinned. If a sixth appears, this fails and the report has to be updated
  // rather than a new auth path silently shipping without a token.
  const EXPECTED = new Set([
    'src/app/(auth)/login/page.tsx|signInWithPassword',
    'src/app/(auth)/reset-password/page.tsx|resetPasswordForEmail',
    'src/app/(auth)/signup/SignupClient.tsx|signUp',
    'src/app/hd/login/page.tsx|signInWithPassword',
    'src/app/hd/signup/page.tsx|signUp',
  ])
  const found = new Set(sites.map(s => `${s.file.replace(/\\/g, '/')}|${s.method}`))
  for (const e of EXPECTED) {
    ok(found.has(e), `known call site present: ${e}`)
  }
  const extra = [...found].filter(f => !EXPECTED.has(f))
  ok(extra.length === 0,
    extra.length === 0
      ? 'no UNEXPECTED call site — nothing new has appeared that would be locked out'
      : `UNEXPECTED call sites found, these are not wired: ${extra.join(', ')}`)

  hr('2. EVERY ONE OF THEM PASSES A TOKEN AND RESETS')
  for (const s of sites) {
    const rel = s.file.replace(/\\/g, '/')
    const text = s.src
    // The call and its options object, generously windowed.
    const lines = text.split('\n')
    const chunk = lines.slice(Math.max(0, s.line - 3), s.line + 20).join('\n')

    ok(/captchaToken/.test(chunk), `${rel}:${s.line} passes captchaToken into the call`)
    // The reset can be a few lines after the await, so the whole function is checked.
    ok(/captcha\.reset\(\)/.test(text), `${rel} calls captcha.reset() — tokens are single-use`)
    ok(/useCaptcha\(\)/.test(text), `${rel} uses the shared useCaptcha hook rather than its own widget`)
    ok(/captcha\.field/.test(text), `${rel} renders the widget`)
  }

  hr('3. THE WIDGET IS REACHABLE ON EVERY FORM THAT SUBMITS')
  // The LD signup is two-step and step 1 can submit DIRECTLY when a plan is
  // preselected, so the widget has to exist on both forms or that path has no token.
  const signup = fs.readFileSync('src/app/(auth)/signup/SignupClient.tsx', 'utf8')
  const fieldCount = (signup.match(/captcha\.field/g) ?? []).length
  console.log(`  LD signup renders captcha.field ${fieldCount} time(s)`)
  ok(fieldCount >= 2,
    'the LD signup renders it on BOTH steps — step 1 submits directly when a plan is preselected, and would otherwise send no token')
  ok(/preselected\) && !needsModules && captcha\.field/.test(signup) || /!needsModules && captcha\.field/.test(signup),
    'and the step-1 widget is gated to exactly that case, so it does not appear twice at once')

  hr('4. NO SITE KEY MUST MEAN EVERY FORM STILL WORKS')
  const comp = fs.readFileSync('src/components/auth/CaptchaField.tsx', 'utf8')
  ok(/NEXT_PUBLIC_TURNSTILE_SITE_KEY/.test(comp), 'the site key comes from NEXT_PUBLIC_TURNSTILE_SITE_KEY')
  ok(/captchaEnabled\s*=\s*Boolean\(TURNSTILE_SITE_KEY\)/.test(comp), 'captchaEnabled is derived from it')
  ok(/captchaEnabled \? \(/.test(comp), 'the widget renders ONLY when a key is set')
  ok(/pending: captchaEnabled && !token/.test(comp),
    'pending is ALWAYS false with no key — so no submit button is ever disabled by a widget that is not on the page')
  ok(/onExpire/.test(comp) && /onError/.test(comp),
    'an expired or errored token is cleared rather than sent')
  ok(/try \{ ref\.current\?\.reset\(\) \} catch/.test(comp),
    'reset is guarded — the widget may already be unmounted on a redirect, and that must not surface as a login failure')

  // The env var genuinely absent right now is the deployable state.
  const envLocal = fs.existsSync('.env.local') ? fs.readFileSync('.env.local', 'utf8') : ''
  const keySet = /NEXT_PUBLIC_TURNSTILE_SITE_KEY\s*=\s*\S/.test(envLocal)
  console.log(`\n  NEXT_PUBLIC_TURNSTILE_SITE_KEY in .env.local: ${keySet ? 'SET' : 'NOT SET'}`)
  ok(!keySet,
    'it is NOT set, so this ships as a no-op: the code is live, no widget renders, and flipping the dashboard toggle is still a separate deliberate step')

  hr('5. THE PACKAGE')
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { dependencies?: Record<string, string> }
  ok(Boolean(pkg.dependencies?.['@marsidev/react-turnstile']),
    `@marsidev/react-turnstile is a dependency (${pkg.dependencies?.['@marsidev/react-turnstile'] ?? 'absent'})`)

  hr('6. WHAT IS NOT IN THIS REPOSITORY')
  const garageDirs = ['src/app/garage', 'src/app/nwi-garage'].filter(d => fs.existsSync(d))
  console.log(`  nwi-garage app directories found: ${garageDirs.length ? garageDirs.join(', ') : 'NONE'}`)
  ok(garageDirs.length === 0,
    'nwi-garage is NOT in this repo — it shares the Supabase project, so it must be wired in its own codebase BEFORE the toggle is flipped or its users are locked out')
  ok(!fs.existsSync('src/app/fleet-pro/login'),
    'Fleet Pro has no login of its own — it redirects to /login, which is wired')
  const admin = fs.readFileSync('src/app/admin/page.tsx', 'utf8')
  ok(!/auth\.(signUp|signInWithPassword|signInWithOtp)/.test(admin),
    'the admin dashboard has no auth of its own either — it is gated by getUser() behind /login')

  hr('7. UNVERIFIED ACCOUNTS AND THE SIGNUP ALERT')
  ok(/listUsers/.test(admin), 'the admin page reads auth users to find out who is verified')
  ok(/perPage: 200/.test(admin) && /page <= 40/.test(admin),
    'and PAGES that call — listUsers defaults to 50, so a 51st subscriber would otherwise read as unverified')
  ok(/unverifiedKnown/.test(admin),
    'a failure to read it shows EVERY profile rather than branding real customers unverified')
  ok(/UNVERIFIED \(/.test(admin),
    'unverified accounts are split into their own labelled section, not deleted and not silently hidden')

  const callback = fs.readFileSync('src/app/auth/callback/route.ts', 'utf8')
  ok(/sendFounderAlert/.test(callback),
    'the signup alert uses sendFounderAlert — the path that already exists in lib/email-alerts.ts')
  // It must not CALL sendNewSubscriberAlert. Mentioning it in a comment explaining
  // why is fine and desirable, so comment lines are stripped before testing — the
  // same rule the internal_notes leak test uses.
  const callbackCode = callback
    .split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')
  ok(!/sendNewSubscriberAlert\s*\(/.test(callbackCode) && !/import[^\n]*sendNewSubscriberAlert/.test(callbackCode),
    'and does NOT call sendNewSubscriberAlert, which is the paying-customer alert from the Stripe webhook — a signup is not a sale')
  ok(/sendFounderAlert\s*\(/.test(callbackCode), 'sendFounderAlert is actually CALLED, not just imported')
  ok(/isFirstConfirmation/.test(callback),
    'it fires only on the FIRST confirmation, so password resets and later magic links do not re-alert')
  ok(/\.catch\(/.test(callback),
    'and it is best-effort: a mail failure never blocks someone getting into the app')

  hr(`${pass} passed, ${fail} failed`)
  if (fail) process.exitCode = 1
}

main().catch(e => { console.error('FAILED:', e.message); process.exitCode = 1 })
