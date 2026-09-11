# Estado de implementação

Atualizado em 2026-09-10.

| Entrega | Estado | Evidência |
|---|---|---|
| Arquitetura operacional V1 | Elaborada | BUTCHER_PLATFORM_ARCHITECTURE_V1.md |
| Arquitetura SaaS V1 | Elaborada | SAAS_PLATFORM_ARCHITECTURE_V1.md |
| Modelo de dados V1 | Elaborado | DATABASE_SCHEMA_V1.md |
| Contrato da API V1 | Elaborado | API_CONTRACT_V1.md |
| Plano de implementação | Elaborado | MVP_IMPLEMENTATION_PLAN.md |
| Núcleo de regras TypeScript | Implementado e validado localmente | packages/domain/src; 17 testes unitários passaram, typecheck e build passaram |
| Fundação PostgreSQL | Schema aplicado e runtime inicial implementado | Neon: schema `app`, RLS, role `acougue_runtime` e ledger `public.schema_migrations` aplicados; `packages/domain/src/database.ts` e `migrations.ts` adicionados |
| CI | Workflow preparado | .github/workflows/ci.yml; aguarda execução remota |
| API, autenticação e interfaces | Em andamento | Autorização por membership implementada no domínio; autenticação e rotas ainda pendentes |
| Produção/homologação | Pendente | Não liberado para operação real |

Especificações são o projeto de implementação. Rotas, tabelas e módulos descritos não devem ser anunciados como já funcionais. O plano completo permanece aberto até haver evidência por requisito.

## Limites da validação atual

Os testes unitários cobrem cálculo inteiro, tolerância, guardas de pedido/pagamento, limites/overrides e rateio de produção. Não provam idempotência transacional, isolamento de aplicação, concorrência real, integração com gateway, offline ou operação comercial. Helpers puros de quota exigem lock no serviço; helpers de transição exigem autorização, versão e persistência na aplicação.
