import { NextRequest, NextResponse } from "next/server";

export const config = {
  matcher: ["/((?!api/|_next/|_static|_images|favicon.ico|api/v1/vipps/webhook).*)"],
};

export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const hostname = (req.headers.get("host") || "").split(":")[0].toLowerCase();

  const allowedOrigins = ["stapay.no", "localhost"];
  const isBaseHost = allowedOrigins.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );

  let slug = "";

  if (!isBaseHost) {
    slug = hostname;
  } else {
    const parts = hostname.split(".");
    if (parts.length > 2 && parts[0] !== "www") {
      slug = parts[0];
    }
  }

  if (slug) {
    return NextResponse.rewrite(new URL(`/t/${slug}${url.pathname}`, req.url));
  }

  return NextResponse.next();
}
