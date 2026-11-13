# Instalar as imagens publicadas num servidor

Este guia instala o MonitorChange a partir das três imagens já publicadas no GitHub Container Registry (GHCR). Os comandos assumem um servidor Linux `x86_64` (Ubuntu ou Debian) com acesso à Internet e à rede local. No servidor não é preciso instalar Node.js, Git nem construir as imagens. O pull descarrega o software, mas Docker ainda precisa da configuração de execução: `compose.yaml`, `.env` e o perfil seccomp do Chromium.

## 1. Confirmar os pré-requisitos

No servidor, executar:

```bash
uname -m
docker version
docker compose version
```

O resultado de `uname -m` deve ser `x86_64`: o workflow atual publica apenas `linux/amd64`. Docker Engine e o plugin Docker Compose têm de estar instalados e o utilizador deve poder executar `docker`. Se faltar algum, seguir os [passos oficiais de instalação do Docker Engine](https://docs.docker.com/engine/install/) e do [plugin Compose](https://docs.docker.com/compose/install/linux/). Se o servidor for ARM64, estas imagens ainda não são a opção adequada; será preciso publicar imagens `linux/arm64`.

Reservar um IPv4 fixo para o servidor na LAN. Confirmar que a porta TCP 3100 está livre e permitir essa porta na firewall **apenas para dispositivos da LAN**. Não encaminhar a porta no router para a Internet.

## 2. Obter apenas os ficheiros de configuração

Na execução bem-sucedida do workflow de publicação, copiar o **SHA completo do commit** que publicou as três imagens. Criar uma pasta no servidor e descarregar os ficheiros desse mesmo commit:

```bash
mkdir -p monitorChange/config
cd monitorChange
RELEASE_SHA=COLOCAR_AQUI_O_SHA_COMPLETO
curl -fL "https://raw.githubusercontent.com/tugaera/monitorChange/${RELEASE_SHA}/compose.yaml" -o compose.yaml
curl -fL "https://raw.githubusercontent.com/tugaera/monitorChange/${RELEASE_SHA}/config/chromium-seccomp.json" -o config/chromium-seccomp.json
curl -fL "https://raw.githubusercontent.com/tugaera/monitorChange/${RELEASE_SHA}/config/DOCKER-SECCOMP-LICENSE" -o config/DOCKER-SECCOMP-LICENSE
```

Estes comandos de download funcionam se o repositório estiver público. Se for privado, copiar esses três ficheiros do computador de desenvolvimento para a mesma estrutura no servidor, por exemplo por SFTP/SCP; não é necessário clonar o repositório. Confirmar que os downloads terminaram sem erro antes de continuar.

## 3. Configurar a instância

Descobrir o endereço LAN, se necessário:

```bash
ip -4 -br addr
```

Criar o ficheiro local `.env` com `nano .env` ou outro editor, usando o conteúdo abaixo.

Gerar **dois** valores aleatórios diferentes e guardá-los temporariamente num local seguro:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Substituir os exemplos por valores reais no ficheiro `.env`:

```dotenv
LAN_BIND_IP=IP_LAN_DO_SERVIDOR
PUBLIC_ORIGIN=http://IP_LAN_DO_SERVIDOR:3100
BOOTSTRAP_TOKEN=PRIMEIRO_VALOR_ALEATORIO
INTERNAL_TOKEN=SEGUNDO_VALOR_ALEATORIO
IMAGE_PREFIX=ghcr.io/tugaera/monitorchange
IMAGE_TAG=sha-COLOCAR_AQUI_O_SHA_COMPLETO
```

Depois de guardar o ficheiro, restringir a leitura:

```bash
chmod 600 .env
```

Usar o mesmo IPv4 real em `LAN_BIND_IP` e `PUBLIC_ORIGIN`. O `PUBLIC_ORIGIN` deve corresponder exatamente ao endereço que será aberto no navegador, incluindo `http` e a porta `3100`. Guardar o `BOOTSTRAP_TOKEN` até concluir a criação da conta inicial. Nunca adicionar `.env` ao Git nem partilhar os tokens.

Usar em `IMAGE_TAG` o mesmo SHA definido em `RELEASE_SHA` no passo 2. A etiqueta tem o formato `sha-<SHA de 40 caracteres>` e deve ser a mesma nas três imagens. `latest` também funciona, mas fixa menos precisamente a versão instalada.

## 4. Autenticar no GHCR, se necessário

Se os três pacotes GHCR estiverem públicos, o pull é anónimo e este passo pode ser ignorado. Se estiverem privados, criar no GitHub um **personal access token (classic)** com `read:packages` e acesso aos pacotes. No servidor, autenticar com:

```bash
docker login ghcr.io -u tugaera
```

Quando o Docker pedir a palavra-passe, introduzir o token; não escrever o token diretamente no comando. Usar o mesmo utilizador de sistema para `docker login` e `docker compose pull`, pois as credenciais Docker são guardadas por utilizador. A [documentação do GHCR](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry) descreve visibilidade e permissões dos pacotes.

## 5. Descarregar e iniciar

Ainda na pasta `monitorChange`, confirmar que os três ficheiros de configuração existem:

```bash
ls -l compose.yaml config/chromium-seccomp.json config/DOCKER-SECCOMP-LICENSE
```

Descarregar as imagens e iniciar:

```bash
docker compose config --quiet
docker compose pull
docker compose up -d --no-build
```

`config --quiet` valida o Compose sem imprimir os tokens do ambiente. `--no-build` obriga a usar as imagens descarregadas. O Compose inicia `app`, `capture` e `egress`; só `app` publica a porta 3100. A base SQLite fica no volume persistente `monitorchange_data`.

## 6. Confirmar o arranque

```bash
docker compose ps
docker compose logs --tail=80 app capture egress
```

Substituindo o texto pelo IPv4 real, verificar `http://IP_LAN_DO_SERVIDOR:3100/api/health` num navegador da LAN. Depois abrir `http://IP_LAN_DO_SERVIDOR:3100`, introduzir o `BOOTSTRAP_TOKEN` e definir uma palavra-passe local com pelo menos 12 caracteres.

Se não abrir pela LAN, verificar primeiro `LAN_BIND_IP`, `PUBLIC_ORIGIN`, a firewall e `docker compose ps`. Se `docker compose pull` devolver `denied`, confirmar a visibilidade dos **três** pacotes e a autenticação GHCR. Se `capture` não arrancar, confirmar que `config/chromium-seccomp.json` existe e consultar os logs desse serviço.

## 7. Atualizar mais tarde

Antes de atualizar, fazer uma cópia consistente da base de dados conforme [Instalação e operação](INSTALACAO.md#cópia-de-segurança-consistente), e guardar essa cópia fora do volume Docker. Depois:

1. Confirmar que a nova execução do workflow publicou **app, capture e egress** com sucesso.
2. Descarregar `compose.yaml`, o perfil seccomp e a licença do novo commit usando os comandos do passo 2, ou copiá-los por SFTP/SCP se o repositório for privado.
3. Editar `IMAGE_TAG` em `.env` para o novo `sha-<commit completo>`.
4. Executar:

```bash
docker compose config --quiet
docker compose pull
docker compose up -d --no-build
docker compose ps
```

Confirmar novamente `/api/health` e a interface. A recuperação de uma versão anterior pode exigir também restaurar a base de dados, caso a atualização tenha alterado o schema; não basta trocar a etiqueta da imagem.

## Estado da validação

As três imagens foram publicadas segundo a execução do GitHub Actions comunicada pelo utilizador. O arranque de Compose e a captura foram verificados anteriormente no Docker Desktop em loopback. A instalação e o acesso LAN neste servidor específico ainda terão de ser confirmados durante os passos acima.
