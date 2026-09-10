# Contrato da API V1

Contrato de implementação. Rotas listadas são planejadas até constarem como verificadas em IMPLEMENTATION_STATUS.md. Gerar OpenAPI executável a partir dos DTOs, com exemplos e schemas correspondentes; este documento não substitui validação de runtime.

## Regras comuns

Base tenant `/api/v1`; plataforma `/platform/v1`; catálogo público `/public/v1`. HTTPS em produção. Sessão em cookie HttpOnly/Secure/SameSite, CSRF e validação de Origin em operações de escrita. Session resolve tenant e Membership; headers/body não substituem autorização. Seleção de organização ocorre por endpoint autenticado que valida participação. Rotas com storeId revalidam acesso à loja.

IDs UUID; timestamps ISO8601 UTC. Dinheiro e quantidades inteiras são strings de dígitos nos contratos para preservar bigint: `"3790"` centavos, `"1375"` gramas. Não aceitar decimal, expoente, sinal negativo em entradas não negativas ou campo adicional desconhecido. Percentuais são inteiros em basis points. Resposta inclui unidade/moeda. `version` é inteiro seguro validado ou string bigint conforme DTO, padronizado como string nesta V1.

Listas: `limit` padrão 25, máximo 100; cursor opaco validado, filtros allowlisted e ordenação estável `(createdAt,id)`. Resposta `{items, nextCursor}`. Proibida paginação sem escopo tenant. Erro `{error:{code,message,fieldErrors?,requestId}}`, sem stack/dados alheios. Códigos 400 validação, 401 sem sessão, 403 sem permissão/recurso comercial, 404 ausente ou alheio, 409 conflito/idempotência/versão/estoque, 413 payload, 422 regra de negócio, 429 rate limit, 503 dependência essencial indisponível.

Escritas críticas exigem `Idempotency-Key` (UUID recomendado, limite 128 caracteres). Escopo é tenant+ator/identidade pública segura+operação+chave; hash canônico do request inclui parâmetros relevantes. Mesmo request retorna resultado original; hash diferente retorna 409 IDEMPOTENCY_CONFLICT. Transação persiste resultado com efeito; timeout pós-commit não duplica. Chave de integração/offline tem retenção própria longa; não expirar enquanto reenvio puder produzir cobrança/venda duplicada. `If-Match: "<version>"` protege alterações de agregados; ausência onde obrigatório retorna 428, versão obsoleta 409.

## Identidade, lojas e usuários

| Método / rota | Entrada e efeito | Autorização |
|---|---|---|
| POST /auth/signup | name,email,password,organizationName,storeName,planVersionId; provisiona e retorna sessão + onboarding | público, rate limit e idempotência |
| POST /auth/login | email,password,challenge quando MFA; resposta genérica em falha | público, rate limit |
| POST /auth/refresh | refresh em cookie; rotação e detecção de reuso | sessão refresh |
| POST /auth/logout | revoga família/contexto e cookie | sessão |
| POST /auth/password-reset/request | email; sempre 202 genérico | público, rate limit |
| POST /auth/password-reset/confirm | token,password; revoga sessões | token de uso único |
| GET /me | usuário, memberships, contexto, permissions e projeção entitlements | sessão |
| POST /auth/organization-context | organizationId; valida membership e muda contexto | sessão |
| GET/POST /stores | listar/criar loja com limites | store.view/store.create |
| PATCH /stores/{storeId} | nome/configuração/status com versão | store.manage |
| GET /memberships | lista sem hashes/tokens | user.manage |
| POST /invitations | email,roleIds,storeIds | user.manage; quota |
| POST /invitations/accept | token; vincula identidade autenticada | destinatário validado |
| PATCH /memberships/{id} | roles,lojas,status,reason,version | user.manage; último owner protegido |
| GET/PATCH /onboarding | etapas e tipo de operação | owner/manager autorizado |

## Produtos, preços e clientes

| Método / rota | Campos / retorno | Permissão |
|---|---|---|
| GET /products | search,category,active,cursor | product.view |
| GET /products/{id} | produto autorizado; custos só com inventory.view_cost | product.view |
| POST /products | sku,name,stockUnit,saleStrategy,saleRule,categoryId,preparationIds,packagingIds | product.create; limite |
| PATCH /products/{id} | atributos permitidos,reason,If-Match | product.update |
| POST /products/{id}/deactivate | reason; preserva histórico | product.update |
| GET /stores/{storeId}/prices | channel,priceListId,asOf | product.view |
| POST /stores/{storeId}/prices | productId,amountMinor,currency,validFrom,validUntil,reason | product.change_price |
| GET/POST /customers | filtros ou nome,tipo,contatos mínimos,consentimento separado | customer.view/customer.create |
| PATCH /customers/{id} | campos autorizados,If-Match | customer.update |
| GET /customers/{id}/orders | histórico paginado | customer.view + order.view |

## Pedido e pesagem

`POST /stores/{storeId}/orders`, permissão order.create, chave obrigatória:

```json
{
  "source": "MANUAL",
  "customerId": "UUID",
  "fulfillment": {"mode": "PICKUP"},
  "items": [{
    "productId": "UUID",
    "requestedQuantity": "1000",
    "unit": "G",
    "preparationId": "UUID",
    "packagingId": "UUID",
    "notes": "Separar em dois pacotes",
    "weightPolicy": {"toleranceBps": 1000, "onlyLower": false, "allowSubstitution": false}
  }]
}
```

Servidor resolve preço/custo/política e aceita somente variação dentro da configuração da loja. Não recebe total confiável do frontend. Retorna 201 `{id,version,fulfillmentStatus,estimatedTotalMinor,finalTotalMinor:null,currency,items}`. Reserva estoque/capacidade em transação; ruptura retorna 409 STOCK_UNAVAILABLE por item autorizado. Source IFOOD só pode ser inserido por adapter autenticado, não por operador fingindo origem externa.

| Método / rota | Comportamento | Permissão |
|---|---|---|
| GET /orders | loja,status,source,dateFrom,dateTo,cursor | order.view |
| GET /orders/{id} | itens,totais,histórico permitido | order.view |
| POST /orders/{id}/confirm | valida estado/versão | order.manage |
| POST /orders/{id}/start-picking | atribui separação | order.pick |
| POST /orders/{id}/weighings | itemId,grams,source,deviceId?,reason?,If-Match; nova revisão | order.weigh |
| POST /orders/{id}/items/{itemId}/unavailable | reason; mantém item, libera reserva | order.pick |
| POST /orders/{id}/items/{itemId}/substitute | productId,quantity,reason; proposta ligada ao original | order.pick + consentimento |
| POST /orders/{id}/request-approval | gera proposta revisada e link protegido | order.manage |
| POST /orders/{id}/ready | exige resolução/peso/aprovação da revisão atual | order.manage |
| POST /orders/{id}/complete | valida entrega/retirada e política de pagamento | order.complete |
| POST /orders/{id}/cancel | reason; libera reservas uma vez | order.cancel |

Toda escrita da tabela exige idempotência e versão salvo início de evento externo. Pesagem além de tolerância mantém WAITING_CUSTOMER_APPROVAL, sem capturar valor maior silenciosamente. Aprovação expirada/revisão antiga responde 409 QUOTE_CHANGED.

## Pagamentos, caixa e PDV

`POST /orders/{id}/payments` recebe method, strategy e referência autorizada; valor é derivado da cotação final. Gateway com resultado ambíguo retorna 202 PENDING_RECONCILIATION, nunca sucesso inventado. Métodos locais exigem permissão de conferência e sessão de caixa válida. `POST /payments/{id}/refunds` recebe amountMinor,reason com idempotência; valida saldo devolvível sob lock. Webhook `/webhooks/payments/{provider}` verifica bytes originais, assinatura, timestamp e integração de destino; não aceita organizationId livre.

| Método / rota | Comportamento | Permissão |
|---|---|---|
| GET /stores/{storeId}/cash-sessions/current | caixa aberto autorizado | cash.view |
| POST /stores/{storeId}/cash-sessions | registerId,openingMinor | cash.open |
| POST /cash-sessions/{id}/movements | SUPPLY/WITHDRAWAL,amountMinor,reason | cash.supply/cash.withdraw |
| POST /cash-sessions/{id}/close | countedByMethod,reason,If-Match | cash.close |
| POST /cash-sessions/{id}/reopen | reason e versão; auditoria | cash.reopen |
| POST /stores/{storeId}/pos/sales | cashSessionId,items com quantity/unit, método e valores recebidos | pos.sell; idempotência |
| GET /stores/{storeId}/pos/catalog | snapshot versionado por dispositivo | pos.sell |
| POST /devices/{id}/offline-sync | operações com IDs/seq/hash/lease | dispositivo+sessão vinculados |

Venda PDV calcula total no backend, valida troco e métodos, grava pedido/pagamento local/baixa/caixa/CMV/outbox atomicamente. Não aceitar cartão como confirmado por simples enum sem operação de terminal/conferência habilitada. Sync responde resultado por operação e preserva conflitos para supervisor. Conclusão repetida após perda de conexão retorna a mesma venda.

## Estoque, importação, relatórios e realtime

GET `/stores/{storeId}/inventory` retorna onHand/reserved/available e unidade; custos exigem permissão. GET `/inventory/movements` é paginado e filtrado. POST `/stores/{storeId}/inventory/adjustments` recebe productId,lotId,delta,reason,expectedVersion e gera ledger, nunca overwrite silencioso. POST `/imports` inicia arquivo/proposta; GET `/imports/{id}` mostra linhas/erros; POST `/imports/{id}/confirm` exige previewHash e idempotência. Mudança de arquivo invalida preview; lote inválido não persiste parcialmente sem política explícita de importação.

GET `/reports/sales` aceita datas no timezone da loja, retorna intervalos UTC usados, receita, CMV e métodos definidos. GET `/dashboard` agrega somente lojas autorizadas. GET `/events` autentica SSE e o servidor define organização/lojas; não aceita assinatura em canal alheio. POST `/exports` cria job autorizado; GET `/objects/{id}/download` retorna URL curta após revalidar objeto e tenant.

## Storefront público

GET `/public/v1/stores/{slug}` e `/products` retornam somente loja publicada, catálogo/preços públicos e disponibilidade comercial. POST `/public/v1/stores/{slug}/orders` resolve tenant pelo slug no servidor e recebe customer, itens, entrega/retirada e consentimento específico; rate limit e idempotência por checkout seguro. Não expõe custo, saldo detalhado, secrets ou contatos de outros consumidores.

GET `/public/v1/orders/{token}` retorna progresso mínimo do pedido vinculado; token aleatório >=256 bits, hash armazenado, validade e revogação. POST `/public/v1/orders/{token}/approve` exige quoteRevision/hash, escopo de aprovação, anti-replay e confirmação explícita. Token de rastreio sozinho não concede cancelamento/refund. Endereço não aparece em listagem pública.

## SaaS e plataforma

GET `/billing/plans` retorna versões publicadas disponíveis; GET `/billing/subscription` e `/billing/entitlements` mostram contrato efetivo. POST `/billing/change-preview` recebe targetPlanVersionId; POST `/billing/changes` confirma previewId/hash e usa chave. POST `/billing/cancellation` recebe reason e data prevista. GET `/billing/invoices` é tenant. Webhook `/webhooks/billing/{provider}` é domínio separado de pagamentos de pedidos. Gate de cobrança/export/suporte permanece acessível conforme política de suspensão.

Rotas `/platform/v1/organizations`, `/subscriptions`, `/plans`, `/plan-versions`, `/metrics`, `/audit`, `/feature-flags` exigem PlatformSession+permissão específica+MFA. Publicar versão e modificar flag/override exigem motivo. Financeiro SaaS não pode editar estoque. Suporte não recebe acesso operacional por conhecer tenantId. `/health/live` e `/health/ready` retornam estado mínimo, sem configuração secreta.

## Contratos futuros

Purchasing: criar pedido, receber/conferir e confirmar entrada. Production: criar lote, registrar entradas/saídas, revisar e finalizar massa/custo. B2B: crédito, tabelas e repetir pedido com novo preço explicitamente apresentado. Fiscal/iFood: somente adapters com capabilities verificadas. Public API/webhooks de clientes: chaves com hash, scopes, rate limits, revogação, HMAC e DLQ. Não expor rotas vazias ou respostas fictícias como implementação desses módulos.

## Aceite do contrato

Schemas estritos, exemplos que passam validação, testes 401/403/404, versão/idempotência, dois tenants e erros sem vazamento. SDK gerado deve reproduzir dinheiro/peso sem float. OpenAPI e implementação são verificados em CI antes de rotas serem marcadas entregues.
