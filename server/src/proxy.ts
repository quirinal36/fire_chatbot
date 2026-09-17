import { NextResponse, type NextRequest } from 'next/server';
import { allowedOrigins } from './lib/env';
import { corsHeaders } from './lib/cors';

export function proxy(req: NextRequest): NextResponse {
  const origin = req.headers.get('origin');
  const headers = corsHeaders(origin, allowedOrigins());
  const id = req.headers.get('x-request-id') ?? crypto.randomUUID();
  headers.set('X-Request-Id', id);

  if (req.method === 'OPTIONS') return new NextResponse(null, { status: 204, headers });

  const forwarded = new Headers(req.headers);
  forwarded.set('x-request-id', id);
  const res = NextResponse.next({ request: { headers: forwarded } });
  headers.forEach((value, key) => res.headers.set(key, value));
  return res;
}

export const config = { matcher: '/api/:path*' };
