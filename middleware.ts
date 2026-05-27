import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const RESERVED_HOSTS = new Set(["localhost", "127.0.0.1", "stapay.no", "www.stapay.no"]);
const RESERVED_PATH_PREFIXES = ["/api", "/_next", "/favicon.ico", "/robots.txt", "/sitemap.xml"];

function normalizeHostname(hostHeader: string): string {
  return hostHeader.split(":")[0].toLowerCase();
}

function resolveTenantSlug(hostname: string): string | null {
  if (RESERVED_HOSTS.has(hostname)) return null;

  if (hostname.endsWith(".localhost")) {
    return hostname.replace(/\.localhost$/, "");
  }

  const parts = hostname.split(".");
  if (parts.length >= 3 && parts.at(-2) === "stapay" && parts.at(-1) === "no") {
    return parts[0];
  }

  return hostname;
}

function isReservedPath(pathname: string): boolean {
  return RESERVED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isReservedPath(pathname)) {
    return NextResponse.next();
  }

  const hostHeader = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!hostHeader) {
    return NextResponse.next();
  }

  const hostname = normalizeHostname(hostHeader);
  const tenant = resolveTenantSlug(hostname);

  if (!tenant) {
    return NextResponse.next();
  }

  const rewriteUrl = request.nextUrl.clone();
  rewriteUrl.pathname = `/t/${tenant}${pathname}`;
  rewriteUrl.search = search;

  return NextResponse.rewrite(rewriteUrl);
}

export const config = {
  matcher: ["/((?!.*\\..*).*)"],
};
