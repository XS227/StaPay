import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { BuyButton } from "./buy-button";

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function TenantStorefront({ params }: Props) {
  const { slug } = await params;

  const tenant = await prisma.tenant.findFirst({
    where: {
      OR: [{ slug }, { customDomain: slug }],
    },
    include: {
      products: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!tenant) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-white text-zinc-900">
      <section className="mx-auto max-w-6xl px-6 py-16">
        <header className="mb-14">
          <p className="text-sm tracking-[0.25em] text-zinc-500 uppercase">Stapay Store</p>
          <h1 className="mt-3 text-5xl font-semibold tracking-tight">{tenant.companyName}</h1>
          <p className="mt-4 max-w-2xl text-zinc-600">Minimal checkout with Vipps MobilePay.</p>
        </header>

        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {tenant.products.map((product) => (
            <article key={product.id} className="rounded-3xl border border-zinc-200 p-6 shadow-sm">
              {product.imageUrl ? (
                <img src={product.imageUrl} alt={product.title} className="mb-5 h-56 w-full rounded-2xl object-cover" />
              ) : (
                <div className="mb-5 h-56 w-full rounded-2xl bg-zinc-100" />
              )}

              <h2 className="text-xl font-medium tracking-tight">{product.title}</h2>
              <p className="mt-2 line-clamp-3 text-sm text-zinc-600">{product.description}</p>
              <p className="mt-6 text-2xl font-semibold">{(product.price / 100).toFixed(2)} NOK</p>

              <BuyButton productId={product.id} tenantId={tenant.id} />
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
