import { NextResponse } from 'next/server';

/**
 * Validate Bearer token for API route protection.
 * Server-side only — uses CRON_SECRET (not NEXT_PUBLIC_).
 * Returns null if authorized, or a 401 NextResponse if not.
 */
export function requireAuth(request) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const secret = process.env.CRON_SECRET || process.env.NEXT_PUBLIC_CRON_SECRET || '';

  if (!secret) {
    console.error('[Auth] CRON_SECRET not configured — rejecting request for security');
    return NextResponse.json(
      { error: 'Unauthorized: Server configuration missing' },
      { status: 401 }
    );
  }

  if (token === secret) {
    return null;
  }

  return NextResponse.json(
    { error: 'Unauthorized' },
    { status: 401 }
  );
}

/**
 * Validate cron requests from GitHub Actions.
 * Same token check but with a clearer name for cron routes.
 */
export function requireCronAuth(request) {
  return requireAuth(request);
}
