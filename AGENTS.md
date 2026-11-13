# Instruções para trabalho em MonitorChange

## Leitura e âmbito

- Antes de iniciar ou retomar alterações neste diretório, ler `README.md` e `PLANO_IMPLEMENTACAO.md`, incluindo o registo de execução final.
- A implementação foi autorizada e está em curso. Consultar `CHANGELOG.md` e `docs/INSTALACAO.md` para o estado real, limitações e operação.
- Executar o plano pela ordem de dependências sem voltar a pedir decisões já documentadas. Instruções atuais do utilizador prevalecem sobre o plano.
- Manter alterações dentro deste projeto e preservar trabalho existente do utilizador.

## Checklist e continuidade

- Usar os IDs P00–P12 e os critérios A/R do plano para indicar trabalho, verificações e próximos passos.
- Marcar uma tarefa como concluída apenas quando existir resultado verificável. Não marcar implementação feita por ter escrito o plano ou uma interface vazia.
- Atualizar o registo de execução por bloco de trabalho com IDs, ficheiros, verificações feitas, limitações e próxima tarefa concreta.
- Se uma decisão técnica não funcionar, registar evidência e atualizar o plano/README afetados antes de declarar a fase concluída.
- Não exigir URLs reais como condição para desenvolver: usar fixtures sintéticas e motor genérico.

## Invariantes do produto

- Servidor sempre ligado, acesso inicial LAN e alertas locais. Integrações externas pertencem a fase posterior.
- Suportar vários produtos/fontes e várias ofertas por página. Preservar vendedor, variante, preço, modalidade e loja por oferta.
- Excluir marketplace por omissão; vendedor/local/preço desconhecidos não podem satisfazer filtros que dependem deles.
- Separar stock, ação de compra indicada, elegibilidade, erro de acesso e frescura. Não executar compra, reserva ou adição ao carrinho.
- Exemplos reais de sites/produtos/URLs fornecidos na conversa não devem ser incluídos em documentação, fixtures, código ou configuração distribuída. Usar dados inventados.
- Novas dependências/serviços externos obrigatórios exigem rever a decisão de autoalojamento mínimo; não introduzir SaaS, IA ou geocodificação cloud silenciosamente.
