# Perfil seccomp do Chromium

`chromium-seccomp.json` deriva do [perfil seccomp padrão do projeto Moby](https://github.com/moby/profiles/blob/main/seccomp/default.json), descarregado em 13 de novembro de 2026. A modificação local acrescenta permissão para `clone`, `setns` e `unshare`, conforme a [documentação Docker do Playwright](https://playwright.dev/docs/docker). O container `capture` usa também `SYS_CHROOT`, necessário para o sandbox de namespace do Chromium neste host.

O ficheiro original pertence ao projeto Moby e é distribuído sob Apache License 2.0. A licença está em [DOCKER-SECCOMP-LICENSE](DOCKER-SECCOMP-LICENSE). Rever o perfil quando a versão do Docker Engine mudar; não substituir automaticamente por uma versão nova sem validar as regras e o arranque do Chromium.
