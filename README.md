# Açougue Organize

Plataforma SaaS para açougues, casas de carnes e boutiques de carnes. Cada cliente possui uma organização isolada e uma ou mais lojas. O primeiro açougue é cliente piloto, sem regras ou identificadores fixos no produto.

## Estado do projeto

Projeto em desenvolvimento. A documentação V1 define o produto e os critérios de aceite; não representa funcionalidades já implementadas nem autorização para operar em produção. O andamento verificável fica em [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

## Documentação

1. [Arquitetura operacional](BUTCHER_PLATFORM_ARCHITECTURE_V1.md)
2. [Arquitetura SaaS](SAAS_PLATFORM_ARCHITECTURE_V1.md)
3. [Modelo de dados](DATABASE_SCHEMA_V1.md)
4. [Contrato da API](API_CONTRACT_V1.md)
5. [Plano de implementação](MVP_IMPLEMENTATION_PLAN.md)

## Princípios

- Autorização no servidor e isolamento por organização em todos os caminhos de dados.
- Dinheiro em centavos, peso em gramas e cálculo final no backend.
- Pedido preserva peso solicitado, peso separado, preço e custo históricos.
- Estoque e caixa usam lançamentos rastreáveis; correções geram movimentos inversos.
- Cobrança SaaS é um domínio separado dos pagamentos dos consumidores.
- Entrega por funcionalidades completas: interface, API, persistência, permissões e testes.

## Stack prevista

Monorepo TypeScript; Next.js/React para as aplicações web; NestJS para API modular; PostgreSQL; Redis/BullMQ para tarefas; armazenamento compatível com S3; Docker para ambientes. ADRs e alternativas estão nas arquiteturas.

## Contribuição

As mudanças devem preservar o modelo SaaS e incluir validação proporcional ao risco. Nunca adicionar dados reais, credenciais, certificados fiscais ou tokens ao repositório. Integrações reais dependem de configuração, capacidades e homologação do respectivo provedor. Nenhum preço comercial de exemplo é uma oferta aprovada.
