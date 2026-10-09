# Changelog

Mudanças do Coffe Mania por versão. A numeração segue a do jogo original (Alpha `0.0.4.x`): cada conjunto de mudanças publicado sobe o último número. O campo npm `version` usa `-` no lugar do último ponto (`0.0.4-20`) por compatibilidade com SemVer.

Seções usadas: **Adicionado**, **Alterado**, **Corrigido**, **Removido** e **Observações** (limites conhecidos e o que ficou para depois).

## [0.0.4.30] — 2026-10-08

### Alterado

- O card de prato do Livro de Receitas usa o mesmo relógio do painel da direita (`recipe-book/clock.png`), no lugar do relógio desenhado em código.

### Observações

- Verificação: typecheck e card ampliado na prévia isolada no Chrome headless.

## [0.0.4.29] — 2026-10-08

### Alterado

- Card de prato do Livro de Receitas igual ao do original. O fundo volta a ser `inside_food_card.png`, com cantos arredondados: faixa caramelo com arabescos e painel claro. O título fica branco com sombra suave; o relógio é azul com aro marinho; o "XP" é amarelo com contorno marrom e halo claro; os números ficam em marrom escuro. As posições foram medidas no card original.
- Botão Cozinhar desenhado como no original: verde chapado, borda escura chanfrada e texto branco, com estados normal, hover, pressionado e sem ouro (cinza).
- Botão + dos favoritos em marrom com borda escura (dourado quando favorito). O + e a ★ passam a ser formas desenhadas e ficam centralizados na caixa.

### Removido

- `card.png`, `card-swirl.png` e `cook-button*.png` de `assets/ui/recipe-book/`, copiados na versão anterior e agora substituídos pelo card original e pelo botão desenhado.

### Observações

- Verificação: typecheck e prévia isolada no Chrome headless com texturas reais: card ampliado nos estados normal, hover no Cozinhar e sem ouro, além do livro inteiro. Sem sessão no quarto ao vivo.

## [0.0.4.28] — 2026-10-08

### Adicionado

- Livro de Receitas no layout do Café Mania original. No alto ficam os recursos (caféGrana, caféOuro, suprimentos e energia) com os botões Grana, Ouro e comprar, e as abas Básico, Avançado, Especiais, ★ Favoritos! e Deluxe. A página mostra seis pratos (2 × 3), e as setas azuis viram as páginas.
- Painel da direita que mostra o prato sob o mouse (ou tocado): nome, foto, balão com o tempo e relógio, preço de compra, XP total, porções e lucro por unidade. Sem prato em foco, mostra uma dica "Sabia que...?".
- Favoritos pelo + de cada card, guardados no navegador (`localStorage`).
- Arte em `game/public/assets/ui/recipe-book/`: livro, card, abas, botão Cozinhar (normal, hover e press), relógio e seta, trazidos do clone. O arabesco dos cards foi extraído do `inside_food_card.png` anterior.

### Alterado

- Cozinhar fica só no botão verde, como no original; clicar no card mostra o prato no painel. Sem caféOuros suficientes, o botão fica cinza e o painel avisa. O servidor continua validando o ouro.
- Tempos no formato do livro original: "3 min", "35 min", "6.0 hs". `recipeTimeLabel` deu lugar a `recipeBookTime` e `recipeBookTimeLabel`.
- Ícones de recursos, XP e moeda reaproveitam o atlas do HUD (`icon_bundle_1.png`); o botão de fechar continua o mesmo.

### Removido

- `cook_screen.png` e `inside_food_card.png` deixaram de ser carregados pelo livro. Os arquivos continuam na pasta.

### Observações

- Faltam assets do original: a fatia de bolo das porções e o cadeado da aba Especiais (desenhados provisoriamente em código), a arte amarela do "Sabia que...?" com o logo caféGrana e os pratos Pamonha e Tacos Triplos (arte e dados).
- O catálogo ainda não separa cardápios: todos os pratos do livro estão no Básico. Avançado abre no nível 30; Especiais fica trancada; Deluxe, vazia. Os botões Grana, Ouro e comprar aparecem, mas a compra ainda não existe no jogo.
- Verificação: typecheck e prévia isolada no Chrome headless com texturas reais (dica, hover, sem ouro, favoritos, página cheia, segunda página e clique em Cozinhar). Sem sessão no quarto ao vivo.

## [0.0.4.27] — 2026-10-08

### Adicionado

- Seção **Encaixe no tile** no Posicionador do Asset Studio. Ela detecta os cantos da base e do tampo pela silhueta, permite arrastá-los e mede os ângulos da arte em relação a 26,565°. Também encaixa base ou tampo na pegada em três modos: só mover (1:1), escala uniforme ou correção de ângulo com verticais preservadas.
- `tools/asset-positioner/fit-geometry.js`: detecção, solução e reamostragem compartilhadas entre o Studio e Node.
- `npm run assets:fit` (`scripts/fit-item-art.mjs`): relatório de ângulos e desvios dos móveis cadastrados, prévias sobre o contorno do tile e regravação com `--write`. `scripts/png.mjs` lê e grava PNG sem dependências.

### Alterado

- `STOVE_DISH_Y` passou de 2 para 11 e `COUNTER_DISH_Y`, de 2 para 9, acompanhando a nova altura do tampo do fogão e do balcão.

### Corrigido

- Arte do fogão (`starter_stove`) e do balcão (`starter_counter`) desalinhada com o tile. As arestas estavam entre 27,4° e 30,2°, e os cantos do fogão, até 4,4 px acima dos cantos do tile. Agora o fogão encaixa pela base e o balcão pelo tampo, a 26,565°, com desvio de 0,1–0,2 px nas quatro rotações. O corpo do balcão continua recuado sob o tampo.

### Observações

- A correção de ângulo reamostra a arte: escala vertical de 89–92% no fogão e de 92–93% no balcão, com ajuste horizontal por face. Os modos uniforme e só mover preservam o ângulo original e deixam 2–4 px de desvio nesses itens.
- Cadeira, caixa de correio, arbusto e mesa não formam um losango pela silhueta (pés, folhas, toalha). O relatório os marca, e os cantos precisam ser posicionados manualmente no Studio.
- Verificação: medição dos PNGs regravados com `npm run assets:fit`; `npm run assets:room`; fluxo do Studio no Chrome headless (detectar, encaixar nos três modos, espelhar e ler offsets). Typecheck rodado. Sem conferência visual dentro do quarto ao vivo.

## [0.0.4.26] — 2026-10-08

### Adicionado

- Apoio do prato medido na junta da mão direita em cada quadro do atlas do chef. Ajustes finos relativos à mão em `CARRIED_DISH_HAND_X/Y`, em `DishPresentation.ts`.
- Oito vistas próprias da animação de transporte, mantendo a mão direita nas direções que antes usavam espelhamento.

### Alterado

- Chef transporta o prato com o braço na pose de carregar. Ao parar, mantém a pose sem caminhar no lugar; ao entregar, volta à animação normal.
- Âncora do prato carregado passa para sua borda inferior, acompanhando a mão na caminhada e na animação de colocar na bancada.

### Corrigido

- Prato baixo, próximo ao chão, e desconectado do braço durante o passo. A posição agora vem do quadro renderizado, em vez de offsets fixos por direção.
- Espelhamento que trocava a mão de apoio no transporte. Na animação de colocar, a mão correspondente é selecionada também nos quadros espelhados.

### Removido

- Bandeja do modelo 3D na animação de transporte; o prato 2D ocupa seu lugar.

### Observações

- Tamanho 140 preservado; imagens existentes, profundidade do personagem no quarto, simulação e calibração da hitbox permanecem iguais.
- Typecheck e Playwright/Chromium com WebGL: quatro quadros de caminhada nas oito direções, contato entre mão e borda do prato, camadas, parada, entrega, atlas sem o clipe novo e troca de tile na metade do passo. Conferência isolada, sem sessão multiplayer completa.
- Recarregar o jogo gera os novos quadros do avatar. Durante o carregamento, a posição aproximada mantém o prato elevado.

## [0.0.4.25] — 2026-10-08

### Adicionado

- Posições do prato na mão direita para as direções cima-direita, cima e cima-esquerda, ajustáveis em `DishPresentation.ts`.

### Alterado

- De costas, o prato carregado passa para trás do corpo e para o lado da mão direita. Nas demais direções, conserva a posição frontal.
- Camadas internas do personagem ordenadas como sombra, prato traseiro, corpo e prato frontal, sem alterar sua profundidade no quarto.

### Corrigido

- Prato desenhado sobre as costas do chef ao caminhar para cima. A camada e o deslocamento agora acompanham as mudanças de direção.

### Removido

- Nenhum.

### Observações

- Preservados os ajustes locais de tamanho do prato (140) e altura frontal (-20).
- Verificados os tipos e a renderização isolada Chromium/WebGL nas oito direções, incluindo troca de direção, ordem das camadas e acompanhamento do personagem. Sem sessão multiplayer completa.
- Sem alterações nas imagens, na simulação ou na calibração da hitbox.

## [0.0.4.24] — 2026-10-08

### Adicionado

- Balão de hover para comida pronta no fogão: "Prato pronto." e "Clique para servir!", com interior branco, contorno marrom e exterior transparente.

### Alterado

- Pratos na mesa, no fogão pronto e na mão do chef usam a mesma escala de 104 px da bancada, preservando a proporção da textura.
- Prato carregado posicionado diante do peito, próximo à cabeça, cobrindo o braço; acompanha a interpolação e a camada do chef.

### Corrigido

- Prato do cliente maior que o da bancada (132 px).
- Prato carregado pequeno (56 px) e independente da camada do personagem.
- Escala e apoio do prato pronto no fogão, tanto na transição de preparo quanto ao restaurar o estado compartilhado.
- Hover e clique de servir também sobre a arte dos pratos dos fogões compartilhados. Comida estragada, serviço em andamento e modo construção não exibem o balão de pronto.

### Removido

- Nenhum.

### Observações

- Verificados os tipos e um cenário isolado Chromium/WebGL com os assets reais, transições de preparo, hover e chef nas oito direções. Não foi executada uma sessão multiplayer completa.
- Assets existentes preservados; o novo balão é vetorial, com transparência real fora da borda. A calibração de movimento e hitbox permanece igual.

## [0.0.4.23] — 2026-10-08

### Adicionado

- Nenhum.

### Alterado

- Os comandos de compilação Go agora reutilizam o console do launcher no Windows, evitando janelas de terminal separadas para as ferramentas auxiliares.

### Corrigido

- A compilação inicial não deve mais abrir e fechar repetidamente janelas de console no Windows.

### Removido

- Nenhum.

### Observações

- Os servidores continuam em processos separados para que o launcher possa salvar os quartos antes de encerrá-los. A alteração vale na próxima inicialização.

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
