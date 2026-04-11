import { NextResponse } from 'next/server'

export function middleware(request) {
  if (request.nextUrl.pathname.startsWith('/~studio')) {
    if (process.env.NODE_ENV !== 'development') {
      return NextResponse.rewrite(new URL('/404', request.url))
    }
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/~studio/:path*'],
}
