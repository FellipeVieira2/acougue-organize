# Estado de implementação

Atualizado em 2026-09-11.

| Entrega | Estado | Evidência |
|---|---|---|
| Arquitetura operacional V1 | Elaborada | BUTCHER_PLATFORM_ARCHITECTURE_V1.md |
| Arquitetura SaaS V1 | Elaborada | SAAS_PLATFORM_ARCHITECTURE_V1.md |
| Modelo de dados V1 | Elaborado | DATABASE_SCHEMA_V1.md |
| Contrato da API V1 | Elaborado | API_CONTRACT_V1.md |
| Plano de implementação | Elaborado | MVP_IMPLEMENTATION_PLAN.md |
| Núcleo de regras TypeScript | Implementado e validado localmente | packages/domain/src; 23 testes unitários passaram, typecheck e build passaram |
| Fundação PostgreSQL | Schema aplicado e runtime inicial implementado | Neon: schema `app`, RLS, role `acougue_runtime` e ledger `public.schema_migrations` aplicados; `packages/domain/src/database.ts` e `migrations.ts` adicionados |
| CI | Workflow preparado | .github/workflows/ci.yml; aguarda execução remota |
| API, autenticação e interfaces | Em andamento | Validação estrita de DTOs, headers If-Match/Idempotency-Key e respostas de erro implementadas no domínio; autenticação e adaptadores HTTP ainda pendentes |
| Produção/homologação | Pendente | Não liberado para operação real |

## Revisão de código e próximo marco

Correções: onboarding cria OWNER/ACTIVE na mesma transação da empresa e loja; preços trafegam como texto inteiro até o PostgreSQL sem perda de precisão; validação rejeita overflow e representações ambíguas. O runner serializa instalações concorrentes, controla a transação da fundação e é o único responsável pelo registro das migrations.

A suíte de integração foi ampliada para dez casos, além de verificações de rollback, concorrência e checksum na preparação. Ainda não foi executada nesta revisão: PostgreSQL local indisponível. O schema Neon citado acima consta da atualização anterior do repositório e não foi reinspecionado nesta sessão. Bancos com a migração antiga exigem baseline revisado conforme `database/README.md`.

Próximo marco: executar a suíte PostgreSQL e implementar autenticação/adaptador HTTP. Antes de expor rotas, retirar operações sem autorização da superfície pública, exigir identidade autenticada no gerenciamento de membros e manter a autorização na mesma transação das alterações. Hoje os helpers exportados e a existência de wrappers autorizados não constituem uma API segura pronta para uso.

Especificações são o projeto de implementação. Rotas, tabelas e módulos descritos não devem ser anunciados como já funcionais. O plano completo permanece aberto até haver evidência por requisito.

## Limites da validação atual

Os testes unitários cobrem cálculo inteiro, tolerância, guardas de pedido/pagamento, limites/overrides e rateio de produção. Não provam idempotência transacional, isolamento de aplicação, concorrência real, integração com gateway, offline ou operação comercial. Helpers puros de quota exigem lock no serviço; helpers de transição exigem autorização, versão e persistência na aplicação.
