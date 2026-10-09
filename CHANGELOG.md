# Changelog

Mudanças do Coffe Mania por versão. A numeração segue a do jogo original (Alpha `0.0.4.x`): cada conjunto de mudanças publicado sobe o último número. O campo npm `version` usa `-` no lugar do último ponto (`0.0.4-20`) por compatibilidade com SemVer.

Seções usadas: **Adicionado**, **Alterado**, **Corrigido**, **Removido** e **Observações** (limites conhecidos e o que ficou para depois).

## [0.0.4.22] — 2026-10-07

### Adicionado

- Fogão, balcão, mesa, cadeira, arbusto e janela à venda no menu de construção, cada um na sua categoria: Fogão 200, Balcão 650, Mesa com Toalha Branca 500, Cadeira Clássica 200, Arbusto 600, Janela Básica 150 (preços de referência do catálogo do Restaurant City, até termos os do Café Mania). Caixa de correio, painel de conquistas e porta-cardápio continuam únicos (não estão à venda), mas podem ser movidos.
- Limite de fogões e balcões por nível, contando os guardados, como no original: 3 de cada no nível 1, +1 balcão no nível 5 e +1 fogão no nível 6.
- O fogão comprado ganha o seu próprio lugar de cozinha e já pode cozinhar.
- **Mover com um clique**: no modo construção, clique num móvel e ele passa a seguir o mouse; o próximo clique o coloca (R gira, Esc cancela, Delete guarda). Alt + arrastar continua funcionando. Móvel em uso por um cliente avisa e não sai do lugar.
- **Pisos e papéis de parede em sequência**: depois de comprar um, ele continua no mouse e cada clique compra e coloca mais um, sem voltar ao menu; arrastar com o botão pressionado pinta vários tiles (Esc para parar).
- **Temperos no fogão**, como no original (o preparo era acelerado com temperos, não com um botão de pagar): Tomilho Acelerador (−1 hora, 1 caféGrana), Tomilho Ultrarrápido (−6 horas, 3), Condimento Instantâneo (pronto na hora, 5) e, no prato estragado, Sálvia Salvadora (recupera, 1). Cada prato aceita um só tempero, e o prato temperado ganha uma luz em volta (FAQ oficial). Preços em caféGranas do clone de referência; os originais não aparecem nas fontes.
- O fogão cozinhando pode ser movido, e o prato vai junto; guardar continua bloqueado.
- **`npm run dev` recompila e reinicia os servidores sozinho** quando o código Go ou os catálogos mudam (e sincroniza o catálogo quando um `item.json`/`recipe.json` muda), salvando os quartos antes. Os catálogos ficam embutidos nos binários: sem isso, o menu de construção continuava mostrando a versão de quando o servidor foi iniciado (por isso fogão, balcão e mesa não apareciam). Compilação com erro mantém os servidores atuais.

### Alterado

- Mover e colocar móveis no modelo do clone de referência: pegar e soltar acontecem no **pressionar** do botão (um clique pega, outro coloca; arrastar e soltar também move); a prévia segue sempre o grid, presa dentro da sala, verde onde pode e vermelha onde não pode; posição inválida não cancela mais: a peça continua no mouse com um aviso.
- O menu do fogão troca "Ver tempo"/"Cancelar" pelos temperos e "Jogar fora", e abre para cima do fogão. O tempo restante fica no balão do hover.
- Clique pelo desenho: as partes transparentes da arte de um móvel deixam o clique passar para o que está atrás (ex.: o fogão atrás da cadeira ou do balcão), com alguns pixels de folga na borda.
- Zoom suave: a roda e a pinça do touchpad acumulam o pedido e a câmera anima até o degrau de pixel inteiro mais próximo; a pinça do touchpad deixou de dar zoom na página.
- O texto de depuração do canto é redesenhado no máximo uma vez por quadro (antes, a cada evento de roda ou de movimento).
- O prato do cliente cobre o tampo da mesa, centrado no prato da arte.
- O passo diagonal dura √2 vezes o passo reto, no servidor e no cliente: clientes e chef andam na mesma velocidade em qualquer direção.

### Corrigido

- A barra da loja bloqueava cliques numa faixa larga acima dela (entre as abas e o botão de confirmar), justamente sobre a parte de baixo da sala: era a principal causa de "clico e não coloca".
- O prato sobre o fogão engolia o clique no modo construção, e o mesmo pressionar chegava a pegar e soltar o fogão de uma vez.
- A posição do fogão guardado não impede mais colocar outro fogão no mesmo tile (o índice único de `player_stoves` virou comum).
- Mensagens de móvel em uso: tentar pegar uma cadeira ou mesa ocupada avisa na hora.

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
