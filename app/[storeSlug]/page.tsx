"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowRight, Beef, Check, Clock3, MapPin, Minus, Plus, ShoppingBag, X } from "lucide-react"

import { cartTotalMinor, formatMinor } from "../../lib/cart.ts"

type Offer = {
  id: string
  productId: string
  productName: string
  offerName: string
  preparationName: string
  sku: string
  saleUnit: "G" | "UNIT" | "FIXED_PACKAGE"
  amountMinor: string
  currency: string
  minWeightG: string | null
  maxWeightG: string | null
  weightStepG: string | null
  defaultWeightG: string | null
  displayOnly?: boolean
}
type Catalog = { store: { id: string; name: string; slug: string }; offers: Offer[] }
type CartLine = { offer: Offer; quantity: string }
type CheckoutResult = { publicNumber: string; accessToken: string; estimatedTotalMinor: string }
class RequestError extends Error { constructor(message: string) { super(message) } }

const money = formatMinor
function displayQuantity(quantity: string, unit: Offer["saleUnit"]) {
  if (unit !== "G") return `${quantity} un.`
  return `${(Number(quantity) / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg`
}
function initialQuantity(offer: Offer) {
  if (offer.saleUnit !== "G") return "1"
  return offer.defaultWeightG ?? offer.minWeightG ?? (offer.saleUnit === "G" ? "1000" : "1")
}
function formatWeightRange(offer: Offer) {
  if (offer.saleUnit !== "G") return "por unidade"
  if (offer.minWeightG && offer.maxWeightG) return `${displayQuantity(offer.minWeightG, "G")} a ${displayQuantity(offer.maxWeightG, "G")}`
  return "peso aproximado"
}

export default function Storefront({ params }: { params: Promise<{ storeSlug: string }> }) {
  const [slug, setSlug] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [cart, setCart] = useState<CartLine[]>([])
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [error, setError] = useState("")
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const attempt = useRef<{ body: string; key: string } | null>(null)
  const [result, setResult] = useState<CheckoutResult | null>(null)

  useEffect(() => { void params.then(value => setSlug(value.storeSlug)).catch(() => { setError('Não foi possível identificar a loja.'); setLoading(false) }) }, [params])
  useEffect(() => {
    if (!slug) return
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    let live = true
    setLoading(true)
    setError('')
    fetch(`/api/public/stores/${encodeURIComponent(slug)}/catalog`, { cache: "no-store", signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new RequestError(body.error?.message ?? "Loja indisponível."); return body as Catalog })
      .then(value => { if (live) setCatalog(value) })
      .catch(value => { if (live) setError(controller.signal.aborted ? 'A loja demorou para responder. Tente novamente.' : value instanceof Error ? value.message : 'Loja indisponível.') })
      .finally(() => { clearTimeout(timeout); if (live) setLoading(false) })
    return () => { live=false; clearTimeout(timeout); controller.abort() }
  }, [slug, reload])

  const filteredOffers = useMemo(() => catalog?.offers.filter(offer => `${offer.productName} ${offer.preparationName}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR"))) ?? [], [catalog, query])
  const totalLines = cart.length
  const estimatedTotal = cartTotalMinor(cart)

  function add(offer: Offer) {
    if (offer.displayOnly) return
    if (result) { setResult(null); attempt.current = null }
    setCart(current => {
      const found = current.find(line => line.offer.id === offer.id)
      if (!found) return [...current, { offer, quantity: initialQuantity(offer) }]
      return current.map(line => line.offer.id === offer.id ? { ...line, quantity: String(Math.min(Number(offer.saleUnit === "G" ? offer.maxWeightG ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER), Number(line.quantity) + Number(offer.saleUnit === "G" ? offer.weightStepG ?? "500" : "1"))) } : line)
    })
    setCartOpen(true)
  }
  function change(offerId: string, delta: number) {
    if (result) { setResult(null); attempt.current = null }
    setCart(current => current.flatMap(line => {
      if (line.offer.id !== offerId) return [line]
      const step = Number(line.offer.saleUnit === "G" ? line.offer.weightStepG ?? "500" : "1")
      const next = Number(line.quantity) + step * delta
      const minimum = Number(line.offer.saleUnit === "G" ? line.offer.minWeightG ?? "1" : "1")
      if (line.offer.saleUnit === "G" && line.offer.maxWeightG && next > Number(line.offer.maxWeightG)) return [line]
      return next < minimum ? [] : [{ ...line, quantity: String(next) }]
    }))
  }
  function remove(offerId: string) { setCart(current => current.filter(line => line.offer.id !== offerId)) }

  if (loading) return <main className="store-loading"><div className="store-loader"><span className="brand-mark"><Beef /></span><p>Abrindo o balcão...</p></div></main>
  if (error || !catalog) return <main className="store-loading"><div className="store-loader"><span className="brand-mark"><Beef /></span><h1>Loja indisponível</h1><p>{error || "Não encontramos este endereço."}</p><button className="primary-button" onClick={() => setReload(value => value + 1)}>Tentar novamente</button></div></main>
  return <main className="storefront-shell">
    <header className="store-header"><a className="store-brand" href={`/${catalog.store.slug}`}><span className="brand-mark"><Beef /></span><span><small>pedido direto</small><strong>{catalog.store.name}</strong></span></a><div className="store-header-meta"><span><Clock3 /> preparo no dia</span><button className="cart-trigger" onClick={() => setCartOpen(true)} aria-label={`Abrir carrinho com ${totalLines} itens`}><ShoppingBag /><b>{totalLines}</b></button></div></header>
    <section className="store-hero"><div><p className="store-kicker">DO BALCÃO PARA SUA CASA</p><h1>Escolha o corte.<br /><em>Do jeito que você gosta.</em></h1><p>Selecione a apresentação, indique o peso aproximado e deixe o preparo por nossa conta.</p></div><div className="hero-stamp"><Beef /><span>carne fresca<br /><strong>todos os dias</strong></span></div></section>
    <section className="store-toolbar"><div><p className="store-section-kicker">O balcão de hoje</p><h2>Cortes e preparos</h2></div><label className="store-search"><span>⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar corte ou preparo" aria-label="Buscar corte ou preparo" /></label></section>
    <section className="offer-grid">{filteredOffers.map(offer => <article className="offer-card" key={offer.id}><div className="offer-art"><Beef /><span>{offer.saleUnit === "G" ? "por kg" : "por unidade"}</span></div><div className="offer-content"><div className="offer-title"><div><p>{offer.productName}</p><h3>{offer.preparationName}</h3></div><span className="offer-price">{money(offer.amountMinor, offer.currency)}<small>/{offer.saleUnit === "G" ? "kg" : "un."}</small></span></div><p className="offer-range">{formatWeightRange(offer)}</p><button className="offer-button" disabled={offer.displayOnly || offer.saleUnit === "FIXED_PACKAGE"} onClick={() => add(offer)}>{offer.displayOnly ? "Consulte a loja" : offer.saleUnit === "FIXED_PACKAGE" ? "Em breve" : "Adicionar"} {!offer.displayOnly && <Plus />}</button></div></article>)}</section>
    {filteredOffers.length === 0 && <div className="store-empty"><Beef /><h2>Nenhum corte encontrado</h2><p>Tente buscar por outro nome.</p></div>}
    <footer className="store-footer"><span><MapPin /> {catalog.store.name}</span><span>Pagamento na retirada ou entrega</span></footer>
    {cartOpen && <div className="drawer-backdrop" onClick={() => setCartOpen(false)}><aside className="cart-drawer" onClick={event => event.stopPropagation()}><div className="drawer-heading"><div><p className="store-section-kicker">Seu pedido</p><h2>Carrinho</h2></div><button className="icon-button" onClick={() => setCartOpen(false)} aria-label="Fechar carrinho"><X /></button></div>{cart.length === 0 ? <div className="cart-empty"><ShoppingBag /><p>Seu carrinho está vazio.</p></div> : <><div className="cart-lines">{cart.map(line => <div className="cart-line" key={line.offer.id}><div><strong>{line.offer.productName}</strong><span>{line.offer.preparationName}</span><small>{displayQuantity(line.quantity, line.offer.saleUnit)} · {money(line.offer.amountMinor, line.offer.currency)}/{line.offer.saleUnit === "G" ? "kg" : "un."}</small></div><div className="quantity-control"><button onClick={() => change(line.offer.id, -1)} aria-label="Diminuir quantidade"><Minus /></button><b>{line.offer.saleUnit === "G" ? `${(Number(line.quantity) / 1000).toLocaleString("pt-BR")} kg` : line.quantity}</b><button onClick={() => change(line.offer.id, 1)} aria-label="Aumentar quantidade"><Plus /></button><button className="remove-line" onClick={() => remove(line.offer.id)} aria-label="Remover item"><X /></button></div></div>)}</div><div className="cart-summary"><span>Estimativa</span><strong>{money(estimatedTotal)}</strong><small>O total final considera o peso separado no balcão.</small><button className="primary-button checkout-button" onClick={() => { setCartOpen(false); setCheckoutOpen(true) }}>Continuar <ArrowRight /></button></div></>}</aside></div>}
    {checkoutOpen && <Checkout attempt={attempt} catalog={catalog} cart={cart} busy={busy} setBusy={setBusy} result={result} setResult={setResult} onClose={() => setCheckoutOpen(false)} />}
  </main>
}

function Checkout({ attempt, catalog, cart, busy, setBusy, result, setResult, onClose }: { attempt: { current: { body: string; key: string } | null }; catalog: Catalog; cart: CartLine[]; busy: boolean; setBusy: (value: boolean) => void; result: CheckoutResult | null; setResult: (value: CheckoutResult | null) => void; onClose: () => void }) {
  const [error, setError] = useState("")
  const [quote, setQuote] = useState<{ currency: string; estimatedTotalMinor: string } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    setQuote(null); setError("")
    fetch(`/api/public/stores/${encodeURIComponent(catalog.store.slug)}/quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: cart.map(line => ({ offerId: line.offer.id, requestedQty: line.quantity })) }), signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new RequestError(body.error?.message ?? "Não foi possível atualizar a cotação."); return body })
      .then(setQuote).catch(value => { if (!controller.signal.aborted) setError(value instanceof Error ? value.message : "Falha na cotação.") })
    return () => controller.abort()
  }, [catalog.store.slug, cart])
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!quote || busy) return; setBusy(true); setError("")
    const fields = new FormData(event.currentTarget)
    const body = { customerName: fields.get("customerName"), customerPhone: fields.get("customerPhone"), fulfillmentType: fields.get("fulfillmentType"), currency: quote.currency, customerNote: fields.get("customerNote") || null, items: cart.map(line => ({ offerId: line.offer.id, requestedQty: line.quantity, customerNote: null })) }
    const serialized = JSON.stringify(body)
    if (attempt.current?.body !== serialized) attempt.current = { body: serialized, key: crypto.randomUUID() }
    try {
      const response = await fetch(`/api/public/stores/${encodeURIComponent(catalog.store.slug)}/orders`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.current!.key }, body: serialized })
      const payload = await response.json()
      if (!response.ok) throw new RequestError(payload.error?.message ?? "Não foi possível enviar o pedido.")
      setResult(payload as CheckoutResult)
    } catch (value) { setError(value instanceof Error ? value.message : "Não foi possível enviar o pedido.") } finally { setBusy(false) }
  }
  return <div className="modal-backdrop"><section className="checkout-modal" role="dialog" aria-modal="true" aria-labelledby="checkout-title"><div className="drawer-heading"><div><p className="store-section-kicker">Quase lá</p><h2 id="checkout-title">Finalizar pedido</h2></div><button className="icon-button" onClick={onClose} aria-label="Fechar checkout"><X /></button></div>{result ? <div className="checkout-success"><span className="success-icon"><Check /></span><p className="store-section-kicker">Pedido recebido</p><h3>Pedido #{result.publicNumber}</h3><p>Acompanhe o preparo usando o link de acompanhamento.</p><a className="primary-button success-link" href={`/${catalog.store.slug}/pedido/${result.publicNumber}?token=${encodeURIComponent(result.accessToken)}`}>Acompanhar pedido <ArrowRight /></a></div> : <form className="checkout-form" onSubmit={event => void submit(event)}><label>Seu nome<input name="customerName" required maxLength={200} autoFocus /></label><label>Telefone<input name="customerPhone" required maxLength={40} inputMode="tel" /></label><label>Como receber<select name="fulfillmentType" defaultValue="PICKUP"><option value="PICKUP">Retirar na loja</option><option value="DELIVERY">Receber em casa</option></select></label><label>Observação <textarea name="customerNote" maxLength={500} placeholder="Algum cuidado especial no preparo?" /></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="checkout-total"><span>Estimativa dos itens</span><strong>{quote ? money(quote.estimatedTotalMinor, quote.currency) : "Atualizando..."}</strong></div><button className="primary-button checkout-button" disabled={busy || !quote}>{busy ? "Enviando pedido..." : "Enviar pedido"}<ArrowRight /></button><small>O preço final será ajustado após a pesagem.</small></form>}</section></div>
}
