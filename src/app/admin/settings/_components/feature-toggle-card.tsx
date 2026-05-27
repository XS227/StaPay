"use client";

import { useTransition } from "react";

type ToggleCardProps = {
  tenantId: string;
  tenantName: string;
  enableRecurring: boolean;
  enableCheckout: boolean;
  enableLoyalty: boolean;
  onToggle: (formData: FormData) => Promise<void>;
};

const features = [
  { key: "enableRecurring", label: "Recurring", description: "Enable Vipps recurring agreements and subscriptions." },
  { key: "enableCheckout", label: "Checkout", description: "Enable Vipps express checkout and shipping mutation support." },
  { key: "enableLoyalty", label: "Loyalty + Login", description: "Enable Vipps Login and loyalty point enrichment." },
] as const;

export function FeatureToggleCard(props: ToggleCardProps) {
  const [pending, startTransition] = useTransition();

  return (
    <article className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
      <div className="mb-6">
        <h2 className="text-xl font-semibold tracking-tight">{props.tenantName}</h2>
        <p className="text-sm text-zinc-500">Tenant ID: {props.tenantId}</p>
      </div>
      <ul className="space-y-3">
        {features.map((feature) => {
          const enabled = props[feature.key];
          return (
            <li key={feature.key} className="flex items-center justify-between rounded-2xl border border-zinc-200 p-4">
              <div>
                <p className="font-medium text-zinc-900">{feature.label}</p>
                <p className="text-sm text-zinc-500">{feature.description}</p>
              </div>
              <form
                action={(formData) => startTransition(() => props.onToggle(formData))}
                className="flex items-center gap-2"
              >
                <input type="hidden" name="tenantId" value={props.tenantId} />
                <input type="hidden" name="feature" value={feature.key} />
                <input type="hidden" name="nextValue" value={String(!enabled)} />
                <button
                  disabled={pending}
                  className={`h-8 w-14 rounded-full p-1 transition ${enabled ? "bg-emerald-500" : "bg-zinc-300"}`}
                  aria-label={`Toggle ${feature.label}`}
                  type="submit"
                >
                  <span className={`block h-6 w-6 rounded-full bg-white transition ${enabled ? "translate-x-6" : "translate-x-0"}`} />
                </button>
              </form>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
