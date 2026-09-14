export default function HomePage() {
  return (
    <main className="min-h-screen bg-background px-6 py-12 text-foreground">
      <div className="mx-auto flex max-w-5xl flex-col gap-10">
        <header className="flex flex-col gap-3">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Açougue Organize</p>
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">Operação simples para vender melhor.</h1>
          <p className="max-w-xl text-base leading-7 text-muted-foreground">Gerencie catálogo, pedidos online e a rotina do seu açougue em um só lugar.</p>
        </header>

        <section className="grid gap-4 sm:grid-cols-2" aria-label="Acessos principais">
          <a href="/loja" className="rounded-2xl border border-border bg-card p-6 shadow-sm transition-colors hover:bg-accent">
            <span className="text-lg font-semibold">Abrir loja online</span>
            <span className="mt-2 block text-sm text-muted-foreground">Veja o catálogo e simule um pedido como cliente.</span>
          </a>
          <a href="/" className="rounded-2xl border border-border bg-card p-6 shadow-sm transition-colors hover:bg-accent">
            <span className="text-lg font-semibold">Acessar operação</span>
            <span className="mt-2 block text-sm text-muted-foreground">Abra o painel operacional do açougue.</span>
          </a>
        </section>
      </div>
    </main>
  )
}
