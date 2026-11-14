# MonitorChange — monitor de disponibilidade autoalojado

**Estado:** implementação inicial em curso; ainda não validada em Docker num servidor.  
**Objetivo:** monitorizar disponibilidade de produtos em várias lojas, num servidor próprio com Docker, através de uma interface simples.

## Documentos do projeto

- [Plano de implementação e checklist](PLANO_IMPLEMENTACAO.md): contratos técnicos, tarefas, dependências, critérios de conclusão e matriz de aceitação.
- [Instruções para trabalho neste diretório](AGENTS.md): leitura obrigatória, manutenção da checklist e registo de progresso por quem implementar.
- [Guia de instalação e operação](docs/INSTALACAO.md): configuração, arranque, acesso LAN e cópias de segurança.
- [Instalação das imagens publicadas num servidor](docs/INSTALAR_NO_SERVIDOR.md): passos para instalar via GHCR sem clone nem build local.
- [Workflow de publicação](.github/workflows/publish.yml): três imagens GHCR geradas do mesmo Dockerfile em cada push para `main`.
- [Histórico de alterações](CHANGELOG.md): trabalho executado, verificações e limitações.
- Este README descreve o produto, as decisões acordadas e o âmbito da primeira versão.

O código já inclui API, interface, captura, extração, persistência e configuração Docker. O build e os testes locais passaram em 13 de novembro de 2026. As três imagens foram construídas e os serviços arrancaram no Docker Desktop com acesso apenas por `127.0.0.1`; Chromium, captura HTTP e bloqueio básico de destinos locais foram verificados. A instalação numa LAN, um restauro e um piloto prolongado ainda precisam de validação.

## Decisões acordadas

1. O serviço corre num **servidor sempre ligado** e continua a verificar páginas quando o navegador do utilizador está fechado.
2. O acesso inicial à interface é **apenas pela rede local**, com autenticação local.
3. Os alertas da primeira versão ficam **na própria interface**. Email, Discord, Telegram e outros canais pertencem a uma fase posterior.
4. Um produto pode ter várias fontes em lojas diferentes. Vários produtos são suportados desde o início.
5. As páginas são adicionadas, editadas e removidas pela interface. Não existe uma lista fixa de lojas ou URLs exigida para começar.
6. País, idioma, moeda, variante e modalidades de compra são configuráveis, com valores por produto e exceções por fonte.
7. Ofertas de **marketplace ficam excluídas por omissão**; o utilizador pode alterar esse filtro. Vendedor desconhecido não é presumido como venda direta.
8. A disponibilidade distingue entrega, compra/reserva para levantamento e simples indicação de stock numa loja física.
9. Lojas físicas só satisfazem critérios de localização quando correspondem à seleção do utilizador. A loja escolhida automaticamente por um website não é presumida como próxima.
10. Não há compra, reserva, adição ao carrinho ou subscrição automática de avisos da própria loja. A aplicação informa e permite abrir a página manualmente.
11. A aplicação funciona sem serviços externos de monitorização, IA, contas cloud ou geocodificação obrigatórios. A consulta aos websites continua a exigir ligação à Internet.
12. Os exemplos reais fornecidos na conversa não integram documentação, fixtures, código nem configuração inicial distribuída.

## Funcionamento esperado

A pessoa cola um URL e cria ou escolhe o produto ao qual essa fonte pertence. A aplicação analisa a página, identifica ofertas e sugere sinais de stock. A pessoa confirma a variante, vendedor, modalidade e restantes critérios. Se for necessário, pode selecionar visualmente o texto ou elemento a observar sem escrever CSS.

Cada fonte mantém o seu método de leitura, perfil regional, regras e histórico. O painel agrupa as fontes por produto e mostra ofertas com vendedor, preço, modalidade, loja/localização e evidência. Os alertas só surgem quando uma oferta cumpre os critérios configurados e a observação é suficientemente fiável.

“Qualquer loja” é um objetivo de compatibilidade ampla. Algumas páginas exigem JavaScript, localização, sessão ou bloqueiam consultas automáticas. O sistema deve reconhecer esses limites e mostrar erro ou informação indeterminada. Um preço visível ou uma palavra positiva na página inteira não bastam para declarar que o artigo pode ser comprado.

## Primeira versão

### Incluído

- Interface web responsiva e autenticação local.
- Criar, editar, arquivar e gerir vários produtos com várias fontes.
- Pausar/retomar fontes, ajustar intervalos e pedir uma verificação manual.
- Captura HTTP e Chromium/Playwright para páginas dinâmicas, com seleção visual segura.
- Extração de várias ofertas e vendedores da mesma página, preservando o contexto de cada uma.
- Regras assistidas e modo avançado para texto/elemento, sem scripts arbitrários.
- Filtros por vendedor, variante, condição, moeda, limite de preço e modalidade/localização.
- Perfis regionais e lojas preferidas; raio geográfico quando houver coordenadas válidas, sem dependência de serviço cloud.
- Histórico, evidência, última tentativa, última leitura válida e próxima verificação.
- Caixa de eventos local com não lidos, leitura/arquivo, deduplicação e diagnóstico.
- Exportação/importação de configuração, backup/restauro, retenção e guias operacionais.
- Docker Compose com armazenamento local, limites de recursos e isolamento de captura.

### Posterior à primeira versão

- Email, Discord, Telegram e outras integrações opcionais.
- Mais adaptadores específicos para casos que o motor genérico não interprete bem.
- Acesso remoto, vários utilizadores, sessões autenticadas nas lojas ou distribuição por vários servidores, caso sejam pedidos.

Não estão previstos checkout automático, resolução de CAPTCHA, contorno de login/filas ou evasão de bloqueios. A indisponibilidade técnica de uma fonte é apresentada como tal.

## Regras que evitam falsos alertas

### Ofertas e vendedores

Uma página pode mostrar a oferta do retalhista principal e várias ofertas de terceiros. Preço, stock e ação de compra têm de permanecer associados ao mesmo vendedor, produto, variante e modalidade. A aplicação não pode combinar o preço da loja principal com disponibilidade de marketplace.

Marketplace excluído significa “oferta fora dos critérios”, não “produto esgotado”. Se não for possível identificar o vendedor com confiança, a oferta fica indeterminada para um filtro de venda direta; a configuração pode guardar um mapeamento confirmado pelo utilizador.

### Stock físico e modalidade

Uma indicação de stock em loja não confirma que seja possível reservar, encomendar para levantamento ou comprar online. A interface mostra separadamente a modalidade e a ação observada na página. O monitor não executa essa ação nem garante a conclusão de checkout.

Selecionar lojas específicas é o método inicial para controlar proximidade. Um raio só é calculado se existirem coordenadas válidas; cidade ou código postal, isoladamente, não justificam inventar distância. As distâncias calculadas localmente são aproximadas e em linha reta.

### Preço e variante

Preço total do artigo, portes, mensalidade, entrada, preço para membros e benefícios em cartão são valores diferentes. O limite de preço usa a base escolhida. Se o utilizador limitar o total com portes e estes forem desconhecidos, o resultado é indeterminado.

A disponibilidade de outra cor, capacidade, tamanho, modelo ou condição não satisfaz silenciosamente o produto pretendido. Moedas diferentes não são convertidas automaticamente.

### Sinais contraditórios e ações da página

Um botão de aviso de reposição é uma pista contextual e pode coexistir com outra oferta ou modalidade disponível. Dados estruturados positivos e texto visível negativo para a mesma oferta geram conflito, não uma decisão por maioria.

Publicidade, recomendações, avaliações, botão global de carrinho ou opções para consultar outra loja não provam disponibilidade do produto. Seletores vazios ou ambíguos exigem revisão da regra.

### Estados separados

| Dimensão | O que representa |
| --- | --- |
| Execução/acesso | Verificação agendada/em curso, sucesso, timeout, bloqueio ou outro erro. |
| Stock observado | Disponível, esgotado, pré-venda, encomenda pendente ou desconhecido, por oferta/modalidade. |
| Ação indicada | Compra online, encomenda/reserva para levantamento, stock físico informativo ou desconhecido. |
| Elegibilidade | Cumpre critérios, excluído ou informação insuficiente. |
| Frescura | Observação recente ou última leitura válida desatualizada. |

Uma falha de acesso preserva o último stock válido e mostra o erro e a hora. Não transforma o artigo em esgotado nem reabre um episódio de reposição.

### Eventos

- A primeira leitura válida cria referência inicial; não se chama reposição a stock já existente na criação da fonte.
- A opção de avisar sobre disponibilidade inicial é separada e desligada por omissão.
- Uma transição confirmada para uma oferta elegível cria um evento persistente; repetições da mesma leitura não duplicam avisos.
- Reposição, nova oferta elegível, preço que passou a cumprir um limite e erro técnico têm tipos diferentes.
- Editar URL, regra, variante, região ou critérios cria uma nova revisão e referência inicial. Resultados antigos em curso não atualizam o novo contexto.
- Ler ou arquivar um evento não rearma alertas. Retomar após um erro também não produz um novo aviso se a oferta já estava disponível.

Os estados, condições de confirmação e transições completos estão nas secções 5–6 do [plano](PLANO_IMPLEMENTACAO.md).

## Arquitetura inicial

Stack implementada: Node 24, TypeScript, React/Vite, Fastify, SQLite e Playwright/Chromium. As versões das dependências estão fixadas em `package-lock.json`.

- **Aplicação:** interface, API, scheduler, regras, persistência e eventos. Um único serviço controla as escritas SQLite.
- **Captura:** HTTP ou Chromium, contextos isolados, sem acesso ao volume de dados ou segredos administrativos.
- **Saída de rede validada:** consultas públicas sujeitas a validação de DNS, IP, redirecionamentos e recursos carregados pelo navegador.
- **Armazenamento:** SQLite num volume de disco local. Não existe serviço separado de PostgreSQL/Redis obrigatório.

A seleção visual usa screenshot e metadados inertes da captura. O HTML/script da loja não é executado na origem da interface. A captura não pode usar URLs introduzidos para aceder à LAN, router, própria aplicação ou metadados de infraestrutura.

## Sequência de implementação

| Fases | Entrega |
| --- | --- |
| P00–P02 | Contratos, estrutura, dependências, base de dados e migrações. |
| P03–P04 | HTTP, rede validada, Chromium e seletor visual. |
| P05–P06 | Extração por oferta e filtros de compra/região/localização. |
| P07–P08 | Scheduler persistente, fiabilidade, transições e eventos locais. |
| P09–P10 | Interface/API completas, autenticação, Docker, operação e recuperação. |
| P11 | Aceitação, medições e relatório da primeira versão. |
| P12 | Notificações externas opcionais numa fase posterior. |

Fiabilidade, deduplicação, autenticação e recuperação fazem parte da primeira entrega. O desenvolvimento usa casos sintéticos; não depende de solicitar uma lista fixa de URLs ao utilizador. As tarefas, dependências e evidência exigida estão no [plano de implementação](PLANO_IMPLEMENTACAO.md).

## Critérios de conclusão

A primeira versão exige instalação reproduzível na LAN, vários produtos/fontes, captura HTTP e JavaScript, configuração guiada, filtros corretos, eventos sem duplicação por episódio, persistência após reinício e restauro demonstrado. Fontes bloqueadas ou ambíguas têm diagnóstico explícito.

O plano contém uma matriz de cenários de aceitação e um registo de execução. As caixas só são marcadas quando houver implementação e evidência; ainda não existem medições de piloto nem garantia de cobertura de lojas reais.

## Referências

- [changedetection.io](https://github.com/dgtlmoon/changedetection.io): referência de monitorização autoalojada e configuração de filtros/captura.
- [Playwright locators](https://playwright.dev/docs/locators) e [auto-waiting](https://playwright.dev/docs/actionability): seleção de elementos e tratamento de páginas dinâmicas.
- [Huginn](https://github.com/huginn/huginn): referência de automação autoalojada baseada em eventos.

As referências orientam o desenho. A proveniência e as licenças de qualquer código/biblioteca reutilizados serão registadas durante a implementação. Referências técnicas adicionais estão na secção 13 do plano.

