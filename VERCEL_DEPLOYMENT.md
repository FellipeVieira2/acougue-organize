# Aplicação web na Vercel

Esta etapa usa Next.js 16 / React 19 na raiz do repositório. Interface e API são publicadas juntas como aplicação web; não há servidor NestJS separado nesta fase. O domínio TypeScript e o PostgreSQL existentes foram preservados. Workers, hardware de PDV e modo offline ficam fora desta entrega.

## Publicação

1. Importe `FellipeVieira2/acougue-organize` na Vercel, ou use o projeto já conectado.
2. Selecione a branch que contém esta entrega. Root Directory: raiz (`.`); Framework: Next.js; Node.js: 24.x. O `vercel.json` define instalação e build.
3. Configure `DATABASE_URL` com a conexão PostgreSQL **pooled**, protegida por TLS, de um usuário de aplicação que possa assumir somente `acougue_runtime`. Não use o dono do banco/superuser no site. Não coloque conexão ou senha em variáveis `NEXT_PUBLIC_*`.
4. Configure `APP_URL` com a origem HTTPS exata do site, sem caminho. Ex.: `https://seu-projeto.vercel.app`. Em previews, se não houver APP_URL, o código usa a URL do deployment informada pela Vercel. Evite herdar a origem de produção para previews.
5. Depois de preparar o banco, defina `ALLOW_SIGNUP=true` para habilitar o cadastro inicial de empresas no piloto. Sem essa opção, novos cadastros são recusados.
6. Faça o deploy. O build não depende de uma conexão ao banco ; conta real, login e gravações exigem o banco preparado.

## Preparação do banco

Use um banco novo para o piloto ou faça o baseline de instalações anteriores conforme `database/README.md`. As quatro migrations criam a fundação de empresas, membros e identidade web. Não execute migrations automaticamente em builds concorrentes da Vercel.

Em um ambiente administrativo, defina `DATABASE_MIGRATION_URL` e execute `pnpm db:migrate`. Esse comando usa o dono de migrations e verifica checksums. Não configure essa credencial administrativa como variável do site. O usuário de runtime deve ser provisionado pelo administrador/provedor com LOGIN e associação à role `acougue_runtime`, sem SUPERUSER, BYPASSRLS, ownership dos schemas ou privilégios administrativos. A senha deve ser definida diretamente no gerenciador de segredos/provedor.

**Bancos antigos:** a migration 0003 anterior gravava um checksum fictício. O runner recusa esse histórico; é necessário inspecionar o schema e estabelecer um baseline antes da atualização. Esta entrega não altera o Neon existente automaticamente.

## Rodar e verificar

- `pnpm dev`: desenvolvimento local.
- `pnpm build` e `pnpm start`: build e servidor de produção Next.js.
- `pnpm typecheck`, `pnpm test`: domínio e testes unitários.
- `DATABASE_TEST_URL=... pnpm test:integration`: banco efêmero vazio com nome terminado em `_test`; requer cluster sem a role de teste preexistente.
- `APP_TEST_URL=http://localhost:3000 pnpm test:http`: fluxo HTTP contra servidor local com banco de teste já preparado e ALLOW_SIGNUP=true. Não aponta a um deployment ou banco real.

Foram validados localmente 32 testes unitários, 13 de PostgreSQL e um fluxo HTTP completo, além do build de produção. Cadastro e inclusão de produto conferidos pelo navegador local. A evidência local não significa deploy remoto já concluído.

## Escopo funcional

Disponível: cadastro atômico de empresa/matriz/proprietário, login por e-mail e senha, cookie HttpOnly com sessão de oito horas revogável, limite persistido de tentativas por e-mail, isolamento por empresa, produtos com preço da matriz, busca/filtro local. Senhas usam scrypt com sal aleatório; tokens são armazenados como SHA-256. Requisições de escrita exigem origem autorizada e corpo limitado.

O painel carrega até 200 produtos. Métricas de produtos referem-se a esse conjunto. Não há modo demonstrativo com dados fictícios nesta interface.

Ainda pendentes: confirmação de e-mail, recuperação de senha, MFA, convites e seleção de múltiplas empresas, paginação completa, edição de produtos/preços, pedidos, estoque, caixa, pagamentos e billing. Antes de abrir um piloto público amplo, configure proteção de tráfego na Vercel e implemente verificação/recuperação de conta. O limite por e-mail não substitui proteção por origem de tráfego. Sessões e contadores expirados exigem rotina posterior de limpeza.

Referências: [Deploy de Next.js](https://nextjs.org/docs/app/getting-started/deploying), [Node.js na Vercel](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).
