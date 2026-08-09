/**
 * Login simples com senha única de família.
 *
 * O que está sendo protegido não são as receitas: é a rota /api/receita, que
 * escreve issues e COMMITA ARQUIVOS no repositório privado. Esse é o ativo.
 *
 * Escolhas e seus porquês:
 *
 * - A senha nunca é guardada. O secret é o SHA-256 dela; o Worker calcula o
 *   hash do que foi digitado e compara.
 *
 * - SHA-256 e não bcrypt/PBKDF2 porque o plano grátis dá 10 ms de CPU por
 *   requisição, e um PBKDF2 honesto (100 mil iterações) estoura isso. Quem
 *   segura a barra aqui é o limite de tentativas, não o custo do hash. É um
 *   trade-off consciente: se um dia o projeto guardar algo de valor, o certo é
 *   pagar o plano e usar derivação lenta.
 *
 * - Sessão em cookie assinado (HMAC), sem banco: não há o que consultar, e um
 *   cookie adulterado não passa na verificação da assinatura.
 *
 * - Comparação em tempo constante nos dois casos, para não vazar informação
 *   pelo tempo de resposta.
 */

const COOKIE = "sessao";
const DURACAO = 60 * 60 * 24 * 30; // 30 dias — é um caderno de receitas

const codificador = new TextEncoder();

const hex = (buffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Compara sem sair mais cedo quando os bytes diferem. */
function iguais(a, b) {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) {
    diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diferenca === 0;
}

async function sha256(texto) {
  return hex(await crypto.subtle.digest("SHA-256", codificador.encode(texto)));
}

async function assinar(mensagem, segredo) {
  const chave = await crypto.subtle.importKey(
    "raw",
    codificador.encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", chave, codificador.encode(mensagem)));
}

export async function senhaConfere(senha, env) {
  if (!senha || !env.SENHA_HASH) return false;
  return iguais(await sha256(senha), env.SENHA_HASH.trim().toLowerCase());
}

export async function criarSessao(env) {
  const expira = String(Math.floor(Date.now() / 1000) + DURACAO);
  const assinatura = await assinar(expira, env.SEGREDO_SESSAO);
  return `${COOKIE}=${expira}.${assinatura}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${DURACAO}`;
}

export const encerrarSessao = () =>
  `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

export async function sessaoValida(request, env) {
  if (!env.SEGREDO_SESSAO) return false;

  const bruto = request.headers.get("cookie") || "";
  const achado = bruto
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${COOKIE}=`));
  if (!achado) return false;

  const [expira, assinatura] = achado.slice(COOKIE.length + 1).split(".");
  if (!expira || !assinatura) return false;

  // a validade é verificada DEPOIS da assinatura: sem assinatura boa, o valor
  // de "expira" não é confiável para nada
  if (!iguais(await assinar(expira, env.SEGREDO_SESSAO), assinatura)) return false;

  return Number(expira) > Math.floor(Date.now() / 1000);
}

/**
 * A tela de login, servida pelo próprio Worker.
 *
 * É HTML solto de propósito. Se o login fosse uma página do site em React, o
 * navegador precisaria baixar o bundle para desenhá-la — e o bundle tem todas
 * as receitas embutidas. Ninguém não autenticado pode receber aquele arquivo.
 */
export function paginaLogin(erro = "") {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Receitas da Mamãe</title>
<style>
  :root { --papel:#eceef1; --ficha:#fbfcfd; --tinta:#16263f; --fraca:#5b6a80;
          --linha:#ccd8e6; --margem:#b6463c; }
  @media (prefers-color-scheme: dark) {
    :root { --papel:#131a24; --ficha:#1a222e; --tinta:#dde5ef; --fraca:#93a2b8;
            --linha:#2c3949; --margem:#e4796d; }
  }
  * { box-sizing:border-box }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         background:var(--papel); color:var(--tinta); padding:1.5rem;
         font:17px/1.6 system-ui, sans-serif }
  form { width:100%; max-width:22rem; background:var(--ficha);
         border:1px solid var(--linha); border-radius:3px; padding:1.6rem }
  h1 { font-size:1.15rem; letter-spacing:-.02em; margin:0 0 1.3rem;
       display:flex; align-items:center; gap:.5rem }
  h1::before { content:""; width:3px; height:1em; background:var(--margem) }
  label { display:block; font-size:.7rem; text-transform:uppercase;
          letter-spacing:.14em; color:var(--fraca); margin-bottom:.4rem }
  input { width:100%; font:inherit; padding:.7rem .9rem; color:inherit;
          background:var(--papel); border:1px solid var(--linha); border-radius:3px }
  button { width:100%; margin-top:1rem; font:inherit; font-weight:700;
           padding:.75rem; border:0; border-radius:3px; cursor:pointer;
           background:var(--tinta); color:var(--ficha) }
  p { margin:1rem 0 0; font-size:.88rem; color:var(--margem);
      border-left:2px solid var(--margem); padding-left:.7rem }
  :focus-visible { outline:2px solid var(--margem); outline-offset:2px }
</style>
</head>
<body>
  <form method="POST" action="/entrar">
    <h1>Receitas da Mamãe</h1>
    <label for="senha">Senha da família</label>
    <input id="senha" name="senha" type="password" autocomplete="current-password"
           autofocus required>
    <button type="submit">Entrar</button>
    ${erro ? `<p>${erro}</p>` : ""}
  </form>
</body>
</html>`;
}
