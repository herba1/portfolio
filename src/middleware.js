import { NextResponse } from 'next/server'

export function middleware(request) {
  if (request.nextUrl.pathname.startsWith('/~studio')) {
    const host = request.headers.get('host') || ''
    const isLocalhost = host.startsWith('localhost') || host.startsWith('127.0.0.1')
    if (!isLocalhost) {
      return NextResponse.rewrite(new URL('/404', request.url))
    }
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/~studio/:path*'],
}
