import { AlertTriangle, PackageX } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { DataSources } from "@/components/integrations/data-sources";
import { StoreNotices } from "@/components/integrations/store-notices";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataList, DataListItem, MetricGrid } from "@/components/ui/data-list";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { SectionSkeleton } from "@/components/ui/skeleton";
import { StatTile, deltaOf } from "@/components/ui/stat-tile";
import { TableContainer, Td, Th } from "@/components/ui/table";
import type { DomainErrorCode } from "@/domain/errors";
import { richT } from "@/i18n/rich";
import { getI18n, type ServerI18n } from "@/i18n/server";
import type {
  FinancialStatus,
  ProductPerformanceResult,
  ShopifyOrder,
  ShopifyProduct,
} from "@/integrations/shopify/types";
import { getShopifySource, toShopifyErrorCode } from "@/server/integrations/shopify";
import { log } from "@/server/logging";
import { loadPerformance } from "@/server/queries/performance";

const DAYS = 30;
const LOW_STOCK = 10;
const RECENT_ORDERS = 8;

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

function StockBadge({ inventory, i18n }: { inventory: number | null; i18n: ServerI18n }) {
  if (inventory === null) return null;
  if (inventory <= 0) {
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

const FINANCIAL_TONE: Record<FinancialStatus, BadgeTone> = {
  PAID: "good",
  PENDING: "warning",
  AUTHORIZED: "warning",
  PARTIALLY_PAID: "warning",
  PARTIALLY_REFUNDED: "neutral",
  REFUNDED: "neutral",
  VOIDED: "neutral",
  EXPIRED: "neutral",
};

/** Products, product performance and recent orders — or an error code, never substitute data. */
async function loadCatalog(range: { from: string; to: string }, now: Date) {
  const source = await getShopifySource();
  if (source.mode === "error") return { ok: false as const, code: source.code };
  try {
    const [products, performance, orders] = await Promise.all([
      source.service.listProducts(),
      source.service.getProductPerformance(range),
      source.service.listRecentOrders(RECENT_ORDERS, now),
    ]);
    return { ok: true as const, products, performance, orders, capabilities: source.service.capabilities };
  } catch (error) {
    const code: DomainErrorCode = toShopifyErrorCode(error);
    log("warn", "shopify.catalog_unavailable", { errorCode: code });
    return { ok: false as const, code };
  }
}

async function ShopifyContent({ i18n }: { i18n: ServerI18n }) {
  await connection();
  const now = new Date();
  const { dict, fmt, t } = i18n;
  const perf = await loadPerformance(DAYS, now);
  const source = perf.store.source;
  const header = (
    <>
      <DataSources store={source} i18n={i18n} />
      <StoreNotices source={source} complete={perf.store.complete} i18n={i18n} />
    </>
  );
  if (!perf.shop) return <div className="space-y-5 sm:space-y-6">{header}</div>;

  const catalog = await loadCatalog(perf.range, now);
  const currency = perf.shop.currency;
  const live = source.mode === "live";
  const capabilities = perf.store.capabilities;
  const pct = (f: number) => fmt.percent(f, { signed: true });
  const vs = t(dict.common.vsPrevious, { n: DAYS });
  const money = (value: number | null) => (value === null ? dict.common.none : fmt.currency(value, currency));

  return (
    <div className="space-y-5 sm:space-y-6">
      {header}
      <p className="text-sm text-ink-2">{richT(dict.shopify.subtitle, { store: perf.shop.name })}</p>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile
          label={dict.kpi.revenue}
          hint={live ? dict.kpi.revenueHintLive : undefined}
          value={perf.kpis.revenue.value === null ? dict.common.none : fmt.currency(perf.kpis.revenue.value, currency, { compact: true })}
          delta={deltaOf(perf.kpis.revenue.delta, pct)}
          deltaLabel={vs}
          trend={perf.trends.revenue}
        />
        <StatTile
          label={dict.kpi.orders}
          value={perf.kpis.orders.value === null ? dict.common.none : fmt.number(perf.kpis.orders.value)}
          delta={deltaOf(perf.kpis.orders.delta, pct)}
          deltaLabel={vs}
          trend={perf.trends.orders}
        />
        <StatTile
          label={dict.kpi.aov}
          value={money(perf.kpis.aov.value)}
          delta={deltaOf(perf.kpis.aov.delta, pct)}
          deltaLabel={vs}
          trend={perf.trends.aov}
        />
        <StatTile
          label={dict.kpi.conversionRate}
          hint={capabilities?.sessions === false ? dict.kpi.conversionUnavailable : undefined}
          value={perf.kpis.conversionRate.value === null ? dict.common.none : fmt.percent(perf.kpis.conversionRate.value, { digits: 2 })}
          delta={deltaOf(perf.kpis.conversionRate.delta, pct)}
          deltaLabel={vs}
          trend={capabilities?.sessions === false ? undefined : perf.trends.conversionRate}
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

      {catalog.ok ? (
        <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
          <ProductsCard
            products={catalog.products}
            performance={catalog.performance}
            showBasis={live}
            inventoryAvailable={catalog.capabilities.inventory}
            i18n={i18n}
          />
          <OrdersCard orders={catalog.orders} now={now} showCustomer={catalog.capabilities.customerNames} showSource={catalog.capabilities.orderSources} i18n={i18n} />
        </div>
      ) : (
        <Notice tone="critical">
          {dict.dataSource.errorNotice} {(dict.errors as Record<string, string>)[catalog.code] ?? dict.errors.UNEXPECTED}
        </Notice>
      )}

      <Notice>{dict.shopify.readOnly}</Notice>
    </div>
  );
}

function ProductsCard({
  products,
  performance,
  showBasis,
  inventoryAvailable,
  i18n,
}: {
  products: ShopifyProduct[];
  performance: ProductPerformanceResult;
  showBasis: boolean;
  inventoryAvailable: boolean;
  i18n: ServerI18n;
}) {
  const { dict: d, fmt: f, t } = i18n;
  const c = d.shopify.columns;
  const rows = products
    .map((p) => ({ product: p, perf: performance.rows.find((x) => x.productId === p.id) }))
    .sort((a, b) => (b.perf?.revenueMinor ?? 0) - (a.perf?.revenueMinor ?? 0));
  const stock = (p: ShopifyProduct) => (p.inventory === null ? d.common.none : f.number(p.inventory));
  const description = [
    t(d.common.lastNDays, { n: DAYS }),
    !performance.complete ? t(d.shopify.productsPartial, { n: performance.ordersScanned }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card>
      <CardHeader title={d.shopify.products} description={description} />
      {rows.length === 0 ? (
        <CardBody>
          <p className="text-sm text-ink-2">{d.shopify.noProducts}</p>
        </CardBody>
      ) : (
        <>
          <DataList label={d.shopify.products} className="mt-2">
            {rows.map(({ product, perf: p }) => (
              <DataListItem
                key={product.id}
                leading={<ProductSwatch product={product} />}
                title={product.title}
                subtitle={product.status !== "ACTIVE" ? d.shopify.productStatus[product.status] : undefined}
                aside={<StockBadge inventory={product.inventory} i18n={i18n} />}
              >
                <MetricGrid
                  columns={2}
                  items={[
                    { label: c.price, value: f.currency(product.priceMinor, product.currency) },
                    { label: c.inventory, value: stock(product) },
                    { label: c.unitsSold, value: f.number(p?.unitsSold ?? 0) },
                    { label: c.revenue, value: f.currency(p?.revenueMinor ?? 0, product.currency) },
                  ]}
                />
              </DataListItem>
            ))}
          </DataList>
          <div className="hidden pt-4 md:block">
            <TableContainer label={d.shopify.products} stickyFirstColumn>
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
                {rows.map(({ product, perf: p }) => (
                  <tr key={product.id}>
                    <Td className="min-w-48 lg:min-w-52">
                      <div className="flex items-center gap-3">
                        <ProductSwatch product={product} />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{product.title}</p>
                          {product.status !== "ACTIVE" ? (
                            <p className="text-xs text-ink-2">{d.shopify.productStatus[product.status]}</p>
                          ) : null}
                        </div>
                      </div>
                    </Td>
                    <Td numeric>{f.currency(product.priceMinor, product.currency)}</Td>
                    <Td numeric>
                      <span className="inline-flex items-center gap-1.5">
                        <StockBadge inventory={product.inventory} i18n={i18n} />
                        {stock(product)}
                      </span>
                    </Td>
                    <Td numeric>{f.number(p?.unitsSold ?? 0)}</Td>
                    <Td numeric>{f.currency(p?.revenueMinor ?? 0, product.currency)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableContainer>
          </div>
        </>
      )}
      {showBasis || !inventoryAvailable ? (
        <ul className="list-disc space-y-1 px-4 pt-3 pb-4 ps-8 text-xs text-ink-2 sm:px-5 sm:ps-9">
          {showBasis ? <li>{d.shopify.productsBasis}</li> : null}
          {!inventoryAvailable ? <li>{d.shopify.inventoryHidden}</li> : null}
        </ul>
      ) : null}
    </Card>
  );
}

function OrdersCard({
  orders,
  now,
  showCustomer,
  showSource,
  i18n,
}: {
  orders: ShopifyOrder[];
  now: Date;
  showCustomer: boolean;
  showSource: boolean;
  i18n: ServerI18n;
}) {
  const { dict, fmt } = i18n;
  const c = dict.shopify.columns;
  const testBadge = (order: ShopifyOrder) => (order.test ? <Badge tone="neutral">{dict.shopify.testOrder}</Badge> : null);
  const subtitleParts = (order: ShopifyOrder) =>
    [
      showCustomer && order.customerLabel ? order.customerLabel : null,
      fmt.relative(new Date(order.createdAt), now),
      showSource && order.source ? dict.shopify.source[order.source] : null,
    ].filter(Boolean);

  return (
    <Card>
      <CardHeader title={dict.shopify.recentOrders} />
      {orders.length === 0 ? (
        <CardBody>
          <p className="text-sm text-ink-2">{dict.shopify.noOrders}</p>
        </CardBody>
      ) : (
        <>
          <DataList label={dict.shopify.recentOrders} className="mt-2">
            {orders.map((order) => (
              <DataListItem
                key={order.id}
                title={
                  <span className="inline-flex items-center gap-1.5">
                    <span className="tabular" dir="ltr">
                      {order.name}
                    </span>
                    {testBadge(order)}
                  </span>
                }
                subtitle={subtitleParts(order).join(" · ")}
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
                  {showSource ? <Th>{c.source}</Th> : null}
                  <Th numeric>{c.total}</Th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <Td>
                      <p className="inline-flex items-center gap-1.5 font-medium">
                        <span className="tabular" dir="ltr">
                          {order.name}
                        </span>
                        {testBadge(order)}
                      </p>
                      {showCustomer && order.customerLabel ? <p className="text-xs text-ink-2">{order.customerLabel}</p> : null}
                    </Td>
                    <Td className="whitespace-nowrap text-ink-2">{fmt.relative(new Date(order.createdAt), now)}</Td>
                    <Td>
                      <Badge tone={FINANCIAL_TONE[order.financialStatus]}>{dict.shopify.financial[order.financialStatus]}</Badge>
                      <p className="mt-1 text-xs text-ink-2">{dict.shopify.fulfillment[order.fulfillmentStatus]}</p>
                    </Td>
                    {showSource ? (
                      <Td className="whitespace-nowrap text-ink-2">{order.source ? dict.shopify.source[order.source] : dict.common.none}</Td>
                    ) : null}
                    <Td numeric>{fmt.currency(order.totalMinor, order.currency)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableContainer>
          </div>
        </>
      )}
    </Card>
  );
}
