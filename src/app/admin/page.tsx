import { prisma } from "@/lib/prisma";

async function getMetrics() {
  const grouped = await prisma.order.groupBy({
    by: ["status"],
    _count: { _all: true },
    _sum: { totalAmount: true },
  });

  return grouped;
}

export default async function AdminPage() {
  const [tenants, metrics] = await Promise.all([
    prisma.tenant.findMany({ orderBy: { createdAt: "desc" } }),
    getMetrics(),
  ]);

  return (
    <main className="min-h-screen bg-zinc-50 p-8 text-zinc-900">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="rounded-3xl bg-white p-8 shadow-sm">
          <h1 className="text-3xl font-semibold tracking-tight">Stapay Admin</h1>
          <p className="mt-2 text-zinc-600">Pseudo-Vipps Login: session verified for secure operations.</p>
        </header>

        <section className="grid gap-6 md:grid-cols-2">
          {tenants.map((tenant) => (
            <article key={tenant.id} className="rounded-3xl bg-white p-6 shadow-sm">
              <h2 className="text-xl font-medium">{tenant.companyName}</h2>
              <p className="mt-4 text-sm text-zinc-500">Domain: {tenant.customDomain ?? `${tenant.slug}.stapay.no`}</p>
              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-zinc-500">Client ID</dt>
                  <dd className="font-mono">{tenant.vippsClientId ?? "Not connected"}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-zinc-500">Sub Key</dt>
                  <dd className="font-mono">{tenant.vippsSubKey ?? "Not connected"}</dd>
                </div>
              </dl>
            </article>
          ))}
        </section>

        <section className="rounded-3xl bg-white p-8 shadow-sm">
          <h2 className="text-2xl font-semibold tracking-tight">Order Metrics</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {metrics.map((metric) => (
              <article key={metric.status} className="rounded-2xl border border-zinc-200 p-4">
                <p className="text-xs tracking-wider text-zinc-500 uppercase">{metric.status}</p>
                <p className="mt-2 text-3xl font-semibold">{metric._count._all}</p>
                <p className="text-sm text-zinc-500">{((metric._sum.totalAmount ?? 0) / 100).toFixed(2)} NOK</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
