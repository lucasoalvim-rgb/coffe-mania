# Changelog

Mudanças do Coffe Mania por versão. A numeração segue a do jogo original (Alpha `0.0.4.x`): cada conjunto de mudanças publicado sobe o último número. O campo npm `version` usa `-` no lugar do último ponto (`0.0.4-20`) por compatibilidade com SemVer.

Seções usadas: **Adicionado**, **Alterado**, **Corrigido**, **Removido** e **Observações** (limites conhecidos e o que ficou para depois).

## [0.0.4.21] — 2026-10-07

### Adicionado

- Arte real do **fogão inicial** e do **balcão inicial**, com frente e costas (rotações 0–1 frente, 2–3 costas). O fogão e o balcão iniciais agora ficam virados para o salão; os que ainda estavam na posição inicial foram girados por migração.
- As **4 primeiras receitas do Livro**, na ordem do original e com arte do prato pronto e do item de preparo no fogão:
  - Nachos de Queijo: 3 minutos, 15 porções, 2 c/un., XP 3, preço 8.
  - X-Tudo: 8 minutos, 25 porções, 5 c/un., XP 8, preço 20.
  - Mousse de Maracujá: 35 minutos, 22 porções, 12 c/un., XP 30, preço 60.
  - Churrasco: 6 horas, 100 porções, 7 c/un., XP 110, preço 250 (valores antes do rebalanceamento de 10/09/2010).
- Ciclo completo do fogão, como no original e no clone de referência:
  - pronto → o chef pega o prato, **anda até o balcão carregando-o** e o pousa;
  - o fogão fica **sujo** e o chef precisa limpá-lo antes do próximo prato;
  - o prato pronto que passa da validade **estraga** e só pode ser jogado fora;
  - **Jogar fora** vale em qualquer estágio e também suja o fogão.
- Validade do prato pronto: o tempo de preparo, entre 30 minutos e 48 horas (regra do projeto; os valores originais se perderam). Pode ser definida por receita com `validitySeconds`.
- O chef se posiciona na frente do fogão (lado dos botões) para cozinhar.
- Gancho de depuração `window.__coffeRoom`, só no `npm run dev`.

### Alterado

- Card do Livro de Receitas no formato do original: prato numa tábua com o preço embaixo e as faixas de porções, lucro, XP e "Pronto: 8 minutos / 6.0 horas".
- Fogão sujo aparece escurecido; prato estragado, esverdeado.
- Mensagens de erro da cozinha em português também pelo servidor do jogo.

### Corrigido

- O chef não carregava o prato quando a confirmação do servidor chegava depois do fim da animação de servir.

### Observações

- Fontes do ciclo: FAQ oficial ("clique nelas para levá-las até um balcão"; "sempre após servir a comida, seus fogões ficarão sujos"; "sua comida pode passar do ponto e estragar") e relatos de jogadores em 2010–2011 sobre o avatar andando até o balcão com o prato, ficando "travado limpando ou servindo" e o item de preparo que aparece no fogão.
- Ainda faltam garçons: o cliente sentado consome a porção direto do balcão.

## [0.0.4.20] — 2026-10-07

### Adicionado

- **Mousse de Maracujá**, a primeira receita real do Café Mania: 35 min de preparo, 22 porções, 12 caféOuros por porção, custo de 60 caféOuros e 30 XP. Números da tabela de jogadores "Alimentos, lucro e XP" (dicas-cafemania.blogspot.com, 10/09/2010), confirmados por comentário do blog oficial ("muse de maracujá você ganha 12 ouros"). Nível 3 na tabela de níveis iniciais.
- **Balcão inicial** (item 3020069, `StainlessSteelKitchenCounter`), o mesmo usado como balcão inicial no clone de referência. Quartos novos já começam com ele; quartos existentes o recebem uma única vez, sem duplicar se ele for guardado.
- Catálogo de receitas: cada receita fica em `game/public/assets/foods/<id>/recipe.json` com os dois estágios do prato. `npm run assets:room` valida e sincroniza o catálogo do cliente e `shared/recipecatalog/`.
- O Livro de Receitas mostra os dados do card original: porções, lucro por unidade, XP, tempo de preparo e custo.
- Prato no balcão, com nome e porções restantes ao passar o mouse.
- Testes de regressão em Go: preparo, envio ao balcão, acúmulo de porções, pagamento por porção, balcão ocupado e provisionamento do balcão inicial (`database/cooking_test.go`, `game-server/gameruntime/counter_test.go`).

### Alterado

- Ciclo da cozinha mais próximo do original: iniciar um prato cobra o custo e dá o XP na hora; o prato pronto vai para um balcão (o mesmo prato acumula no mesmo balcão); cada cliente consome uma porção e o dono recebe o lucro dela.
- O cliente sentado é servido pelo balcão com mais porções.
- O servidor recusa servir quando não há balcão livre ("Não há balcão livre para este prato."): o prato continua no fogão. Também recusa guardar um balcão com comida.
- As recusas do servidor (ouro insuficiente, balcão ocupado, fogão ocupado) aparecem para o jogador.

### Removido

- O "bolo beta" saiu do Livro de Receitas. Continua no catálogo, fora do livro, só para concluir preparos e porções salvos antes desta versão.

### Observações

- A arte do Mousse de Maracujá é **provisória** (desenhada para esta versão); falta a arte original.
- A arte do balcão vem do atlas do Restaurant City em 1× (81×63 px no SWF original, que é bitmap) e foi ampliada 2× para a grade de 160×80.
- Níveis ainda não são simulados: o nível exigido pela receita fica registrado no catálogo, mas não bloqueia o preparo, e o XP para no máximo do nível atual.
- Cancelar um preparo não devolve o custo nem retira o XP, como jogar o prato fora no original.
- O café novo começa com 100 caféOuros: dá para um mousse e, depois, o lucro das porções paga os próximos.
- Ainda não existem garçons, fogão sujo nem prato estragado.

## [0.0.4.19]

- Versão de partida desta distribuição.
