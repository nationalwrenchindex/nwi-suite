import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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

  // x-pathname has to travel on the REQUEST, not the response. Setting it on the
  // response (as this did) sends it to the browser, where nothing reads it, while
  // `headers()` inside a server layout sees nothing — so every layout branching on
  // it silently took the wrong path. That is why hd/layout.tsx never actually
  // exempted /hd/signup and /hd/login from its subscription gate.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-pathname', effectivePath)

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

  // The customer paying an invoice has no account. Kept separate from isHDAuthRoute
  // on purpose: that set also bounces a SIGNED-IN visitor to /hd/dashboard, which
  // would stop a subscriber opening their own payment link to check it.
  const isHDPublicRoute = effectivePath.startsWith('/hd/invoices/pay')

  const isHDProtected =
    effectivePath.startsWith('/hd/') && !isHDAuthRoute && !isHDPublicRoute

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

  const isProtected = isHDProtected || isLegacyProtected || isFleetProProtected
  const isAuthRoute  = isHDAuthRoute || isLegacyAuthRoute

  if (!user && isProtected) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = isHD ? '/hd/login' : '/login'
    loginUrl.searchParams.set('redirect', effectivePath)
    return NextResponse.redirect(loginUrl)
  }

  if (user && isAuthRoute && !effectivePath.startsWith('/update-password')) {
    const homeUrl = request.nextUrl.clone()
    homeUrl.pathname = isHD ? '/hd/dashboard' : '/dashboard'
    return NextResponse.redirect(homeUrl)
  }

  supabaseResponse.headers.set('x-pathname', effectivePath)
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
