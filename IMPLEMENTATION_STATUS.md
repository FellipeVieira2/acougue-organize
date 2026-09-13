# Integração web e continuidade com a v0

A integração foi consolidada na main em dde6323, após o painel da v0 da PR #5. O painel verde, CSS, SWR e configuração Next.js da v0 foram preservados e conectados à autenticação do servidor.

## Funcionando nesta etapa

- Cadastro de empresa, matriz e proprietário na mesma transação, habilitado por ALLOW_SIGNUP.
- Login, sessão revogável em cookie HttpOnly, logout e limitação persistida de tentativas por e-mail.
- Painel autenticado: empresa, lojas, produtos, preços da primeira loja ativa e últimas cinco atividades reais.
- Cadastro atômico de produto e preço inicial, busca e filtro de status.
- Edição de nome, ativação e inativação com versão exata, proteção contra edições simultâneas e auditoria na mesma transação.
- Permissão validada na mesma transação da operação, com bloqueio contra revogação concorrente.
- Valores monetários integrais até a exibição, sem perda de centavos.
- Build Next.js para Vercel, sem dependência do banco durante o build.

## Evidências locais

Em 13/09/2026: 33 testes unitários, 13 testes com PostgreSQL 17 e um fluxo HTTP passaram, assim como a checagem TypeScript e o build de produção. O teste HTTP cobre também a rota de dashboard criada pela v0: cabeçalhos de identidade falsos não autenticam, dados da segunda empresa não aparecem na primeira, respostas não são cacheadas e logout invalida o acesso. Cadastro, inclusão e edição de produto foram conferidos pelo navegador local. O fluxo HTTP ampliado valida duas edições simultâneas (uma resposta 200 e uma 409), auditoria única, inativação/reativação, manutenção do preço e bloqueio de edição entre empresas. Os 13 testes de banco da consolidação continuam como evidência da fundação; nesta etapa foram repetidos os 33 unitários e o fluxo HTTP com PostgreSQL.

Essa evidência não confirma a configuração do banco nem o deployment remoto.

## Próximas implementações

Recuperação/verificação de e-mail, convites, escolha de empresa/loja, paginação completa, edição de preços com revisão concorrente, estoque, pedidos, caixa e billing. O painel informa o limite dos 200 produtos carregados. Estoque tem estado explícito de funcionalidade em preparação, sem números demonstrativos.

O adaptador de domínio http.ts exige autenticação injetada pelo servidor. Ele não está exposto como rota Next e não implementa persistência de idempotência; validar o cabeçalho não equivale a garantir reexecução segura. As rotas web concretas usam as próprias transações autorizadas.

## Trabalhando entre Codex e v0

Antes de uma nova alteração, atualize a partir da main. A PR #3 foi encerrada porque sua implementação foi incorporada à consolidação. Preserve lib/auth.ts, lib/web.ts, os testes e as validações de sessão nas rotas. A interface não deve escolher empresa, ator ou permissões por cabeçalhos ou variáveis NEXT_PUBLIC. Nunca restaure a antiga consulta de dashboard sem sessão.

A PR #3 continha a base anterior de autenticação. Esta integração parte da main mais recente e incorpora essa base; não sobreponha o painel da v0 com a interface antiga daquela etapa.
