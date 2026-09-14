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
- Primeira fatia do domínio de açougue: preparos, estoque físico, ofertas, saldo, movimentos e reservas com isolamento RLS.
- Operações autorizadas de criação de preparo/estoque/oferta, ajuste de saldo com ledger e reserva condicional sem overselling.
- Fundação de pedidos: `sales_order`, `order_item` com snapshot, `order_event`, estados separados e vínculo explícito entre reserva e item.
- Caso de uso transacional de criação de pedido interno: preço vigente no servidor, cálculo estimado, snapshot, reserva e evento com rollback conjunto.
- Operação transacional de pesagem: peso final, validação de faixa/teto, consumo físico, liberação do excedente, total final e espera por aprovação quando necessário.
- Aprovação transacional de item pesado: resolve itens fora da faixa, recalcula o total final quando o pedido fica completo e registra `ORDER_ITEM_APPROVED` sem novo consumo de estoque.
- Catálogo público por slug de loja, com ofertas publicadas, preparo, limites de peso e preço vigente.
- Quote público recalculado no servidor, com validação de ofertas, quantidades, moeda e total estimado.
- Checkout convidado transacional em `/api/public/stores/{slug}/orders`, com snapshot de preço, reserva atômica, token de acompanhamento derivado no servidor e `Idempotency-Key`.
- Consulta pública protegida por token em `/api/public/stores/{slug}/orders/{publicNumber}?token=...`, sem permitir acesso apenas pelo número do pedido.
- Storefront público em `/{storeSlug}` com busca de cortes, apresentação, peso, carrinho e checkout convidado responsivo.
- Página de acompanhamento em `/{storeSlug}/pedido/{publicNumber}` com token, status, itens, peso e total estimado/final.
- Aprovação pública de peso via token em `/api/public/stores/{slug}/orders/{publicNumber}/approve`, sem nova movimentação de estoque.
- Fila administrativa de pedidos no dashboard, com confirmação e início de separação autorizados para operadores.

## Evidências locais

Em 13/09/2026: 33 testes unitários, 14 testes com PostgreSQL 17 e um fluxo HTTP passaram, assim como a checagem TypeScript e o build de produção. O teste HTTP cobre também a rota de dashboard criada pela v0: cabeçalhos de identidade falsos não autenticam, dados da segunda empresa não aparecem na primeira, respostas não são cacheadas e logout invalida o acesso. Cadastro, inclusão e edição de produto foram conferidos pelo navegador local. O fluxo HTTP ampliado valida duas edições simultâneas (uma resposta 200 e uma 409), auditoria única, inativação/reativação, manutenção do preço e bloqueio de edição entre empresas. Nesta revisão, passaram novamente os 33 testes unitários, 14 testes com PostgreSQL em banco vazio e o fluxo HTTP completo (48 testes). A nova cobertura confirma que consulta e vínculo revogado não permitem edição nem geram auditoria. A tela de acesso revogado permite sair da conta mesmo quando o painel ainda não carregou dados.

Essa evidência não confirma a configuração do banco nem o deployment remoto.

## Próximas implementações

Recuperação/verificação de e-mail, convites, escolha de empresa/loja, paginação completa, integração avançada dessas entidades no painel, caixa e billing. O painel informa o limite dos 200 produtos carregados. Catálogo, quote, criação, acompanhamento e aprovação pública de pedidos já existem nas rotas `/api/public/stores/{slug}/catalog`, `/api/public/stores/{slug}/quote`, `/api/public/stores/{slug}/orders`, `/api/public/stores/{slug}/orders/{publicNumber}` e `/api/public/stores/{slug}/orders/{publicNumber}/approve`; as telas públicas estão em `/{storeSlug}` e `/{storeSlug}/pedido/{publicNumber}`.

O adaptador de domínio http.ts exige autenticação injetada pelo servidor. Ele não está exposto como rota Next e não implementa persistência de idempotência; validar o cabeçalho não equivale a garantir reexecução segura. As rotas web concretas usam as próprias transações autorizadas.

## Trabalhando entre Codex e v0

Antes de uma nova alteração, atualize a partir da main. A PR #3 foi encerrada porque sua implementação foi incorporada à consolidação. Preserve lib/auth.ts, lib/web.ts, os testes e as validações de sessão nas rotas. A interface não deve escolher empresa, ator ou permissões por cabeçalhos ou variáveis NEXT_PUBLIC. Nunca restaure a antiga consulta de dashboard sem sessão.

A PR #3 continha a base anterior de autenticação. Esta integração parte da main mais recente e incorpora essa base; não sobreponha o painel da v0 com a interface antiga daquela etapa.

## Validação e correções do checkout — 13/09/2026

Revisão sobre a main 06ae7c7, preservando as telas recentes da v0:

- Corrigida a estimativa 100 vezes maior no carrinho e checkout; cálculo por linha em centavos inteiros com o mesmo arredondamento do servidor.
- Implementada cotação atualizada ao abrir o checkout, com envio bloqueado até a resposta e erro explícito em caso de indisponibilidade.
- Peso mínimo, máximo e incremento validados na cotação e na criação do pedido; moeda comparada ao preço vigente e unidade comparada ao estoque físico.
- Reenvios do mesmo formulário reutilizam a chave idempotente. Chaves e tokens agora incluem a loja, evitando colisões entre lojas da mesma empresa.
- Embalagens fixas ficam indisponíveis no checkout até existir conversão explícita entre embalagem e unidade física de estoque.
- Corrigidos erros de compilação no acompanhamento público, seletor de loja e dados opcionais; corrigido parâmetro SQL no cadastro de produto sem loja explícita.
- Executor de migrações remove o envelope externo BEGIN/COMMIT de todas as migrações que o possuem, mantendo checksums originais e atomicidade do lote inteiro. `.gitattributes` padroniza SQL em LF entre Windows e Vercel.

Evidências desta revisão: build de produção e TypeScript aprovados; 15 testes com PostgreSQL 17 aprovados, incluindo instalação concorrente, rollback do lote e checkout público concorrente com reserva única; fluxo HTTP de cadastro, catálogo, isolamento e logout aprovado. Carrinho e cotação conferidos no navegador local: 250 g a R$ 37,90/kg resulta em R$ 9,48.

Pendências prioritárias antes de operar o cardápio em produção:

1. Concluir a atualização e validação do banco remoto (migrações 1–8), conexão de aplicação com privilégios restritos e configuração de APP_URL/ORDER_ACCESS_SECRET. A revisão local não confirma essa ativação.
2. Completar telas de cadastro/publicação de ofertas e movimentos de estoque, pesagem, entrega/retirada, cancelamento e conclusão.
3. Revisar concorrência entre pesagem/aprovação de itens: serializar pelo pedido antes de recalcular totais e impedir operações em pedidos terminais; testar aprovação de múltiplos itens e excluir cancelados dos totais.
4. Implementar endereço/taxa para entrega, política de aprovação de alteração de preço entre cotação e envio, expiração/liberação de reservas abandonadas e limitação de pedidos públicos.
5. Cobrir ponta a ponta todos os fluxos públicos, incluindo falhas de rede, alteração de preços, aprovação e consumo de estoque. As funções existentes de pesagem/aprovação ainda não equivalem a fluxo operacional completo validado.

## Consistência da preparação — 13/09/2026

A pendência de serialização da preparação foi tratada: pesagem, aprovação administrativa e aprovação pública bloqueiam primeiro o pedido, antes de alterar itens ou calcular o total. Pedidos encerrados ou ainda fora da preparação rejeitam essas operações. Itens já pesados não podem consumir estoque novamente.

O resumo distingue itens ainda em pesagem de itens aguardando aprovação, exclui cancelados dos totais e só publica o total final quando todos os itens estão resolvidos. Corrigido também o tipo do parâmetro SQL ao liberar excedente da reserva, que impedia executar a pesagem no PostgreSQL.

Validação: 38 testes unitários e 16 testes PostgreSQL aprovados, incluindo duas pesagens concorrentes, disputa entre aprovação administrativa e pública, token inválido, bloqueio antes da separação e após cancelamento, total final e saldo físico sem consumo duplicado. Build de produção aprovado. As telas administrativas de pesagem e a ativação do banco remoto continuam pendentes.

## Entrada da plataforma e página de vendas — 14/09/2026

O fluxo principal em `/` é login do açougue e acesso ao painel; uma sessão válida abre diretamente a operação. A tela inicial foi redesenhada com formulário em destaque e layout adaptável a telas menores. A página com atalhos circulares da v0 foi substituída, e as rotas de autenticação e pedidos removidas naquele merge foram restauradas.

A venda pública continua em `/{slug}`. No painel, em Lojas, cada loja ativa apresenta Ver página de vendas e Copiar link para clientes. `/loja?loja={slug}` direciona para o endereço específico; `/loja` sem identificação orienta o cliente a solicitar o link ao açougue, sem presumir uma loja chamada matriz.

Integrada também a tela de detalhes e pesagem: consulta autenticada, quantidades inteiras, validação de reserva, baixa única e aviso de aprovação pendente. Build, 38 testes unitários, 16 testes de banco (nove arquivos de migração, incluindo convites) e dois fluxos HTTP aprovados. Login e pesagem conferidos visualmente em ambiente local. A configuração e atualização do banco remoto ainda precisam ser concluídas para validar a operação em produção.
