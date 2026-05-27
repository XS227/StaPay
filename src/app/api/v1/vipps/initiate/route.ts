import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type InitiateBody = {
  productId: string;
  tenantId: string;
};

type VippsTokenResponse = {
  access_token: string;
  expires_in: number;
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
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.token;
  }

  try {
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
  } catch (error) {
    console.error("[Vipps] token fetch failed", error);
    throw error;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<InitiateBody>;

    if (!body.productId || !body.tenantId) {
      return NextResponse.json({ error: "productId and tenantId are required" }, { status: 400 });
    }

    const [tenant, product] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: body.tenantId } }),
      prisma.product.findFirst({ where: { id: body.productId, tenantId: body.tenantId } }),
    ]);

    if (!tenant || !product) {
      return NextResponse.json({ error: "Tenant or product not found" }, { status: 404 });
    }

    const accessToken = await fetchAccessToken(tenant);
    const vippsOrderId = `stapay-${randomUUID()}`;

    await prisma.order.create({
      data: {
        tenantId: tenant.id,
        vippsOrderId,
        totalAmount: product.price,
        status: "PENDING",
      },
    });

    const webhookUrl = new URL("/api/v1/vipps/webhook", req.url).toString();
    const returnUrl = new URL(`/t/${tenant.slug}?paid=1`, req.url).toString();

    const paymentPayload = {
      amount: { currency: "NOK", value: product.price },
      paymentMethod: { type: "WALLET" },
      customer: {},
      reference: vippsOrderId,
      returnUrl,
      callbackUrl: webhookUrl,
      userFlow: "WEB_REDIRECT",
      paymentDescription: `${tenant.companyName} - ${product.title}`,
    };

    try {
      const vippsResponse = await fetch(`${VIPPS_BASE_URL}/epayment/v1/payments`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Ocp-Apim-Subscription-Key": tenant.vippsSubKey ?? "",
          "Idempotency-Key": vippsOrderId,
          "Merchant-Serial-Number": process.env.VIPPS_MSN ?? "",
        },
        body: JSON.stringify(paymentPayload),
        cache: "no-store",
      });

      const responsePayload = await vippsResponse.json();
      if (!vippsResponse.ok) {
        await prisma.order.update({ where: { vippsOrderId }, data: { status: "FAILED" } });
        return NextResponse.json(
          { error: "Failed to initiate Vipps payment", details: responsePayload },
          { status: vippsResponse.status },
        );
      }

      return NextResponse.json({ vippsOrderId, redirectUrl: responsePayload.redirectUrl ?? null });
    } catch (error) {
      console.error("[Vipps] initiate payment failed", error);
      await prisma.order.update({ where: { vippsOrderId }, data: { status: "FAILED" } });
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
