# Fundação PostgreSQL

A migration 0001 cria organização, loja, produto, revisão de preço e auditoria com RLS, FKs compostas e role de runtime sem login e sem bypass. É a primeira parte do modelo V1; não inclui autenticação, pedidos, billing ou estoque ainda.

O papel usado pela API futura deve herdar somente os privilégios necessários de `acougue_runtime`, com senha obtida de secret manager. Nunca usar a conta de migration/superuser para servir requests. O servidor deve autenticar Membership antes de definir `app.organization_id` dentro da transação com `set_config(..., true)`. RLS protege queries, mas não substitui autenticação nem torna seguro aceitar tenantId arbitrário do usuário.

O ensaio de CI usa banco efêmero vazio e `SET LOCAL ROLE acougue_runtime`; dados de teste são fictícios. `DATABASE_TEST_URL` precisa apontar a banco de teste com nome terminado em `_test`. A suíte recusa outro nome e recusa schema `app` preexistente; não apaga banco/schema para preparar teste.

Execução: `pnpm test:integration`. Requer PostgreSQL 17 e privilégios de criação de role/schema no banco de teste. Sem URL, o teste falha explicitamente; não é ignorado. O runner versionado aplica as três migrations com checksum e lock transacional, sem permitir que o BEGIN/COMMIT da fundação encerre a transação externa. A suíte também verifica rollback de instalação, reaplicação concorrente, alteração de checksum, proprietário inicial e precisão de preços.

## Bancos inicializados anteriormente

A versão anterior de `0003_organization_membership.sql` escrevia o checksum fictício `applied-through-neon-mcp`. Esse autorregistro foi removido: somente o runner registra migrations. Um banco com esse marcador ou com checksum da versão anterior deve ser inspecionado e ter seu schema comparado às migrations antes de receber um baseline administrativo. O runner recusa divergências; não substitui checksums nem apaga dados automaticamente. Esta revisão não altera bancos remotos existentes.

A role `acougue_runtime` é global ao cluster. O ensaio completo exige um cluster efêmero onde essa role ainda não exista; provisionamento em clusters compartilhados e baseline de instalações manuais ainda precisam de procedimento próprio.

Referência: [Row Security Policies — PostgreSQL](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).
