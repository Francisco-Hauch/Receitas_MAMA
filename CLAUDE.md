# Contexto do projeto — Receitas da Mamãe

Este arquivo é o contexto que o Claude lê ao trabalhar neste repositório.
Mantê-lo curto e verdadeiro; se uma decisão mudar, atualizar aqui.

## O que é

Central de receitas de família. Uma foto do caderno vira uma receita
estruturada num site privado, **sem ninguém digitar nada**. O trabalho pesado
roda num PC pessoal que fica desligado a maior parte do tempo — por isso tudo
gira em torno de uma **fila** (issues no GitHub) e de **nunca perder** o que já
foi processado se a máquina cair no meio.

## Combinado de trabalho (IMPORTANTE)

1. **Só este projeto.** Todo trabalho acontece no `Receitas_MAMA` e em nada mais.
2. **Só front.** Editamos apenas o front-end em `site/src/` (componentes React
   e `estilo.css`). **Não** mexer em `worker/` (Python), em `data/`, nem no
   backend do Cloudflare Worker — `site/src/worker.js` e
   `site/src/autenticar.js` — a não ser que o dono peça explicitamente.
3. **Git primeiro.** No início de cada rodada: `git fetch`, comparar se há
   branch ou `main` mais nova que a cópia local e **puxar** para atualizar antes
   de editar.
4. **Commits são manuais**, feitos pelo dono do projeto. O Claude edita e
   entrega os arquivos alterados; não commita nem faz push por conta própria.

## Arquitetura em uma olhada

```
foto/formulário → issue no GitHub (fila) → worker no PC (3h da manhã):
  transcreve (passada 1, sem internet) → valida (Pydantic) → grava data/receitas/
  → enriquece (passada 2, com web) → grava data/complementos/ → commit+push
  → Cloudflare reconstrói o site
```

**A fila é para pensar, não para guardar.** Ela existe porque transcrever
depende do Claude no PC de casa. Foto de momento não tem nada a pensar: entra
por `POST /api/receita/:issue/fotos`, que **commita direto** em `data/fotos/` e
não espera o PC ligar. Receita nova continua toda pela fila.

Decisão central: **procedência**. A receita da mamãe (`data/receitas/`) e as
sugestões da internet (`data/complementos/`) saem de chamadas diferentes e vão
para arquivos diferentes. No front, isso aparece como **card "da internet"** ao
lado do passo que a sugestão comenta (o accent dourado marca tudo que não é da
mamãe). Nunca misturar as duas coisas visualmente.

## O front (`site/`) — nosso território

React 19 + Vite. Roteamento por **hash** (`#/0001-pao-de-alho`), sem lib de
rota. Os dados **entram no build** via `import.meta.glob` — zero requisição em
runtime; publicar receita nova exige rebuild (o Cloudflare faz sozinho a cada
push).

**Visual ("Caderno de Receitas", aplicado a partir de um mockup do Claude
Design).** Livro de receitas: fundo creme (`#f3f2f2`), tipografia serifada
(Cormorant Garamond nos títulos, Lora no corpo), um único accent dourado
(`#b68235`) e fotos com moldura de "prato". Tokens e classes ficam no topo de
`estilo.css`. **Light-only** (o dark-mode antigo foi removido; o design system
é mono e claro). Seção sem backend ("recados de quem fez") existe como
**placeholder estático marcado "demonstração"** até haver suporte real —
"Fotos de momentos" já não é placeholder: manda foto de verdade.

**Fotos.** Quem manda a receita é a mesma pessoa que tira todas as fotos, então
foto **não tem autoria** em lugar nenhum do front — nada de "foto de Fulana".
São *momentos*: de vezes diferentes ou do meio do preparo. A mais recente é a
que vai grande no topo da receita e no card da lista; as outras ficam na galeria
da coluna lateral, sem legenda.

As fotos de `data/fotos/` **entram no build** como os JSONs (`import.meta.glob`
em `dados.js`). A ligação é o número que abre o nome do arquivo: `0003-2.png` é
a segunda foto da receita `0003-…`, e o **maior número é a mais recente**, então
`receita.fotos[0]` é sempre a foto grande. Receita sem foto cai no monograma na
moldura vazia, como antes.

**Mandar foto de momento** (`Momentos.jsx`, na lateral da receita) usa essa
mesma regra de nome: o servidor lê `data/fotos/`, acha o maior `0003-N` e grava
o próximo. É por isso que a foto fica associada àquela receita e não a outra —
não há id novo em lugar nenhum. Antes de subir, o navegador **encolhe para 2000px
e converte para WebP** (`encolher()` em `arquivos.js`): resolve o HEIC do
iPhone, que o `dados.js` nem varre, e derruba 4 MB para centenas de KB. A foto
do **caderno** não passa por isso — ela é o bruto da transcrição e sobe como
veio. Entre soltar a foto e vê-la na galeria existe o rebuild do Cloudflare
(~1 min); a tela diz isso em vez de fingir.

**Movimento.** O site é animado, e o movimento é parte do design system, não
enfeite solto. A estética é editorial: entra subindo e clareando, sai encolhendo
e rápido, distância curta (18px é o padrão, 34px só no hero). Nada pula, nada
pisca, nada gira — movimento grande em tipografia serifada lê como
instabilidade.

Os tokens vivem em **dois lugares que precisam andar juntos**: `movimento.js`
(em segundos, para a Motion) e o bloco `--mov-*` / `--ease-*` no topo do
`estilo.css` (em ms, para o que é animado por folha de estilo). Mudar de um lado
exige mudar do outro.

Duas regras de fundo:

- **Feedback é mola, cena é duração.** Toque do dedo (marcar ingrediente, abrir
  foto) usa mola, porque responde ao gesto. Troca de cena (página, foto do
  carrossel) usa duração fixa, porque é narrativa.
- **`prefers-reduced-motion` é desligar, não acelerar.** Para quem pediu menos
  movimento, bloco revelado por scroll aparece **já visível** (`useEntrada()` em
  `movimento.js`) — conteúdo que depende de rolagem para existir é exatamente o
  que essa preferência pede para evitar. São dois mecanismos: o CSS no
  `estilo.css` e o `<MotionConfig reducedMotion="user">` no `App.jsx`, porque a
  Motion escreve transform inline e `transition: none` não alcança.

A troca de tela usa a **View Transitions API** (não AnimatePresence): a foto do
card e a foto do topo da receita têm o mesmo `view-transition-name`, e o
navegador liga uma na outra. Onde a API não existe, a navegação acontece igual e
só a animação de montagem da página aparece — é enfeite, nunca mecanismo.

| Arquivo | Papel |
|---|---|
| `site/src/App.jsx` | Raiz. Roteia por hash entre Lista / Receita / tela de erro. **Não há mais rota de envio**: `#/enviar` (link antigo) troca para `#/`, e "mandar receita" no cabeçalho é botão, não link — incrementa o contador `chamado`, que leva a pessoa até a zona de arraste na home. |
| `site/src/Lista.jsx` | Página principal: hero, **bloco de envio** (`Enviar`, só para quem pode enviar), busca por nome/ingrediente (sem acento, sem caixa) e filtro por tag. |
| `site/src/Receita.jsx` | Tela principal. Hero (kicker/tag, título display, resumo, stats tempo/serve/dificuldade). Ingredientes e passos são botões marcáveis (estado some ao sair, de propósito — é sessão de cozinha). Sugestões da internet como card "da internet" ao lado do passo + seção "Dicas da internet" + fontes. Na lateral: `Momentos` (fotos, de verdade) e o placeholder demo dos recados. |
| `site/src/Momentos.jsx` | Bloco "Fotos de momentos" da lateral. Zona de arraste (só para quem pode enviar) → encolhe → `POST /api/receita/:issue/fotos`. Enquanto o site não reconstrói, a foto aparece numa moldura marcada "subindo"/"chegando" — nunca como se já estivesse na galeria. |
| `site/src/Arrastar.jsx` | O gesto de arrastar sozinho: `useArrasto()` (conta `dragenter`, engole o drop na janela), `<Miniatura>` e `usePrevia()`. Usado pelas duas zonas. |
| `site/src/arquivos.js` | O que as duas zonas sabem sobre arquivo: tipos aceitos, limites (espelham o `worker.js`), `tipoDoArquivo()`, `conferir()`, `lerBase64()` e `encolher()` (2000px + WebP, **só para foto de momento**). |
| `site/src/Enviar.jsx` | Bloco de envio da home (não é tela). Zona de arraste: o arquivo é que decide o tipo (imagem → foto, PDF/.docx/.txt/.md → documento); aceito o arquivo, abre o pop-up com nome e observações → `POST /api/receita`. Digitar a receita e mandar link são atalhos abaixo da zona, no mesmo pop-up. Recusa (tipo desconhecido, foto misturada com documento, limite de tamanho) acontece antes de abrir o pop-up. |
| `site/src/Galeria.jsx` | Fotos: moldura, carrossel do topo (crossfade + Ken Burns + anel de progresso), grade de miniaturas e o visor de tela cheia (teclado ←/→/Esc, arrasto, foco preso e devolvido). O visor mora num contexto porque quem o abre está em dois pontos distantes da árvore. |
| `site/src/movimento.js` | **Tokens e hooks de movimento**: durações, curvas, molas, variants compartilhados, `useEntrada()`, contagem de números, relógio do carrossel, `comTransicao()`. Nenhum componente deve inventar duração ou curva por conta. |
| `site/src/Revelar.jsx` | Peças de movimento reusadas: `<Revelar>`, `<ListaRevelada>`/`<ItemRevelado>`, `<TituloRevelado>` (título saindo de trás do papel, palavra a palavra — só em hero) e `<Contador>`. |
| `site/src/dados.js` | Lê e indexa os JSONs **e as fotos**; liga receita ↔ complemento pelo número da issue e receita ↔ fotos pelo prefixo do nome do arquivo. |
| `site/src/sessao.js` | Pergunta `/api/sessao` só para decidir o que mostrar. Segurança de verdade é no Worker. |
| `site/src/estilo.css` | Design system "Caderno de Receitas": tokens (cores, serifas, espaçamento) + classes. Light-only. |
| `site/src/worker.js` | **Backend** (Cloudflare Worker): rotas, login, sessão, API. `POST /api/receita` cria (fila); `POST /api/receita/:issue/fotos` acrescenta foto a receita existente, num **commit só** (Git Data API). **Não é front — não editar sem pedido.** |
| `site/src/autenticar.js` | **Backend**: senha, sessão, níveis. **Não editar sem pedido.** |

### Convenções do front

- Idioma do código e da UI: **português** (nomes de variáveis, funções e textos).
- Fontes: `Cormorant Garamond` (títulos) e `Lora` (corpo), via Google Fonts no `index.html`.
- Acessibilidade já usada: `aria-pressed` em botões de toggle, `aria-label` na
  busca. Manter esse padrão ao adicionar interações.
- Formatação de quantidade: inteiro vira `"4"`, decimal vira `"0,5"` (vírgula);
  `unidade` ausente ou `"unidade"` some (ver `quantidade()` em `Receita.jsx`).
- Sugestões da internet sempre marcadas como tal (classe `sugerido` nas stats,
  rótulo "da internet" nos cards); nunca apresentar como parte da receita original.

### Rodar o front localmente

```bash
cd site
.\dev.cmd            # servidor de dev (com --host abre no celular)
npm run build        # build de produção
```

No PowerShell usar `npm.cmd` (o `dev.cmd` já contorna a política de script).

## Pegadinhas relevantes ao front

- **Rota por hash** de propósito: caminho normal daria 404 ao abrir o link
  direto de uma receita em hospedagem estática.
- **Dados no bundle**: mudar receita/complemento exige rebuild para aparecer.
- **`sessao.js` é só tela**: esconder o botão de enviar é cortesia, não
  segurança. Se `/api/sessao` falhar, o site assume modo leitura.
- **`transform` no `<main>` vira armadilha**: a animação de entrada da página
  usa `animation-fill-mode: backwards`, nunca `both`. Com `both` o transform
  final fica grudado no elemento, e transform cria bloco de contenção — todo
  `position: fixed` de dentro (o visor de foto) passa a se posicionar em relação
  ao `<main>` em vez da janela. Já quebrou uma vez.
- **Um commit = um build.** Na rota de fotos, os arquivos vão num commit só
  pela Git Data API; o `subirArquivo` da rota antiga ainda faz um PUT por
  arquivo, e portanto um build por arquivo. Vale unificar quando mexer nela.
- **`data/fotos` guarda duas coisas diferentes** hoje: a foto da **página do
  caderno** (o bruto que o worker do PC transcreve) e a **foto de momento**. O
  site mostra as duas como momento. Separar isso é a próxima fase, não um bug
  para consertar de passagem.
- **HEIC só não é um buraco por causa do `encolher()`**: o `dados.js` varre
  `png,jpg,jpeg,webp`, então qualquer HEIC que chegue a `data/fotos` por outro
  caminho fica invisível no site.
- **A dependência nova é a Motion** (`motion`, ~80 KB no bundle). Depois de
  puxar esta branch é preciso rodar `npm install` dentro de `site/` antes do
  `dev.cmd`, senão o import falha.
