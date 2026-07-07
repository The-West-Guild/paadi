import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(_request: NextRequest) {
  // Since session tokens are stored in localStorage, the server cannot
  // inspect them during SSR middleware execution.
  //
  // Route guarding is handled client-side in the layout components
  // (e.g. apps/web/src/app/(main)/layout.tsx) using the useSessionStore hook.
  //
  // If you later migrate session tokens to HttpOnly cookies, you can
  // implement server-side redirects here:
  //
  // const token = request.cookies.get("paadi:token");
  // if (!token && request.nextUrl.pathname.startsWith("/home")) {
  //   return NextResponse.redirect(new URL("/welcome", request.url));
  // }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - icon.svg (app icon)
     * - manifest.webmanifest (PWA manifest)
     */
    "/((?!api|_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest).*)",
  ],
};
