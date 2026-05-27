import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const VIPPS_BASE_URL = process.env.VIPPS_BASE_URL ?? "https://apitest.vipps.no";

type VippsTokenExchangeResponse = {
  access_token: string;
};

type VippsProfile = {
  sub?: string;
  email?: string;
  phone_number?: string;
  name?: string;
};

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const tenantId = url.searchParams.get("state");

    if (!code || !tenantId) return NextResponse.json({ error: "Missing OAuth code or state" }, { status: 400 });

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    if (!tenant.enableLoyalty) return NextResponse.json({ error: "Loyalty feature is disabled" }, { status: 403 });
    if (!tenant.vippsClientId || !tenant.vippsClientSecret || !tenant.vippsSubKey) {
      return NextResponse.json({ error: "Vipps credentials are not configured" }, { status: 400 });
    }

    const tokenRes = await fetch(`${VIPPS_BASE_URL}/access-management-1.0/access/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${tenant.vippsClientId}:${tenant.vippsClientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Ocp-Apim-Subscription-Key": tenant.vippsSubKey,
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code }).toString(),
      cache: "no-store",
    });

    if (!tokenRes.ok) {
      const details = await tokenRes.text();
      return NextResponse.json({ error: "Token exchange failed", details }, { status: tokenRes.status });
    }

    const tokenData = (await tokenRes.json()) as VippsTokenExchangeResponse;
    const profileRes = await fetch(`${VIPPS_BASE_URL}/vipps-userinfo-api/userinfo/`, {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Ocp-Apim-Subscription-Key": tenant.vippsSubKey,
      },
      cache: "no-store",
    });

    if (!profileRes.ok) {
      const details = await profileRes.text();
      return NextResponse.json({ error: "Failed to fetch user profile", details }, { status: profileRes.status });
    }

    const profile = (await profileRes.json()) as VippsProfile;
    if (!profile.sub) return NextResponse.json({ error: "Vipps profile missing subject" }, { status: 400 });

    const customer = await prisma.customer.upsert({
      where: { vippsSub: profile.sub },
      update: {
        email: profile.email ?? "",
        phone: profile.phone_number ?? "",
        name: profile.name ?? "",
        loyaltyPoints: { increment: 10 },
      },
      create: {
        tenantId: tenant.id,
        vippsSub: profile.sub,
        email: profile.email ?? "",
        phone: profile.phone_number ?? "",
        name: profile.name ?? "",
        loyaltyPoints: 10,
      },
    });

    return NextResponse.json({ ok: true, customerId: customer.id, loyaltyPoints: customer.loyaltyPoints });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
