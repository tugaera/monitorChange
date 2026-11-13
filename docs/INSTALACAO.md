# Instalação e operação

Este guia descreve a implementação atual. O Compose foi construído e arrancou no Docker Desktop em 13 de novembro de 2026, ligado apenas a `127.0.0.1` durante a validação. A configuração LAN real, a recuperação e um piloto prolongado continuam por validar no servidor de destino.

## Requisitos

- Servidor sempre ligado, com Docker Engine e Docker Compose.
- Um endereço IPv4 fixo ou reservado na LAN para o servidor.
- Acesso à Internet a partir do servidor para consultar as páginas e, no primeiro build, obter a imagem e o Chromium.
- Disco persistente para o volume `monitorchange_data`.

## Configuração inicial

1. Na pasta do projeto, copiar `.env.example` para `.env`.
2. Definir `LAN_BIND_IP` com o IPv4 da interface LAN do servidor e `PUBLIC_ORIGIN` com `http://<esse-ip>:3100`. O endereço de exemplo no ficheiro não funciona como endereço real.
3. Gerar **dois** segredos independentes com pelo menos 32 caracteres. Em PowerShell, executar duas vezes `[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))`. Colocar um em `BOOTSTRAP_TOKEN` e o outro em `INTERNAL_TOKEN`. Não publicar nem versionar `.env`.
4. Executar `docker compose up -d --build` na pasta do projeto.
5. Abrir `PUBLIC_ORIGIN` num navegador da LAN. Na primeira visita, introduzir o token de instalação e definir uma palavra-passe local com pelo menos 12 caracteres.

## Imagens publicadas no GitHub Container Registry

O workflow [publish.yml](../.github/workflows/publish.yml) corre após um push para `main` ou por execução manual em `main`. Constrói os três alvos do mesmo Dockerfile para `linux/amd64` e publica:

| Serviço | Imagem |
| --- | --- |
| `app` | `ghcr.io/<owner>/<repository>-app` |
| `capture` | `ghcr.io/<owner>/<repository>-capture` |
| `egress` | `ghcr.io/<owner>/<repository>-egress` |

Cada imagem recebe `latest` e `sha-<commit completo>`. Os nomes de owner e repositório são convertidos para minúsculas pelo workflow. A imagem `capture` inclui Chromium e é maior do que as outras duas. O workflow usa o `GITHUB_TOKEN` do repositório com permissão `packages: write`; não é necessário guardar um token de publicação no projeto. A primeira publicação no GHCR é privada por omissão, pelo que um servidor diferente pode precisar de autenticação com uma credencial GitHub que tenha `read:packages` para fazer pull.

Para usar imagens já publicadas em vez de construir localmente, definir no `.env`:

```dotenv
IMAGE_PREFIX=ghcr.io/<owner>/<repository>
IMAGE_TAG=sha-<commit completo>
```

Depois executar `docker compose pull` e `docker compose up -d --no-build`. O mesmo Compose mantém as redes, o perfil seccomp e o volume SQLite. Fixar `IMAGE_TAG` a um commit permite repetir uma instalação ou voltar a uma versão anterior; `latest` acompanha o último build em `main`. `docker compose up -d --build` continua disponível para construir localmente e etiqueta as três imagens com o prefixo configurado.

Publicar as imagens não configura nem inicia automaticamente um servidor. A instalação ainda precisa de `.env`, `compose.yaml`, `config/chromium-seccomp.json`, do volume persistente e do arranque Compose no host de destino. Ver o [guia passo a passo para instalar as imagens publicadas](INSTALAR_NO_SERVIDOR.md).

Só a porta 3100 do serviço `app` é publicada, ligada ao IP definido. A rede `frontend` permite publicar essa porta; `control` e `exit` mantêm a comunicação interna, e só `egress` alcança a rede `internet`. Os serviços `capture` e `egress` não publicam portas. O perfil inicial usa **HTTP na LAN**; o tráfego entre o navegador e o servidor não é cifrado. Restringir o acesso à rede de confiança. TLS local requer um proxy e uma configuração adicional ainda não fornecida pelo projeto.

## Utilização

Criar um produto, definir os critérios de compra e adicionar uma ou mais fontes por URL. A fonte começa em pausa: analisar a página, confirmar o vendedor, a variante, a modalidade, o preço e a regra de leitura antes de a ativar. A seleção de elemento é feita por uma lista de candidatos associada a uma captura estática. Uma página bloqueada, ambígua ou sem dados suficientes não deve ser interpretada como produto disponível.

O painel guarda eventos locais e continua a monitorizar quando o navegador fecha. A verificação manual respeita a fila e os limites do scheduler. Alterações materiais a URL, região, regra ou critérios reiniciam a referência inicial da fonte.

## Configuração e dados

- `docker compose logs -f app capture egress` mostra os registos dos serviços.
- `docker compose ps` mostra o estado dos containers.
- `docker compose restart` reinicia os serviços sem remover o volume.
- A interface permite exportar e importar **configuração**, sem eventos, sessões ou palavra-passe. Na importação são criadas cópias com novos IDs e fontes em pausa.
- O volume `monitorchange_data` contém a base SQLite e o seu histórico. Não copiar apenas o ficheiro `.sqlite` enquanto o serviço escreve em modo WAL.

## Cópia de segurança consistente

O utilitário `dist/apps/api/src/backup.js` usa a API de backup do SQLite. Destinar o ficheiro a uma pasta persistente montada **apenas no serviço app**, distinta da base ativa. Executar dentro do container, por exemplo `docker compose exec app node dist/apps/api/src/backup.js /app/data/backup.sqlite`. Depois copiar o backup para outro local de armazenamento do servidor, com acesso restrito. A cópia no mesmo volume não protege contra perda desse volume.

Para restaurar, parar o serviço app, guardar a base atual em local separado e substituir a base pelo backup consistente. Iniciar novamente e confirmar produtos, fontes, eventos e migrações. Este procedimento ainda carece de uma prova de restauro numa instância Docker separada; não o tratar como recuperação validada.

## Desenvolvimento local

Node 22.17+ e `npm ci` instalam as dependências. `npm run build` compila API, serviços e interface. `npm run dev`, `npm run dev:capture` e `npm run dev:egress` arrancam os serviços em processos distintos; é preciso configurar `CAPTURE_URL`, `EGRESS_PROXY_URL`, `INTERNAL_TOKEN`, `PUBLIC_ORIGIN`, `BOOTSTRAP_TOKEN` e `DB_PATH` de modo coerente. O caminho recomendado para uso permanente é Docker Compose, depois da validação no host alvo.

## Limites desta etapa

- O build e o arranque Docker foram verificados neste Windows com Docker Desktop. A publicação em `127.0.0.1`, o arranque do sandbox Chromium, a captura HTTP e o bloqueio básico de destinos locais passaram. A publicação no IP LAN, reinício do host, restauro e capacidade ainda não foram exercitados.
- A captura sem proxy não alcançou uma página pública e o proxy recusou `127.0.0.1`; ainda faltam casos de DNS mutável, redirecionamento para LAN, IPv6, WebSocket e subrecursos internos antes de declarar completo o isolamento de rede.
- A seleção visual por clique direto na imagem, passos interativos de loja, adaptadores específicos e canais externos de alerta ainda não estão implementados.
- A cobertura de lojas depende do HTML e das restrições de cada página. Algumas páginas precisam de configuração manual ou não serão legíveis.
