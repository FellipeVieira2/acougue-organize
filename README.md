# Açougue Organize

Aplicação web de gestão para açougues, em implementação com Next.js, React e PostgreSQL. O painel da v0 está integrado ao login e ao catálogo persistido com isolamento entre empresas.

## Desenvolvimento

Node.js 24 e pnpm 11.19.0. Instale com `pnpm install --frozen-lockfile`, copie `.env.example` para `.env.local` e configure um banco de desenvolvimento preparado com as migrations. Execute `pnpm dev`.

`pnpm typecheck`, `pnpm test` e `pnpm build` validam tipos, regras e build. Os testes de banco e HTTP exigem um ambiente efêmero separado, conforme [publicação na Vercel](VERCEL_DEPLOYMENT.md).

## Entrega atual

Login, cadastro inicial opcional, painel autenticado, lojas, criação de produtos com preço, busca, filtro e auditoria. Consulte [estado da implementação](IMPLEMENTATION_STATUS.md) para evidências, limites e continuidade entre Codex e v0.

O build não exige banco, mas o uso da conta e do catálogo exige PostgreSQL configurado. Estoque, pedidos, caixa, cobrança SaaS e recuperação de conta ainda não estão disponíveis nesta interface.

Os documentos de arquitetura e requisitos permanecem como referência de evolução, não como afirmação de funcionalidades entregues.
