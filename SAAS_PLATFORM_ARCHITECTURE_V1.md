# Arquitetura SaaS V1

Data: 2026-09-10. Especificação para implementação; não certifica funcionalidades existentes. Complementa a arquitetura operacional e é a referência para separação de clientes.

## 1. Provisionamento

Signup valida identidade, plano publicado e política comercial; uma chave idempotente protege a solicitação. Transação cria Organization em PROVISIONING, Membership OWNER, Store inicial, permissões/configurações e Subscription/Trial vinculados a PlanVersion. Uma restrição de unicidade impede duplicação pelo mesmo request. Outbox executa efeitos externos: BillingCustomer, notificações e recursos de storage. Finalização muda Organization para ACTIVE quando os requisitos locais estão íntegros. Falha externa permite retry com a mesma identidade; não cria outro cliente nem cobra novamente. Não inserir dados de piloto fixos em migrations de produção. Demo é um tenant fictício provisionado pelo mesmo caminho, explicitamente marcado.

## 2. Isolamento

Toda tabela operacional carrega organization_id. O servidor autentica a sessão e resolve Membership; nunca confia em organizationId do body, header ou job sem vinculação. RLS usa `current_setting('app.organization_id', true)` e retorna nenhum dado quando o contexto não existe. Contexto é `SET LOCAL` dentro da transação, limpo pelo commit/rollback e seguro para pool. Role de runtime não é dona das tabelas, não é superuser e não tem BYPASSRLS. Aplicar FORCE ROW LEVEL SECURITY e policies WITH CHECK. FKs compostas proíbem relacionamentos entre clientes, mesmo em consultas privilegiadas. Recursos de outro tenant respondem 404; permissões insuficientes sobre recurso próprio respondem 403.

## 3. Usuários e organizações

User é identidade global, sem role operacional global. Membership liga user à organization, status ACTIVE/DISABLED e papéis. Um usuário pode pertencer a mais de uma organização, mas cada sessão de trabalho possui contexto ativo autorizado. Troca de organização renova contexto/CSRF, encerra canais e limpa caches da interface. Convites possuem hash de token, validade, e-mail destinatário e aceite idempotente. Remover último OWNER ativo é proibido até transferir titularidade. Revogação invalida sessões/leases conforme versão de autorização.

## 4. Multiloja

Store pertence a uma organização. StoreMembership limita usuários a lojas; OWNER pode receber escopo organizacional explícito. Produtos são organizacionais, preços/saldos/caixas/pedidos são locais. UI permite visão consolidada somente a quem tem escopo. Cada endpoint valida storeId contra tenant e acesso do usuário. Limite de lojas ativas é entitlement e criação concorrente é serializada por organização. Arquivar loja preserva histórico; impedir enquanto houver caixa aberto/pedido operacional pendente.

## 5. Billing

Billing SaaS cobra o açougue; Payments cobra o consumidor. Tabelas, webhooks, chaves e credenciais separados. BillingProvider abstrai customer, checkout, subscription, changePreview, change, cancellation e reconciliation. MockBillingProvider é exclusivo de desenvolvimento/teste. Provedor real e métodos serão habilitados após configuração. Webhook valida assinatura sobre bytes originais, deduplica eventId e persiste inbox antes de processamento. Eventos antigos não regridem estado: reconciliar versão/data do provedor e, em ambiguidade, consultar estado atual. Falha de transporte não significa inadimplência.

## 6. Planos

Plan contém identidade/nome; PlanVersion imutável contém moeda, preço em centavos, intervalo, trialPolicy e entitlements. Assinatura aponta à versão contratada. Nova publicação não migra clientes anteriores automaticamente. Plano enterprise pode ter versão privada com condições negociadas. Seed comercial de demonstração é identificado como exemplo; preços de produção exigem decisão comercial. Add-ons são itens de assinatura versionados e podem ampliar recursos/limites.

## 7. Entitlements

EntitlementService resolve regras centralizadas. Precedência: override vigente auditado → composição da versão base e add-ons confirmados → default deny. Booleanos usam semântica explícita (união de concessões, salvo override de negação); limites agregáveis somam base+add-on, outros usam regra cadastrada. Suspensão aplica uma política de acesso por ação após resolução dos direitos, sem alterar contrato. Frontend recebe projeção para navegação, mas backend revalida. Chaves sugeridas POS, STOREFRONT, PRODUCTION, B2B, IFOOD_INTEGRATION, ADVANCED_ANALYTICS, API, AI_ASSISTANT, MAX_STORES, MAX_USERS, MAX_PRODUCTS, MAX_MONTHLY_ORDERS, STORAGE_BYTES. Não comparar strings de nome do plano na regra de negócio.

## 8. Limites e uso

Entitlement possui type BOOLEAN/LIMIT, unidade e política de combinação. Inteiros não negativos; ilimitado usa valor explícito separado, não -1 mágico. Operação que consome capacidade verifica limite e incrementa contador na mesma transação protegida por lock. UsageLedger tem idempotencyKey e período; UsageCounter é projeção reconciliável. Definir se recurso arquivado conta; padrão: lojas/usuários ativos, produtos ativos, pedidos criados não duplicados por mês no timezone de faturamento definido. Estouro não apaga registros. Importação reserva capacidade do lote antes de commit.

## 9. Trial

Trial começa no provisionamento local concluído, duração configurada na versão e timestamps UTC. Fluxo TRIALING → ACTIVE somente após confirmação confiável do estado de cobrança; ter cartão cadastrado não prova pagamento. Sem ativação, TRIAL_EXPIRED. Lembretes usam configuração de antecedências, delivery deduplicado e consentimento/finalidade apropriados. UI informa data de término. Não reiniciar trial por retry ou mudança de e-mail.

## 10. Upgrade

Servidor calcula preview de mudança com preço, impostos quando aplicáveis, pró-rata, data efetiva e limites. Cliente confirma a proposta identificada; criar SubscriptionChange PENDING e chamar provider com idempotencyKey. Entitlements extras liberados apenas após confirmação adequada. Falha ou timeout preserva versão atual e encaminha reconciliação. Invalidar cache por subscriptionRevision quando aplicar.

## 11. Downgrade

Preview compara uso com plano alvo e lista impedimentos. Cliente desativa recursos excedentes explicitamente; nenhum dado é excluído. Revalidar no momento efetivo porque o uso pode ter crescido. Mudança pode ser agendada para renovação conforme provider/política. Se incompatível na efetivação, manter situação segura e informar necessidade de ação; nunca cortar lojas arbitrariamente.

## 12. Suspensão

TRIALING, ACTIVE, PAST_DUE, GRACE_PERIOD, SUSPENDED, CANCELED, EXPIRED são estados comerciais; TRIAL_EXPIRED diferencia expiração inicial. Prazos de cobrança/restrição são policy configurável. Estado local confirmado sustenta operação durante indisponibilidade técnica do provider. Suspensão impede novas ações operacionais conforme matriz, preservando cobrança, suporte e exportação autorizada. PDV offline segue lease emitido e reconciliará divergências; não prometer bloqueio imediato sem rede.

## 13. Cancelamento

Cancelamento self-service informa data efetiva, acesso remanescente, exportação e motivo estruturado/comentário opcional. CancellationReason: PRICE, MISSING_FEATURE, COMPETITOR, BUSINESS_CLOSED, DIFFICULT_TO_USE, SUPPORT, OTHER. Solicitação cancela renovação; estado final deriva do provider e data, não de clique no frontend. Operação idempotente e auditada. Distinguir agendado, efetivado e cancelamento da solicitação quando permitido.

## 14. Retenção

Lifecycle de dados ACTIVE → SUSPENDED/CANCELED → RETENTION_PERIOD → ANONYMIZED/DELETED, separado da assinatura. Política versionada por categoria, jurisdição, legal hold e contrato; nenhum prazo legal presumido. Job de descarte inicialmente desabilitado até validação da política. Exportação privada com validade e audit log. Backups seguem política e acesso restrito; restauração não reativa contas/exclusões logicamente sem reconciliação de tombstones.

## 15. Platform Admin

PlatformUser independente de Membership. Papéis PLATFORM_SUPER_ADMIN, PLATFORM_ADMIN, PLATFORM_SUPPORT, PLATFORM_FINANCIAL, PLATFORM_SALES com permissões específicas. MFA obrigatório para privilégios; sessão/audience distinta. Rotas `/platform/v1` nunca aceitam somente token tenant. Admin vê organizações, lojas, planos, subscriptions, trial, uso, billing, integrações, erros agregados, flags e auditoria. Dados operacionais privados não são retorno padrão. Ações elevadas exigem motivo e PlatformAuditLog.

## 16. Suporte

Suporte vê metadados operacionais mínimos: organization/store/user identificados, versão, browser e correlationId de falha. Tickets podem integrar fornecedor externo, sem construir helpdesk desnecessariamente. Impersonation não pertence ao MVP: futura SupportAccessGrant exige MFA, justificativa, escopo, prazo curto, consentimento/política tenant, banner e auditoria de início/fim/ações. Proibido trocar userId para implementar login como cliente.

## 17. Segredos

IntegrationCredential vincula organizationId, integrationId, merchant e referência ao secret manager. Envelope encryption e rotação; chaves mestras fora do banco. Workers só resolvem secret após validar job/contexto e integração. Logs/auditoria nunca registram conteúdo. Secrets de plataforma e tenant separados por política de acesso. Nenhum endpoint retorna credencial para frontend.

## 18. Storage

ObjectRecord vincula UUID opaco, tenant, loja, purpose, mime, tamanho e status. Chave física `organizations/{id}/{purpose}/{uuid}`. Download autenticado resolve ObjectRecord com RLS e emite URL assinada curta; conhecer caminho não autoriza acesso. Upload limita tamanho/tipo, faz quarentena/validação apropriada e reserva quota. Publicar foto do catálogo gera derivado público sem expor documento privado original. Exportações não ficam em bucket público.

## 19. Cache e busca

Chaves `tenant:{organizationId}:store:{storeId}:...` incluem versão de autorização/preço quando necessário. Helpers exigem contexto tipado e não aceitam string livre de tenant externo. Invalidation via outbox após commit. Índices de busca aplicam filtro tenant obrigatório; indexação carrega contexto de origem e remoção revoga visibilidade. Cache miss/falha busca fonte autorizada; nunca reutiliza dado de outro contexto.

## 20. Filas

JobEnvelope imutável contém jobId, organizationId, storeId opcional, actorId, permissionSnapshotVersion, correlationId, schemaVersion e payload com identificadores mínimos. Worker autentica origem, revalida tenant ativo/autorização adequada e cria transação RLS nova por job. Não usar contexto global mutável. Fairness por tenant, limite de concorrência, timeout, retry exponencial/jitter e DLQ. Reprocessamento mantém idempotência e motivo. Jobs financeiros/sistema usam identidade de serviço com escopo explícito, sem herdar usuário incorreto.

## 21. Realtime

Handshake autentica sessão e memberships; servidor determina canais. Cliente não escolhe sala arbitrária por organizationId. Canal por organização+loja, com filtro adicional de função quando houver dados restritos. Revogação/desligamento encerra conexão; reconexão revalida. Cada evento passa pelo mesmo serializer público/autorizado da API. Teste A/B abre conexões simultâneas, publica em A e prova ausência em B.

## 22. Analytics SaaS

Snapshots mensais da receita recorrente contratada, líquidos de descontos recorrentes segundo política documentada, excluem taxas/receita avulsa/impostos conforme classificação. Normalizar anual por 12; arredondamento analítico em decimal, sem alterar cobrança. Trial sem cobrança não contribui para MRR. Definir inclusão de past_due por política explícita de reporting. ARR=12×MRR. ARPA=MRR/clientes pagantes ativos. New/Expansion/Contraction/Churned comparam receita recorrente por cliente entre períodos; retorno após churn é reativação separada.

NRR=(MRR inicial+expansion-contraction-churn)/MRR inicial; GRR=(inicial-contraction-churn)/inicial, sem expansão. Denominador zero retorna indisponível, não zero fictício. Logo churn usa coorte de clientes no início do período. Trial conversion usa coorte com janela de maturação definida. LTV/CAC/payback só exibidos com entradas e metodologia declaradas; não inventar CAC. Segmentação por PlanVersion, coorte e duração. Unit economics futuro registra custos variáveis sem confundir custo de mercadoria do açougue com custo do SaaS.

## 23. Telemetria

Eventos AccountCreated, StoreCreated, FirstProductCreated, FirstOrderCreated, FirstSaleCompleted, OnboardingCompleted e product_created/order_created/sale_completed com schema versionado, dedupe e dados mínimos. Projeções derivam first/third sale de vendas confirmadas. North star inicial: lojas estabelecidas com vendas concluídas na semana; definição de estabelecida versionada e exclui demo/teste. Time to value mede cadastro→primeira venda concluída. Health score futuro usa atividade/erros/uso, sem abrir dados privados para comercial.

## 24. Feature flags

Flag controla rollout técnico; entitlement controla direito comercial. Disponibilidade efetiva exige ambos e permissão. Avaliação determinística por hash de tenant+flag+salt, percentual e overrides temporários; auditoria de mudança e rollback. Menu progressivo considera tipo de operação e módulos habilitados. Não mostrar dezenas de módulos a um microaçougue nem upsell constante sem contexto.

## 25. Escala

Aplicação compartilhada, PostgreSQL compartilhado, índices tenant-first, paginação e limites de importação. Medir consultas, filas e uso antes de particionar; particionar ledger/auditoria por tempo quando necessário. Projeções/materialized views para analytics. Connection pooling com contexto transacional. Isolar workers ruidosos por tenant/tipo e aplicar quotas. Futuro TenantPlacement permite mover cliente grande para banco dedicado com export/import validado e cutover controlado. Meta de 10.000 tenants exige ensaio de carga e capacidade, não é garantia por desenho.

## 26. Riscos

Bypass RLS por role indevida; contexto vazando em pool; workers em tenant errado; cache/realtime sem escopo; upgrade antes da cobrança; suspensão em falha técnica; eventos fora de ordem; quotas concorrentes; export público; suporte excessivo. Mitigações precisam de testes de integração e revisão de configuração real. Política comercial, provedor, domínio, dispositivos e aprovação fiscal permanecem dependências de ativação, não impeditivos para desenvolvimento com adapters.

## 27. Testes de isolamento

Provisionar A e B pelo caminho público e executar mesma suíte em ambos. Provar leitura/alteração proibida de produto, cliente, pedido, analytics, loja e usuário alheios. Provar INSERT/UPDATE cruzado rejeitado por FK/RLS, inclusive sem contexto e após reutilizar conexão do pool. Provar cache, busca, arquivo assinado, job e realtime isolados. Testar suspensão, revogação, role tenant tentando platform, dois upgrades iguais, dois webhooks iguais, ordem invertida, expiração de override e criação simultânea no limite. Relatório de CI identifica testes não executados; nenhum skip conta como aprovação.

## 28. ADRs SaaS

- ADR-011: identidade de plataforma separada de identidade operacional; aumenta superfície de autenticação, reduz risco de escalada.
- ADR-012: PlanVersion imutável e entitlements centralizados; evita migração comercial silenciosa e condicionais por plano.
- ADR-013: billing local confirmado e tolerância a falha técnica; não bloquear a operação por timeout do gateway.
- ADR-014: provisão local transacional e efeitos externos via outbox; retomada segura após falha.
- ADR-015: flags independentes de direitos, rollout determinístico e reversível.
- ADR-016: retenção separada de cancelamento e descarte desabilitado até política validada.
- ADR-017: limites serializados por tenant; contadores reconciliáveis e sem check-then-insert concorrente.
- ADR-018: schemas de evento versionados e analytics por coorte; não somar recebimentos para calcular MRR.
