"use client"

import { ArrowLeft, Beef, Check, Clock3, PackageCheck } from "lucide-react"
import { useEffect, useState } from "react"

type Order = { publicNumber: string; status: string; fulfillmentStatus: string; estimatedTotalMinor: string; finalTotalMinor: string | null; items: { id: string; productName: string; preparationName: string; requestedQty: string; finalQty: string | null; estimatedTotalMinor: string; finalTotalMinor: string | null; status: string }[] }
function money(minor: string) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(minor) / 100) }
function statusLabel(status: string) { return ({ RECEIVED: "Pedido recebido", CONFIRMED: "Pedido confirmado", SEPARATING: "Em separação", WEIGHING: "Pesando seus cortes", WAITING_CUSTOMER_APPROVAL: "Aguardando sua aprovação", WEIGHT_ADJUSTED: "Peso confirmado", READY: "Pronto para retirada", COMPLETED: "Pedido concluído", CANCELED: "Pedido cancelado" } as Record<string, string>)[status] ?? status }

export default function OrderTracking({ params, searchParams }: { params: Promise<{ storeSlug: string; publicNumber: string }>; searchParams: Promise<{ token?: string }> }) {
  const [state, setState] = useState<{ slug: string; token: string; order: Order | null; error: string; loading: boolean }>({ slug: "", token: "", order: null, error: "", loading: true })
  const [approving, setApproving] = useState<string | null>(null)
  useEffect(() => { void Promise.all([params, searchParams]).then(async ([route, query]) => {
    setState(current => ({ ...current, slug: route.storeSlug, token: query.token ?? "" }))
    if (!query.token) throw new Error("Link de acompanhamento inválido.")
    const response = await fetch(`/api/public/stores/${encodeURIComponent(route.storeSlug)}/orders/${encodeURIComponent(route.publicNumber)}?token=${encodeURIComponent(query.token)}`, { cache: "no-store" })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error?.message ?? "Pedido não encontrado.")
    setState({ slug: route.storeSlug, order: body as Order, error: "", loading: false })
  }).catch(error => setState(current => ({ ...current, loading: false, error: error instanceof Error ? error.message : "Não foi possível consultar o pedido." }))) }, [params, searchParams])

  if (state.loading) return <main className="store-loading"><div className="store-loader"><span className="brand-mark"><Beef /></span><p>Consultando seu pedido...</p></div></main>
  if (state.error || !state.order) return <main className="store-loading"><div className="store-loader"><span className="brand-mark"><Beef /></span><h1>Pedido indisponível</h1><p>{state.error}</p><a className="primary-button success-link" href={`/${state.slug}`}>Voltar à loja <ArrowLeft /></a></div></main>
  const order = state.order
  async function approve(itemId: string) {
    setApproving(itemId)
    try {
      const response = await fetch(`/api/public/stores/${encodeURIComponent(state.slug)}/orders/${encodeURIComponent(order.publicNumber)}/approve`, { method: "POST", headers: { "Content-Type": "application/json", "X-Order-Token": state.token }, body: JSON.stringify({ orderItemId: itemId }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error?.message ?? "Não foi possível aprovar o peso.")
      window.location.reload()
    } catch (error) { setState(current => ({ ...current, error: error instanceof Error ? error.message : "Não foi possível aprovar o peso." })) }
    finally { setApproving(null) }
  }
  return <main className="storefront-shell"><header className="store-header"><a className="store-brand" href={`/${state.slug}`}><span className="brand-mark"><Beef /></span><span><small>pedido direto</small><strong>Acompanhar pedido</strong></span></a></header><section className="tracking-shell"><a className="back-link" href={`/${state.slug}`}><ArrowLeft /> Voltar à loja</a><div className="tracking-card"><div className="tracking-top"><div><p className="store-section-kicker">Pedido #{order.publicNumber}</p><h1>{statusLabel(order.fulfillmentStatus)}</h1><p>Estamos cuidando de tudo por aqui.</p></div><span className="tracking-icon"><PackageCheck /></span></div><div className="tracking-steps"><div className="tracking-step active"><span><Check /></span><small>Recebido</small></div><div className={order.fulfillmentStatus !== "RECEIVED" ? "tracking-step active" : "tracking-step"}><span><Clock3 /></span><small>Preparo</small></div><div className={order.fulfillmentStatus === "READY" || order.fulfillmentStatus === "COMPLETED" ? "tracking-step active" : "tracking-step"}><span><PackageCheck /></span><small>Pronto</small></div></div>{state.error && <div className="status-banner" role="alert">{state.error}</div>}<div className="tracking-items"><h2>Itens do pedido</h2>{order.items.map(item => <div className="tracking-item" key={item.id}><div><strong>{item.productName} · {item.preparationName}</strong><span>{item.finalQty ? `Separado: ${item.finalQty} g` : `Solicitado: ${item.requestedQty} g`}</span>{item.status === "WAITING_CUSTOMER_APPROVAL" && <button className="approve-button" disabled={approving === item.id} onClick={() => void approve(item.id)}>{approving === item.id ? "Aprovando…" : "Aprovar peso"}</button>}</div><b>{money(item.finalTotalMinor ?? item.estimatedTotalMinor)}</b></div>)}</div><div className="tracking-total"><span>{order.finalTotalMinor ? "Total final" : "Total estimado"}</span><strong>{money(order.finalTotalMinor ?? order.estimatedTotalMinor)}</strong></div></div></section></main>
}
