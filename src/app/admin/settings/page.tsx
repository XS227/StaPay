import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { FeatureToggleCard } from "./_components/feature-toggle-card";

async function toggleFeature(formData: FormData) {
  "use server";

  const tenantId = String(formData.get("tenantId") ?? "");
  const feature = String(formData.get("feature") ?? "");
  const nextValue = String(formData.get("nextValue") ?? "false") === "true";

  const allowed = ["enableRecurring", "enableCheckout", "enableLoyalty"] as const;
  type AllowedFeature = (typeof allowed)[number];
  const isAllowedFeature = (value: string): value is AllowedFeature =>
    allowed.includes(value as AllowedFeature);

  if (!tenantId || !isAllowedFeature(feature)) {
    throw new Error("Invalid toggle payload");
  }

  await prisma.tenant.update({
    where: { id: tenantId },
    data: { [feature]: nextValue },
  });

  revalidatePath("/admin/settings");
}

export default async function AdminSettingsPage() {
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      companyName: true,
      enableRecurring: true,
      enableCheckout: true,
      enableLoyalty: true,
    },
  });

  return (
    <main className="min-h-screen bg-zinc-50 p-8 text-zinc-900">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="rounded-3xl bg-white p-8 shadow-sm">
          <h1 className="text-3xl font-semibold tracking-tight">Feature Toggles</h1>
          <p className="mt-2 text-zinc-600">Apple-style toggle grid for Vipps ecosystem activation per tenant.</p>
        </header>

        <section className="grid gap-6 md:grid-cols-2">
          {tenants.map((tenant) => (
            <FeatureToggleCard key={tenant.id} tenantId={tenant.id} tenantName={tenant.companyName} enableRecurring={tenant.enableRecurring} enableCheckout={tenant.enableCheckout} enableLoyalty={tenant.enableLoyalty} onToggle={toggleFeature} />
          ))}
        </section>
      </div>
    </main>
  );
}
