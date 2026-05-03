import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ message: 'SEOS API is active', status: 'ok' });
}
