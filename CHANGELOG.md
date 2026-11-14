# MonitorChange — histórico de implementação

Este ficheiro regista alterações efetuadas, verificações e limitações. O plano de execução continua em [PLANO_IMPLEMENTACAO.md](PLANO_IMPLEMENTACAO.md); uma tarefa só é marcada nele quando todos os seus critérios estão concluídos.

## 2026-11-13 — início da implementação

### Criado

- Estrutura TypeScript, contratos comuns, configuração de build e dependências fixadas em lockfile.
- Modelo de dados e migrações SQLite, API Fastify, autenticação local, scheduler, verificações e caixa de eventos.
- Motor de extração por oferta, classificação de elegibilidade e transições de alertas com testes sintéticos.
- Interface React para produtos, fontes, análise da página, regras, ofertas e eventos.
- Serviços de captura HTTP/Chromium e proxy de saída que valida destinos públicos.
- Dockerfile, Compose, exemplo de configuração e volume persistente.

### Verificação

- `npm run typecheck` passou com TypeScript 5.9.3 e Node 22.17.1.
- `npm run build` passou: servidor e serviços compilados; Vite gerou a interface de produção.
- `npm test -- --maxWorkers=1` passou: 5 ficheiros, 86 testes, incluindo domínio, extração, validação de destinos, SQLite, autenticação, API, scheduler e eventos.
- A primeira execução dos testes revelou um caminho JSON SQLite incorreto, uma comparação de origem que normalizava a porta, e uma leitura de atributo de stock vazio que ocultava o texto visível. Foram corrigidos antes da execução completa acima. Também foram corrigidos tipos do cliente de captura e do proxy de saída encontrados no typecheck.
- Docker Desktop 29.9.3 e Compose v5.7.0 foram disponibilizados. `docker compose build` construiu `app`, `capture` e `egress`; `docker compose up -d --no-build` iniciou os três serviços em `127.0.0.1` com tokens temporários.
- A API respondeu `200` em `http://127.0.0.1:3100/api/health`, com schema SQLite 1. A publicação da porta falhou quando `app` estava apenas na rede interna; a rede `frontend` corrigiu o binding efetivo.
- O Chromium falhou primeiro por falta de permissões de sandbox. Acrescentámos o perfil seccomp derivado de Moby e a capacidade `SYS_CHROOT` apenas a `capture`; depois, a captura Chromium de uma página pública devolveu `200` e HTML. A captura HTTP também devolveu `200`.
- O endpoint de captura recusou URL de loopback com `400`; o proxy devolveu `403` para loopback e `200` para uma página pública. Uma ligação direta do container `capture` à Internet falhou sem proxy.
- A instância temporária foi parada com `docker compose stop`; o volume de dados de validação foi preservado.

### Limitações conhecidas nesta etapa

- O build e o arranque foram validados no Docker Desktop deste Windows, com publicação apenas em loopback. Ainda não foi provado o acesso pela LAN nem o comportamento após reinício do host.
- A interface de seleção visual usa screenshot e lista de elementos; ainda não inclui seleção por clique direto na imagem.
- O sandbox Chromium e bloqueios básicos de rede passaram neste host. Permanecem por verificar DNS mutável, redirecionamentos para LAN, IPv6, subrecursos, WebSocket e outros caminhos de saída antes de declarar a política de rede completa.
- Passos interativos de escolha de loja/região/variante, retenção automática, prova de restauro e piloto de capacidade permanecem pendentes.
- Alertas externos pertencem à fase posterior P12.

### Próximo passo

- Completar os cenários de isolamento de rede, criar credenciais permanentes para a instalação LAN, executar restauro numa instância separada e rever a experiência na LAN.

## 2026-11-13 — preparação da publicação de imagens

- Criado `.github/workflows/publish.yml`, inspirado no workflow do outro projeto do utilizador. Usa uma matriz para construir e publicar separadamente os alvos `app`, `capture` e `egress` do mesmo Dockerfile no GHCR.
- Cada imagem recebe `latest` e `sha-<commit>`. O workflow dispara em `main` ou manualmente em `main`, com `packages: write` e o `GITHUB_TOKEN` do próprio repositório.
- O Compose passou a ter nomes de imagem configuráveis por `IMAGE_PREFIX` e `IMAGE_TAG`, mantendo a opção de build local. O guia explica pull, instalação a partir de imagem e autenticação para pacotes privados.
- Publicação ainda não executada: os ficheiros do projeto estão por adicionar ao novo repositório e enviar para GitHub. Não foram criados pacotes GHCR nesta etapa.

## 2026-11-13 — guia para instalação no servidor e manutenção do workflow

- O utilizador comunicou a publicação bem-sucedida das três imagens no GHCR pelo workflow do repositório `tugaera/monitorChange`. A instalação num servidor externo ainda não foi executada nem verificada.
- Criado `docs/INSTALAR_NO_SERVIDOR.md` com pré-requisitos `linux/amd64`, configuração LAN, tokens, autenticação GHCR para pacotes privados, pull, arranque sem build, verificação, diagnóstico e atualização por SHA.
- Atualizado `.github/workflows/publish.yml`: `actions/checkout@v7`, `docker/setup-buildx-action@v4`, `docker/login-action@v4` e `docker/build-push-action@v7` usam runtime Node 24; o runner ficou fixado em `ubuntu-24.04`.
- Os avisos de Node 20 referiam-se ao runtime das ações GitHub, não ao Node 22 da aplicação no Dockerfile. O Node da aplicação não foi alterado.
- README e guia geral apontam para o novo guia. As alterações do workflow ainda não foram publicadas nem executadas no GitHub; o deploy do servidor e a prova de acesso LAN permanecem pendentes.

## 2026-11-13 — instalação sem clone do repositório

- Corrigido `docs/INSTALAR_NO_SERVIDOR.md` para descarregar apenas `compose.yaml`, o perfil seccomp e a sua licença do mesmo commit das imagens; o ficheiro `.env` é criado no servidor. Um repositório privado pode fornecer esses ficheiros por SFTP/SCP.
- Removida a dependência de Git também do procedimento de atualização. O pull das imagens continua separado dos ficheiros necessários para configurar os serviços no host.
- Alteração documental; a instalação no servidor permanece por executar e validar.

## 2026-11-14 — atualização do runtime da aplicação para Node 24

- Alterados os quatro estágios do `Dockerfile` para `node:24-bookworm-slim`, preservando a base Debian Bookworm e os três alvos de publicação.
- O requisito em `package.json` e `package-lock.json` passou a Node 24+; `@types/node` foi atualizado de 22.20.5 para 24.19.2 no manifesto e lockfile.
- README e guias de instalação passaram a identificar Node 24 como runtime das novas imagens e do desenvolvimento local. As imagens já publicadas com Node 22 continuam disponíveis até uma nova publicação e atualização da etiqueta no servidor.
- Compatibilidade analisada com as declarações oficiais de suporte do Node LTS, Playwright e imagem oficial Node. A instalação de `@types/node` concluiu. Build, testes e arranque Docker com Node 24 não foram executados nesta etapa; a execução do workflow após o próximo push deve confirmar o build das três imagens antes de atualizar o servidor.
