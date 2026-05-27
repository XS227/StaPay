"use client";

import { useState } from "react";

type Props = {
  productId: string;
  tenantId: string;
};

export function BuyButton({ productId, tenantId }: Props) {
  const [loading, setLoading] = useState(false);

  const onBuy = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/v1/vipps/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, tenantId }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.redirectUrl) {
        throw new Error(payload.error ?? "Unable to start payment");
      }
      window.location.href = payload.redirectUrl;
    } catch (error) {
      console.error(error);
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onBuy}
      disabled={loading}
      className="mt-5 w-full rounded-full bg-black px-6 py-3 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60"
    >
      {loading ? "Starter Vipps..." : "Kjøp med Vipps"}
    </button>
  );
}
