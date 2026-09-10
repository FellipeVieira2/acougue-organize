# Plano de implementação

O escopo integral dos dois documentos é preservado em fases. MVP não significa todas as funções futuras nem somente telas. Cada tarefa só conclui com evidência; itens abaixo começam pendentes. Implementar fatias completas antes de abrir vários módulos incompletos.

## Definition of Done por fatia

- Caso de uso/regra de negócio e fluxo de exceção documentados.
- Interface acessível, loading, vazio, erro acionável e teclado quando aplicável.
- Endpoint validado, persistência/migration, autorização e isolamento.
- Transação/idempotência/auditoria e observabilidade proporcionais ao risco.
- Testes unitários, integração/API e E2E da jornada; replay e concorrência nos efeitos críticos.
- Documentação de setup/operação e estado atualizado; mock não conta como integração real.

## Ordem, tarefas e critérios de saída

| Épico | Tarefas pequenas | Dependência | Evidência de saída |
|---|---|---|---|
| E00 Arquitetura | 00.1 arquitetura operacional; 00.2 SaaS; 00.3 banco; 00.4 API; 00.5 roadmap/ADRs | nenhuma | cinco documentos consistentes |
| E01 Fundação | 01.1 monorepo/lockfile; 01.2 configuração validada; 01.3 PostgreSQL/migrations/roles/RLS; 01.4 CI; 01.5 erros/logs/health | E00 | build+typecheck+lint e banco vazio migrado |
| E02 Cadastro completo | 02.1 User/hash/sessão; 02.2 signup idempotente; 02.3 Organization/Store/Membership; 02.4 formulário/onboarding; 02.5 logout/revogação/reset; 02.6 MFA | E01 | cadastro→loja acessível, A/B isolados |
| E03 Acesso | 03.1 roles/permissions; 03.2 convites; 03.3 escopo loja; 03.4 troca de organização; 03.5 impedir último owner removido | E02 | matriz de permissões/API/SQL e UI coerentes |
| E04 Catálogo completo | 04.1 produto por peso/unidade e estratégias; 04.2 preparo/embalagem; 04.3 preços por canal/vigência; 04.4 lista/formulário; 04.5 desativação/auditoria | E03 | cadastrar/editar/buscar em A/B, preço histórico intacto |
| E05 Estoque inicial | 05.1 ledger/projeção; 05.2 ajustes com motivo; 05.3 reserva atômica; 05.4 movimentos/consulta; 05.5 reconciliação | E04 | último estoque disputado sem overselling online |
| E06 Clientes | 06.1 cadastro PF/PJ; 06.2 contatos/endereços; 06.3 consentimento; 06.4 histórico mínimo | E03 | CRUD autorizado e minimização |
| E07 Caixa completo | 07.1 abertura única; 07.2 suprimento/sangria; 07.3 fechamento por método; 07.4 diferença/reabertura; 07.5 telas | E03 | dois operadores não abrem/fecham simultaneamente |
| E08 PDV online | 08.1 catálogo/atalhos; 08.2 carrinho misto; 08.3 cálculo seguro; 08.4 recebimento local; 08.5 venda transacional; 08.6 recibo e reversão | E04/E05/E07 | venda completa e retry não duplica estoque/caixa |
| E09 Pedidos e separação | 09.1 criação/reserva; 09.2 fila; 09.3 pesagem/revisões; 09.4 tolerância/aprovação; 09.5 ruptura/substituição/parcial; 09.6 status/timeline | E05/E06 | solicitado/separado/cobrado preservados |
| E10 Pagamentos | 10.1 interface/capabilities; 10.2 mock contract; 10.3 gateway real; 10.4 assinatura/inbox; 10.5 reconciliação; 10.6 refund parcial | E09 | evento repetido/fora de ordem e timeout sem cobrança duplicada |
| E11 Loja online | 11.1 slug/publicação; 11.2 catálogo mobile; 11.3 carrinho estimado; 11.4 checkout; 11.5 entrega/retirada/slots; 11.6 tracking/aprovação | E09/E10 | compra real de ponta a ponta, token sem vazamento |
| E12 SaaS comercial | 12.1 PlanVersion; 12.2 EntitlementService; 12.3 quotas/Usage; 12.4 trial; 12.5 provider/inbox; 12.6 upgrade/downgrade; 12.7 cancelamento/suspensão | E02/E03 | contrato/grandfathering e limites concorrentes corretos |
| E13 Platform Admin | 13.1 PlatformUser/sessão/MFA; 13.2 lista tenant/subscription; 13.3 planos/flags; 13.4 overrides auditados; 13.5 métricas iniciais | E12 | owner tenant não entra em administração SaaS |
| E14 Importação/exportação | 14.1 CSV com limites; 14.2 preview/erros; 14.3 confirmação idempotente; 14.4 XLSX seguro; 14.5 export privado | E04/E05/E06/E12 | erro por linha, quota e tenant respeitados |
| E15 Dashboard | 15.1 projeções; 15.2 vendas/kg/CMV; 15.3 caixa/estoque/pedidos; 15.4 filtros/relatório; 15.5 telemetria/ativação | E08/E09/E12 | totais reconciliados ao ledger, A/B isolados |
| E16 PDV offline | 16.1 IndexedDB/shell; 16.2 lease/dispositivo; 16.3 venda local; 16.4 sync idempotente; 16.5 conflitos/cotas; 16.6 UX recuperação | E08 | queda/reconexão/reenvio e dois caixas testados |
| E17 Operação piloto | 17.1 backups/restore; 17.2 CI security/migrations; 17.3 alertas; 17.4 carga; 17.5 revisão privacidade; 17.6 ensaio loja | E02–E16 | gates comerciais abaixo atendidos |

E12 começa na fundação com contrato/entitlements mínimos antes de liberar limites; a fatia comercial completa depende de cadastro seguro. A ordem não permite construir várias telas antes do backend: cada subfluxo da linha é integrado e testado ao ser entregue.

## MVP 1.5

E18: balança real/bridge seguro, parser EAN configurável, etiqueta e impressão, teste em hardware. E19: fornecedores/compras, recebimento conferido, lote/validade/FEFO, perda e inventário. A base de rastreabilidade já pertence a E05, mas equipamento e recebimento completos têm aceite próprio.

## Fase 2

E20: desossa, massa, rateio/custo e genealogia. E21: B2B, tabela de preço, limite de crédito, fiado/recebíveis e repetição de pedido. E22: contas a pagar/receber, fluxo de caixa e conciliação por canal. E23: fiscal via provider especializado, configuração e homologação por operação. E24: iFood Groceries/Market, catálogo/picking/eventos/reconciliação conforme permissões oficiais. E25: transferências/multiloja avançado e analytics de margem/ABC/metas.

## Fase 3 e evolução SaaS

E26: kits fixos/configuráveis, churrasco configurável e compra recorrente do consumidor. E27: promoções/fidelidade/cashback. E28: roteirização e portal B2B. E29: IA consultiva, previsão, anomalias com explicação e sem acusação automática. E30: coortes, churn, health score, unit economics, customer success. E31: site comercial/funil, parceiros/referral/comissão, white label/domínio próprio, API/webhooks/marketplace, enterprise/add-ons. Não confundir assinatura de carne com assinatura do SaaS.

## Gates de liberação

**G1 Fundação:** migrations num PostgreSQL vazio, runtime sem bypass RLS, testes de tenant A/B e permissões. **G2 Operação:** catálogo→caixa→venda→estoque→relatório; online→separação→pesagem→aprovação→pagamento→entrega; dinheiro e CMV reconciliados. **G3 Resiliência:** replay/timeout/concorrência/offline, inbox/outbox e DLQ. **G4 Comercial:** cadastro autônomo, trial, planos, limites, pagamento SaaS, mudança/cancelamento/exportação e Platform Admin isolado. **G5 Produção:** restore ensaiado, monitoramento, configuração real dos provedores/equipamentos, política de retenção/fiscal validada, staging e operação piloto acompanhada.

O marco comercial final requer cliente externo se cadastrar, configurar, operar e decidir pagar. Código e testes não provam esse resultado de mercado; registrar validação com cliente real quando ocorrer.

## Matriz mínima de testes críticos

| Área | Casos obrigatórios |
|---|---|
| Dinheiro/peso | R$37,90×1.375g=R$52,11; limites/overflow; negativo/zero; rateio com resíduo; cálculo backend/cliente igual |
| Pedido | chave repetida/mudada, transição inválida, concorrência de pesagem, aprovação antiga, ruptura/substituição |
| Estoque | dois caixas/último saldo, reserva incremental/liberação, cancelamento repetido, FEFO/vencido, reconciliação |
| Pagamento | webhook repetido/fora de ordem, timeout depois de captura, refund parcial repetido/excessivo |
| Produção | massa divergente, custo residual, genealogia, finalização repetida, CMV histórico |
| SaaS | limite concorrente, override expirado, downgrade incompatível, grandfathering, falha de provider sem suspensão |
| Isolamento | produto/cliente/pedido/analytics, SQL RLS, loja, cache, busca, arquivo, job, realtime, admin |
| Offline | crash antes/depois de persistência, perda de resposta, reenvio, troca tenant, lease expirado, caixa fechado |

## Decisões de ativação externas

Marca/domínio definitivos, preços/limites comerciais, provedor de billing/pagamento/fiscal, modelos de balança/impressora, política comercial/retensão e critérios de homologação. Desenvolver usando configuração e mocks explícitos enquanto esses insumos não existem; não pedir credenciais em chat nem publicá-las no Git.
