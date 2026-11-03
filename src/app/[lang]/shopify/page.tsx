import { AlertTriangle, PackageX } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataList, DataListItem, MetricGrid } from "@/components/ui/data-list";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { SectionSkeleton } from "@/components/ui/skeleton";
import { StatTile, deltaOf } from "@/components/ui/stat-tile";
import { TableContainer, Td, Th } from "@/components/ui/table";
import { richT } from "@/i18n/rich";
import { getI18n, type ServerI18n } from "@/i18n/server";
import { getIntegrations } from "@/integrations/registry";
import type { ShopifyOrder, ShopifyProduct } from "@/integrations/shopify/types";
import { loadPerformance } from "@/server/queries/performance";

const DAYS = 30;
const LOW_STOCK = 10;

export async function generateMetadata({ params }: PageProps<"/[lang]/shopify">): Promise<Metadata> {
  return { title: getI18n((await params).lang).dict.shopify.title };
}

export default async function ShopifyPage({ params }: PageProps<"/[lang]/shopify">) {
  const i18n = getI18n((await params).lang);
  return (
    <>
      <PageHeader title={i18n.dict.shopify.title} description={i18n.dict.shopify.readOnly} />
      <Suspense fallback={<SectionSkeleton label={i18n.dict.common.loading} />}>
        <ShopifyContent i18n={i18n} />
      </Suspense>
    </>
  );
}

function ProductSwatch({ product }: { product: ShopifyProduct }) {
  return (
    <span
      aria-hidden
      className="size-9 shrink-0 rounded-md sm:size-8"
      style={{ background: `linear-gradient(135deg, hsl(${product.swatchHue} 45% 70%), hsl(${product.swatchHue} 40% 45%))` }}
    />
  );
}

function StockBadge({ inventory, i18n }: { inventory: number; i18n: ServerI18n }) {
  if (inventory === 0) {
    return (
      <Badge tone="critical" icon={<PackageX aria-hidden className="size-3" />}>
        {i18n.dict.shopify.outOfStock}
      </Badge>
    );
  }
  if (inventory < LOW_STOCK) {
    return (
      <Badge tone="warning" icon={<AlertTriangle aria-hidden className="size-3" />}>
        {i18n.dict.shopify.lowStock}
      </Badge>
    );
  }
  return null;
}

const FINANCIAL_TONE: Record<ShopifyOrder["financialStatus"], BadgeTone> = {
  PAID: "good",
  PENDING: "warning",
  REFUNDED: "neutral",
};

async function ShopifyContent({ i18n }: { i18n: ServerI18n }) {
  await connection();
  const now = new Date();
  const { dict, fmt, t } = i18n;
  const { shopify } = getIntegrations();
  const perf = await loadPerformance(DAYS, now);
  const [products, performance, orders] = await Promise.all([
    shopify.listProducts(),
    shopify.getProductPerformance(perf.range),
    shopify.listRecentOrders(8, now),
  ]);
  const currency = perf.shop.currency;
  const pct = (f: number) => fmt.percent(f, { signed: true });
  const vs = t(dict.common.vsPrevious, { n: DAYS });
  const c = dict.shopify.columns;

  const productRows = products
    .map((p) => ({ product: p, perf: performance.find((x) => x.productId === p.id) }))
    .sort((a, b) => (b.perf?.revenueMinor ?? 0) - (a.perf?.revenueMinor ?? 0));

  return (
    <div className="space-y-5 sm:space-y-6">
      <p className="text-sm text-ink-2">{richT(dict.shopify.subtitle, { store: perf.shop.name })}</p>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile
          label={dict.kpi.revenue}
          value={fmt.currency(perf.kpis.revenue.value, currency, { compact: true })}
          delta={deltaOf(perf.kpis.revenue.delta, pct)}
          deltaLabel={vs}
          trend={perf.trends.revenue}
        />
        <StatTile
          label={dict.kpi.orders}
          value={fmt.number(perf.kpis.orders.value)}
          delta={deltaOf(perf.kpis.orders.delta, pct)}
          deltaLabel={vs}
          trend={perf.trends.orders}
        />
        <StatTile
          label={dict.kpi.aov}
          value={perf.kpis.aov.value === null ? "—" : fmt.currency(perf.kpis.aov.value, currency)}
          delta={deltaOf(perf.kpis.aov.delta, pct)}
          deltaLabel={vs}
          trend={perf.trends.aov}
        />
        <StatTile
          label={dict.kpi.conversionRate}
          value={perf.kpis.conversionRate.value === null ? "—" : fmt.percent(perf.kpis.conversionRate.value, { digits: 2 })}
          delta={deltaOf(perf.kpis.conversionRate.delta, pct)}
          deltaLabel={vs}
          trend={perf.trends.conversionRate}
        />
      </div>

      <Card>
        <CardHeader title={dict.charts.ordersPerDay} description={dict.charts.ordersPerDayDesc} />
        <CardBody>
          <TimeSeriesChart
            title={dict.charts.ordersPerDay}
            mark="column"
            dates={perf.sales.map((d) => d.date)}
            format={{ kind: "number" }}
            series={[{ id: "orders", label: dict.charts.series.orders, color: "series-1", values: perf.sales.map((d) => d.orders) }]}
          />
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title={dict.shopify.products} description={t(dict.common.lastNDays, { n: DAYS })} />
          <DataList label={dict.shopify.products} className="mt-2">
            {productRows.map(({ product, perf: p }) => (
              <DataListItem
                key={product.id}
                leading={<ProductSwatch product={product} />}
                title={product.title}
                subtitle={product.status !== "ACTIVE" ? dict.shopify.productStatus[product.status] : undefined}
                aside={<StockBadge inventory={product.inventory} i18n={i18n} />}
              >
                <MetricGrid
                  columns={2}
                  items={[
                    { label: c.price, value: fmt.currency(product.priceMinor, product.currency) },
                    { label: c.inventory, value: fmt.number(product.inventory) },
                    { label: c.unitsSold, value: fmt.number(p?.unitsSold ?? 0) },
                    { label: c.revenue, value: fmt.currency(p?.revenueMinor ?? 0, product.currency) },
                  ]}
                />
              </DataListItem>
            ))}
          </DataList>
          <div className="hidden pt-4 md:block">
            <TableContainer label={dict.shopify.products} stickyFirstColumn>
              <thead>
                <tr>
                  <Th>{c.product}</Th>
                  <Th numeric>{c.price}</Th>
                  <Th numeric>{c.inventory}</Th>
                  <Th numeric>{c.unitsSold}</Th>
                  <Th numeric>{c.revenue}</Th>
                </tr>
              </thead>
              <tbody>
                {productRows.map(({ product, perf: p }) => (
                  <tr key={product.id}>
                    <Td className="min-w-48 lg:min-w-52">
                      <div className="flex items-center gap-3">
                        <ProductSwatch product={product} />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{product.title}</p>
                          {product.status !== "ACTIVE" ? (
                            <p className="text-xs text-ink-2">{dict.shopify.productStatus[product.status]}</p>
                          ) : null}
                        </div>
                      </div>
                    </Td>
                    <Td numeric>{fmt.currency(product.priceMinor, product.currency)}</Td>
                    <Td numeric>
                      <span className="inline-flex items-center gap-1.5">
                        <StockBadge inventory={product.inventory} i18n={i18n} />
                        {fmt.number(product.inventory)}
                      </span>
                    </Td>
                    <Td numeric>{fmt.number(p?.unitsSold ?? 0)}</Td>
                    <Td numeric>{fmt.currency(p?.revenueMinor ?? 0, product.currency)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title={dict.shopify.recentOrders} />
          <DataList label={dict.shopify.recentOrders} className="mt-2">
            {orders.map((order) => (
              <DataListItem
                key={order.id}
                title={
                  <span className="tabular" dir="ltr">
                    {order.name}
                  </span>
                }
                subtitle={
                  <>
                    {order.customerLabel} · {fmt.relative(new Date(order.createdAt), now)} · {dict.shopify.source[order.source]}
                  </>
                }
                aside={
                  <>
                    <span className="tabular text-sm font-semibold text-ink">{fmt.currency(order.totalMinor, order.currency)}</span>
                    <Badge tone={FINANCIAL_TONE[order.financialStatus]}>{dict.shopify.financial[order.financialStatus]}</Badge>
                    <span className="text-xs text-ink-2">{dict.shopify.fulfillment[order.fulfillmentStatus]}</span>
                  </>
                }
              />
            ))}
          </DataList>
          <div className="hidden pt-4 md:block">
            <TableContainer label={dict.shopify.recentOrders}>
              <thead>
                <tr>
                  <Th>{c.order}</Th>
                  <Th>{c.placed}</Th>
                  <Th>{c.payment}</Th>
                  <Th>{c.source}</Th>
                  <Th numeric>{c.total}</Th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <Td>
                      <p className="tabular font-medium" dir="ltr">
                        {order.name}
                      </p>
                      <p className="text-xs text-ink-2">{order.customerLabel}</p>
                    </Td>
                    <Td className="whitespace-nowrap text-ink-2">{fmt.relative(new Date(order.createdAt), now)}</Td>
                    <Td>
                      <Badge tone={FINANCIAL_TONE[order.financialStatus]}>{dict.shopify.financial[order.financialStatus]}</Badge>
                      <p className="mt-1 text-xs text-ink-2">{dict.shopify.fulfillment[order.fulfillmentStatus]}</p>
                    </Td>
                    <Td className="whitespace-nowrap text-ink-2">{dict.shopify.source[order.source]}</Td>
                    <Td numeric>{fmt.currency(order.totalMinor, order.currency)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableContainer>
          </div>
        </Card>
      </div>

      <Notice>{dict.shopify.readOnly}</Notice>
    </div>
  );
}
