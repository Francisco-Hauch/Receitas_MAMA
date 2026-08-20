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
é mono e claro). Seções sem backend (galeria de fotos enviadas, "recados de
quem fez") existem como **placeholders estáticos marcados "demonstração"** até
haver suporte real.

| Arquivo | Papel |
|---|---|
| `site/src/App.jsx` | Raiz. Roteia por hash entre Lista / Receita / tela de erro. **Não há mais rota de envio**: `#/enviar` (link antigo) troca para `#/`, e "mandar receita" no cabeçalho é botão, não link — incrementa o contador `chamado`, que leva a pessoa até a zona de arraste na home. |
| `site/src/Lista.jsx` | Página principal: hero, **bloco de envio** (`Enviar`, só para quem pode enviar), busca por nome/ingrediente (sem acento, sem caixa) e filtro por tag. |
| `site/src/Receita.jsx` | Tela principal. Hero (kicker/tag, título display, resumo, stats tempo/serve/dificuldade). Ingredientes e passos são botões marcáveis (estado some ao sair, de propósito — é sessão de cozinha). Sugestões da internet como card "da internet" ao lado do passo + seção "Dicas da internet" + fontes. Placeholders demo: galeria e recados. |
| `site/src/Enviar.jsx` | Bloco de envio da home (não é tela). Zona de arraste: o arquivo é que decide o tipo (imagem → foto, PDF/.docx/.txt/.md → documento); aceito o arquivo, abre o pop-up com nome e observações → `POST /api/receita`. Digitar a receita e mandar link são atalhos abaixo da zona, no mesmo pop-up. Recusa (tipo desconhecido, foto misturada com documento, limite de tamanho) acontece antes de abrir o pop-up. |
| `site/src/dados.js` | Lê e indexa os JSONs; liga receita ↔ complemento pelo número da issue. |
| `site/src/sessao.js` | Pergunta `/api/sessao` só para decidir o que mostrar. Segurança de verdade é no Worker. |
| `site/src/estilo.css` | Design system "Caderno de Receitas": tokens (cores, serifas, espaçamento) + classes. Light-only. |
| `site/src/worker.js` | **Backend** (Cloudflare Worker): rotas, login, sessão, API. **Não é front — não editar sem pedido.** |
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
