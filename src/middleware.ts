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

  // ── Supabase auth session refresh ─────────────────────────────────────────
  // Must run on every request to keep the session alive.
  let supabaseResponse = targetUrl
    ? NextResponse.rewrite(targetUrl)
    : NextResponse.next({ request })

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
          supabaseResponse = targetUrl
            ? NextResponse.rewrite(targetUrl)
            : NextResponse.next({ request })
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

  const isHDProtected =
    effectivePath.startsWith('/hd/') && !isHDAuthRoute

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

  const isProtected = isHDProtected || isLegacyProtected
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
    '/((?!_next/static|_next/image|favicon.ico|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
