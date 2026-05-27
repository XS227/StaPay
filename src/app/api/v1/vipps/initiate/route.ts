import { NextRequest, NextResponse } from "next/server";

type VippsAuthResponse = {
  access_token: string;
  expires_in: number;
  token_type: "Bearer";
};

type InitiateRequestBody = {
  tenantId: string;
  orderId: string;
  amount: number;
  returnUrl: string;
  callbackUrl?: string;
  phoneNumber?: string;
  reference?: string;
};

type TenantVippsConfig = {
  clientId: string;
  clientSecret: string;
  subscriptionKey: string;
  merchantSerialNumber: string;
};

type CachedToken = {
  token: string;
  expiresAt: number;
};

const tokenCache = new Map<string, CachedToken>();

async function getTenantVippsConfig(tenantId: string): Promise<TenantVippsConfig> {
  void tenantId;
  const clientId = process.env.VIPPS_CLIENT_ID;
  const clientSecret = process.env.VIPPS_CLIENT_SECRET;
  const subscriptionKey = process.env.VIPPS_SUBSCRIPTION_KEY;
  const merchantSerialNumber = process.env.VIPPS_MSN;

  if (!clientId || !clientSecret || !subscriptionKey || !merchantSerialNumber) {
    throw new Error("Missing Vipps environment variables or tenant credential provider");
  }

  return { clientId, clientSecret, subscriptionKey, merchantSerialNumber };
}

async function getVippsAccessToken(config: TenantVippsConfig): Promise<string> {
  const cacheKey = `${config.clientId}:${config.subscriptionKey}`;
  const cached = tokenCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.token;
  }

  const authResponse = await fetch("https://apitest.vipps.no/accesstoken/get", {
    method: "POST",
    headers: {
      "client_id": config.clientId,
      "client_secret": config.clientSecret,
      "Ocp-Apim-Subscription-Key": config.subscriptionKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });

  if (!authResponse.ok) {
    const details = await authResponse.text();
    throw new Error(`Vipps auth failed (${authResponse.status}): ${details}`);
  }

  const authPayload = (await authResponse.json()) as VippsAuthResponse;
  const expiresAt = Date.now() + authPayload.expires_in * 1000;
  tokenCache.set(cacheKey, { token: authPayload.access_token, expiresAt });

  return authPayload.access_token;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as InitiateRequestBody;

    if (!body.tenantId || !body.orderId || !body.amount || !body.returnUrl) {
      return NextResponse.json({ error: "tenantId, orderId, amount, and returnUrl are required" }, { status: 400 });
    }

    const vippsConfig = await getTenantVippsConfig(body.tenantId);
    const accessToken = await getVippsAccessToken(vippsConfig);

    const paymentReference = body.reference ?? body.orderId;

    const vippsRequest = {
      amount: {
        currency: "NOK",
        value: Math.round(body.amount * 100),
      },
      paymentMethod: {
        type: "WALLET",
      },
      reference: paymentReference,
      returnUrl: body.returnUrl,
      userFlow: "WEB_REDIRECT",
      paymentDescription: `Stapay order ${body.orderId}`,
      customer: body.phoneNumber ? { phoneNumber: body.phoneNumber } : undefined,
      callbackUrl: body.callbackUrl,
    };

    const vippsResponse = await fetch("https://apitest.vipps.no/epayment/v1/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": vippsConfig.subscriptionKey,
        "Merchant-Serial-Number": vippsConfig.merchantSerialNumber,
        "Idempotency-Key": `${body.tenantId}-${paymentReference}`,
      },
      body: JSON.stringify(vippsRequest),
      cache: "no-store",
    });

    const payload = await vippsResponse.json();

    if (!vippsResponse.ok) {
      return NextResponse.json(
        {
          error: "Failed to initiate Vipps payment",
          details: payload,
        },
        { status: vippsResponse.status },
      );
    }

    return NextResponse.json({
      orderId: body.orderId,
      vippsReference: paymentReference,
      redirectUrl: payload?.redirectUrl ?? null,
      raw: payload,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
