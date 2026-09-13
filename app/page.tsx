"use client"

import { useState } from "react"
import { ArrowUpRight, Beef, Boxes, CircleHelp, LayoutDashboard, Menu, PackagePlus, Settings2, Store, Users, X } from "lucide-react"

const navItems = [
  { label: "Visão geral", icon: LayoutDashboard },
  { label: "Catálogo", icon: Beef },
  { label: "Estoque", icon: Boxes },
  { label: "Lojas", icon: Store },
]

const products = [
  { name: "Picanha premium", sku: "BOV-001", unit: "kg", price: "R$ 89,90", status: "Ativo" },
  { name: "Coxão mole", sku: "BOV-014", unit: "kg", price: "R$ 49,90", status: "Ativo" },
  { name: "Linguiça artesanal", sku: "SUÍ-021", unit: "kg", price: "R$ 32,50", status: "Ativo" },
  { name: "Kit churrasco família", sku: "KIT-004", unit: "un", price: "R$ 119,90", status: "Rascunho" },
]

export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [active, setActive] = useState("Visão geral")

  return (
    <main className="app-shell">
      <aside className={menuOpen ? "sidebar sidebar-open" : "sidebar"}>
        <div className="brand"><span className="brand-mark"><Beef /></span><span>Açougue<br /><strong>Organize</strong></span></div>
        <div className="workspace"><span className="workspace-dot" /> Casa do Corte <span className="workspace-caret">⌄</span></div>
        <nav aria-label="Navegação principal">
          <p className="nav-label">Operação</p>
          {navItems.map(({ label, icon: Icon }) => <button key={label} className={active === label ? "nav-item active" : "nav-item"} onClick={() => { setActive(label); setMenuOpen(false) }}><Icon />{label}</button>)}
          <p className="nav-label nav-label-spaced">Administração</p>
          <button className="nav-item" onClick={() => setMenuOpen(false)}><Users />Equipe</button>
          <button className="nav-item" onClick={() => setMenuOpen(false)}><Settings2 />Configurações</button>
        </nav>
        <div className="sidebar-footer"><button className="help-link"><CircleHelp />Central de ajuda</button><div className="user-card"><span className="avatar">FC</span><span><strong>Felipe Costa</strong><small>Administrador</small></span><span className="more">•••</span></div></div>
      </aside>
      {menuOpen && <button className="mobile-overlay" aria-label="Fechar menu" onClick={() => setMenuOpen(false)} />}
      <section className="main-content">
        <header className="topbar"><button className="mobile-menu" aria-label="Abrir menu" onClick={() => setMenuOpen(true)}>{menuOpen ? <X /> : <Menu />}</button><div className="breadcrumbs"><span>Operação</span><b>/</b><strong>{active}</strong></div><div className="topbar-actions"><span className="status-dot" /> Sincronizado <span className="topbar-divider" /><button className="topbar-icon" aria-label="Abrir ajuda"><CircleHelp /></button><span className="top-avatar">FC</span></div></header>
        <div className="content-wrap">
          <div className="page-heading"><div><p className="eyebrow">TERÇA-FEIRA, 12 DE SETEMBRO DE 2026</p><h1>Bom dia, Felipe.</h1><p className="heading-copy">Aqui está o resumo da sua operação hoje.</p></div><button className="primary-button"><PackagePlus /> Novo produto</button></div>
          <div className="metric-grid"><Metric label="Produtos ativos" value="128" detail="+12%" detailCopy="vs. mês anterior" tone="green" /><Metric label="Estoque baixo" value="07" detail="Atenção" detailCopy="itens precisam de reposição" tone="orange" /><Metric label="Vendas hoje" value="R$ 8.420" detail="+8,4%" detailCopy="vs. ontem" tone="green" /><Metric label="Pedidos em aberto" value="24" detail="03 urgentes" detailCopy="aguardando produção" tone="purple" /></div>
          <div className="section-heading"><div><h2>Catálogo de produtos</h2><p>Gerencie os itens disponíveis nas suas lojas.</p></div><button className="text-button" onClick={() => setActive("Catálogo")}>Ver catálogo <ArrowUpRight /></button></div>
          <div className="table-card"><div className="table-toolbar"><div className="search-field"><span>⌕</span><input aria-label="Buscar produto" placeholder="Buscar por nome ou SKU" /></div><button className="filter-button">Todos os status <span>⌄</span></button></div><div className="table-wrap"><table><thead><tr><th>Produto</th><th>SKU</th><th>Unidade</th><th>Preço atual</th><th>Status</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>{products.map((product) => <tr key={product.sku}><td><span className="product-icon"><Beef /></span><strong>{product.name}</strong></td><td className="muted">{product.sku}</td><td className="muted">{product.unit}</td><td>{product.price}</td><td><span className={product.status === "Ativo" ? "badge badge-green" : "badge badge-gray"}>{product.status}</span></td><td><button className="row-more" aria-label={`Mais ações para ${product.name}`}>•••</button></td></tr>)}</tbody></table></div></div>
          <div className="bottom-grid"><div className="insight-card"><div className="insight-icon"><Boxes /></div><div><h3>Estoque merece atenção</h3><p>7 produtos estão abaixo do estoque mínimo configurado.</p></div><button className="arrow-button" aria-label="Ver estoque"><ArrowUpRight /></button></div><div className="activity-card"><div className="activity-head"><h3>Atividade recente</h3><button className="text-button">Ver tudo</button></div><Activity text="Preço atualizado" item="Picanha premium" time="há 12 min" /><Activity text="Produto cadastrado" item="Kit churrasco família" time="há 1 h" /></div></div>
        </div>
      </section>
    </main>
  )
}

function Metric({ label, value, detail, detailCopy, tone }: { label: string; value: string; detail: string; detailCopy: string; tone: string }) { return <article className="metric-card"><p>{label}</p><strong>{value}</strong><span className={`metric-detail ${tone}`}>{detail}</span><small>{detailCopy}</small></article> }
function Activity({ text, item, time }: { text: string; item: string; time: string }) { return <div className="activity-row"><span className="activity-dot" /><div><strong>{text}</strong><p>{item}</p></div><time>{time}</time></div> }
