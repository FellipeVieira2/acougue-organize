# Fundação PostgreSQL

A migration 0001 cria organização, loja, produto, revisão de preço e auditoria com RLS, FKs compostas e role de runtime sem login e sem bypass. É a primeira parte do modelo V1; não inclui autenticação, pedidos, billing ou estoque ainda.

O papel usado pela API futura deve herdar somente os privilégios necessários de `acougue_runtime`, com senha obtida de secret manager. Nunca usar a conta de migration/superuser para servir requests. O servidor deve autenticar Membership antes de definir `app.organization_id` dentro da transação com `set_config(..., true)`. RLS protege queries, mas não substitui autenticação nem torna seguro aceitar tenantId arbitrário do usuário.

O ensaio de CI usa banco efêmero vazio e `SET LOCAL ROLE acougue_runtime`; dados de teste são fictícios. `DATABASE_TEST_URL` precisa apontar a banco de teste com nome terminado em `_test`. A suíte recusa outro nome e recusa schema `app` preexistente; não apaga banco/schema para preparar teste.

Execução: `pnpm test:integration`. Requer PostgreSQL 17 e privilégios de criação de role/schema no banco de teste. Sem URL, o teste falha explicitamente; não é ignorado. A migration tem transação e deve ser executada uma vez por banco. O runner versionado com checksum e migrations incrementais ainda faz parte de E01 pendente.

Referência: [Row Security Policies — PostgreSQL](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).
