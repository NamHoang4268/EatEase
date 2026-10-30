import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { loadServerEnvironment } from './config/environment';
import { createSignedApiProxyHeaders } from './server/api-proxy-signature';

export function proxy(request: NextRequest) {
  if (process.env.NODE_ENV !== 'production') return NextResponse.next();

  try {
    const environment = loadServerEnvironment();
    if (!environment.API_PROXY_SHARED_SECRET) throw new Error('Proxy secret is unavailable.');
    const headers = createSignedApiProxyHeaders({
      headers: request.headers,
      method: request.method,
      pathname: request.nextUrl.pathname,
      sharedSecret: environment.API_PROXY_SHARED_SECRET,
    });
    return NextResponse.next({ request: { headers } });
  } catch {
    return NextResponse.json(
      { error: { code: 'API_PROXY_UNAVAILABLE', message: 'API proxy is unavailable.' } },
      { status: 503 },
    );
  }
}

export const config = { matcher: '/api/:path*' };
