import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type InitiateRecurringBody = {
  productId: string;
  tenantId: string;
  vippsSub: string;
};

type VippsTokenResponse = {
  access_token: string;
  expires_in: number;
};

type VippsAgreementResponse = {
  id?: string;
  redirectUrl?: string;
};

type CachedToken = {
  token: string;
  expiresAt: number;
};

const tokenCache = new Map<string, CachedToken>();
const VIPPS_BASE_URL = process.env.VIPPS_BASE_URL ?? "https://apitest.vipps.no";

async function fetchAccessToken(tenant: {
  id: string;
  vippsClientId: string | null;
  vippsClientSecret: string | null;
  vippsSubKey: string | null;
}) {
  if (!tenant.vippsClientId || !tenant.vippsClientSecret || !tenant.vippsSubKey) {
    throw new Error("Tenant Vipps credentials are missing");
  }

  const cacheKey = `${tenant.id}:${tenant.vippsClientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;

  const response = await fetch(`${VIPPS_BASE_URL}/accesstoken/get`, {
    method: "POST",
    headers: {
      client_id: tenant.vippsClientId,
      client_secret: tenant.vippsClientSecret,
      "Ocp-Apim-Subscription-Key": tenant.vippsSubKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Vipps token request failed (${response.status}): ${details}`);
  }

  const data = (await response.json()) as VippsTokenResponse;
  tokenCache.set(cacheKey, {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });

  return data.access_token;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<InitiateRecurringBody>;
    if (!body.productId || !body.tenantId || !body.vippsSub) {
      return NextResponse.json({ error: "productId, tenantId and vippsSub are required" }, { status: 400 });
    }

    const [tenant, product] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: body.tenantId } }),
      prisma.product.findFirst({ where: { id: body.productId, tenantId: body.tenantId } }),
    ]);

    if (!tenant || !product) return NextResponse.json({ error: "Tenant or product not found" }, { status: 404 });
    if (!tenant.enableRecurring) return NextResponse.json({ error: "Recurring is disabled for this tenant" }, { status: 403 });
    if (product.type !== "SUBSCRIPTION") return NextResponse.json({ error: "Product is not a subscription" }, { status: 400 });

    const customer = await prisma.customer.upsert({
      where: { vippsSub: body.vippsSub },
      update: {},
      create: {
        tenantId: tenant.id,
        vippsSub: body.vippsSub,
        email: `${body.vippsSub}@vipps.local`,
        phone: "",
        name: "Vipps customer",
      },
    });

    const accessToken = await fetchAccessToken(tenant);
    const vippsAgreementId = `agr-${randomUUID()}`;
    const returnUrl = new URL(`/t/${tenant.slug}?subscription=1`, req.url).toString();

    const payload = {
      externalId: vippsAgreementId,
      customerPhoneNumber: customer.phone || undefined,
      customer: { partyId: body.vippsSub },
      interval: product.interval ?? "MONTH",
      currency: "NOK",
      price: product.price,
      productName: product.title,
      returnUrl,
    };

    const vippsResponse = await fetch(`${VIPPS_BASE_URL}/recurring/v3/agreements`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": tenant.vippsSubKey ?? "",
        "Idempotency-Key": vippsAgreementId,
        "Merchant-Serial-Number": process.env.VIPPS_MSN ?? "",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const data: VippsAgreementResponse = await vippsResponse.json();
    if (!vippsResponse.ok) {
      return NextResponse.json({ error: "Failed to initiate recurring agreement", details: data }, { status: vippsResponse.status });
    }

    await prisma.subscription.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        vippsAgreementId: data.id ?? vippsAgreementId,
        status: "PENDING",
      },
    });

    return NextResponse.json({ agreementId: data.id ?? vippsAgreementId, redirectUrl: data.redirectUrl ?? returnUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
