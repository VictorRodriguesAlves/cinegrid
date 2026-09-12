# Origem das fixtures

`letterboxd-real.xml` reproduz apenas os campos estruturados observados na consulta real de `https://letterboxd.com/dave/rss/`, em 12/09/2026. A consulta retornou HTTP 200, `application/rss+xml;charset=utf-8` e 114.545 bytes. Os três registros, títulos, IDs e datas foram mantidos; o envelope foi reduzido e as descrições/reviews foram omitidas. Não é uma cópia integral byte a byte do feed. A contagem observada não representa garantia de cobertura ou tamanho do RSS.

Uma nova consulta real em 12/09/2026 confirmou `letterboxd:memberRating`: 4.0 para Blue Heron, 3.0 para Novocaine e 4.5 para The Rivals of Amziah King. Esses valores foram acrescentados à fixture; ausência e valores inválidos continuam sendo casos sintéticos nos testes.

`profile-short-link.json` registra apenas a URL pública, o status 302 e o cabeçalho `Location` observados em uma consulta real `HEAD` a `https://boxd.it/4WZNB`, em 12/09/2026. O destino foi `https://letterboxd.com/apontadorroxo/`. A página do perfil não foi consultada; corpos, cookies e demais cabeçalhos não são armazenados na fixture.

`mixed.xml` e `tmdb-search.json` são casos sintéticos para testes. A imagem raster do teste de navegador é gerada no próprio teste. Nenhuma fixture é importada pelo aplicativo, usada como fallback de integração ou disponibilizada como resultado real.
