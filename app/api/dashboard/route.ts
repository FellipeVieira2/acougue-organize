import { createPool, createTenantTransaction } from "../../../packages/domain/src/database.ts"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 30

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(request: Request) {
  const organizationId = request.headers.get("x-organization-id") ?? process.env.ORGANIZATION_ID
  if (!organizationId || !UUID_PATTERN.test(organizationId)) {
    return Response.json({ error: "ORGANIZATION_ID_REQUIRED" }, { status: 400 })
  }

  const pool = createPool()
  const transaction = createTenantTransaction(pool)

  try {
    const dashboard = await transaction(organizationId, async (client) => {
      const [organization, stores, products, activity] = await Promise.all([
        client.query<{ name: string; status: string }>("SELECT name, status FROM app.organization WHERE id = $1", [organizationId]),
        client.query<{ id: string; name: string; active: boolean }>("SELECT id, name, active FROM app.store ORDER BY created_at ASC", []),
        client.query<{ id: string; name: string; sku: string; stock_unit: string; active: boolean; amount_minor: string | null; currency: string | null }>(
          `SELECT p.id, p.name, p.sku, p.stock_unit, p.active, price.amount_minor, price.currency
           FROM app.product p
           LEFT JOIN LATERAL (
             SELECT amount_minor, currency FROM app.product_price
             WHERE product_id = p.id AND channel = 'POS'
             ORDER BY revision DESC LIMIT 1
           ) price ON true
           ORDER BY p.created_at DESC`,
          [],
        ),
        client.query<{ action: string; reason: string | null; created_at: string }>("SELECT action, reason, created_at FROM app.audit_log ORDER BY created_at DESC LIMIT 5", []),
      ])

      return {
        organization: organization.rows[0] ?? null,
        stores: stores.rows,
        products: products.rows.map((product) => ({
          ...product,
          amountMinor: product.amount_minor,
          currency: product.currency,
        })),
        activity: activity.rows,
      }
    })

    return Response.json(dashboard)
  } catch (error) {
    console.error("[v0] Dashboard query failed", error)
    return Response.json({ error: "DASHBOARD_UNAVAILABLE" }, { status: 503 })
  } finally {
    await pool.end()
  }
}
