# Modelo de dados V1

Especificação lógica PostgreSQL. As migrations executáveis devem materializar e testar estas regras por fatia; a presença de uma tabela neste documento não significa implementação concluída.

## Convenções

`id uuid primary key`, `created_at/updated_at timestamptz` em UTC; `version bigint >= 1` para agregados concorrentes. UUID gerado com fonte segura. Valores em `bigint` centavos/gramas; percentuais `integer` basis points; analytics pode usar numeric. JSONB apenas para payload versionado/configuração validada, não substituir FKs e campos de decisão. Moeda `char(3)` e inicial BRL. Quantidades discriminadas por unidade, nunca um número sem unidade.

Nas tabelas tenant, `organization_id NOT NULL`, `UNIQUE(organization_id,id)` e FKs compostas `(organization_id,parent_id)`. Nas entidades locais, também `store_id` e FK composta para Store. Índices iniciam por tenant e, quando pertinente, loja; FK referenciadora recebe índice. Exclusão usa RESTRICT em histórico; desativação/status para entidades operacionais. Correções de ledger são lançamentos inversos ligados ao original. Campo pessoal é restrito e minimizado. RLS com SELECT/INSERT/UPDATE/DELETE e WITH CHECK; role runtime sem ownership/BYPASSRLS.

## Identidade, organização e plataforma

| Tabela | Campos relevantes | Constraints / índices |
|---|---|---|
| User | email_normalized, password_hash, status, auth_version, mfa_enabled | email único; senha hash nunca serializada |
| Session | user_id, token_hash, refresh_family, expires_at, revoked_at, auth_version | token_hash único; índice user/expiry; refresh com rotação |
| PasswordReset | user_id, token_hash, expires_at, used_at | hash único; uso único transacional |
| Organization | legal_name, display_name, status, timezone, demo, retention_policy_id | status validado; índice status/created_at |
| Store | organization_id, name, slug, status, timezone, currency, version | slug público global único; unique organization/id |
| Membership | organization_id, user_id, status, version | unique organization/user; impedir último owner removido no serviço |
| Role | organization_id, code, name | unique organization/code |
| Permission | code, description | code único; catálogo de permissões |
| RolePermission | organization_id, role_id, permission_code | PK organization/role/permission |
| MembershipRole | organization_id, membership_id, role_id | FKs compostas; PK dos três |
| StoreMembership | organization_id, store_id, membership_id | FKs compostas e unique dos três |
| Invitation | organization_id, email_normalized, token_hash, expires_at, accepted_at, role_id | hash único; convite não concede acesso antes do aceite |
| StoreConfiguration | organization_id, store_id, revision, weight_policy, payment_methods, delivery_config, discount_policy | unique store/revision; schema validado |
| OnboardingProgress | organization_id, store_id, step, completed_at, skipped_at | unique tenant/store/step |
| PlatformUser | user_id, platform_role, status, mfa_required | user único; independente de Membership |
| PlatformSession | platform_user_id, token_hash, expires_at, mfa_verified_at | namespace/cookie distintos; hash único |
| PlatformAuditLog | actor_id, action, target_organization_id, reason, before_redacted, after_redacted, correlation_id | append-only; índices ator/data e tenant/data |
| SupportAccessGrant (futuro) | platform_user_id, organization_id, scope, reason, expires_at, revoked_at | sem concessão implícita por role tenant |

## Assinaturas e controle comercial

| Tabela | Campos relevantes | Constraints / índices |
|---|---|---|
| Plan | code, name, visibility, status | code único; PUBLIC/PRIVATE |
| PlanVersion | plan_id, revision, amount_minor, currency, interval_months, trial_days, published_at | unique plan/revision; valores >=0; intervalo >0; imutável publicada |
| Entitlement | key, kind, unit, merge_policy | key único; BOOLEAN/LIMIT |
| PlanEntitlement | plan_version_id, entitlement_key, bool_value, limit_value, unlimited | unique versão/key; CHECK de tipo/valor único |
| Subscription | organization_id, plan_version_id, provider_ref, status, period_start, period_end, cancel_at, revision | uma assinatura corrente por tenant; provider/ref único quando presente |
| SubscriptionItem | organization_id, subscription_id, addon_plan_version_id, quantity, effective_at, ends_at | quantity >0; FK composta para assinatura |
| SubscriptionChange | organization_id, subscription_id, target_version_id, preview_hash, effective_at, status, idempotency_key | unique tenant/key; PENDING/APPLIED/FAILED/CANCELED |
| Trial | organization_id, subscription_id, starts_at, ends_at, activated_at | unique subscription; ends > starts |
| BillingCustomer | organization_id, provider, external_id | unique tenant/provider; unique provider/external_id |
| BillingInvoice | organization_id, subscription_id, provider, external_id, amount_minor, currency, status, due_at, paid_at | unique provider/external_id; amount >=0 |
| BillingEvent | provider, external_event_id, organization_id, payload_reference, received_at, processed_at, status, attempts | unique provider/event; assinatura verificada antes do efeito |
| BillingPolicy | revision, grace_days, restricted_after_days, retention_policy_id | configurável e versionada |
| SaaSCoupon | code, discount_type, value, starts_at, ends_at, max_redemptions | separada de cupom do consumidor |
| CouponRedemption | organization_id, coupon_id, subscription_id, redeemed_at | unique conforme regra comercial; quota concorrente |
| EntitlementOverride | organization_id, key, value, valid_from, valid_until, actor_id, reason | intervalo válido; índice tenant/key/validade |
| UsageLedger | organization_id, metric, period_start, delta, event_id | unique tenant/metric/event; append-only |
| UsageCounter | organization_id, metric, period_start, value, version | unique tenant/metric/período; value >=0 |
| FeatureFlag | key, enabled, rollout_bps, salt, revision | key único; 0..10000 |
| TenantFeatureOverride | organization_id, flag_key, enabled, expires_at, reason, actor_id | unique tenant/flag; auditoria |
| Cancellation | organization_id, subscription_id, reason_code, comment, requested_at, effective_at | não apaga assinatura |
| RetentionPolicy | revision, data_category, retention_config, legal_hold_rules | política publicada imutável |
| DataLifecycleRequest | organization_id, kind, status, requested_by, scheduled_at, legal_hold, executed_at | export/anonymize/delete auditados |

## Catálogo e preços

| Tabela | Campos relevantes | Constraints / índices |
|---|---|---|
| AnimalSpecies | code, name | catálogo de referência; code único |
| Category | organization_id, name, parent_id | FK pai no tenant; ciclos proibidos |
| Cut | organization_id, species_code, name | nome/espécie conforme catálogo local |
| Product | organization_id, sku, name, description, category_id, species_code, cut_id, kind, stock_unit, sale_strategy, active, version | unique tenant/sku; enum de unidade/estratégia |
| ProductVariant | organization_id, product_id, sku, attributes, active | unique tenant/sku; FK composta |
| UnitConversion | organization_id, product_id, from_unit, to_unit, numerator, denominator, revision | numerador/denominador >0; conversão explícita |
| ProductSaleRule | organization_id, product_id, min_quantity, increment_quantity, package_grams, approximate_grams, tolerance_bps | quantidades >0 quando exigidas; tolerância 0..10000 |
| PreparationOption | organization_id, code, name, active | unique tenant/code |
| PackagingOption | organization_id, code, name, active | unique tenant/code |
| ProductPreparation / ProductPackaging | organization_id, product_id, option_id | unique vínculo; FKs compostas |
| PriceList | organization_id, name, channel, customer_group_id, priority | índice tenant/channel/priority |
| ProductPrice | organization_id, store_id, product_id, price_list_id, amount_minor, currency, valid_from, valid_until, revision | amount >=0; evitar vigências ambíguas na mesma chave |
| PriceAudit | organization_id, product_id, old_minor, new_minor, actor_id, reason | append-only |
| Promotion (fase posterior) | organization_id, rule_type, rule_version, channel, validity, priority, stacking_policy | regra validada; cupom consumidor separado de SaaSCoupon |
| StorefrontConfiguration | organization_id, store_id, published, logo_object_id, colors, custom_domain | um por loja; domínio único quando validado |

## Clientes e B2B

Customer(organization_id, type PF/PJ, name, phone, email, document_encrypted opcional, active, marketing_consent_at, source); índice tenant/name e tenant/phone, sem unicidade global de telefone. CustomerAddress(organization_id, customer_id, postal_code, street, number, complement, city, region) com acesso restrito. CustomerTag e CustomerTagAssignment com FKs compostas. BusinessCustomer(organization_id, customer_id, price_list_id, credit_limit_minor, payment_terms_id, salesperson_id), unique tenant/customer. CreditLedger(organization_id, customer_id, amount_minor, entry_type, order_id, reversal_of) append-only; crédito consumido em transação com lock do cliente. PaymentTerms registra condições versionadas. PortalMembership liga identidade ao comprador, sem conceder Membership operacional.

## Pedidos, pesagem e atendimento

| Tabela | Campos relevantes | Constraints / índices |
|---|---|---|
| Order | organization_id, store_id, customer_id, source, external_order_id, integration_id, external_status, external_metadata, fulfillment_status, payment_status, delivery_status, estimated_minor, final_minor, currency, version | unique tenant/integration/external_id quando presente; índice tenant/store/status/created |
| OrderItem | organization_id, order_id, product_id, variant_id, unit, requested_quantity, estimated_quantity, actual_quantity, name_snapshot, sku_snapshot, price_minor_snapshot, cost_minor_snapshot, estimated_subtotal, final_subtotal, policy_snapshot, preparation_snapshot, packaging_snapshot, original_item_id, status | requested >0; actual >=0 se definido; snapshots imutáveis após conclusão |
| WeighingRevision | organization_id, order_item_id, revision, grams, source, device_id, actor_id, reason, created_at | unique item/revision; grams >=0 |
| WeightApproval | organization_id, order_id, quote_revision, quote_hash, approved_at, actor_type, token_hash | aprovação válida só para revisão/hash atuais |
| OrderStatusHistory | organization_id, order_id, previous_status, new_status, actor_id, actor_type, source, reason, metadata | append-only; índice tenant/order/created |
| OrderPublicToken | organization_id, order_id, token_hash, scope, expires_at, revoked_at | hash único; token original só ao emitir |
| OrderAdjustment | organization_id, order_id, item_id, kind, amount_minor, reason, actor_id | motivos para substituição/cancelamento parcial/desconto |
| IdempotencyRecord | organization_id, actor_scope, operation, key, request_hash, status, response_code, response_body, expires_at | unique tenant/actor_scope/operation/key; hash diferente =409 |

## Estoque, compras e produção

InventoryLocation(organization_id, store_id, name); InventoryLot(organization_id, store_id, product_id, supplier_id, receipt_item_id, production_output_id, lot_code, received_at, packed_at, expires_at, status, original_quantity, cost_minor) com índices FEFO `(organization_id,store_id,product_id,expires_at,id)`. Produto sem rastreio físico ainda usa bucket interno identificado, sem inventar validade.

StockBalance(organization_id, store_id, product_id, lot_id, on_hand, reserved, version), unique chave completa, CHECK on_hand>=0, reserved>=0, reserved<=on_hand para operação online sem exceção. StockMovement(organization_id, store_id, product_id, lot_id, type, quantity_delta, reserved_delta, cost_minor, reference_type, reference_id, reversal_of, event_id, actor_id, reason); unique tenant/event_id; sem UPDATE/DELETE para runtime. StockReservation(organization_id, order_item_id, lot_id, quantity, state, expires_at), quantity>0; reservas ativas expiram por job idempotente que registra release. SaleAllocation(organization_id, order_item_id, lot_id, quantity, cost_minor) conserva CMV.

Supplier(organization_id,name,document,contacts); PurchaseOrder(organization_id,store_id,supplier_id,status,version); PurchaseOrderItem(organization_id,purchase_order_id,product_id,quantity,unit,cost_minor_snapshot); GoodsReceipt(organization_id,store_id,purchase_order_id,status,received_by,confirmed_at); GoodsReceiptItem(organization_id,receipt_id,product_id,quantity,lot_id,cost_minor); PurchaseInvoice(organization_id,supplier_id,object_id,external_key,status) com unique tenant/external_key. XML fica em quarentena até conferência.

ProductionBatch(organization_id,store_id,status,allocation_strategy,allocation_revision,input_grams,output_grams,loss_grams,total_cost_minor,version); ProductionInput(organization_id,batch_id,lot_id,grams,cost_minor); ProductionOutput(organization_id,batch_id,product_id,grams,category,allocated_cost_minor,coefficient_snapshot,market_price_snapshot); soma massa/custo validada sob transação antes de COMPLETED. InventoryLoss(organization_id,lot_id,grams,cost_minor,reason,actor_id,movement_id); InventoryCount(organization_id,store_id,status,version) e CountItem(organization_id,count_id,product_id,lot_id,expected_quantity,counted_quantity,movement_id). Transfer(organization_id,from_store_id,to_store_id,status) relaciona movimentos de saída/entrada sem atravessar tenant.

## Caixa, pagamentos, financeiro e entrega

CashRegister(organization_id,store_id,name,active); CashSession(organization_id,store_id,register_id,opened_by,opened_at,opening_minor,status,closed_at,counted_minor,expected_minor,difference_minor,version), índice único parcial por register WHERE status='OPEN'. CashMovement(organization_id,session_id,type,method,amount_minor,payment_id,reversal_of,actor_id,reason,event_id) append-only; unique tenant/event_id. Fechamento guarda totais por método em CashClosingMethod; saldo físico considera só dinheiro.

Payment(organization_id,order_id,provider,external_id,method,strategy,status,authorized_minor,captured_minor,refunded_minor,currency,version), CHECK 0<=refunded<=captured; external_id único por provider/merchant. PaymentAttempt(organization_id,payment_id,idempotency_key,status,provider_reference,error_code) separa tentativas. Refund(organization_id,payment_id,amount_minor,status,idempotency_key,reason) protege repetição e total devolvido sob lock. Settlement(organization_id,payment_id,gross_minor,fee_minor,net_minor,expected_at,settled_at) distingue venda de repasse.

Receivable/Payable(organization_id,store_id,counterparty_id,order_id opcional,amount_minor,due_at,status,paid_minor,version); FinancialTransaction(organization_id,account_id,amount_minor,direction,source_type,source_id,reversal_of,category_id,cost_center_id); CashAccount/BankAccount, FinancialCategory, CostCenter e ReceivablePayment com FKs tenant. Aging deriva vencimento e saldo; renegociação preserva obrigações originais e vínculo. CreditLedger registra fiado, nunca apaga dívida.

DeliveryZone(organization_id,store_id,name,rule); DeliveryFeeRule(organization_id,zone_id,revision,amount_minor,min_order_minor,free_above_minor); DeliverySlot(organization_id,store_id,starts_at,ends_at,capacity,reserved,version), CHECK 0<=reserved<=capacity; DeliveryOrder(organization_id,order_id,address_snapshot,fee_minor_snapshot,slot_id,driver_id,status); Driver(organization_id,user_id,active); Route/RouteStop futuros. Capacidade é reservada atomicamente no checkout. Retirada não exige endereço residencial.

## Integrações, arquivos, operação e analytics

Integration(organization_id,store_id,provider,merchant_id,status,capabilities,version), unique tenant/provider/merchant; IntegrationCredential(organization_id,integration_id,secret_reference,key_version,rotated_at); ExternalMapping(organization_id,integration_id,entity_type,entity_id,external_id), unique tenant/integration/type/external_id. ExternalEventInbox(provider,integration_id,organization_id,external_event_id,payload_reference,status,attempts,received_at,processed_at) unique integration/event. OutboxEvent(organization_id,aggregate_id,aggregate_version,event_type,schema_version,payload,status,available_at,attempts,published_at), índice parcial pending/available; ConsumerInbox(consumer,event_id,processed_at) unique par; JobExecution inclui tenant e error_code redigido.

Device(organization_id,store_id,public_key,lease_expires_at,revoked_at,last_sequence); OfflineOperation(organization_id,device_id,client_operation_id,sequence,request_hash,status,result), unique tenant/device/client_operation_id e device/sequence. ScaleBarcodeConfiguration(organization_id,store_id,revision,prefix,plu_start,plu_length,value_start,value_length,value_kind,scale_factor,checksum_scheme) valida layout antes de ativar.

ObjectRecord(organization_id,store_id opcional,purpose,storage_key,mime,size_bytes,status,expires_at) unique storage_key; ImportJob(organization_id,store_id,object_id,status,row_count,valid_count,error_count,preview_hash,confirmed_by); ImportRow(organization_id,job_id,row_number,normalized_data,errors,status), unique job/row. AuditLog conforme arquitetura operacional, append-only. Notification(organization_id,user_id,type,status,dedupe_key,created_at) unique tenant/user/dedupe. ProductEvent(organization_id,store_id,event_type,event_id,occurred_at,properties_redacted), unique event_id. SaaSMrrSnapshot(organization_id,period_start,plan_version_id,mrr_decimal,currency,policy_revision), unique tenant/period; AnalyticsDaily(organization_id,store_id,business_date,channel,revenue_minor,cmv_minor,orders,grams,projection_version), chave por dimensões.

## Regras transacionais obrigatórias

1. Provisionar tenant, proprietário, loja, assinatura e evento em uma transação local.
2. Criar pedido, snapshots, reserva, consumo de quota e outbox atomicamente.
3. Pesagem muda revisão, ajusta reserva e invalida aprovação antiga no mesmo commit.
4. Concluir venda bloqueia pedido/caixa/saldos em ordem estável, verifica pagamento, baixa estoque, registra caixa/CMV/auditoria/outbox uma vez.
5. Webhook não executa cobrança externa dentro de lock longo; usa inbox e reconciliação.
6. Uso e limite são lidos/escritos sob lock por organização; sem corrida de última loja/usuário.
7. Índices de unicidade e idempotência são defesa final contra concorrência, não apenas checagens de aplicação.

## Migrations e validação

Cada migration tem revisão, checksum e transação quando suportada. Criar roles/tabelas/FKs/checks/índices/RLS; provar RLS usando o usuário de runtime, não dono do banco. Alterações expand/contract antes de remover colunas. CI sobe banco vazio, aplica todas as migrations e executa testes de duas organizações, concorrência, rollback e reconciliação. Restore deve ser ensaiado antes de liberar produção.
