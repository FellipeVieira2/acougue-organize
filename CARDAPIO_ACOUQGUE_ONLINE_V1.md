# Cardápio online para açougue: visão completa e roadmap de implementação

## 1. Visão geral

Este documento define a ideia de um cardápio online para um açougue, conforme o modelo de negócio real do setor: cortes de carne, variações de apresentação, venda por peso, opção de retirada ou entrega, e pedido que cai no sistema da operação para separação, pesagem e faturamento manual.

A proposta não é um cardápio de hambúrgueria, e sim um catálogo de cortes de carne com opções de preparo, apresentação e quantidade. O cliente escolhe o corte, a forma de venda e o modo de retirada/pagamento; a operação recebe o pedido no sistema e executa a separação do produto.

A ideia central é:

- o cliente compra pelo corte, não por item fixo de cardápio;
- o produto pode ter múltiplas formas de apresentação;
- a venda ocorre majoritariamente por peso;
- o sistema acompanha o pedido do início até a separação;
- o pagamento online ainda não é obrigatório; o cliente pode escolher dinheiro, cartão, pix ou débito/crédito para informar a forma de pagamento.

---

## 2. Objetivo do produto

O objetivo é permitir que o cliente navegue por um catálogo de cortes de carne e escolha itens conforme a necessidade do momento:

- Picanha
- Acém
- Frango
- Contra-filé
- Coxa
- Linguiça
- Costela
- etc.

Cada corte pode ter diversas variações, por exemplo:

- Picanha em peça
- Picanha em bifes
- Picanha em tiras
- Picanha moída
- Picanha para panela
- Picanha para churrasco

E também:

- Acém para panela
- Acém moído
- Acém em tiras
- Acém em cubos
- Frango inteiro
- Frango em pedaços
- Frango filé
- Frango moído
- Costela inteira
- Costela em pedaços

A compra pode ser feita:

- por peso
- por unidade
- por porção fixa
- por quantidade definida pela operação

---

## 3. Diferenciação do açougue em relação a outros modelos de cardápio

### 3.1 Características do negócio

O açougue tem regras muito diferentes de restaurante ou lanchonete:

- grande parte da venda é por peso;
- o cliente pode solicitar corte ou apresentação personalizada;
- o produto pode ser vendido bruto, em peça, em tiras, moído, para panela, etc.;
- o atendimento pode exigir pesagem real na bancada;
- o estoque precisa ser reservado no momento do pedido;
- o pedido pode ser retirado no balcão ou entregue;
- o acompanhamento do pedido é importante para garantir qualidade e confiança.

### 3.2 O que não é o modelo dessa solução

- não é um menu de hamburgueria;
- não é um menu de pizza com opções fixas;
- não é um checkout de e-commerce tradicional com produto único e preço fixo;
- não exige pagamento online obrigatoriamente no MVP;
- não exige integração com gateway em fase inicial.

---

## 4. Personas e comportamentos

### 4.1 Cliente do açougue

Perfil:

- compra carne para semana, churrasco, família, refeição ou pequenos pedidos;
- gosta de saber preço por peso;
- quer cortar conforme necessidade;
- valoriza apresentação e qualidade do corte;
- pode comprar por balcão ou online.

Objetivos:

- encontrar o corte desejado rapidamente;
- visualizar opções e apresentação;
- escolher a quantidade;
- saber se o item está disponível;
- pagar com o método desejado;
- retirar ou receber o produto com facilidade.

### 4.2 Operador da loja

Perfil:

- trabalha no balcão ou na produção;
- precisa gerenciar catálogo e preços;
- precisa separar itens corretamente;
- precisa saber se o pedido foi confirmado e pronto para retirada;
- precisa ajustar peso e valor final no momento da separação.

Objetivos:

- cadastrar cortes e variações de forma ágil;
- controlar preço por kg e por peça;
- receber pedidos sem erro;
- separar itens de acordo com as opções escolhidas;
- ajustar o peso e confirmar o valor final;
- manter rastreabilidade de estoque.

---

## 5. Modelo conceitual do produto

### 5.1 Produto base

Um produto base representa o corte principal, por exemplo:

- Picanha
- Acém
- Frango inteiro
- Contra-filé
- Costela

Campos sugeridos:

- id
- nome
- categoria
- espécie
- descrição curta
- ativo/inativo
- status de visibilidade
- criado em
- atualizado em

### 5.2 Variante do produto

Uma variante representa uma forma específica de apresentação do corte.

Exemplos:

- Picanha / em peça
- Picanha / em bifes
- Acém / para panela
- Acém / moído
- Frango / filé

Campos sugeridos:

- id
- product_id
- nome da variante
- sku
- unidade de venda: kg, unidade, porção
- peso mínimo
- peso máximo
- preço base
- preço por kg
- ativo/inativo
- disponibilidade
- descrição opcional
- tags: panela, churrasco, moído, tiras, iscas, etc.

### 5.3 Preço

O preço pode variar por:

- loja
- canal: balcão, online, entrega
- vigência
- tipo de venda: kg, unidade, porção

Regra ideal do MVP:

- preço por kg para a maioria dos cortes;
- preço por unidade ou por porção em alguns itens específicos;
- preços por loja e por canal em uma primeira versão simples.

### 5.4 Estoque

O estoque precisa refletir a disponibilidade real do produto:

- estoque por loja
- quantidade disponível em kg ou unidades
- reserva atômica por pedido
- ajuste de estoque por separação, perda, venda ou devolução

---

## 6. Fluxo do cliente

### 6.1 Fluxo principal

1. Cliente entra na loja online
2. Visualiza categorias de cortes
3. Escolhe o tipo de carne
4. Visualiza variações disponíveis
5. Seleciona a apresentação (bifes, moído, tiras, etc.)
6. Define quantidade em kg ou unidade
7. Adiciona ao carrinho
8. Escolhe retirada ou entrega
9. Escolhe método de pagamento: dinheiro, cartão, pix, débito/crédito
10. Confirma pedido
11. Sistema registra o pedido e reserva o estoque
12. Operação recebe o pedido e inicia separação
13. O atendente confirma peso real e valor final
14. Cliente retira ou recebe a compra

### 6.2 Fluxo de separação da operação

1. Pedido chega na operação
2. O atendente vê o item e a demanda
3. O operador separa o corte em quantidade real
4. Coloca observações e peso real
5. Confirma item e valor final
6. O pedido passa para pronto
7. Cliente é avisado para retirada ou entrega

---

## 7. Regras de negócio principais

### 7.1 Variação por corte

- um corte pode ter múltiplas formas de apresentação;
- cada apresentação pode ter preço próprio;
- a apresentação deve ser clara para o cliente;
- nome e SKU devem ser legíveis para operação e gestão.

### 7.2 Venda por peso

- o sistema deve indicar que a venda é por kg;
- se tiver margem de peso, o cliente pode escolher faixa aproximada;
- o peso final é confirmado na separação; 
- o valor pode ser recalculado com base no peso exato.

### 7.3 Separação e pesagem

- as opções do pedido devem respeitar o tipo de corte;
- a separação real pode alterar o valor final;
- se o peso final divergir do estimado, deve aparecer uma revisão no pedido;
- há necessidade de auditoria para evitar fraude ou erro operacional.

### 7.4 Pagamento no MVP

No planejamento inicial, o pagamento online não precisa ser processado.

O cliente escolhe o método:

- dinheiro
- cartão
- pix
- débito
- crédito

Isso serve como:

- informação de cobrança;
- preparo da operação;
- previsibilidade para o caixa;
- preparação para uma futura integração de gateway.

### 7.5 Carrinho

- o cliente pode adicionar vários itens;
- cada item precisa ser individualizado por corte e apresentação;
- a quantidade pode ser em kg ou quantidade;
- o carrinho precisa mostrar valor estimado;
- não deve permitir compra de item indisponível.

---

## 8. Estrutura de dados recomendada

### 8.1 Tabelas essenciais

#### app.product
- id
- organization_id
- name
- category
- species
- description
- active
- created_at
- updated_at

#### app.product_variant
- id
- product_id
- organization_id
- name
- sku
- presentation_type
- unit_type
- min_weight_kg
- max_weight_kg
- active
- created_at

#### app.product_price
- id
- organization_id
- store_id
- product_variant_id
- channel
- amount_minor
- currency
- valid_from
- valid_to
- revision
- created_at

#### app.store
- id
- organization_id
- name
- slug
- active
- created_at

#### app.inventory
- id
- organization_id
- store_id
- product_variant_id
- available_qty
- available_weight_kg
- reserved_qty
- reserved_weight_kg
- updated_at

#### app.order
- id
- organization_id
- store_id
- customer_id
- status
- order_type
- payment_method
- total_minor
- estimated_total_minor
- pickup_or_delivery
- created_at
- updated_at

#### app.order_item
- id
- order_id
- product_variant_id
- quantity
- unit_type
- estimated_weight_kg
- unit_price_minor
- final_price_minor
- notes
- created_at

#### app.order_event
- id
- order_id
- action
- actor_id
- details
- created_at

### 8.2 Enum sugeridos

#### presentation_type
- PIECE
- BEEF_CUT
- MINCED
- TIRAS
- PANELA
- ISCAS
- WHOLE
- FILE
- etc.

#### unit_type
- KG
- UNIT
- PORTION

#### order_status
- DRAFT
- CONFIRMED
- RESERVED
- PREPARING
- READY
- PICKED_UP
- DELIVERED
- CANCELED

#### payment_method
- CASH
- CARD
- PIX
- DEBIT
- CREDIT
- BANK_TRANSFER

---

## 9. UX e UI do cliente

### 9.1 Tela inicial

- hero com destaque das categorias
- lista de cortes mais vendidos
- filtros por categoria
- busca por nome

### 9.2 Tela de categoria/corte

- nome do corte
- imagens ou fotos do produto
- descrição
- opções de apresentação
- preço por kg
- botão “adicionar ao carrinho”

### 9.3 Tela de variação

- Picanha / em bifes
- Picanha / em tiras
- Picanha para panela
- preço por kg
- peso estimado
- botão para selecionar quantidade

### 9.4 Carrinho

- lista de itens
- peso estimado
- valor estimado
- observações
- forma de retirada
- forma de pagamento
- botão confirmar pedido

### 9.5 Tela de confirmação

- resumo do pedido
- endereço ou retirada selecionada
- valor estimado
- observações finais
- botão confirmar compra

---

## 10. UX e UI da operação

### 10.1 Dashboard da operação

- pedidos pendentes
- pedidos em preparo
- pedidos prontos
- pedidos cancelados
- quantidade e peso total estimado
- filtros por loja, hora e status

### 10.2 Tela de pedido

- cliente
- itens
- valor estimado
- observações
- status da produção
- botões de mudança de status
- campo de peso real
- campo para confirmação final

### 10.3 Tela de separação

- item a separar
- quantidade pedida
- corte e apresentação
- peso real final
- botão para concluir separação
- ajuste de preço final

---

## 11. Implementação passo a passo

## Fase 1 — Base da estrutura

### Passo 1: modelar o domínio do açougue

- definir produto base
- definir variantes
- definir tipo de unidade e apresentação
- definir categorias de corte

### Passo 2: criar migrations do banco

- tabela de produto
- tabela de variante
- tabela de preço
- tabela de estoque
- tabela de pedido
- tabela de item de pedido
- tabela de eventos de pedido

### Passo 3: regras de isolamento por loja e organização

- garantir que cada loja só veja sua própria produção e estoque
- garantir que cada pedido se relacione à loja correta
- validar RLS/tenant isolation

### Passo 4: criar catalog admin básico

- cadastro de corte
- cadastro de variante
- cadastro de preço
- ativar/inativar item
- salvar observação e apresentação

### Critérios de saída desta fase

- é possível cadastrar um corte e uma variante
- é possível atribuir preço por kg
- a loja consegue isolar dados da sua operação

---

## Fase 2 — estoque e disponibilidade

### Passo 5: criar estoque por variante

- estoque em kg ou quantidade
- reserva por pedido
- liberação automática por cancelamento

### Passo 6: regras de disponibilidade

- item indisponível não pode ser adicionado ao carrinho
- estoque insuficiente deve bloquear compra
- se o pedido for cancelado, a reserva deve ser liberada

### Critérios de saída desta fase

- não é possível vender item sem estoque
- pedido reserva o estoque corretamente
- cancelamento libera a reserva

---

## Fase 3 — fluxo do cliente e carrinho

### Passo 7: storefront do cliente

- catálogo com categorias e cortes
- listagem de variações
- visualização de preço por kg
- opção de quantidade
- botão adicionar ao carrinho

### Passo 8: carrinho

- itens separados por corte e apresentação
- quantidade estimada
- modo de retirada
- forma de pagamento selecionada
- valor estimado

### Passo 9: checkout simples

- confirmação do pedido
- resumo final
- seleção entre retirada/entrega
- confirmação sem pagamento online

### Critérios de saída desta fase

- cliente consegue concluir um pedido
- pedido entra no sistema da operação
- o pedido tem status inicial correto

---

## Fase 4 — operação e separação

### Passo 10: dashboard de pedidos

- lista de pedidos pendentes
- filtros por status
- detalhamento do pedido

### Passo 11: separação e pesagem

- atendente ajusta peso e finaliza pedido
- valor real pode ser recalculado
- evento de pedido é registrado

### Passo 12: status do pedido

- recebido
- separado
- pronto
- entregue
- cancelado

### Critérios de saída desta fase

- operação consegue separar e confirmar pedido
- peso e valor final ficam rastreáveis
- cliente consegue retirar ou receber corretamente

---

## Fase 5 — expansão e maturidade

### Passo 13: entrega e logística simples

- endereço do cliente
- faixa de entrega
- taxa de entrega
- status de entrega

### Passo 14: pagamento real

- integração com gateway
- cartão, pix e boleto
- webhook de pagamento

### Passo 15: analytics e operação

- produtos mais vendidos
- cortes mais procurados
- faturamento por loja
- volume e custos por corte

---

## 12. Regras de implementação para o projeto atual

### 12.1 O que já existe e serve como base

O projeto atual já possui base sólida de:

- autenticação
- conta
- loja e organização
- catálogo interno simples
- edição de produtos
- auditoria
- isolamento por organização

Esses blocos já permitem começar a construir a funcionalidade de açougue online ao invés de começar do zero.

### 12.2 O que precisa adicionar

A próxima evolução real deve ser:

- modelagem de variantes de corte
- tipo de apresentação
- estoque real
- reserva de estoque
- pedidos
- separação
- status operacional
- checkout para retirada/entrega

---

## 13. Estratégia de priorização

### MVP recomendado

O primeiro MVP de açougue online deve incluir:

1. cadastro de cortes e variantes;
2. preço por kg e por unidade;
3. escolha de apresentação;
4. catálogo público para cliente;
5. carrinho simples;
6. pedido sem pagamento online;
7. seleção de pagamento em dinheiro/cartão/pix;
8. dashboard operacional para separação;
9. status do pedido e retirada;
10. estoque mínimo para reserva.

### Fora do MVP inicial

- gateway e cobrança online
- entrega integrada com motorista
- rastreio de entrega em tempo real
- promoções complexas
- fidelidade e cashback
- IA e previsão

---

## 14. Critérios de aceitação do MVP

### Cliente

- consegue ver os cortes e suas variações
- consegue escolher apresentação e quantidade
- consegue adicionar item ao carrinho
- consegue confirmar pedido sem pagar online
- consegue informar o método de pagamento

### Operação

- consegue visualizar pedidos pendentes
- consegue separar o pedido corretamente
- consegue confirmar o peso final
- consegue mover o pedido para pronto e entregue
- consegue reduzir estoque após confirmação

### Sistema

- pedido não duplica estoque
- item indisponível não pode ser vendido
- pedido respeita a organização e a loja correta
- dados ficam isolados por tenant

---

## 15. Coisas que devem ser evitadas

- não transformar o açougue em um cardápio fixo de “hambúrguer”; 
- não vender sem uma regra clara de peso e preço;
- não ignorar separação e pesagem real;
- não abrir pagamento de e-commerce sem a regra de estoque e cobrança;
- não misturar loja interna com loja pública sem diferenciação de canal.

---

## 16. Proposta de roadmap prático

### Sprint 1
- modelagem de produto, variante e preço
- cadastro de corte e apresentação
- isolamento por loja

### Sprint 2
- estoque e reserva
- catálogo público básico
- carrinho e checkout sem pagamento

### Sprint 3
- dashboard operacional
- status do pedido e separação
- confirmação de peso real

### Sprint 4
- retirada e entrega simples
- pagamento por seleção de método
- refinamento do preço final

### Sprint 5+
- gateway real
- analytics
- campanhas, promoções e fidelidade

---

## 17. Conclusão

A melhor maneira de pensar no futuro do açougue no projeto é esta:

- o cliente compra corte + apresentação + peso;
- a operação separa e pesa o item real;
- o pedido cai no sistema e pode ser retirado ou entregue;
- o pagamento pode ser informado no pedido, sem exigir gateway no início;
- o core real do negócio é a gestão do corte, da variação e da separação.

Essa é a direção mais fiel ao modelo de açougue real e mais adequada para o projeto atual.

---

## 18. Próximo passo sugerido

A partir deste documento, a próxima etapa natural é:

1. validar a estrutura de dados do açougue;
2. definir a primeira versão do modelo de produto + variante + preço;
3. começar pela implementação do catálogo e estoque;
4. depois avançar para pedido e separação.

Se quiser, na próxima etapa eu posso transformar este documento em um plano técnico de desenvolvimento com:

- migrations reais;
- endpoints da API;
- telas do cliente e do operador;
- backlog por sprint;
- critérios de aceite para cada fase.
