import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getConfig } from "@/lib/config";
import { getAppMeta } from "@/lib/db";

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Never intercept API setup route or static assets
  if (
    pathname.startsWith("/api/setup") ||
    pathname.match(/\.(png|jpg|svg|css|js|woff|woff2)$/)
  ) {
    return NextResponse.next();
  }

  try {
    const config = getConfig();
    const meta = await Promise.resolve(getAppMeta(config));
    const setupComplete = meta.get("setup_complete");

    if (pathname === "/setup" || pathname.startsWith("/setup/")) {
      // D-09: /setup is only accessible when setup is NOT complete
      // If already set up, redirect to dashboard root
      if (setupComplete === "true") {
        return NextResponse.redirect(new URL("/", request.url));
      }
      return NextResponse.next();
    }

    // All other routes: require setup to be complete
    if (setupComplete !== "true") {
      return NextResponse.redirect(new URL("/setup", request.url));
    }

    return NextResponse.next();
  } catch (err) {
    console.warn("[proxy] setup check failed:", err);

    // Conservative: if DB is not ready and user is not on /setup, send them there
    if (pathname !== "/setup" && !pathname.startsWith("/setup/")) {
      return NextResponse.redirect(new URL("/setup", request.url));
    }
    return NextResponse.next();
  }
}

export const config = {
  matcher: [
    // Match all routes except _next internals, static files, and favicon
    "/((?!_next|static|favicon\\.ico).*)",
  ],
};
