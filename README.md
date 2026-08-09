# Receitas da Mamãe

Central de receitas de família. Uma foto do caderno vira uma receita
estruturada num site privado, sem ninguém digitar nada.

O trabalho pesado roda num PC pessoal que fica desligado a maior parte do
tempo — então tudo é desenhado em torno disso: os pedidos esperam numa fila,
e o que já foi feito nunca se perde se a máquina cair no meio.

---

## O fluxo inteiro

```
  ENTRADA                    FILA              PROCESSAMENTO (PC, 3h da manhã)         PUBLICAÇÃO
  ───────                    ────              ───────────────────────────────         ──────────

  foto no celular  ─┬─▶  issue no GitHub  ─▶   1. sincroniza com o remoto
                    │    (label status:novo)   2. baixa as fotos anexadas
  formulário do     │                          3. Claude lê e transcreve         ─┐
  site ─────────────┘                          4. Pydantic valida                 │
     POST /api/receita                         5. grava data/receitas/*.json      ├─▶ commit + push
     (cria a issue                             6. Claude busca complementos       │        │
      pela API)                                   na web (2ª passada)             │        ▼
                                                7. grava data/complementos/       │   Cloudflare
                                                8. comenta e fecha a issue       ─┘   reconstrói
                                                                                       o site
```

Cada passo do worker é um módulo em `worker/src/`. O `main.py` só chama os
outros na ordem certa.

---

## Duas portas, uma fila

| Porta | Como se usa | Quem trata |
|---|---|---|
| **Issue no GitHub** | abre a issue e arrasta a foto | o formulário de `.github/ISSUE_TEMPLATE/` |
| **Formulário do site** | toca em "mandar receita" | `site/src/worker.js` → API do GitHub |

As duas produzem **o mesmo corpo de issue**, com os mesmos `### rótulos`. Por
isso existe um só lugar que sabe ler o formulário — `worker/src/parser.py` — em
vez de dois caminhos para manter sincronizados.

---

## As duas passadas do Claude

Esta é a decisão central do projeto, e ela é sobre **procedência**.

```
passada 1  claude.py      sem internet, sem ferramentas  →  data/receitas/
passada 2  enriquecer.py  WebSearch + WebFetch           →  data/complementos/
```

Pedir ao modelo "complete a receita e marque o que foi você" seria confiar nele
para ser honesto sobre a própria contribuição. Em vez disso, a receita da mamãe
e as sugestões da internet saem de **chamadas diferentes** e vão para **arquivos
diferentes**. A origem de cada informação deixa de ser uma afirmação do modelo e
passa a ser um fato sobre qual chamada a produziu.

E a garantia não depende só do prompt: o esquema JSON da passada 2 **não tem os
campos `ingredientes` nem `passos`**. Ele é incapaz de expressar uma receita —
só adendos ancorados a ela. Mesmo que o modelo quisesse reescrever o que a
mamãe escreveu, a validação rejeitaria a resposta.

No site isso vira a **margem vermelha do caderno**: o texto dela fica na página,
as sugestões da internet ficam na margem, ao lado do passo que comentam.

### Verificação das fontes

O modelo às vezes cita URLs que não existem — medido neste projeto: a primeira
que ele devolveu dava `HTTP 301`. Por isso `verificar_fontes()` confere cada
link antes de gravar, em três baldes:

| resposta | leitura | destino |
|---|---|---|
| `200` | a página existe | entra como fonte |
| `401/403/405/429` | anti-bot recusou — indecidível | entra marcada "não verificada" |
| `301/404`, erro de rede | não é a página citada | descartada |

O `allow_redirects=False` é o que pega a URL inventada: um artigo que
redireciona para a home do site não é o artigo que ele diz ter lido.

---

## Camadas de segurança

O ativo protegido **não são as receitas**. É a rota `/api/receita`: quem passa
por ela cria issues e **commita arquivos no repositório privado**, porque o
token do Worker tem escrita em Contents. Todo o resto decorre disso.

### 1. O repositório é privado

A fila, as fotos, as receitas e o código estão num repositório privado. O site
é servido a partir dele, não é um espelho público.

### 2. Login próprio, no Worker

O Cloudflare Access foi avaliado e descartado por escolha do dono do projeto.
No lugar, autenticação por senha única de família, implementada em
`site/src/autenticar.js`.

### 3. Nada sai antes da sessão ser conferida

A peça mais importante, e a menos óbvia:

```jsonc
"assets": { "binding": "ASSETS", "run_worker_first": true }
```

Por padrão a Cloudflare entrega o arquivo estático **antes** de rodar qualquer
código. Como o bundle do React traz todas as receitas embutidas, isso
significaria entregar os dados a quem não entrou. Essas duas linhas invertem a
ordem: o Worker vê toda requisição primeiro e só chama `env.ASSETS.fetch()`
depois de validar a sessão.

Pelo mesmo motivo, **a tela de login é HTML solto servido pelo Worker**, não uma
página React — uma tela de login em React exigiria baixar o bundle para
desenhá-la. Autenticar depois de entregar os dados não é autenticar.

Testado: sem cookie, `GET /assets/index-*.js` responde `302` para o login.

### 4. Sessão em cookie assinado

O cookie é `nivel.validade.HMAC(nivel.validade)`, com `HttpOnly`, `Secure`,
`SameSite=Lax` e validade de 30 dias.

- **Sem banco de sessão.** Não há o que consultar nem o que vazar.
- **A assinatura é conferida ANTES da validade.** Na ordem inversa, o valor da
  data seria usado antes de se saber se é confiável.
- **O nível vai dentro da assinatura.** Editar `visita` para `familia` no cookie
  quebra o HMAC. Testado: devolve `401`.

### 5. Comparação em tempo constante

Senha e assinatura são comparadas byte a byte sem sair mais cedo na primeira
diferença, para não vazar informação pelo tempo de resposta.

### 6. Limite de tentativas

Dois freios nativos da Cloudflare, em `wrangler.jsonc`:

| binding | limite | contra |
|---|---|---|
| `LIMITE_LOGIN` | 5 por minuto, por origem | alguém insistindo |
| `LIMITE_GLOBAL` | 30 por minuto, no total | muitas origens tentando pouco cada |

Se o binding não existir, o login **recusa** em vez de seguir sem freio.

### 7. Falha fechada, sempre

| falta | acontece |
|---|---|
| `SENHA_*_HASH` | ninguém entra |
| `SEGREDO_SESSAO` | nenhuma sessão é válida |
| binding de rate limit | login recusa |
| `GITHUB_TOKEN` | `/api/receita` responde 500 |

Nenhuma falha de configuração abre a porta.

### 8. Níveis de acesso

| nível | vê receitas | manda receita |
|---|---|---|
| `familia` | sim | sim |
| `visita` | sim | **não** (`403`) |

Cada nível tem sua senha. Adicionar um terceiro é uma linha em `NIVEIS` mais um
secret.

O site pergunta `/api/sessao` para saber o que mostrar, **mas isso é só tela**.
Esconder um botão não protege nada — quem recusa é o Worker no POST. Se a
consulta falhar, o site assume leitura: errar mostrando de menos é melhor que
oferecer o que vai falhar depois.

### 9. A senha nunca é guardada

O secret é o **SHA-256** da senha; o Worker calcula o hash do que foi digitado e
compara.

> **Trade-off assumido.** SHA-256 e não bcrypt/PBKDF2 porque o plano grátis dá
> 10 ms de CPU por requisição, e uma derivação lenta honesta estoura esse
> orçamento. Quem segura a barra aqui é o limite de tentativas, não o custo do
> hash. Se um dia o projeto guardar algo de valor, o certo é pagar o plano e
> trocar por derivação lenta.

### 10. Segredo mora em um lugar só

`.gitignore` cobre `.env`, `.dev.vars`, `*.token`, `*.pat`, `*token*.txt`. Os
secrets de produção vivem só no painel da Cloudflare, onde não podem ser lidos
de volta depois de salvos.

Tokens do GitHub são **fine-grained, escopados a este repositório**, com o
mínimo: Issues R/W, Contents R/W, Metadata RO. Um token separado para o site e
outro para o worker local — revogar um não derruba o outro.

### 11. O worker automático só toca em `data/`

```bash
git commit -m "..." -- data
```

O `-- data` no fim não é estilo. Sem ele, `git commit` leva **tudo que estiver
no index** — e o worker roda às 3h da manhã, possivelmente no meio de uma edição
sua. Testado em produção: o worker commitou os dados e deixou quatro arquivos de
código modificados intactos.

### 12. Escape de HTML na tela de login

Todas as mensagens de erro são literais hoje, mas `paginaLogin()` escapa o que
recebe. Segurança que depende de quem chama lembrar do cuidado é segurança que
expira.

---

## Estrutura

| Caminho | Conteúdo |
|---|---|
| `worker/src/github.py` | API do GitHub: fila, etiquetas, anexos |
| `worker/src/parser.py` | fatia o corpo do formulário |
| `worker/src/claude.py` | passada 1 — transcreve, sem internet |
| `worker/src/enriquecer.py` | passada 2 — busca na web, só acrescenta |
| `worker/src/modelos.py` | validação Pydantic |
| `worker/src/armazenar.py` | grava os JSONs e as fotos |
| `worker/src/versionar.py` | sincroniza, commita e publica |
| `worker/agendar.py` | registra a tarefa noturna no Windows |
| `site/src/worker.js` | rotas, login e API (roda na Cloudflare) |
| `site/src/autenticar.js` | senha, sessão e níveis |
| `data/brutos/` | o que chegou, como chegou |
| `data/fotos/` | as imagens originais |
| `data/receitas/` | a receita da mamãe — fonte da verdade |
| `data/complementos/` | o que a internet sugeriu |

Os arquivos são nomeados `0003-brigadeiro-de-chocolate-branco.json`. O número da
issue vem na frente porque o título **não é estável** — o modelo pode renomear a
receita, e sem o número um reprocessamento criaria um arquivo novo em vez de
atualizar o antigo.

---

## Configuração

### Secrets na Cloudflare

*Workers & Pages → receitas-mama → Settings → Variables and Secrets → Add →* tipo **Secret**:

| nome | o que é |
|---|---|
| `GITHUB_TOKEN` | token fine-grained com Issues R/W + Contents R/W |
| `SEGREDO_SESSAO` | string aleatória que assina o cookie |
| `SENHA_FAMILIA_HASH` | SHA-256 da senha de quem vê e manda |
| `SENHA_VISITA_HASH` | SHA-256 da senha de quem só vê (opcional) |

Gerando um hash sem a senha aparecer na tela nem no histórico:

```powershell
.venv\Scripts\python.exe -c "import getpass,hashlib;print();print(hashlib.sha256(getpass.getpass('Senha: ').encode()).hexdigest())"
```

### Build na Cloudflare

| campo | valor |
|---|---|
| Root directory | `site` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

O `name` do `wrangler.jsonc` precisa ser **idêntico** ao nome do Worker no
painel, senão o deploy cria um segundo Worker em vez de atualizar este.

### Worker local

`.env` na raiz (nunca commitado):

```
GITHUB_TOKEN=...
GITHUB_OWNER=...
GITHUB_REPO=...
```

### Tarefa noturna

```powershell
.venv\Scripts\python.exe worker\agendar.py            # ver o XML, sem criar
.venv\Scripts\python.exe worker\agendar.py --criar    # registrar
schtasks /Run /TN "Receitas da Mamae"                 # testar agora
```

A tarefa é registrada por XML e não pela linha de comando do `schtasks` por
causa de uma opção só:

```xml
<StartWhenAvailable>true</StartWhenAvailable>
```

Sem ela, uma tarefa das 3h **nunca roda** num PC que fica desligado à noite. Com
ela, o Windows percebe que perdeu o horário e roda assim que a máquina liga.

---

## Rodando

```bash
# worker
worker\executar.cmd                  # lista a fila
worker\executar.cmd --simular        # processa sem gravar nem mexer nas issues
worker\executar.cmd --processar      # grava e fecha as issues
worker\executar.cmd --enriquecer     # o mesmo + busca na web
worker\executar.cmd --sem-commit     # grava mas não publica

# site
cd site && .\dev.cmd                 # servidor local (com --host, abre no celular)
npm run build
```

No PowerShell use `npm.cmd` em vez de `npm`: o PowerShell escolhe o `npm.ps1`,
que não é assinado, e a política padrão recusa. O `dev.cmd` já contorna isso.

---

## Decisões que não são óbvias

**Gravar antes de marcar.** O worker escreve o arquivo e só depois muda a
etiqueta da issue. Se a máquina cair no meio, a execução seguinte consulta o
**disco** — não memória, não estado guardado — e conserta: arquivo existe →
`pronto`; arquivo não existe → volta para a fila. Nada se perde, nada roda duas
vezes.

**Um lote, um prompt.** Cada invocação do Claude headless carrega ~38 mil tokens
fixos, independente do tamanho do pedido. Por isso várias receitas vão na mesma
chamada, e as flags e o esquema são constantes congeladas: prefixo idêntico
byte a byte reaproveita o cache e custa ~5× menos. Mudar uma vírgula no esquema
descarta o cache.

**Três caches, não um.** Texto, foto (com a ferramenta `Read` ligada) e
enriquecimento (com busca web) têm prefixos diferentes, logo caches separados.
Um lote nunca mistura os dois primeiros.

**Sem OCR separado.** O plano original previa Llama para ler as fotos. O Claude
headless lê imagem direto com a ferramenta `Read` — um modelo a menos para
instalar e manter.

**Anexo de issue em repo privado dá 404** na URL que aparece no Markdown, mesmo
com token válido. A saída é pedir a issue com `Accept:
application/vnd.github.full+json`: o campo `body_html` traz as mesmas imagens
apontando para `private-user-images.githubusercontent.com` com um token de curta
duração na própria URL. Essas baixam — e sem header de autorização, que faria o
servidor de imagens recusar.

**Rota por `#` no site.** Sem biblioteca de rotas. Com caminho normal, abrir o
link direto de uma receita daria 404 até alguém configurar redirecionamento.

**Os JSONs entram no build**, não são buscados em tempo de execução. Zero
requisição, zero CORS. O preço é que receita nova exige rebuild — que é
exatamente o que a Cloudflare faz sozinha a cada push.

---

## Quando algo quebra

| sintoma | causa provável |
|---|---|
| login diz "sem senha configurada" | secret faltando ou com nome trocado |
| `/api/receita` responde 500 | `GITHUB_TOKEN` não configurado |
| `/api/receita` responde 403 | sessão de `visita` tentando enviar |
| formulário do site parou sozinho | token do GitHub expirou |
| issue presa em `status:processando` | queda no meio; a próxima execução conserta |
| deploy cria um Worker novo | `name` do `wrangler.jsonc` ≠ nome no painel |
| acentos virando `Ã§` | falta `PYTHONUTF8=1` — o `executar.cmd` já põe |

O log de cada execução noturna fica em `worker/logs/AAAA-MM-DD.log`.
