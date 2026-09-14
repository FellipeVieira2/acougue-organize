# Cardápio Online para Açougues — Arquitetura V2

## 1. Decisão arquitetural

Esta versão substitui o modelo inicial por uma arquitetura mais fiel à operação real de um açougue e mais segura para evolução como SaaS.

A principal decisão é separar três conceitos que não devem ser confundidos:

1. Produto comercial — aquilo que o cliente reconhece, por exemplo `Acém`.
2. Estoque físico — aquilo que realmente existe na loja e pode ser consumido, por exemplo `Acém bovino disponível: 18,420 kg`.
3. Oferta/preparo — a forma como o produto é vendido, por exemplo `Acém moído`, `Acém em cubos`, `Acém em bifes`.

Essa separação resolve um problema importante do modelo anterior: se cada apresentação possuir estoque próprio, o sistema pode duplicar saldos ou obrigar a operação a ficar transferindo estoque entre “Acém moído”, “Acém em cubos” e “Acém em bifes”, mesmo quando todas essas opções saem da mesma peça física de acém.

A regra passa a ser:

> O cliente compra uma oferta, mas o sistema reserva e consome um recurso de estoque físico.

---

## 2. Resumo da revisão do documento anterior

### 2.1 O que estava correto

O documento original acertou em pontos essenciais:

- o açougue não deve ser modelado como hamburgueria ou pizzaria;
- grande parte da venda é por peso;
- o valor exibido ao cliente pode ser estimado;
- o peso final precisa ser informado durante a separação;
- o sistema precisa suportar retirada e entrega;
- o pedido precisa possuir rastreabilidade;
- a solução precisa nascer multi-tenant;
- pagamento online não é obrigatório para o primeiro MVP;
- a operação precisa receber, separar, pesar e concluir o pedido.

Esses conceitos devem ser mantidos.

### 2.2 O que deve mudar

Os principais ajustes recomendados são:

- não usar `product_variant` como unidade principal de estoque;
- separar catálogo, preparo e estoque;
- transformar peso variável em conceito de primeira classe;
- separar `peso solicitado`, `peso reservado` e `peso final`;
- usar um ledger de movimentações de estoque;
- criar reserva explícita em vez de apenas campos `reserved_weight`;
- separar status comercial, pagamento e fulfillment;
- guardar snapshot de preço e descrição dentro do pedido;
- tornar criação de pedido e integrações idempotentes;
- preparar um outbox de eventos;
- evitar microserviços no início;
- usar um monólito modular com limites claros entre domínios;
- permitir tolerância de peso definida pelo cliente;
- preparar a arquitetura para lote, validade, perdas, rendimento e balança, sem colocar tudo no MVP.

---

# 3. Modelo mental correto para açougue

## 3.1 Exemplo

A loja possui:

Estoque físico

- Acém: 18,420 kg

No catálogo existem:

Produto

- Acém

Ofertas

- Acém em peça
- Acém em bifes
- Acém em cubos
- Acém moído
- Acém para panela

Todas podem consumir o mesmo estoque físico.

Assim, uma venda de:

- 1,000 kg de Acém moído

e outra de:

- 2,000 kg de Acém em cubos

devem reduzir o mesmo saldo de Acém.

Saldo teórico depois das duas separações:

- 15,420 kg

Isso é muito mais fiel ao que acontece na bancada.

---

# 4. Peso variável como regra central

Carne é frequentemente um produto de medida variável.

O cliente normalmente não quer uma quantidade matematicamente exata. Ele quer algo como:

- aproximadamente 500 g;
- aproximadamente 1 kg;
- duas peças;
- uma peça entre 900 g e 1,2 kg;
- até R$ 50;
- o mais próximo possível de 2 kg.

Por isso o sistema deve armazenar separadamente:

- `requested_weight_g`
- `reserved_weight_g`
- `final_weight_g`

Nunca substituir um pelo outro.

## 4.1 Exemplo

Cliente pede:

- 1,000 kg de picanha em bifes.

Configuração de tolerância:

- mínimo aceitável: 900 g
- máximo aceitável: 1.100 g

Separação real:

- 1.046 g

O pedido deve mostrar:

- solicitado: 1.000 g
- separado: 1.046 g
- preço por kg: R$ 89,90
- total estimado: R$ 89,90
- total final: R$ 94,04

O valor final é calculado somente com o peso efetivamente separado.

---

# 5. Preferência de tolerância do cliente

Esse é um recurso que vale colocar cedo porque reduz atrito operacional.

Para itens por peso, o cliente pode escolher uma política.

## 5.1 Opções de UX

### Padrão

> Quero aproximadamente 1 kg. Pode variar um pouco.

O sistema usa uma tolerância padrão configurada pela loja, por exemplo:

- -10%
- +10%

### Não ultrapassar

> Quero aproximadamente 1 kg, mas não ultrapasse 1 kg.

### Valor máximo

> Quero aproximadamente 1 kg, mas não ultrapasse R$ 45.

### Quantidade mínima

> Preciso de pelo menos 1 kg.

### Exato quando possível

> Tente chegar o mais próximo possível do peso escolhido.

Essas preferências ficam registradas no item do pedido e são mostradas para o operador durante a separação.

---

# 6. Unidades internas

Para evitar problemas de arredondamento:

## 6.1 Peso

Armazenar peso internamente em gramas inteiros.

Exemplos:

- 500 g → `500`
- 1 kg → `1000`
- 1,235 kg → `1235`

A interface pode exibir em kg.

## 6.2 Dinheiro

Armazenar dinheiro em unidade monetária mínima.

Para BRL:

- R$ 37,90 → `3790`

Campo recomendado:

- `amount_minor BIGINT`

## 6.3 Cálculo por kg

Exemplo:

```text
price_per_kg_minor = 3790
final_weight_g = 1053

final_total_minor =
round(price_per_kg_minor * final_weight_g / 1000)
```

O modo de arredondamento deve ser único em todo o sistema e coberto por testes.

---

# 7. Domínios do sistema

Recomendo dividir o software em módulos lógicos.

Não recomendo microserviços neste momento.

Use um monólito modular com banco transacional único, mantendo limites de domínio claros.

Módulos:

1. Identity & Tenant
2. Store
3. Catalog
4. Pricing
5. Inventory
6. Ordering
7. Fulfillment
8. Customer
9. Delivery
10. Payment
11. Notification
12. Audit
13. Analytics

Cada módulo pode futuramente ser extraído caso haja necessidade real.

---

# 8. Estrutura de dados recomendada

## 8.1 organization

Representa o cliente SaaS.

Campos:

```text
id
name
slug
plan
status
timezone
created_at
updated_at
```

---

## 8.2 store

Unidade física da organização.

```text
id
organization_id
name
slug
active
timezone
address_id
created_at
updated_at
```

Toda entidade operacional deve possuir contexto de organização e, quando aplicável, de loja.

---

# 9. Catálogo

## 9.1 catalog_product

Representa a identidade comercial reconhecida pelo cliente.

Exemplos:

- Acém
- Picanha
- Coxão mole
- Peito de frango
- Linguiça toscana

```text
id
organization_id
name
slug
category_id
species_id
description
active
public_visible
created_at
updated_at
```

O produto não representa necessariamente uma unidade física de estoque.

---

## 9.2 inventory_item

Representa aquilo que existe fisicamente no estoque.

Exemplos:

- Acém bovino
- Picanha bovina
- Peito de frango
- Linguiça toscana

```text
id
organization_id
name
sku
base_unit
active
created_at
updated_at
```

`base_unit`:

```text
GRAM
UNIT
```

Na maioria das carnes vendidas por peso:

```text
GRAM
```

---

## 9.3 preparation_option

Representa um preparo/apresentação.

Exemplos:

```text
PECA
BIFE
CUBOS
TIRAS
MOIDO
ISCAS
PANELA
INTEIRO
FILE
PEDACOS
```

Campos:

```text
id
organization_id
code
name
active
created_at
```

Não usar enum fechado no código para tudo.

A loja pode precisar criar apresentações próprias.

---

## 9.4 catalog_offer

Esse passa a ser o item realmente comprável.

Exemplos:

- Acém / moído
- Acém / cubos
- Picanha / peça
- Picanha / bifes

```text
id
organization_id
product_id
inventory_item_id
preparation_option_id
sku
sale_unit
min_weight_g
max_weight_g
weight_step_g
default_weight_g
active
public_visible
customer_notes_enabled
created_at
updated_at
```

### sale_unit

```text
WEIGHT
UNIT
FIXED_PORTION
```

A oferta liga:

> catálogo → apresentação → estoque físico

---

# 10. Preços

## 10.1 price_rule

```text
id
organization_id
store_id
offer_id
channel
pricing_type
amount_minor
currency
valid_from
valid_to
priority
revision
created_at
```

### pricing_type

```text
PER_KG
PER_UNIT
FIXED_PORTION
```

### channel

```text
COUNTER
ONLINE
DELIVERY
WHOLESALE
```

No MVP pode existir somente:

```text
ONLINE
COUNTER
```

A estrutura já fica pronta para evoluir.

---

# 11. Estoque

Aqui está uma das mudanças mais importantes.

Não usar somente uma tabela com:

```text
available_weight
reserved_weight
```

como fonte completa da verdade.

Usar:

1. saldo consolidado;
2. ledger de movimentações;
3. reservas explícitas.

---

## 11.1 inventory_balance

Saldo rápido para consulta.

```text
id
organization_id
store_id
inventory_item_id
on_hand_qty
reserved_qty
version
updated_at
```

Para peso:

- `on_hand_qty` em gramas;
- `reserved_qty` em gramas.

Disponível:

```text
available = on_hand_qty - reserved_qty
```

Constraint:

```text
on_hand_qty >= 0
reserved_qty >= 0
reserved_qty <= on_hand_qty
```

---

## 11.2 inventory_movement

Ledger auditável.

```text
id
organization_id
store_id
inventory_item_id
movement_type
quantity_delta
reference_type
reference_id
reason
actor_id
created_at
```

### movement_type

```text
PURCHASE
SALE
ADJUSTMENT
LOSS
RETURN
TRANSFER_IN
TRANSFER_OUT
PRODUCTION_IN
PRODUCTION_OUT
```

Exemplos:

Compra de 25 kg:

```text
+25000
```

Venda real de 1,046 kg:

```text
-1046
```

Perda de 300 g:

```text
-300
```

O saldo pode ser reconstruído pelo ledger caso seja necessário auditar inconsistências.

---

## 11.3 inventory_reservation

Reservas não devem ser apenas um contador anônimo.

```text
id
organization_id
store_id
inventory_item_id
order_id
order_item_id
reserved_qty
status
expires_at
created_at
released_at
consumed_at
```

### status

```text
ACTIVE
CONSUMED
RELEASED
EXPIRED
```

Benefícios:

- descobrir qual pedido reservou o estoque;
- liberar reserva individual;
- expirar carrinhos/pedidos abandonados;
- auditar overselling;
- reprocessar falhas.

---

# 12. Reserva concorrente de estoque

Duas compras simultâneas não podem vender o mesmo saldo.

A reserva deve acontecer dentro de uma transação.

Estratégias possíveis:

### Estratégia A — lock pessimista

```text
BEGIN

SELECT inventory_balance
FOR UPDATE

validar saldo

criar reservation

incrementar reserved_qty

COMMIT
```

### Estratégia B — update condicional

```text
UPDATE inventory_balance
SET reserved_qty = reserved_qty + :requested
WHERE id = :id
AND on_hand_qty - reserved_qty >= :requested
```

Depois validar se exatamente uma linha foi alterada.

A operação precisa ser atômica.

Nunca:

1. consultar saldo;
2. sair da transação;
3. criar pedido;
4. atualizar estoque depois.

Isso gera condição de corrida.

---

# 13. Quanto reservar em um produto de peso variável

O pedido pode solicitar 1 kg, mas terminar em 1,080 kg.

A loja deve possuir uma política configurável.

Exemplo:

```text
reservation_buffer_percent = 10%
```

Pedido:

```text
requested = 1000 g
```

Reserva:

```text
1100 g
```

Na separação:

```text
final = 1046 g
```

Então:

```text
consume 1046 g
release 54 g
```

Isso reduz a chance de overselling provocado pela variação natural da pesagem.

Alternativamente, a reserva pode usar diretamente o limite máximo aceito pelo cliente.

Essa é a opção preferida quando há tolerância explícita.

---

# 14. Pedido

Não usar um único `status` para representar tudo.

Um pedido possui pelo menos três dimensões independentes.

---

## 14.1 order

```text
id
organization_id
store_id
customer_id
public_number

order_status
fulfillment_status
payment_status

fulfillment_type

currency
estimated_subtotal_minor
final_subtotal_minor
delivery_fee_minor
discount_minor
estimated_total_minor
final_total_minor

customer_note

created_at
confirmed_at
completed_at
canceled_at
updated_at
```

---

## 14.2 order_status

```text
DRAFT
PENDING_CONFIRMATION
CONFIRMED
CANCELED
COMPLETED
```

---

## 14.3 fulfillment_status

```text
UNFULFILLED
QUEUED
PREPARING
READY
OUT_FOR_DELIVERY
FULFILLED
```

---

## 14.4 payment_status

```text
NOT_REQUIRED
PENDING
AUTHORIZED
PARTIALLY_PAID
PAID
FAILED
REFUNDED
PARTIALLY_REFUNDED
```

Isso evita situações ruins como tentar representar:

```text
PREPARING_AND_PIX_PENDING
```

em um único enum.

---

# 15. Item de pedido

## 15.1 order_item

```text
id
organization_id
order_id

offer_id
inventory_item_id

product_name_snapshot
offer_name_snapshot
preparation_name_snapshot
sku_snapshot

pricing_type_snapshot
unit_price_minor_snapshot

requested_qty
requested_weight_g
reserved_weight_g
final_qty
final_weight_g

min_acceptable_weight_g
max_acceptable_weight_g
max_total_minor

estimated_total_minor
final_total_minor

customer_note
operator_note

status

created_at
updated_at
```

---

# 16. Snapshot é obrigatório

O pedido nunca deve depender do catálogo atual para reconstruir o que foi vendido.

Exemplo:

Hoje:

```text
Acém — R$ 34,90/kg
```

Amanhã:

```text
Acém — R$ 37,90/kg
```

O pedido de ontem deve continuar mostrando:

```text
R$ 34,90/kg
```

Mesmo que:

- o produto seja renomeado;
- a apresentação mude;
- o preço seja alterado;
- a oferta seja desativada.

Por isso `order_item` guarda snapshot.

---

# 17. Fluxo ideal do cliente

## 17.1 Catálogo

1. Cliente abre a loja.
2. Sistema identifica a loja/tenant.
3. Busca ofertas públicas e disponíveis.
4. Exibe categorias e produtos.
5. Exibe preço atual por kg/unidade.

---

## 17.2 Escolha

Cliente seleciona:

```text
Acém
→ Moído
→ aproximadamente 1 kg
```

Pode informar:

```text
Moer duas vezes.
```

ou:

```text
Não ultrapassar 1,1 kg.
```

---

## 17.3 Carrinho

O carrinho mostra:

```text
Acém moído
Quantidade aproximada: 1 kg
Preço: R$ 34,90/kg
Estimativa: R$ 34,90
```

Mensagem:

> O peso final pode variar durante a separação. Você pagará pelo peso efetivamente separado, respeitando os limites escolhidos.

---

## 17.4 Checkout

Cliente informa:

- nome;
- telefone;
- endereço, quando entrega;
- retirada ou entrega;
- horário/faixa disponível;
- forma de pagamento;
- observações.

No MVP não é obrigatório criar conta.

Checkout como convidado reduz fricção.

---

## 17.5 Confirmação

Dentro da transação:

1. validar preços;
2. validar disponibilidade;
3. criar pedido;
4. criar itens;
5. reservar estoque;
6. registrar eventos;
7. confirmar transação.

Depois do commit:

- notificar operação;
- notificar cliente.

---

# 18. Fluxo operacional

## 18.1 Fila de pedidos

A operação vê colunas:

```text
Novos
Em separação
Aguardando revisão
Prontos
Entrega
Finalizados
```

---

## 18.2 Tela de separação

Exemplo:

```text
Pedido #1042

Acém moído

Solicitado:
1.000 g

Faixa autorizada:
900 g – 1.100 g

Reserva:
1.100 g

Observação:
Moer duas vezes.

Preço:
R$ 34,90/kg
```

Operador informa:

```text
Peso final: 1.046 g
```

Sistema calcula:

```text
R$ 36,51
```

---

## 18.3 Finalização do item

Ao confirmar:

1. validar tolerância;
2. consumir estoque real;
3. liberar sobra da reserva;
4. calcular total final;
5. registrar `inventory_movement`;
6. marcar reserva como `CONSUMED`;
7. registrar evento de pedido.

Tudo dentro da mesma transação local.

---

# 19. Peso fora da tolerância

Se o operador informar peso fora do autorizado:

```text
requested: 1000 g
max: 1100 g
final: 1180 g
```

o sistema não deve concluir silenciosamente.

Opções:

```text
AJUSTAR_PESO
SOLICITAR_APROVACAO_CLIENTE
SUBSTITUIR_ITEM
CANCELAR_ITEM
```

Pode existir:

```text
order_item.status = WAITING_CUSTOMER_APPROVAL
```

Isso é especialmente útil quando o item é uma peça naturalmente variável.

---

# 20. Substituições

Recurso recomendado para uma segunda fase.

Cliente pode configurar:

```text
Aceito substituição equivalente: SIM/NÃO
```

Exemplo:

- pediu determinada marca de linguiça;
- produto ficou indisponível durante separação.

O operador pode sugerir alternativa.

A substituição deve gerar evento e manter rastreabilidade do item original.

---

# 21. Pagamento no MVP

O documento original está correto em não exigir gateway imediatamente.

Formas informadas:

```text
PIX
CASH
CARD_ON_DELIVERY
CARD_AT_PICKUP
```

Evitar duplicidade conceitual como:

```text
CARD
DEBIT
CREDIT
```

ao mesmo tempo.

Uma abordagem melhor:

```text
payment_method = CARD
card_mode = CREDIT
```

ou usar um modelo de método extensível.

No MVP o sistema pode registrar apenas intenção de pagamento.

---

# 22. Pagamento online futuro

A arquitetura deve partir do princípio de que:

```text
estimated_total != final_total
```

para compras por peso.

Isso significa que o gateway não deve ser acoplado à ideia de um valor imutável criado no momento do carrinho.

O módulo de pagamento deve possuir:

```text
payment
payment_attempt
payment_event
refund
```

e trabalhar com:

- valor estimado;
- valor autorizado, quando aplicável;
- valor final;
- diferença;
- estorno;
- webhook;
- idempotência.

A estratégia concreta varia conforme o provedor e o método de pagamento.

Não colocar regras específicas do gateway no domínio de pedidos.

---

# 23. Entrega

## 23.1 fulfillment_type

```text
PICKUP
DELIVERY
```

---

## 23.2 delivery

```text
id
organization_id
order_id
address_id
delivery_zone_id
fee_minor
status
driver_id
scheduled_start
scheduled_end
dispatched_at
delivered_at
created_at
```

---

## 23.3 delivery_status

```text
PENDING
READY_FOR_DISPATCH
ASSIGNED
OUT_FOR_DELIVERY
DELIVERED
FAILED
CANCELED
```

No MVP:

- entrega própria;
- sem rastreamento em tempo real;
- taxa por bairro/CEP/faixa.

---

# 24. Endereços e áreas de entrega

Criar:

```text
delivery_zone
```

Campos:

```text
id
organization_id
store_id
name
fee_minor
minimum_order_minor
estimated_minutes
active
```

A primeira versão pode usar:

- CEP;
- bairro;
- raio aproximado.

Não precisa começar com roteirização avançada.

---

# 25. Multi-tenant

Toda tabela de negócio compartilhada deve possuir:

```text
organization_id
```

Quando o dado for local:

```text
store_id
```

Exemplos:

- produto;
- oferta;
- estoque;
- pedido;
- preço;
- cliente;
- entrega;
- evento;
- pagamento.

A aplicação nunca deve confiar em `organization_id` vindo livremente do frontend.

O contexto de tenant deve ser derivado da sessão/token/domínio resolvido.

---

# 26. RLS

Se PostgreSQL estiver sendo usado, RLS pode ser uma camada adicional de isolamento.

Recomendação:

- habilitar RLS nas tabelas tenant-aware;
- aplicar `USING`;
- aplicar `WITH CHECK`;
- testar INSERT/UPDATE/DELETE cross-tenant;
- testar rotas administrativas;
- evitar uso cotidiano de roles que bypassam RLS.

RLS não substitui autorização da aplicação.

As duas camadas devem existir.

---

# 27. Idempotência

Rotas que criam efeitos financeiros ou de estoque devem aceitar idempotency key.

Exemplos:

```text
POST /orders
POST /orders/{id}/confirm
POST /orders/{id}/items/{itemId}/weigh
POST /payments
POST /webhooks/*
```

Criar:

```text
idempotency_record
```

com:

```text
organization_id
key
operation
request_hash
response_code
response_body
created_at
expires_at
```

Isso evita:

- pedido duplicado por duplo clique;
- reserva duplicada;
- cobrança duplicada;
- reprocessamento inseguro de webhook.

---

# 28. Eventos e Outbox

Criar:

```text
outbox_event
```

Campos:

```text
id
organization_id
aggregate_type
aggregate_id
event_type
payload
occurred_at
published_at
attempt_count
last_error
```

Exemplo de transação:

```text
criar pedido
reservar estoque
registrar order_event
criar outbox_event
COMMIT
```

Depois um worker publica:

```text
ORDER_CONFIRMED
```

para:

- WhatsApp;
- e-mail;
- analytics;
- integrações;
- atualização em tempo real.

Assim o pedido não depende da disponibilidade do serviço de notificação.

---

# 29. Auditoria

Além de eventos de domínio, ações administrativas críticas precisam de auditoria.

Registrar:

```text
actor_id
organization_id
action
entity_type
entity_id
before
after
ip
user_agent
created_at
```

Principalmente:

- alteração de preço;
- ajuste manual de estoque;
- alteração de peso;
- cancelamento;
- estorno;
- mudança de forma de pagamento;
- concessão de desconto.

---

# 30. Lotes e validade

Não precisa entrar obrigatoriamente no primeiro MVP, mas a arquitetura de estoque não deve impedir isso.

Futuro:

```text
inventory_lot
```

```text
id
organization_id
store_id
inventory_item_id
supplier_id
supplier_lot
received_at
expires_at
cost_minor
initial_qty
remaining_qty
```

Isso permite:

- FEFO;
- validade;
- recall;
- rastreabilidade;
- custo real;
- margem.

---

# 31. Quebra, rendimento e produção

Alguns açougues compram cortes prontos.

Outros compram peças maiores e fazem desossa/transformação.

Não coloque um ERP de produção inteiro no MVP.

Mas deixe preparado um futuro módulo:

```text
inventory_transformation
```

Exemplo:

```text
entrada:
20 kg de peça bruta

saída:
14 kg de cortes vendáveis
3 kg de outros cortes
2 kg de ossos
1 kg de perda
```

Isso é importante para açougues que controlam rendimento de desossa.

---

# 32. Custo e margem

O preço de venda não deve ser confundido com custo.

Futuramente:

```text
inventory_cost_layer
```

ou custo médio.

Métricas:

```text
receita
CMV
margem bruta
perdas
rendimento
ticket médio
peso vendido
```

Não bloquear o MVP por isso, mas não colocar `cost` dentro da tabela de preço de venda.

---

# 33. Balança

Uma evolução muito interessante é integração com balança.

Não deve fazer parte do primeiro MVP.

Arquitetura futura:

```text
scale_adapter
```

Fluxo:

1. operador abre item;
2. coloca carne na balança;
3. peso chega ao sistema;
4. operador confirma;
5. peso fica vinculado ao item;
6. sistema calcula valor;
7. etiqueta pode ser impressa.

Não acoplar o domínio a um fabricante específico.

Criar adaptadores.

---

# 34. Código de barras de peso variável

Outra evolução relevante:

- etiquetas com peso;
- preço;
- identificador do item;
- leitura no checkout/PDV.

O modelo de dados de peso em gramas e preço por unidade de medida já deixa o sistema preparado para isso.

---

# 35. Catálogo público

URL recomendada:

```text
/{storeSlug}
```

ou domínio personalizado:

```text
pedido.acouguecliente.com.br
```

O tenant nunca deve ser determinado somente por um ID enviado pelo navegador.

O backend resolve:

```text
hostname/slug
→ store
→ organization
```

---

# 36. Busca e filtros

MVP:

- busca por nome;
- categoria;
- espécie;
- ofertas em destaque;
- disponibilidade.

Depois:

- churrasco;
- panela;
- air fryer;
- moído;
- econômico;
- premium;
- kits.

Essas tags devem ser comerciais, não necessariamente tipos de estoque.

---

# 37. Kits

Boa funcionalidade futura.

Exemplo:

```text
Kit Churrasco 5 pessoas
```

Pode conter:

- 1 kg picanha;
- 1 kg linguiça;
- 1 kg frango.

O kit não deve criar estoque artificial.

Ao comprar o kit, o sistema gera reservas para os itens físicos correspondentes.

---

# 38. Promoções

Não implementar motor complexo no MVP.

Primeiro suporte:

```text
preço promocional por oferta
valid_from
valid_to
```

Depois:

- cupom;
- desconto por quantidade;
- compre X leve Y;
- combos;
- cashback.

---

# 39. API recomendada

## Catálogo público

```text
GET /public/stores/{slug}
GET /public/stores/{slug}/categories
GET /public/stores/{slug}/offers
GET /public/stores/{slug}/offers/{id}
```

---

## Carrinho/quote

```text
POST /public/stores/{slug}/quote
```

O servidor sempre recalcula:

- preço;
- disponibilidade;
- entrega;
- total estimado.

Nunca confiar no total enviado pelo frontend.

---

## Pedidos

```text
POST /public/stores/{slug}/orders
GET /public/orders/{publicNumber}
```

Para consulta pública usar token seguro ou combinação não previsível.

---

## Operação

```text
GET /admin/orders
GET /admin/orders/{id}
POST /admin/orders/{id}/start
POST /admin/orders/{id}/cancel
POST /admin/orders/{id}/ready
POST /admin/orders/{id}/complete
```

---

## Separação

```text
POST /admin/orders/{id}/items/{itemId}/start
POST /admin/orders/{id}/items/{itemId}/weigh
POST /admin/orders/{id}/items/{itemId}/substitute
POST /admin/orders/{id}/items/{itemId}/complete
```

---

## Estoque

```text
GET /admin/inventory
POST /admin/inventory/{itemId}/adjustments
GET /admin/inventory/{itemId}/movements
```

---

# 40. Realtime

A tela operacional pode receber atualizações por:

- WebSocket;
- Server-Sent Events;
- serviço realtime da stack usada.

Eventos:

```text
ORDER_CREATED
ORDER_UPDATED
ORDER_CANCELED
ORDER_READY
```

Nunca use realtime como fonte da verdade.

A fonte da verdade continua sendo o banco transacional.

---

# 41. Notificações

Criar módulo independente de canal.

Eventos:

```text
ORDER_CONFIRMED
ORDER_PREPARING
ORDER_WAITING_APPROVAL
ORDER_READY
ORDER_OUT_FOR_DELIVERY
ORDER_DELIVERED
ORDER_CANCELED
```

Canais possíveis:

```text
WHATSAPP
SMS
EMAIL
PUSH
```

No início pode existir apenas WhatsApp ou mensagem manual assistida.

---

# 42. Segurança

Obrigatório:

- rate limit em endpoints públicos;
- validação server-side;
- proteção contra enumeração de pedidos;
- logs de segurança;
- tenant isolation;
- RBAC;
- RLS quando aplicável;
- secrets fora do código;
- upload de imagem com validação;
- proteção de webhook;
- idempotência;
- auditoria.

---

# 43. Perfis de acesso

Exemplo:

```text
OWNER
MANAGER
CASHIER
BUTCHER
DELIVERY
CATALOG_MANAGER
```

Permissões devem ser capabilities.

Exemplo:

```text
catalog.read
catalog.write
inventory.read
inventory.adjust
orders.read
orders.prepare
orders.cancel
prices.write
reports.read
```

Isso escala melhor que condicionais espalhadas por role.

---

# 44. Observabilidade

Desde o MVP:

- `request_id`;
- `organization_id` no contexto de log;
- `store_id`;
- `order_id`;
- duração de request;
- erros;
- eventos de estoque;
- eventos de pagamento.

Nunca registrar:

- dados completos de cartão;
- segredos;
- tokens;
- senhas.

---

# 45. Métricas operacionais

Métricas úteis:

```text
pedidos por hora
ticket médio
tempo até iniciar separação
tempo de separação
tempo até pronto
cancelamentos
peso solicitado x separado
diferença percentual de peso
itens indisponíveis
reservas expiradas
perdas de estoque
```

Essas métricas dão valor real ao SaaS.

---

# 46. Analytics comercial

Depois do MVP:

- faturamento por loja;
- faturamento por canal;
- produtos mais vendidos;
- preparos mais escolhidos;
- clientes recorrentes;
- horário de pico;
- conversão do catálogo;
- abandono de carrinho;
- margem estimada;
- taxa de recompra;
- valor médio por cliente.

---

# 47. Banco e índices

Índices mínimos:

```text
catalog_offer (
  organization_id,
  active,
  public_visible
)

inventory_balance (
  organization_id,
  store_id,
  inventory_item_id
)

inventory_reservation (
  organization_id,
  order_id,
  status
)

orders (
  organization_id,
  store_id,
  created_at
)

orders (
  organization_id,
  store_id,
  fulfillment_status,
  created_at
)

order_item (
  organization_id,
  order_id
)

inventory_movement (
  organization_id,
  store_id,
  inventory_item_id,
  created_at
)
```

Criar unique constraints para chaves de negócio importantes.

---

# 48. Constraints importantes

Exemplos:

```text
weight >= 0
money >= 0
reserved <= on_hand
valid_to > valid_from
min_weight <= max_weight
```

Além de validação na aplicação, colocar constraints possíveis no banco.

---

# 49. Soft delete

Não deletar fisicamente entidades usadas em histórico.

Para:

- produtos;
- ofertas;
- preços;
- clientes;
- operadores;

preferir:

```text
active = false
```

ou:

```text
deleted_at
```

Pedidos, eventos e movimentos de estoque devem ser imutáveis ou altamente controlados.

---

# 50. Arquitetura de aplicação

Recomendação inicial:

```text
Frontend público
Frontend administrativo

        ↓

Backend modular

        ↓

PostgreSQL
Redis opcional
Object Storage
Worker
```

Não criar:

```text
catalog-service
inventory-service
order-service
payment-service
customer-service
```

como serviços separados logo no início.

Isso aumentaria:

- complexidade de deploy;
- observabilidade;
- consistência distribuída;
- custo;
- troubleshooting;
- necessidade de mensageria.

Mantenha os módulos separados no código e extraia somente quando houver necessidade concreta.

---

# 51. Estrutura modular sugerida

Exemplo:

```text
modules/
  identity/
  tenancy/
  stores/
  catalog/
  pricing/
  inventory/
  customers/
  ordering/
  fulfillment/
  delivery/
  payments/
  notifications/
  audit/
  analytics/
```

Cada módulo deve possuir:

```text
domain
application
infrastructure
api
```

quando fizer sentido para a stack.

Evitar abstração excessiva.

---

# 52. Ordem correta de implementação

A ordem do documento anterior deve ser ajustada.

Não começaria pela UI do catálogo antes de fechar corretamente o modelo de:

- oferta;
- estoque;
- peso variável;
- reserva;
- snapshot de preço;

---

# 53. Fase 0 — decisões de domínio

Implementar e testar conceitualmente:

- product;
- inventory_item;
- preparation_option;
- catalog_offer;
- price_rule;
- unidades;
- regra de peso variável;
- tolerância;
- status.

### Critério de saída

Ser capaz de representar corretamente:

```text
Acém
  estoque físico: 20 kg

ofertas:
  moído
  cubos
  bifes
```

sem criar três estoques independentes.

---

# 54. Fase 1 — catálogo e preço

Implementar:

- categorias;
- produtos;
- estoque físico cadastral;
- preparações;
- ofertas;
- preços;
- catálogo administrativo.

### Critério de saída

Gestor consegue:

- criar Acém;
- associar ao inventory item;
- criar oferta “Acém moído”;
- criar oferta “Acém em cubos”;
- definir preço por kg;
- publicar/despublicar.

---

# 55. Fase 2 — estoque robusto

Implementar:

- inventory_balance;
- inventory_movement;
- inventory_reservation;
- ajuste manual;
- concorrência;
- testes de oversell.

### Critério de saída

Executar 20 tentativas simultâneas de compra contra saldo limitado sem estoque ficar negativo.

Esse teste é obrigatório.

---

# 56. Fase 3 — storefront e quote

Implementar:

- página pública;
- categorias;
- produto;
- preparo;
- quantidade;
- tolerância;
- carrinho;
- quote server-side.

### Critério de saída

Cliente consegue montar compra e receber uma estimativa consistente.

---

# 57. Fase 4 — criação de pedido

Implementar:

- checkout convidado;
- cliente;
- endereço;
- retirada/entrega;
- forma de pagamento;
- snapshot;
- reserva;
- idempotência;
- order_event;
- outbox.

### Critério de saída

Pedido confirmado:

- possui snapshot;
- possui reserva;
- não duplica com retry;
- não oversella estoque;
- aparece na operação.

---

# 58. Fase 5 — separação

Implementar:

- fila;
- iniciar preparo;
- peso final;
- tolerância;
- valor final;
- consumo da reserva;
- liberação de sobra;
- estoque;
- auditoria.

### Critério de saída

Operador consegue separar item de peso variável com rastreabilidade completa.

---

# 59. Fase 6 — retirada e entrega

Implementar:

- pickup;
- delivery zones;
- taxa;
- ready;
- out for delivery;
- delivered.

### Critério de saída

Pedido percorre o ciclo completo até fulfillment.

---

# 60. Fase 7 — notificações

Implementar:

- worker;
- outbox;
- templates;
- status de envio;
- retry.

Nunca bloquear transação de pedido esperando WhatsApp ou e-mail.

---

# 61. Fase 8 — pagamentos reais

Somente depois do fluxo operacional estar estável.

Implementar:

- gateway adapter;
- webhook;
- idempotência;
- payment_attempt;
- refund;
- conciliação;
- tratamento de valor final variável.

---

# 62. Fase 9 — recursos SaaS

Implementar:

- planos;
- limites;
- trial;
- billing SaaS;
- feature flags;
- onboarding;
- customização de marca;
- domínio personalizado;
- métricas por tenant;
- suporte.

O billing da assinatura do SaaS é diferente do pagamento do pedido de carne.

Não misturar os dois domínios.

---

# 63. MVP recomendado

O MVP comercial deve conter:

1. multi-tenant;
2. lojas;
3. catálogo;
4. produtos;
5. preparações;
6. ofertas;
7. preço por kg/unidade;
8. estoque físico;
9. movimentos de estoque;
10. reserva concorrente;
11. storefront;
12. carrinho;
13. checkout convidado;
14. retirada;
15. entrega simples;
16. seleção de método de pagamento;
17. pedido;
18. separação;
19. peso final;
20. preço final;
21. status;
22. auditoria básica.

---

# 64. Fora do MVP

Deixar para depois:

- microserviços;
- roteirização avançada;
- tracking GPS;
- programa de fidelidade;
- cashback;
- marketplace de açougues;
- IA;
- previsão de demanda;
- integração profunda com balanças;
- etiquetas avançadas;
- desossa/rendimento completo;
- lotes avançados;
- contabilidade;
- fiscal completo;
- gateway com todos os meios de pagamento;
- integrações complexas com ERP.

---

# 65. Testes obrigatórios

## Estoque

- duas reservas simultâneas;
- vinte reservas simultâneas;
- estoque insuficiente;
- cancelamento libera reserva;
- expiração libera reserva;
- final menor que reserva;
- final maior que solicitado;
- final fora da tolerância;
- ajuste manual auditado.

## Pedido

- duplo clique;
- retry de request;
- mudança de preço durante checkout;
- produto desativado;
- oferta desativada;
- cancelamento;
- cliente sem conta;
- entrega inválida.

## Multi-tenant

- usuário A tenta ler pedido de B;
- usuário A tenta alterar estoque de B;
- usuário A tenta inserir produto em B;
- admin de loja A tenta acessar loja B;
- bypass de IDs no frontend.

## Preço

- 1 g;
- 999 g;
- 1000 g;
- 1001 g;
- arredondamento;
- promoção expirada;
- preço alterado após pedido.

---

# 66. Critérios de aceitação do produto

## Cliente

O cliente consegue:

- encontrar um corte;
- escolher preparo;
- informar quantidade;
- definir tolerância;
- visualizar preço por kg;
- visualizar estimativa;
- selecionar retirada/entrega;
- informar pagamento;
- concluir sem criar conta;
- acompanhar status.

## Operação

A equipe consegue:

- receber pedido;
- iniciar separação;
- visualizar instruções;
- pesar item;
- alterar para peso real;
- identificar excesso de tolerância;
- concluir;
- liberar sobra de reserva;
- atualizar estoque;
- deixar pronto;
- entregar.

## Gestão

O gestor consegue:

- cadastrar produtos;
- cadastrar ofertas;
- cadastrar preços;
- ajustar estoque;
- visualizar movimentos;
- visualizar pedidos;
- auditar alterações.

## Sistema

O sistema:

- não permite overselling;
- não duplica pedido por retry;
- não recalcula pedido antigo com preço novo;
- isola tenants;
- registra movimentos;
- preserva histórico;
- suporta peso variável corretamente.

---

# 67. Diferenciais que podem tornar o SaaS melhor que um simples cardápio

Depois do core funcionando, há oportunidades fortes.

## 67.1 Lista recorrente

Cliente repete:

> Compra da semana passada.

Um clique recria o carrinho usando preços atuais.

## 67.2 Favoritos

Exemplo:

> Acém moído — 1 kg — moer 2x

## 67.3 Compra por orçamento

Cliente informa:

> Quero R$ 50 de contra-filé.

O sistema converte isso em peso estimado e o operador separa respeitando o teto.

## 67.4 Churrascômetro

Cliente informa:

- pessoas;
- adultos;
- crianças;
- tipos de carne.

Sistema monta sugestão de carrinho.

Não precisa de IA.

Pode ser regra simples.

## 67.5 Assinatura/cesta recorrente

Exemplo:

> Toda sexta, kit da semana.

Implementar somente depois de pedidos normais estarem maduros.

## 67.6 Reposição inteligente para gestão

Com histórico:

- média diária;
- estoque atual;
- pedidos reservados;
- lead time do fornecedor.

O sistema pode sugerir compra.

## 67.7 Produção do dia

Agrupar demanda:

```text
Acém
  moído     12,8 kg
  cubos      6,4 kg
  bifes      4,9 kg

Peito de frango
  filé      15,3 kg
  cubos      3,2 kg
```

Depois o operador ainda finaliza o peso de cada pedido individualmente.

Isso pode aumentar muito a eficiência do açougue em horários de pico.

---

# 68. Outra ideia: promessa operacional

Cada loja configura:

```text
tempo_medio_preparo
capacidade_por_slot
horario_limite
```

O cliente vê:

> Retirada disponível a partir das 16:20.

Isso evita receber 30 pedidos para o mesmo horário sem capacidade de produção.

É um recurso muito valioso para uma versão posterior.

---

# 69. Decisão final

A ideia original está no caminho certo, mas a implementação recomendada muda em um ponto estrutural:

### Modelo anterior

```text
Produto
  ↓
Variante
  ↓
Estoque da variante
```

### Modelo recomendado

```text
Produto comercial
        ↓
Oferta + preparo
        ↓
Inventory item físico
        ↓
Saldo + movimentos + reservas
```

E o pedido trabalha com:

```text
peso solicitado
peso reservado
peso final
```

separadamente.

Essa arquitetura representa melhor o mundo real, diminui risco de estoque incorreto e prepara o produto para:

- SaaS multi-loja;
- pagamento online;
- integração com balança;
- lotes e validade;
- rendimento;
- PDV;
- entrega;
- analytics;
- automações;
- produção agregada.

---

# 70. Próximo passo técnico recomendado

Antes de desenvolver novas telas, implementar nesta ordem:

```text
1. inventory_item
2. preparation_option
3. catalog_offer
4. price_rule
5. inventory_balance
6. inventory_movement
7. inventory_reservation
8. order
9. order_item com snapshot
10. transação atômica de reserva
```

Depois construir o storefront em cima desse domínio.

A arquitetura deve ser validada primeiro com cinco cenários reais:

### Cenário A

```text
1 kg de Acém moído
```

### Cenário B

```text
800 g de Acém em cubos
```

### Cenário C

```text
1 peça de Picanha com peso variável
```

### Cenário D

```text
R$ 50 de Contra-filé
```

### Cenário E

```text
dois clientes tentando comprar o último 1 kg ao mesmo tempo
```

Se o modelo resolver os cinco sem exceções artificiais, a base está pronta para implementação.
