import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { isReeferPath, REEFER_SURFACE_COOKIE } from '@/lib/reefer-standalone'

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') ?? ''
  const isHD = hostname.startsWith('hd.')
  const path = request.nextUrl.pathname

  // ── Determine effective path (rewrite /hd prefix for HD subdomain) ──────────
  let targetUrl: URL | null = null
  if (isHD && !path.startsWith('/hd') && !path.startsWith('/_next') && !path.startsWith('/api')) {
    targetUrl = request.nextUrl.clone()
    targetUrl.pathname = `/hd${path === '/' ? '/dashboard' : path}`
  }

  const effectivePath = targetUrl?.pathname ?? path

  // ── Reefer Standalone surface (/reefer) ────────────────────────────────────
  // Main host only: on the hd. subdomain /reefer already means /hd/reefer (the HD
  // Reefer Module) through the rewrite above, and that must not change.
  //
  // /reefer/X renders the same page as /hd/X (src/app/reefer re-exports them). While a
  // browser is on it, the nwi_surface cookie is set, and an /hd link followed from
  // inside a reused HD screen comes back to /reefer/X - or to the reefer dashboard when
  // X is not a reefer screen (DOT, aerial, truck ...). Customer-facing pages
  // (/hd/quote/<token>, /hd/invoices/pay) and the bare /hd marketing page are never
  // redirected, and nothing here runs for a browser without the cookie - an HD
  // subscriber's requests take exactly the path they took before.
  // ?leave_reefer=1 on an /hd URL clears the cookie (the reefer layout sends a non-reefer
  // account there), so a browser can always get back out.
  const isReeferSurface = !isHD && (path === '/reefer' || path.startsWith('/reefer/'))
  if (isReeferSurface) {
    const suffix = path.slice('/reefer'.length)
    if (!isReeferPath(suffix)) {
      const to = request.nextUrl.clone()
      to.pathname = '/reefer/dashboard'
      to.search = ''
      return NextResponse.redirect(to)
    }
  } else if (
    !isHD &&
    path.startsWith('/hd/') &&
    request.cookies.get(REEFER_SURFACE_COOKIE)?.value === 'reefer' &&
    !path.startsWith('/hd/quote/') &&
    !path.startsWith('/hd/invoices/pay')
  ) {
    if (request.nextUrl.searchParams.get('leave_reefer') === '1') {
      const to = request.nextUrl.clone()
      to.searchParams.delete('leave_reefer')
      const res = NextResponse.redirect(to)
      res.cookies.delete(REEFER_SURFACE_COOKIE)
      return res
    }
    const suffix = path.slice('/hd'.length)
    const to = request.nextUrl.clone()
    to.pathname = isReeferPath(suffix) ? '/reefer' + suffix : '/reefer/dashboard'
    if (!isReeferPath(suffix)) to.search = ''
    return NextResponse.redirect(to)
  }

  // x-pathname has to travel on the REQUEST, not the response. Setting it on the
  // response (as this did) sends it to the browser, where nothing reads it, while
  // `headers()` inside a server layout sees nothing — so every layout branching on
  // it silently took the wrong path. That is why hd/layout.tsx never actually
  // exempted /hd/signup and /hd/login from its subscription gate.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-pathname', effectivePath)
  // The reefer layout gates before the dashboard page can provision from a fresh Stripe
  // session, so it is handed the session id to provision first (src/app/reefer/layout.tsx).
  requestHeaders.delete('x-reefer-checkout-session')
  const reeferCheckoutSession = isReeferSurface ? request.nextUrl.searchParams.get('session_id') : null
  if (reeferCheckoutSession) requestHeaders.set('x-reefer-checkout-session', reeferCheckoutSession)

  const buildResponse = () =>
    targetUrl
      ? NextResponse.rewrite(targetUrl, { request: { headers: requestHeaders } })
      : NextResponse.next({ request: { headers: requestHeaders } })

  // ── Supabase auth session refresh ─────────────────────────────────────────
  // Must run on every request to keep the session alive.
  let supabaseResponse = buildResponse()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = buildResponse()
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // IMPORTANT: do not add any logic between createServerClient and getUser()
  const { data: { user } } = await supabase.auth.getUser()

  // ── Route guards ──────────────────────────────────────────────────────────
  const isHDAuthRoute =
    effectivePath.startsWith('/hd/signup') ||
    effectivePath.startsWith('/hd/login')

  // The customer paying an invoice, or approving a quote, has no account. Kept
  // separate from isHDAuthRoute on purpose: that set also bounces a SIGNED-IN visitor
  // to /hd/dashboard, which would stop a subscriber opening their own link to check it.
  //
  // /hd/quote/<token> WAS MISSING HERE, and that made the whole customer approval path
  // unreachable. The page itself renders bare and the /hd layout already carves it out,
  // but the middleware runs first and treated it as protected - so every customer who
  // tapped the link in their text landed on a login page for software they have never
  // heard of. Proved by driving the suite against a local build: flow N reported
  // "the approval page renders without a login -- 200 at /login".
  //
  // Production could not have caught it. The token-issuing code is not promoted there,
  // so the suite never got as far as fetching the page.
  const isHDPublicRoute =
    effectivePath.startsWith('/hd/invoices/pay') ||
    effectivePath.startsWith('/hd/quote/')

  const isHDProtected =
    effectivePath.startsWith('/hd/') && !isHDAuthRoute && !isHDPublicRoute

  // /reefer/login is an auth route. /reefer/signup is NOT treated as one: a signed-in
  // reefer account with no subscription yet (closed Stripe, came back) must be able to
  // reach it to finish checkout, and the layout - not this - decides who belongs.
  const isReeferAuthRoute   = isReeferSurface && effectivePath.startsWith('/reefer/login')
  const isReeferSignupRoute = isReeferSurface && effectivePath.startsWith('/reefer/signup')
  const isReeferProtected   = isReeferSurface && !isReeferAuthRoute && !isReeferSignupRoute

  const isLegacyAuthRoute =
    effectivePath.startsWith('/login') ||
    effectivePath.startsWith('/signup') ||
    effectivePath.startsWith('/reset-password') ||
    effectivePath.startsWith('/update-password')

  const isLegacyProtected =
    effectivePath.startsWith('/dashboard')  ||
    effectivePath.startsWith('/onboarding') ||
    effectivePath.startsWith('/scheduler')  ||
    effectivePath.startsWith('/intel')      ||
    effectivePath.startsWith('/financials') ||
    effectivePath.startsWith('/billing')    ||
    effectivePath.startsWith('/quickwrench')

  // Fleet Pro is a customer-facing portal, not part of the mechanic's app, but it
  // is still session-authed. /fleet-pro/accept-invite is excluded: an invited user
  // lands there from an email link before they have a session.
  const isFleetProProtected =
    effectivePath.startsWith('/fleet-pro') &&
    !effectivePath.startsWith('/fleet-pro/accept-invite')

  const isProtected = isHDProtected || isLegacyProtected || isFleetProProtected || isReeferProtected
  const isAuthRoute  = isHDAuthRoute || isLegacyAuthRoute || isReeferAuthRoute

  if (!user && isProtected) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = isHD ? '/hd/login' : isReeferSurface ? '/reefer/login' : '/login'
    loginUrl.searchParams.set('redirect', effectivePath)
    return NextResponse.redirect(loginUrl)
  }

  if (user && isAuthRoute && !effectivePath.startsWith('/update-password')) {
    const homeUrl = request.nextUrl.clone()
    homeUrl.pathname = isHD ? '/hd/dashboard' : isReeferSurface ? '/reefer/dashboard' : '/dashboard'
    return NextResponse.redirect(homeUrl)
  }

  supabaseResponse.headers.set('x-pathname', effectivePath)
  if (isReeferSurface) {
    supabaseResponse.cookies.set(REEFER_SURFACE_COOKIE, 'reefer', {
      path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 30,
    })
  }
  return supabaseResponse
}

export const config = {
  matcher: [
    // sw.js and the manifest are excluded deliberately: a service worker must be
    // served from the root scope untouched, and running auth middleware on it costs
    // a Supabase round-trip on every page load for a file that is always public.
    // /inspect is NOT excluded — it needs no session, but it is not a static asset
    // and is simply absent from the protected prefixes above.
    '/((?!_next/static|_next/image|favicon.ico|auth/callback|sw\\.js|manifest\\.webmanifest|site\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
