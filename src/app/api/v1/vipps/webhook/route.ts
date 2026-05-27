import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type VippsWebhookPayload = {
  reference?: string;
  state?: string;
  amount?: { value?: number };
};

const VIPPS_BASE_URL = process.env.VIPPS_BASE_URL ?? "https://apitest.vipps.no";

async function capturePayment(reference: string, tenant: { vippsSubKey: string | null }) {
  const accessToken = process.env.VIPPS_SERVER_TOKEN;
  const merchantSerialNumber = process.env.VIPPS_MSN;

  if (!accessToken || !tenant.vippsSubKey || !merchantSerialNumber) {
    throw new Error("Missing capture credentials");
  }

  try {
    const response = await fetch(`${VIPPS_BASE_URL}/epayment/v1/payments/${reference}/captures`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Merchant-Serial-Number": merchantSerialNumber,
        "Ocp-Apim-Subscription-Key": tenant.vippsSubKey,
        "Idempotency-Key": `capture-${reference}`,
      },
      body: JSON.stringify({
        modificationAmount: undefined,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Capture failed (${response.status}): ${details}`);
    }
  } catch (error) {
    console.error("[Vipps webhook] capture failed", error);
    throw error;
  }
}

export async function POST(req: NextRequest) {
  try {
    const signature = req.headers.get("x-ms-signature") ?? req.headers.get("authorization");
    if (!signature) {
      return NextResponse.json({ error: "Missing webhook signature" }, { status: 401 });
    }

    const body = (await req.json()) as VippsWebhookPayload;
    if (!body.reference || !body.state) {
      return NextResponse.json({ error: "Missing reference or state" }, { status: 400 });
    }

    const order = await prisma.order.findUnique({
      where: { vippsOrderId: body.reference },
      include: { tenant: true },
    });

    if (!order) {
      return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
    }

    if (body.state === "SUBMITTED" || body.state === "RESERVED") {
      await prisma.order.update({
        where: { vippsOrderId: body.reference },
        data: {
          status: "RESERVED",
          customerInfo: body,
        },
      });

      if (process.env.VIPPS_AUTO_CAPTURE === "true") {
        await capturePayment(body.reference, order.tenant);
        await prisma.order.update({
          where: { vippsOrderId: body.reference },
          data: { status: "CAPTURED" },
        });
      }
    }

    if (body.state === "FAILED") {
      await prisma.order.update({ where: { vippsOrderId: body.reference }, data: { status: "FAILED" } });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("[Vipps webhook] handler failed", error);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
