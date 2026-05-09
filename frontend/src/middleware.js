import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';

export function middleware(request) {
  const { pathname } = request.nextUrl;

  // Protect all /api routes
  if (pathname.startsWith('/api')) {
    // Exclude health check
    if (pathname === '/api/health' || pathname === '/api') {
      return NextResponse.next();
    }

    // Exclude Telegram webhook POST (Telegram needs to deliver updates)
    // Note: The webhook handler itself should verify the token if possible,
    // or we could check a secret in the path if we used one.
    if (pathname === '/api/telegram/webhook' && request.method === 'POST') {
      return NextResponse.next();
    }

    // Enforce authentication
    const authResponse = requireAuth(request);
    if (authResponse) {
      return authResponse;
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
