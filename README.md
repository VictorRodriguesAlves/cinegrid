# CineGrid

Gerador de colagens de pôsteres dos filmes registrados no diário público do Letterboxd. O visitante informa somente o username, a URL do perfil ou seu link curto oficial `https://boxd.it/codigo`, escolhe últimos sete dias, últimos 30 dias ou um intervalo personalizado e uma grade 3 × 3, 4 × 4 ou 5 × 5. A imagem PNG, com as avaliações disponíveis no diário, é composta e baixada no navegador.

**O RSS mostra apenas atividades recentes disponibilizadas pelo Letterboxd. Alguns filmes do período podem não aparecer.** Marcar um filme como assistido sem registrar uma data no diário não garante sua presença. A aplicação não consulta histórico completo, listas, reviews em HTML nem pôsteres personalizados.

## Executar localmente com Docker

Requisitos: Docker e Docker Compose disponíveis, Docker em execução, internet e um **API Read Access Token do desenvolvedor** no TMDB. Node.js e npm não são necessários no computador para este fluxo.

Arquivos gerados e locais ficam fora do Git: `next-env.d.ts`, `.next/`, `node_modules/`, caches, logs, relatórios de testes e `.env.local`. O Next recria `next-env.d.ts` durante `dev`, `build` ou `typegen`; ele continua incluído no `tsconfig.json`. O `package-lock.json`, o `.env.example`, as configurações e as fixtures de testes são versionados para permitir reproduzir o projeto.

Copie o arquivo de ambiente, na raiz do projeto:

```sh
# Linux / terminal WSL2
cp .env.example .env.local
```

```powershell
# PowerShell
Copy-Item .env.example .env.local
```

Edite `.env.local` e preencha a única credencial externa:

```dotenv
TMDB_READ_ACCESS_TOKEN=seu_api_read_access_token
```

Use o token de leitura da aplicação, obtido nas configurações de API do TMDB; ele é enviado no cabeçalho Bearer, exclusivamente pelo servidor. Não use prefixo `NEXT_PUBLIC_`, não versione o arquivo e não forneça credenciais do Letterboxd. O visitante não precisa ter conta no TMDB.

```sh
docker compose up --build
```

Abra **http://localhost:3000**. O único serviço, `app`, executa o Next completo em desenvolvimento, incluindo os Route Handlers. O processo fica em primeiro plano; para acompanhar os logs em outro terminal:

```sh
docker compose logs -f app
```

O código é montado do computador. `node_modules` e `.next` usam volumes separados; dependências do Windows não são compartilhadas com Linux. O container escuta em `0.0.0.0`, mas a porta no computador é publicada apenas em `127.0.0.1:3000:3000`.

O comando inicial executa `npm ci` antes de `npm run dev`, uma vez por início do serviço, nunca a cada edição. É necessário acessar o registry quando houver pacotes a baixar. Editar o código não exige rebuild da imagem.

### Comandos de verificação

Com o serviço em execução:

```sh
docker compose exec app npm test
docker compose exec app npm run typecheck
docker compose exec app npm run lint
```

`npm test` executa Vitest e encerra; não entra em watch. O comando de tipos gera as definições de rotas Next e executa TypeScript sem emissão.

Para validar o build, primeiro pare o servidor, evitando concorrência no volume `.next`:

```sh
docker compose stop app
docker compose run --rm --no-deps app sh -c "npm ci && npm run build"
docker compose up
```

Para encerrar sem remover os volumes:

```sh
docker compose down
```

### Dependências, ambiente e permissões

Instalar ou remover pacotes dentro do container atualiza `package.json` e `package-lock.json` no computador:

```sh
docker compose exec app npm install --save-exact nome-do-pacote@versao
docker compose exec app npm install --save-dev --save-exact nome-do-pacote@versao
docker compose exec app npm uninstall nome-do-pacote
```

Para atualizar uma dependência, escolha uma versão compatível e use o mesmo comando de instalação com a nova versão. Depois de alterações no lockfile — inclusive após um `git pull` — reinicie o serviço para sincronizar o volume e execute as verificações:

```sh
docker compose restart app
```

Após mudar variáveis de `.env.local`, recrie o container para atualizar os valores carregados pelo `env_file`:

```sh
docker compose up --force-recreate app
```

Mudanças em `Dockerfile.dev`, na imagem Node ou nos IDs do usuário exigem `docker compose up --build`. Reconstruir a imagem **não atualiza automaticamente um volume de dependências existente**; a sincronização é feita pelo `npm ci` inicial.

O processo usa o usuário `node`, com UID/GID 1000 por padrão e diretórios de volumes preparados para escrita. Se seu usuário Linux/WSL usar outros IDs, configure-os antes de construir:

```sh
export DEV_UID="$(id -u)"
export DEV_GID="$(id -g)"
docker compose up --build
```

Esses argumentos não contêm segredos. São interpolados pelo Compose a partir do terminal, não do `env_file`. Se mudar os IDs depois de criar os volumes, remova os volumes de desenvolvimento e reconstrua. Para uma instalação limpa:

```sh
docker compose down -v
docker compose up --build
```

**`down -v` remove os volumes de dependências e de cache/build `.next` deste projeto.** Será necessário baixar/reinstalar dependências. Não remove o código montado nem `.env.local`. Não há banco, histórico ou colagens armazenadas nesses volumes.

### Windows e WSL2

Use Docker Desktop com backend WSL2 e integração habilitada para a distribuição. O fluxo recomendado é manter o projeto no filesystem Linux, por exemplo `~/projects/cinegrid`, e executar o Compose no terminal WSL. Arquivos em `/mnt/c/...` podem ter desempenho inferior e não entregar os mesmos eventos de alteração.

Se o hot reload não detectar edições em uma pasta Windows, prefira mover o projeto para o filesystem Linux. Como alternativa, descomente `WATCHPACK_POLLING=true` em `.env.local` e recrie o serviço. O projeto seleciona **Webpack explicitamente**, tanto em desenvolvimento quanto no build; essa variável pertence ao Watchpack e não é apresentada como opção de Turbopack. Polling aumenta o trabalho de observação dos arquivos.

Local não significa offline: RSS, TMDB e imagens continuam exigindo internet.

## Arquitetura e contratos

```text
Navegador → GET /api/collage → RSS público → filtro/seleção → TMDB → JSON
Navegador → GET /api/poster → image.tmdb.org → bytes raster
Navegador → Canvas 2D → Blob PNG → download local
```

A estrutura separa componentes, regras puras, contratos em `src/types/collage.ts` e integrações em `src/lib/server`, protegidas por `server-only`. Não existe banco, backend separado, autenticação do visitante, armazenamento de imagens, serviço de IA ou mecanismo de compartilhamento permanente.

### `GET /api/collage`

Parâmetros obrigatórios, únicos: `username`, `start`, `end` e `grid`. O campo `username` aceita nomes de 1 a 40 letras ASCII, números, `_` ou `-`, URLs `https://letterboxd.com/usuario/` e links curtos `https://boxd.it/codigo`, com barra final opcional. O username é normalizado para minúsculas; o código do link curto preserva maiúsculas/minúsculas e aceita até 32 caracteres alfanuméricos. Esses são os formatos aceitos pelo CineGrid, não uma afirmação sobre todos os formatos admitidos pelo Letterboxd. Outros hosts, credenciais, portas explícitas, parâmetros, fragmentos e caminhos de recursos são rejeitados.

Links `boxd.it` são resolvidos exclusivamente no servidor, em `src/lib/server/resolve-profile.ts`: uma consulta `HEAD` ao host fixo, sem cookies ou credenciais e com redirecionamento automático desabilitado. Apenas o cabeçalho `Location` de uma resposta 301, 302, 303, 307 ou 308 é interpretado. Ele precisa ser uma URL HTTPS de perfil no domínio exato `letterboxd.com`; links de filmes, reviews, listas, outros hosts e novas etapas de redirecionamento são rejeitados. A página de destino e o HTML não são consultados. O RSS é então construído a partir do username validado; JSON, cabeçalho da colagem e nome do PNG usam esse username resolvido. Nenhuma nova rota ou permissão de proxy foi adicionada.

A resolução tem limite de 4 s dentro do orçamento total da geração, permite cancelamento e não tenta novamente automaticamente. Link inexistente ou destino inválido retorna `SHORT_LINK_INVALID` (400, próximo ao campo); bloqueio ou falha de integração retorna `SHORT_LINK_UNAVAILABLE` (502/503); timeout retorna `SHORT_LINK_TIMEOUT` (504). Respostas 429 preservam `Retry-After` quando válido. HTML/bloqueios não viram perfil vazio; em caso de indisponibilidade, o visitante pode informar diretamente o username.

Datas são strings de calendário `YYYY-MM-DD`. Últimos sete dias inclui hoje e seis dias anteriores, usando a data local do navegador; últimos 30 dias inclui hoje e os 29 dias anteriores. O período personalizado disponibiliza campos nativos de data inicial e final, incluindo ambas na seleção. O servidor e o formulário exigem datas reais e início até fim; não impõem um limite de duração. Campos incompletos, datas impossíveis e datas invertidas mostram erro junto aos campos, sem iniciar uma consulta. `watchedDate` nunca é substituída por `pubDate`.

O período personalizado foi acrescentado a pedido do usuário após a implementação inicial. Ampliar o filtro não solicita um feed mais antigo nem garante meses ou anos completos: todos os períodos consultam o mesmo RSS público, uma única vez por consulta sem cache. A duração escolhida não aumenta o número de consultas e sua validação não percorre cada dia do intervalo. Permanecem os limites de 1 MiB de XML, até 25 filmes selecionados e quatro consultas simultâneas ao TMDB. Alterar qualquer uma das datas invalida a colagem e o download anteriores.

O JSON contém `username`, `start`, `end`, `grid`, `entriesInPeriod`, `uniqueFilmsInPeriod`, `displayedCount`, `warnings` e `movies`. Cada filme contém `key`, `title`, `year`, `watchedDate`, `rating`, `tmdbId`, `entryUrl` e `poster`. Valores desconhecidos usam `null`. `poster` discrimina `{ kind: "image", url }` de `{ kind: "placeholder", reason }`. A URL de imagem é sempre interna. Avisos possuem códigos tipados e mensagens em português.

`rating` é a avaliação do próprio membro no registro, extraída exclusivamente de `letterboxd:memberRating`, confirmada em uma amostra real do feed. Aceita de 0,5 a 5 estrelas em passos de meia estrela; ausência, zero e valores inválidos retornam `null`. Não usa a média do TMDB, não interpreta estrelas do título/HTML e não infere avaliações privadas. Em revisualizações, mantém a nota do registro mais recente selecionado no período, mesmo quando ela está ausente. A nota aparece como estrelas na colagem, inclusive em placeholders, e com descrição numérica acessível na lista. A chave de cache do RSS foi atualizada para não reutilizar registros da versão sem avaliações.

O pipeline valida registros, filtra por visualização, ordena por data decrescente, desempata por identificador e posição original, deduplica e seleciona até 9, 16 ou 25 filmes. Só depois consulta TMDB. A identidade principal é o ID; a alternativa mantém título normalizado por NFKC, espaços e caixa, junto do ano, sem remover palavras ou pontuação. Uma entrada sem ID só é associada a outra com ID quando título/ano apontam para exatamente um ID conhecido no período. Isso evita misturar filmes diferentes com IDs conhecidos.

Na ausência de ID, a pesquisa do TMDB usa título e ano de lançamento, comparando `title` e `original_title` com igualdade normalizada. Não usa similaridade aproximada, popularidade nem simplesmente o primeiro resultado. Se a pesquisa tiver múltiplas páginas ou correspondência ambígua, usa placeholder. Essa decisão pode deixar um filme legítimo sem pôster, especialmente quando o título do RSS não coincide com o título inglês/original ou o ano difere. Não faz consultas adicionais para tentar adivinhar a identidade.

Uma credencial ausente ou recusada gera erro de configuração, nunca um resultado aparentemente bem-sucedido com todos os pôsteres faltando. Um 404 de filme gera placeholder sem armazenar a falha HTTP no cache. Indisponibilidade parcial preserva os títulos e informa o problema; falha temporária de todas as consultas gera erro geral. Ao receber 429, para novos trabalhos, limita `Retry-After` válido a uma hora e não tenta novamente automaticamente.

### `GET /api/poster`

Aceita apenas `poster_path` em um padrão restritivo de nome alfanumérico e extensão JPG, JPEG, PNG ou WebP. Rejeita URLs, segmentos extras, traversal, queries dentro do caminho, SVG e parâmetros adicionais. Constrói HTTPS com host fixo `image.tmdb.org` e tamanho `w500`, sem encaminhar cookies ou cabeçalhos do visitante.

A leitura tem timeout e contagem dos bytes realmente recebidos, inclusive sem `Content-Length`. Todos os redirecionamentos são recusados. O MIME precisa ser JPEG, PNG ou WebP e coincidir com a assinatura binária; a extensão do caminho não determina o tipo retornado. O CDN foi observado retornando WebP para um caminho `.jpg`.

A rota retorna bytes e MIME originais, sem Sharp ou segunda transformação. O otimizador de imagens do Next está desabilitado na configuração. O Canvas carrega esses bytes pela mesma origem, evitando dependência do CORS remoto. SVG é permitido apenas para o logo oficial local de créditos, nunca na rota de pôsteres.

### Imagem e estados do cliente

O PNG tem largura 1080 px, células 2:3, margens laterais de 24 px, espaços de 8 px e cabeçalho discreto. Alturas: **1676 px (3 × 3), 1672 px (4 × 4), 1668 px (5 × 5)**. Pôsteres são recortados proporcionalmente ao centro, sem esticar. Células vagas têm fundo neutro diferente dos filmes com placeholder, que incluem título e indicação de indisponibilidade. Cada filme mostra o título acima das estrelas disponíveis, ambos alinhados no canto inferior esquerdo, sem retângulo ou fundo preto; um contorno fino nas letras ajuda a leitura sobre imagens claras. Títulos quebram por palavras em até três linhas, com reticências quando necessário; o texto completo continua disponível na lista acessível. Meias estrelas usam `½`. Filmes sem avaliação mostram apenas o título, sem uma nota inventada.

Fontes e imagens são decodificadas antes da exportação com `toBlob`. A prévia recebe os mesmos pixels do Canvas exportado. O nome do arquivo usa o resultado concluído: `cinegrid-{username}-{start}-{end}.png`. Imagem final, Blob e download permanecem no navegador; URLs temporárias e bitmaps são liberados. A aplicação não recebe o PNG final.

A abertura usa cabeçalho e controles compactos para mostrar o formulário e a prévia completos na área visível em telas comuns de notebook. O aviso de cobertura fica abaixo dos dois painéis. No celular, os painéis ficam empilhados e a prévia inicial ocupa menos altura. O Canvas gerado se ajusta à altura disponível, preservando a proporção e a resolução do PNG. Não há bloqueio de rolagem nem altura fixa cortando conteúdo: telas muito pequenas, zoom, datas personalizadas, mensagens e a lista de filmes expandida podem exigir rolagem.

Alterar uma opção cancela o trabalho, invalida a imagem e remove o download antigo. Um identificador de geração também impede respostas atrasadas de substituir a geração atual. Estados inicial, consulta, composição, sucesso, vazio, erro e pôsteres faltantes são apresentados com labels, foco, avisos acessíveis e lista textual de filmes.

## Limites, cache e custos

Os limites de aplicação ficam centralizados em `src/lib/constants.ts`:

| Recurso | Limite inicial |
| --- | --- |
| XML, metadados por resposta e pôster por imagem | 1 MiB cada, contado durante a leitura |
| RSS / metadados / imagem externa | 8 s / 4 s / 8 s |
| Resolução de link curto oficial | Uma consulta HEAD, até 4 s dentro do orçamento total |
| Orçamento interno de `/api/collage` | 25 s; Function configurada para 30 s |
| Function de `/api/poster` | 15 s |
| Consultas simultâneas ao TMDB por geração | 4, inclusive callbacks de revalidação |
| Carregamentos simultâneos de pôsteres no navegador | 4 |
| Fase de carregamento de pôsteres no navegador | até 60 s; falhas viram placeholders |
| Filmes enriquecidos por geração | até 25 |
| Intervalo de visualização aceito | Datas reais em `YYYY-MM-DD`, início até fim; cobertura limitada ao RSS, sem teto de duração |

Cache de dados: o `unstable_cache` do Next envolve **resultados validados e reduzidos**, com revalidação de 600 s por username no RSS, 600 s por código de link curto (somente o username resolvido) e de 86.400 s para resolução TMDB. Os `fetch` internos usam `no-store`, para não guardar HTML de bloqueio ou JSON inválido só porque vieram com HTTP 200. Exceções não viram valores de sucesso dentro do cache. O cache TMDB separa mudanças de credencial por SHA-256 do token; o token não aparece em chaves nem respostas. Revogação de um mesmo token só pode ser constatada em uma nova consulta externa, não ao reutilizar metadados já cacheados.

Essa API de cache continua disponível no Next escolhido, embora a documentação recomende Cache Components para migrações futuras. Foi mantida aqui para armazenar somente dados depois da validação sem acrescentar outro serviço. Usa o mecanismo do framework/provedor, não um `Map` global ou arquivos persistentes próprios da Function. Os Maps usados na seleção e os limitadores duram apenas uma operação.

Revalidação temporal pode devolver um valor anterior enquanto atualiza em segundo plano; não é um TTL rígido de frescor nem garantia de retenção. O aplicativo não acumula snapshots para oferecer histórico. Uma falha de atualização pode conservar dados anteriormente válidos. Erros de autenticação detectados em consultas efetivas são tratados explicitamente; revalidações assíncronas também podem aparecer nos logs do framework.

Cache HTTP de imagens: apenas respostas raster válidas recebem `public, max-age=86400, s-maxage=86400`. JSON de colagem e todos os erros recebem `no-store`. Cache de dados e cache de navegador/CDN são mecanismos diferentes, ambos sujeitos a limites e remoção pelo provedor. O comportamento da CDN e do cache de dados precisa ser verificado no deploy, não inferido do modo de desenvolvimento.

**Projeto pessoal e não comercial para Vercel Hobby**, sem upgrades, trials ou serviços pagos configurados. O uso gratuito do TMDB depende da finalidade não comercial e da atribuição exigida. Gratuidade depende das condições e franquias atuais de cada provedor. Cache não elimina consumo de Function, consultas, armazenamento de cache ou transferência de imagens; não há promessa de tráfego ilimitado, disponibilidade garantida ou custo zero para qualquer uso. Os direitos sobre pôsteres não são transferidos pelo acesso à API.

Os endpoints são públicos e não possuem rate limit global. Bloqueio de cliques duplicados não impede chamadas diretas ou abuso distribuído. Limites por operação restringem o trabalho de cada chamada, mas muitas chamadas válidas ainda podem consumir as franquias ou a quota do token. A Vercel oferece mitigação DDoS e recursos gratuitos limitados de Firewall/Attack Mode conforme o plano; revisar o painel e a documentação antes de habilitar regras, pois podem bloquear visitantes legítimos. Não há Redis, proxy externo ou contorno de bloqueios.

Os logs do aplicativo registram códigos de erro, status e contagens de falhas quando necessários. Não registram tokens, cookies, XML completo ou reviews. Next e hospedagem também podem manter logs operacionais e URLs de requisições, que incluem o username público nos parâmetros. Não há promessa de ausência total de logs.

## Deploy nativo na Vercel

1. Publique este código em um repositório Git da sua conta e importe-o na Vercel **Hobby**, com o preset **Next.js**.
2. Selecione Node **24.x**, alinhado ao `engines` do projeto. A Vercel controla os patches dessa versão principal.
3. Configure `TMDB_READ_ACCESS_TOKEN` nas variáveis do projeto para Preview e Production, conforme os ambientes que serão testados. A variável é exclusivamente de servidor.
4. Mantenha `npm ci` como instalação e `npm run build` como build; ambos estão definidos em `vercel.json`. Nenhum script da Vercel chama Docker.
5. Use o subdomínio gratuito `*.vercel.app`. Não configure exportação estática, volumes ou publicação de containers.
6. Teste um deploy de Preview antes de considerar o projeto pronto em produção: consulte um perfil público com entradas conhecidas, confira datas, avaliações e contagens, teste pôsteres, download e as nove combinações de período/grade, incluindo intervalos personalizados nas viradas de mês e ano. Verifique também o erro de configuração em um ambiente sem token.
7. Repita consultas e inspecione o cache de dados na observabilidade disponível do projeto. Para `/api/poster`, confira `Cache-Control` e os cabeçalhos da CDN, como `x-vercel-cache`, em requisições repetidas. Respostas de erro não devem ser armazenadas como imagens bem-sucedidas. Registre evidências e limites vigentes no painel.

Faça a primeira verificação de acesso ao RSS na Vercel antes de investir em refinamentos adicionais. Um RSS acessível neste computador pode estar bloqueado a partir da infraestrutura da hospedagem. HTML, timeout e bloqueio são erros de integração, não perfis vazios. Se o provedor bloquear, registre a limitação; não use scraping, login, cookies ou proxies para contornar.

O build funciona com token ausente e não consulta um perfil nem o TMDB durante a construção. A ausência da credencial só falha quando há filmes selecionados que exigem enriquecimento. Sem filmes selecionados, pode retornar o estado vazio sem TMDB.

## Testes e verificações

As fixtures ficam exclusivamente em `tests/fixtures`, com origem documentada. Vitest cobre regras puras e integrações com respostas HTTP simuladas: entradas maliciosas, namespaces, CDATA, listas, ausência de visualização, distinção de publicação, datas, deduplicação, cortes, correspondências, credenciais, falhas gerais e parciais, timeout, redirecionamentos, MIME, bytes e concorrência.

Playwright fica apenas nas dependências de desenvolvimento. Os testes de navegador usam o build de produção na porta interna 3100 e interceptam as APIs **somente no teste**. Geram um PNG de verdade, verificam assinatura/dimensões e comparam todos os pixels com a prévia. Cobrem placeholders, erro, vazio, solicitações obsoletas, nome do arquivo, teclado e larguras de 320, 390 e 1280 px. Isso valida o navegador e a composição, não a autenticação real do TMDB.

Verificação opcional de navegador, usando somente o serviço Docker existente, com o app parado para não concorrer no build:

```sh
docker compose stop app
docker compose run --rm --no-deps --user root app sh -c "su node -s /bin/sh -c 'npm ci' && npx playwright install-deps chromium && su node -s /bin/sh -c 'npx playwright install chromium && npm run build && npm run test:e2e'"
docker compose up
```

A etapa root instala apenas bibliotecas do Chromium no container descartável; instalação de pacotes do projeto, navegador, build e testes executam como `node`. Exige rede e baixa ferramentas de teste, sem serviços auxiliares ou publicação de portas adicionais. Os navegadores e bibliotecas desse container descartável precisarão ser instalados novamente em uma próxima execução.

Como alternativa opcional para quem já utiliza Node 24 no host: `npm ci`, `npx playwright install --with-deps chromium`, `npm run build` e `npm run test:e2e`, sem servidor de desenvolvimento concorrendo. Essa alternativa não é requisito para o fluxo principal com Compose.

### Registro de validação desta entrega

Verificações realizadas em 12/09/2026, no WSL/Ubuntu, usando Node 24.21.0 e npm 11.19.0 diretamente. Após o Docker Desktop voltar a responder, também foram executadas as verificações de container indicadas abaixo:

| Verificação | Resultado |
| --- | --- |
| `npm ci` e consistência do lockfile | Aprovados; instalação informou zero vulnerabilidades conhecidas naquele momento |
| `npm test` | 137 testes aprovados, incluindo links curtos oficiais, destinos maliciosos, timeout, datas personalizadas, avaliações e revisualizações |
| `npm run typecheck` e `npm run lint` | Aprovados |
| `npm run build` | Aprovado na versão atual; o build inicial também foi aprovado com token ausente. Página estática e os dois handlers dinâmicos |
| Playwright / build de produção | 14 cenários aprovados, incluindo link curto com código preservado e nome de PNG resolvido, as três grades em 390 e 1280 px, datas personalizadas acima de 180 dias, últimos 30 dias, erros nos campos e layout em 320 px; fixtures e interceptações restritas aos testes |
| PNG | Assinatura, decodificação, dimensões e igualdade de todos os pixels com a prévia verificadas no navegador; estrelas inteiras/meias, ausência de avaliação, ausência de fundo preto, placeholders e download também verificados. Títulos acima das estrelas no canto inferior esquerdo conferidos visualmente no PNG |
| RSS real através de `/api/collage` | Consulta de `dave` lida e interpretada; o teste inicial sem token chegou ao erro esperado `TMDB_NOT_CONFIGURED` |
| Link curto real no Docker | `https://boxd.it/4WZNB` retornou 302 para `https://letterboxd.com/apontadorroxo/` via HEAD. No navegador, sem interceptações, a geração de 01/01/2025 a 12/09/2026 retornou HTTP 200, 50 entradas, 49 filmes únicos e nove exibidos. Download `cinegrid-apontadorroxo-2025-01-01-2026-09-12.png`, de 1080 × 1676 px e 2.477.374 bytes, sem erro de JavaScript. A validação desse fluxo na Vercel continua pendente |
| Fluxo real com TMDB autenticado no Docker | Após configurar a credencial local, `/api/collage` retornou HTTP 200 para `dave`, de 01 a 12/09/2026, grade 3 × 3: três entradas, três filmes únicos e três pôsteres reais, todos carregados com HTTP 200. Download PNG de 1080 × 1676 px e 1.210.614 bytes, idêntico à prévia pixel a pixel e sem erro de CORS; nenhuma API foi interceptada neste teste |
| Datas personalizadas, títulos e avaliações reais | Perfil `dave`, de 01/01/2025 a 12/09/2026, grade 5 × 5: HTTP 200, 50 entradas e 49 filmes únicos disponíveis no RSS, 25 exibidos, 24 com nota e um sem avaliação. Pôster sem correspondência mantido como placeholder. PNG de 1080 × 1668 px e 3.512.099 bytes idêntico à prévia, sem erro de CORS ou rolagem horizontal em 390 px; títulos acima das estrelas, alinhados à esquerda e sem fundo preto. Teste sem interceptações; o intervalo escolhido não implica histórico completo |
| Últimos 30 dias com dados reais | HTTP 200, de 14/08/2026 a 12/09/2026, com cinco filmes únicos no RSS de `dave`; prévia concluída. Alteração da data personalizada também invalidou a imagem anterior |
| Cache local do RSS | Entrada de cache do Next inspecionada, com revalidação de 600 s e somente os campos estruturados; consulta repetida também executada |
| `/api/poster` real | HTTP 200 com WebP; um pôster real foi exportado em Canvas para PNG decodificável, sem erro de CORS. Este teste do proxy não valida a identificação autenticada de filmes |
| Segurança das rotas em execução | URL arbitrária rejeitada com 400; otimizador `/_next/image` desabilitado e retornando 404 |
| Hot reload | Verificado com Node/Webpack diretamente e pelo bind mount do Compose no filesystem Linux do WSL: CSS atualizado e restaurado no navegador, mantendo o estado do formulário |
| Abertura compacta no navegador | Formulário e prévia inicial inteiros na área visível em 1280 × 720, 1366 × 768, 1440 × 900, 1920 × 1080, 768 × 1024, 360 × 800 e 390 × 844 px. Sem rolagem horizontal, inclusive em 320 × 568 px, onde a rolagem vertical continua disponível. Datas personalizadas também couberam em 1280 × 720 px |
| Docker Compose | Configuração validada; imagem construída e serviço iniciado com `docker compose up --build -d`; página em `localhost:3000` respondeu HTTP 200 |
| Verificações no container | Node 24.21.0 e UID 1000; `npm ci`, 137 testes, tipos e lint aprovados; volumes separados permitiram instalação e compilação sem erros de permissão |
| Build isolado no Compose | Execução inicial aprovada com `docker compose stop app` seguido de `docker compose run --rm --no-deps app sh -c "npm ci && npm run build"`; token ausente não impediu o build. Os builds das alterações de datas/avaliações foram executados no host, cujo `.next` é separado do volume Docker, mantendo o serviço local disponível |

O Chromium de teste precisou de bibliotecas nativas, extraídas temporariamente para a validação no host. Elas não foram incorporadas ao aplicativo ou à imagem Docker. Houve falhas transitórias de DNS/rede durante as verificações; uma tentativa de pôster recebeu erro controlado antes da consulta posterior bem-sucedida, sem retry automático no aplicativo.

**Pendências reais:**

- **Windows:** hot reload com código em uma pasta Windows (`/mnt/c/...`), incluindo a alternativa de polling, permanece sem validação prática. O bind mount de código no filesystem Linux do WSL foi validado com Docker Desktop.
- **TMDB por título/ano:** o teste autenticado real utilizou IDs disponibilizados no RSS. A pesquisa alternativa por título/ano, ambiguidades e falhas de autenticação continuam verificadas com respostas simuladas nos testes automatizados.
- **Vercel:** nenhum deploy foi publicado; não há projeto/credenciais de hospedagem configurados. RSS a partir da Vercel, funcionamento da CDN, comportamento do cache de dados e consumo das franquias em produção continuam pendentes. O procedimento de deploy está acima.

## Versões e atribuição

Versões diretas fixas em `package.json` e árvore reproduzível no lockfile. Base: Node 24.21.0 / npm 11.19.0; Next 16.3.5; React/React DOM 19.3.0; TypeScript 6.0.3; Tailwind 4.3.3; fast-xml-parser 5.11.1; Vitest 5.0.0; Playwright 1.63.0; ESLint 10.10.0 com plugin Next 16.3.5, React Hooks 7.1.1 e typescript-eslint 8.70.0.

O plano inicial previa ESLint 9, mas o registry o marcou como sem suporte. A implementação usa ESLint 10 e os plugins compatíveis diretamente, evitando depender da configuração agregada que ainda trazia um plugin React incompatível. TypeScript 6 foi mantido por compatibilidade com typescript-eslint.

O logo local `public/tmdb.svg` é o asset oficial curto azul, sem modificações, da [página de logos aprovados](https://www.themoviedb.org/about/logos-attribution): `blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg`.

This product uses the TMDB API but is not endorsed or certified by TMDB.

Projeto independente, sem afiliação com o Letterboxd.

### Referências oficiais

- [Letterboxd: alternativas à API e RSS](https://letterboxd.com/api-beta/)
- [TMDB: autenticação](https://developer.themoviedb.org/docs/authentication-application), [imagens](https://developer.themoviedb.org/docs/image-basics) e [uso/atribuição](https://developer.themoviedb.org/docs/faq)
- [Next: Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers), [fetch](https://nextjs.org/docs/app/api-reference/functions/fetch) e [unstable_cache](https://nextjs.org/docs/app/api-reference/functions/unstable_cache)
- [Vercel: Hobby](https://vercel.com/docs/plans/hobby), [Next.js](https://vercel.com/docs/frameworks/full-stack/nextjs) e [Node](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
- [Docker: Compose](https://docs.docker.com/reference/compose-file/services/) e [WSL2](https://docs.docker.com/desktop/features/wsl/best-practices/)
- [Watchpack: polling](https://github.com/webpack/watchpack)
- [Canvas e CORS](https://developer.mozilla.org/en-US/docs/Web/HTML/How_to/CORS_enabled_image)
