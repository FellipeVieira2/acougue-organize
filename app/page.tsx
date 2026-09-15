"use client"

import useSWR from "swr"
import { StockPanel } from './components/stock-panel.tsx'
import { OrderWeighing } from "./components/order-weighing.tsx"
import { useEffect, useState, type FormEvent } from "react"
import { ArrowUpRight, Beef, Boxes, ClipboardList, LayoutDashboard, Menu, PackagePlus, Store, X } from "lucide-react"
import { formatBRL, priceToMinor } from "../lib/money.ts"
import { resolveSelectedStore } from "../lib/store.ts"

const navItems = [{ label: "Visão geral", icon: LayoutDashboard }, { label: "Catálogo", icon: Beef }, { label: "Pedidos", icon: ClipboardList }, { label: "Estoque", icon: Boxes }, { label: "Lojas", icon: Store }]
type DashboardProduct = { id: string; name: string; sku: string; stock_unit: string; active: boolean; version: string; amountMinor: string | null }
type DashboardOrder = { id: string; publicNumber: string; customerName: string; fulfillmentType: string; fulfillmentStatus: string; estimatedTotalMinor: string; finalTotalMinor: string | null; createdAt: string }
type DashboardData = { organization: { name: string; status: string }; email: string; role: string; canCreateProduct: boolean; priceStore: string | null; selectedStoreId: string | null; selectedStoreName: string | null; hasMore: boolean; stores: { id: string; name: string; slug: string; active: boolean }[]; products: DashboardProduct[]; orders: DashboardOrder[]; activity: { id: string; action: string; reason: string | null; created_at: string }[] }
class HttpError extends Error { readonly status: number; constructor(message: string, status: number) { super(message); this.status = status } }
async function api(url: string, body?: unknown) {
  const response = await fetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const result = await response.json()
  if (!response.ok) throw new HttpError(result.error?.message ?? "Não foi possível concluir. Tente novamente.", response.status)
  return result
}
const roleLabels: Record<string, string> = { OWNER: "Proprietário", ADMIN: "Administrador", MANAGER: "Gerente", OPERATOR: "Operador", VIEWER: "Consulta" }
const actionLabels: Record<string, string> = { "organization.created": "Empresa cadastrada", "product.created": "Produto cadastrado", "product.updated": "Produto atualizado", "membership.created": "Membro adicionado" }

export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [active, setActive] = useState("Visão geral")
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("all")
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<DashboardProduct | null>(null)
  const [message, setMessage] = useState("")
  const [signingOut, setSigningOut] = useState(false)
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null)
  const dashboardKey = selectedStoreId ? `/api/dashboard?storeId=${encodeURIComponent(selectedStoreId)}` : "/api/dashboard"
  const { data, error, isLoading, isValidating, mutate } = useSWR<DashboardData, HttpError>(dashboardKey, api, { shouldRetryOnError: false })
  useEffect(() => {
    if (!data) return
    const resolved = resolveSelectedStore(data.stores, selectedStoreId ?? data.selectedStoreId ?? null)
    if (resolved && resolved.id !== selectedStoreId) setSelectedStoreId(resolved.id)
  }, [data, selectedStoreId])
  if (error?.status === 401) return <Access onSuccess={async () => { setSearch(""); setStatus("all"); setMessage(""); setCreating(false); setEditing(null); await mutate() }} />
  if (error?.status === 403) return <main className="access-shell"><section className="access-card"><Brand /><h1>Acesso indisponível</h1><p>Seu acesso a esta empresa não está ativo.</p><button className="primary-button" onClick={() => void api("/api/auth/logout", {}).then(() => mutate(undefined)).catch(() => setMessage("Não foi possível sair. Tente novamente."))}>Sair</button><p role="alert">{message}</p></section></main>
  if (!data) return <main className="access-shell"><section className="access-card"><Brand /><h1>{isLoading ? "Abrindo sua operação…" : "Não foi possível abrir o painel"}</h1>{error && <><p role="alert">O serviço está indisponível no momento. Tente novamente em alguns instantes.</p><button className="primary-button" onClick={() => void mutate()}>Tentar novamente</button></>}</section></main>
  const selectedStore = resolveSelectedStore(data.stores, selectedStoreId ?? data.selectedStoreId ?? null)
  const products = data.products.filter(product => `${product.name} ${product.sku}`.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")) && (status === "all" || product.active === (status === "active")))
  const initials = data.email.slice(0, 2).toUpperCase()
  async function signOut() {
    setSigningOut(true)
    try { await api("/api/auth/logout", {}); setCreating(false); setEditing(null); await mutate(undefined) }
    catch { setMessage("Não foi possível sair. Tente novamente.") }
    finally { setSigningOut(false) }
  }
  return <main className="app-shell">
    <aside className={menuOpen ? "sidebar sidebar-open" : "sidebar"}>
      <Brand /><div className="workspace"><span className="workspace-dot" />{data.organization.name}</div>
      <nav aria-label="Navegação principal"><p className="nav-label">Operação</p>{navItems.map(({ label, icon: Icon }) => <button key={label} className={active === label ? "nav-item active" : "nav-item"} aria-current={active === label ? "page" : undefined} onClick={() => { setActive(label); setMenuOpen(false) }}><Icon />{label}</button>)}</nav>
      <div className="sidebar-footer"><div className="user-card"><span className="avatar">{initials}</span><span className="user-identity"><strong>{data.email}</strong><small>{roleLabels[data.role] ?? data.role}</small></span></div><button className="text-button" disabled={signingOut} onClick={() => void signOut()}>{signingOut ? "Saindo…" : "Sair da conta"}</button></div>
    </aside>
    {menuOpen && <button className="mobile-overlay" aria-label="Fechar menu" onClick={() => setMenuOpen(false)} />}
    <section className="main-content">
      <header className="topbar"><button className="mobile-menu" aria-label="Abrir menu" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button><div className="breadcrumbs"><span>Operação</span><b>/</b><strong>{active}</strong></div><div className="topbar-actions"><span className="status-dot" />{error ? "Atualização pendente" : isValidating ? "Atualizando…" : "Atualizado"}<span className="topbar-divider" /><span className="top-avatar">{initials}</span></div></header>
      <div className="content-wrap">
        <div className="page-heading"><div><p className="eyebrow">SUA OPERAÇÃO, EM UM SÓ LUGAR</p><h1>{active === "Visão geral" ? "Visão geral da operação" : active}</h1><p className="heading-copy">{data.organization.name}</p></div>{data.canCreateProduct && active !== "Estoque" && <button className="primary-button" onClick={() => { setActive("Catálogo"); setCreating(true); setEditing(null); setMessage("") }}><PackagePlus />Novo produto</button>}</div>
        {data.stores.length > 0 && <div className="table-card store-selector"><label htmlFor="store-selector">Loja ativa</label><select id="store-selector" value={selectedStore?.id ?? data.stores[0]!.id} onChange={event => { setSelectedStoreId(event.target.value); setMessage("") }}><option value="" disabled={!selectedStore}>Selecione a loja</option>{data.stores.map(store => <option key={store.id} value={store.id}>{store.name}{store.active ? " (ativa)" : " (inativa)"}</option>)}</select></div>}
        {error && <div className="status-banner" role="alert">Não foi possível atualizar os dados. <button className="text-button" onClick={() => void mutate()}>Tentar novamente</button></div>}
        {message && <div className="status-banner" role="status">{message}</div>}
        {active === "Pedidos" ? <OrderQueue key={selectedStore?.id ?? "none"} orders={data.orders} onChanged={() => mutate()} /> : active === "Estoque" ? <StockPanel key={selectedStore?.id ?? "none"} storeId={selectedStore?.id ?? null} canAdjust={data.canCreateProduct} /> : active === "Lojas" ? <section className="table-card"><div className="section-heading"><h2>Suas lojas</h2></div>{data.stores.map(store => <div className="activity-row" key={store.id}><Store /><strong>{store.name}</strong><span className={store.active ? "badge badge-green" : "badge badge-gray"}>{store.active ? "Ativa" : "Inativa"}</span>{store.active && <StoreLink slug={store.slug} />}</div>)}</section> : <>
          {active === "Visão geral" && <div className="metric-grid"><Metric label="Produtos carregados" value={String(data.products.length)} detail={data.hasMore ? "Primeiros 200" : "Catálogo"} /><Metric label="Lojas ativas" value={String(data.stores.filter(store => store.active).length)} detail="Operação" /><Metric label="Produtos com preço" value={String(data.products.filter(product => product.amountMinor !== null).length)} detail={selectedStore?.name ?? data.priceStore ?? "Sem loja ativa"} /><Metric label="Eventos recentes" value={String(data.activity.length)} detail="Até 5 registros" /></div>}
          {editing && <EditProduct key={`${editing.id}:${editing.version}`} product={editing} onCancel={() => setEditing(null)} onReload={async () => { const fresh = await mutate(); const current = fresh?.products.find(product => product.id === editing.id); if (current) setEditing(current); else { setEditing(null); setMessage("Produto indisponível. Atualize a busca.") } }} onSuccess={async () => { setEditing(null); setMessage("Produto atualizado com sucesso."); await mutate() }} />}
          {creating && <ProductForm storeId={selectedStore?.id ?? null} storeName={selectedStore?.name ?? data.priceStore} onCancel={() => setCreating(false)} onSuccess={async () => { setCreating(false); setMessage("Produto cadastrado com sucesso."); await mutate() }} />}
          <div className="section-heading"><div><h2>Catálogo de produtos</h2><p>Preços de venda em {data.priceStore ?? "uma loja ativa"}. Produtos pesáveis têm preço por kg.</p></div>{active === "Visão geral" && <button className="text-button" onClick={() => setActive("Catálogo")}>Ver catálogo <ArrowUpRight /></button>}</div>
          {data.hasMore && <div className="status-banner">Mostrando os 200 produtos mais recentes. A busca considera apenas esses produtos.</div>}
          <div className="table-card"><div className="table-toolbar"><div className="search-field"><span>⌕</span><input aria-label="Buscar produto" placeholder="Buscar por nome ou SKU" value={search} onChange={event => setSearch(event.target.value)} /></div><select className="filter-button" aria-label="Filtrar por status" value={status} onChange={event => setStatus(event.target.value)}><option value="all">Todos os status</option><option value="active">Ativos</option><option value="inactive">Inativos</option></select></div><div className="table-wrap"><table><thead><tr><th>Produto</th><th>SKU</th><th>Unidade de venda</th><th>Preço atual</th><th>Status</th>{data.canCreateProduct && <th><span className="sr-only">Ações</span></th>}</tr></thead><tbody>{products.map(product => <tr key={product.id}><td><span className="product-icon"><Beef /></span><strong>{product.name}</strong></td><td className="muted">{product.sku}</td><td className="muted">{product.stock_unit === "G" ? "kg" : "un"}</td><td>{formatBRL(product.amountMinor)}</td><td><span className={product.active ? "badge badge-green" : "badge badge-gray"}>{product.active ? "Ativo" : "Inativo"}</span></td>{data.canCreateProduct && <td><button className="text-button" aria-label={`Editar ${product.name}`} onClick={() => { setEditing(product); setCreating(false); setMessage("") }}>Editar</button></td>}</tr>)}</tbody></table>{products.length === 0 && <p className="empty-state">{search || status !== "all" ? "Nenhum produto encontrado para esse filtro." : "Seu catálogo está vazio. Cadastre o primeiro produto para começar."}</p>}</div></div>
          {active === "Visão geral" && <div className="bottom-grid"><div className="insight-card"><div className="insight-icon"><Boxes /></div><div><h3>Organize seu catálogo</h3><p>Cadastre produtos e preços para preparar sua operação.</p></div></div><div className="activity-card"><div className="activity-head"><h3>Atividade recente</h3></div>{data.activity.length === 0 && <p>Nenhuma atividade registrada.</p>}{data.activity.map(event => <div className="activity-row" key={event.id}><span className="activity-dot" /><div><strong>{actionLabels[event.action] ?? "Alteração registrada"}</strong></div><time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}</time></div>)}</div></div>}
        </>}
      </div>
    </section>
  </main>
}
function Brand() { return <div className="brand"><span className="brand-mark"><Beef /></span><span>Açougue<br /><strong>Organize</strong></span></div> }
function Metric({ label, value, detail }: { label: string; value: string; detail: string }) { return <article className="metric-card"><p>{label}</p><strong>{value}</strong><span className="metric-detail green">{detail}</span></article> }
function orderStatusLabel(status: string) { return ({ RECEIVED: "Novo", CONFIRMED: "Confirmado", SEPARATING: "Em separação", WEIGHING: "Pesagem", WAITING_CUSTOMER_APPROVAL: "Aguardando cliente", WEIGHT_ADJUSTED: "Peso aprovado", READY: "Pronto" } as Record<string, string>)[status] ?? status }
function OrderQueue({ orders, onChanged }: { orders: DashboardOrder[]; onChanged: () => Promise<unknown> }) {
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")
  async function advance(order: DashboardOrder) {
    const status = order.fulfillmentStatus === "RECEIVED" ? "CONFIRMED" : "SEPARATING"
    setBusy(order.id); setError("")
    try {
      const response = await fetch(`/api/orders/${order.id}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error?.message ?? "Não foi possível atualizar o pedido.")
      await onChanged()
    } catch (value) { setError(value instanceof Error ? value.message : "Não foi possível atualizar o pedido.") }
    finally { setBusy(null) }
  }
  async function operate(order: DashboardOrder, operation: "ready" | "complete" | "cancel") {
    setBusy(order.id); setError("")
    try {
      const body = operation === "cancel" ? { reason: "Cancelado pela operação" } : operation === "complete" ? { fulfillmentType: order.fulfillmentType } : {}
      const response = await fetch(`/api/orders/${order.id}/${operation}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error?.message ?? "Não foi possível atualizar o pedido.")
      await onChanged()
    } catch (value) { setError(value instanceof Error ? value.message : "Não foi possível atualizar o pedido.") }
    finally { setBusy(null) }
  }
  if (selectedOrder) return <OrderWeighing key={selectedOrder} orderId={selectedOrder} onClose={() => setSelectedOrder(null)} onChanged={onChanged} />
  return <section className="table-card order-queue"><div className="section-heading"><div><p className="eyebrow">OPERAÇÃO</p><h2>Fila de pedidos</h2><p>Confirme a entrada e inicie a separação na bancada.</p></div></div>{error && <div className="status-banner" role="alert">{error}</div>}{orders.length === 0 ? <div className="empty-state"><ClipboardList /><h2>Nenhum pedido pendente</h2><p>Quando chegar um pedido online, ele aparecerá aqui.</p></div> : <div className="order-list">{orders.map(order => <article className="order-row" key={order.id}><div className="order-main"><span className="order-number">#{order.publicNumber}</span><strong>{order.customerName}</strong><small>{order.fulfillmentType === "DELIVERY" ? "Entrega" : "Retirada"} · {new Date(order.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</small></div><span className="badge badge-orange">{orderStatusLabel(order.fulfillmentStatus)}</span><strong className="order-total">{formatBRL(order.finalTotalMinor ?? order.estimatedTotalMinor)}</strong>{order.fulfillmentStatus === "RECEIVED" || order.fulfillmentStatus === "CONFIRMED" ? <button className="filter-button" disabled={busy === order.id} onClick={() => void advance(order)}>{busy === order.id ? "Atualizando…" : order.fulfillmentStatus === "RECEIVED" ? "Confirmar" : "Iniciar separação"}</button> : null}{order.fulfillmentStatus === "WEIGHT_ADJUSTED" ? <button className="filter-button" disabled={busy === order.id} onClick={() => void operate(order, "ready")}>Marcar pronto</button> : null}{order.fulfillmentStatus === "READY" ? <button className="filter-button" disabled={busy === order.id} onClick={() => void operate(order, "complete")}>Concluir</button> : null}{!['COMPLETED', 'CANCELED'].includes(order.fulfillmentStatus) ? <button className="text-button" disabled={busy === order.id} onClick={() => void operate(order, "cancel")}>Cancelar</button> : null}<button className="text-button" onClick={() => setSelectedOrder(order.id)}>Ver itens e pesagem</button></article>)}</div>}</section>
}
function Access({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [registering, setRegistering] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("")
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("")
    const fields = new FormData(event.currentTarget)
    try { await api(`/api/auth/${registering ? "register" : "login"}`, { email: fields.get("email"), password: fields.get("password"), ...(registering ? { name: fields.get("name") } : {}) }); await onSuccess() }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Não foi possível entrar.") }
    finally { setBusy(false) }
  }
  return <main className="login-layout"><aside className="login-story"><Brand /><div><p className="login-kicker">GESTÃO PARA AÇOUGUES</p><h2>Mais controle no balcão.<br/>Mais tempo para o seu negócio.</h2><p>Organize produtos, acompanhe pedidos e cuide da operação da sua loja em um só lugar.</p><div className="login-points"><span><Beef />Seu catálogo organizado</span><span><ClipboardList />Pedidos do início ao preparo</span><span><Boxes />Estoque sob controle</span></div></div><small>Açougue Organize · Sua operação, em um só lugar.</small></aside><section className="login-entry"><div className="access-card"><p className="eyebrow">ÁREA DO AÇOUGUE</p><h1>{registering ? "Comece a organizar seu açougue" : "Bem-vindo de volta"}</h1><p>Entre na sua conta para acessar o painel da sua loja.</p><form className="editor-form" onSubmit={event => void submit(event)}>{registering && <label>Nome do açougue<input name="name" required maxLength={200} autoComplete="organization" /></label>}<label>E-mail<input name="email" type="email" required maxLength={254} autoComplete="username" /></label><label>Senha<input name="password" type="password" required minLength={registering ? 12 : 1} maxLength={256} autoComplete={registering ? "new-password" : "current-password"} /></label>{registering && <small>Use pelo menos 12 caracteres. Novos cadastros dependem da liberação do serviço.</small>}{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy}>{busy ? "Aguarde…" : registering ? "Criar conta" : "Entrar no painel"}</button></form><button className="text-button access-switch" disabled={busy} onClick={() => { setRegistering(!registering); setError("") }}>{registering ? "Já tenho uma conta" : "Criar uma conta"}</button><p className="login-note">Quer fazer um pedido? Acesse o link da loja enviado pelo seu açougue.</p></div></section></main>
}
function ProductForm({ onSuccess, onCancel, storeId, storeName }: { onSuccess: () => Promise<void>; onCancel: () => void; storeId: string | null; storeName: string | null }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [unit, setUnit] = useState("G")
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("")
    const fields = new FormData(event.currentTarget)
    try { await api("/api/products", { name: fields.get("name"), sku: fields.get("sku"), stockUnit: unit, amountMinor: priceToMinor(String(fields.get("price"))), storeId: storeId ?? undefined }); await onSuccess() }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Não foi possível salvar.") }
    finally { setBusy(false) }
  }
  return <section className="table-card product-editor" aria-labelledby="new-product-title"><h2 id="new-product-title">Novo produto</h2><p>Preço inicial para {storeName ?? "sua loja"}.</p><form className="editor-form product-fields" onSubmit={event => void submit(event)}><label>Nome<input name="name" required maxLength={200} autoFocus /></label><label>SKU<input name="sku" required maxLength={80} /></label><label>Venda por<select name="stockUnit" value={unit} onChange={event => setUnit(event.target.value)}><option value="G">Quilo (kg)</option><option value="UNIT">Unidade</option></select></label><label>Preço por {unit === "G" ? "kg" : "unidade"} (R$)<input name="price" required inputMode="decimal" placeholder="39,90" maxLength={19} /></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="filter-button" disabled={busy} onClick={onCancel}>Cancelar</button><button className="primary-button" disabled={busy || !storeName}>{busy ? "Salvando…" : "Salvar produto"}</button></div></form></section>
}

function EditProduct({ product, onSuccess, onCancel, onReload }: { product: DashboardProduct; onSuccess: () => Promise<void>; onCancel: () => void; onReload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [conflict, setConflict] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("")
    const fields = new FormData(event.currentTarget)
    try { await api(`/api/products/${product.id}`, { name: fields.get("name"), active: fields.get("active") === "true", expectedVersion: product.version }); await onSuccess() }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Não foi possível salvar."); setConflict(failure instanceof HttpError && failure.status === 409) }
    finally { setBusy(false) }
  }
  async function reload() {
    setBusy(true)
    try { await onReload() } catch { setError("Não foi possível recarregar. Tente novamente.") } finally { setBusy(false) }
  }
  return <section className="table-card product-editor" aria-labelledby="edit-product-title"><h2 id="edit-product-title">Editar produto</h2><p>SKU: {product.sku}. O preço atual será mantido.</p><form className="editor-form product-fields" onSubmit={event => void submit(event)}><label>Nome<input name="name" defaultValue={product.name} required maxLength={200} autoFocus /></label><label>Status<select name="active" defaultValue={String(product.active)}><option value="true">Ativo</option><option value="false">Inativo</option></select></label><small>Inativar mantém o produto e seu histórico no catálogo.</small>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="filter-button" disabled={busy} onClick={onCancel}>Cancelar</button>{conflict && <button type="button" className="filter-button" disabled={busy} onClick={() => void reload()}>Recarregar dados</button>}<button className="primary-button" disabled={busy || conflict}>{busy ? "Salvando…" : "Salvar alterações"}</button></div></form></section>
}

function StoreLink({slug}:{slug:string}) {
 const [copied,setCopied]=useState(false),[error,setError]=useState('');
 async function copy(){try{await navigator.clipboard.writeText(new URL('/'+encodeURIComponent(slug),window.location.origin).href);setCopied(true);setError('');}catch{setError('Abra a página da loja e copie o endereço do navegador.');}}
 return <div className="store-share"><a className="text-button" href={'/'+encodeURIComponent(slug)} target="_blank" rel="noopener noreferrer">Ver página de vendas</a><button className="filter-button" onClick={()=>void copy()}>{copied?'Link copiado':'Copiar link para clientes'}</button>{error&&<small role="alert">{error}</small>}</div>;
}
