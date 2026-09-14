# Recebimento por lote — próxima entrega

Estado: critérios definidos; funcionalidade ainda não implementada.
Validação inicial de quantidade e custo disponível em `packages/domain/src/receiving.ts`, com testes. Ainda não conectada a uma rota, tela ou gravação no banco.

O operador registra a entrada de uma mercadoria em uma loja. O recebimento cria o lote e aumenta o estoque disponível na mesma transação.

## Dados mínimos

- Loja e item de estoque pertencentes à empresa autenticada e ativos.
- Código do lote, quantidade recebida e custo total de aquisição.
- Quantidade em gramas inteiras para itens G ou unidades inteiras para itens UNIT.
- Custo em centavos inteiros, sem conversão para ponto flutuante.
- Data do recebimento e responsável registrados pelo servidor.

## Critérios de aceite

- Exigir sessão válida e permissão de operador ou superior; não aceitar empresa ou responsável enviados pelo navegador.
- Validar quantidade positiva, custo não negativo e limites de bigint antes de gravar.
- Gravar lote, movimento PURCHASE, saldo e auditoria em uma única transação: qualquer falha desfaz tudo.
- Usar uma chave de idempotência para impedir entrada duplicada por reenvio; rejeitar a mesma chave com conteúdo diferente.
- Preservar reservas existentes e impedir perda de atualização em recebimentos simultâneos.
- Isolar lotes por empresa com RLS e vínculos que impeçam referências entre empresas.
- Testar reenvio, concorrência, rollback, valores inválidos e acesso de outra empresa.

## Limite desta primeira entrega

Exibir a quantidade recebida como histórico de entrada. Não apresentá-la como saldo atual do lote: vendas e ajustes existentes ainda precisam ser vinculados aos lotes para calcular esse saldo corretamente. Estoque anterior à introdução de lotes exige conciliação explícita; não inventar origem ou custo.

Desossa, maturação e alocação FIFO ficam para entregas posteriores. Manter Next.js, TypeScript, PostgreSQL e Vercel.
