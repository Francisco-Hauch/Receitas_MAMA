/**
 * A parte servidor do site: recebe o formulário e cria a issue no GitHub.
 *
 * O mesmo Worker que entrega os arquivos estáticos atende esta rota — é a razão
 * de o projeto estar em Workers e não em Pages. O `run_worker_first` no
 * wrangler.jsonc é o que faz /api/* chegar aqui em vez de virar index.html.
 *
 * O token do GitHub vive como secret na Cloudflare e NUNCA sai daqui. O
 * navegador fala só com este Worker; quem fala com o GitHub é ele.
 *
 * Quem pode chamar: o Cloudflare Access, na frente do site inteiro. Sem o
 * Access ligado, esta rota fica aberta para quem souber o endereço.
 */

import {
  criarSessao,
  encerrarSessao,
  paginaLogin,
  senhaConfere,
  sessaoValida,
} from "./autenticar.js";

const CAMINHO = "/api/receita";
const LOGIN = "/entrar";
const SAIR = "/sair";

const TIPOS_ACEITOS = new Set(["foto", "audio", "link", "texto"]);
const SEM_RESPOSTA = "_No response_";

// Base64 incha ~33%; 8 MB de arquivo viram ~11 MB de texto.
const LIMITE_FOTO = 8 * 1024 * 1024;
const LIMITE_FOTOS = 6;

const EXTENSOES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/heic": "heic",
};

const json = (dados, status = 200) =>
  new Response(JSON.stringify(dados), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

async function github(env, caminho, opcoes = {}) {
  const resposta = await fetch(
    `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}${caminho}`,
    {
      ...opcoes,
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "receitas-mamae",
        "content-type": "application/json",
        ...opcoes.headers,
      },
    },
  );

  if (!resposta.ok) {
    const detalhe = await resposta.text();
    throw new Error(`GitHub ${resposta.status}: ${detalhe.slice(0, 300)}`);
  }
  return resposta.json();
}

/**
 * Monta o corpo NO MESMO formato que o Issue Form do GitHub renderiza.
 *
 * Isto não é estética: o parser.py fatia o texto pelos "### rótulo", e os
 * rótulos aqui têm que bater com os do .github/ISSUE_TEMPLATE/receita.yml.
 * Mudou lá, muda aqui.
 */
export function corpoDaIssue({ tipo, conteudo, titulo, notas, autor }) {
  const secao = (rotulo, valor) =>
    `### ${rotulo}\n\n${valor && valor.trim() ? valor.trim() : SEM_RESPOSTA}\n`;

  return [
    secao("Tipo de entrada", tipo),
    secao("Conteúdo", conteudo),
    secao("Nome da receita", titulo),
    secao("Observações", notas),
    // campo extra: o parser devolve, o worker ignora, e fica o registro
    secao("Enviado por", autor),
  ].join("\n");
}

/** Sobe uma foto para data/fotos/ e devolve o nome do arquivo criado. */
async function subirFoto(env, foto, indice) {
  const extensao = EXTENSOES[foto.tipo];
  if (!extensao) throw new Error(`formato não aceito: ${foto.tipo}`);
  if (foto.base64.length > LIMITE_FOTO * 1.4) {
    throw new Error(`imagem ${indice + 1} é grande demais`);
  }

  // Nome único: duas fotos de celular podem se chamar IMG_1234.jpg e uma
  // sobrescreveria a outra.
  const nome = `${crypto.randomUUID().slice(0, 8)}-${indice + 1}.${extensao}`;

  await github(env, `/contents/data/fotos/${nome}`, {
    method: "PUT",
    body: JSON.stringify({
      message: `chore: foto enviada pelo site (${nome})`,
      content: foto.base64,
    }),
  });

  return nome;
}

async function criarReceita(request, env) {
  let corpo;
  try {
    corpo = await request.json();
  } catch {
    return json({ erro: "corpo da requisição não era JSON" }, 400);
  }

  const tipo = String(corpo.tipo || "").trim();
  if (!TIPOS_ACEITOS.has(tipo)) {
    return json({ erro: "escolha um tipo de entrada válido" }, 400);
  }

  const fotos = Array.isArray(corpo.fotos) ? corpo.fotos : [];
  if (fotos.length > LIMITE_FOTOS) {
    return json({ erro: `no máximo ${LIMITE_FOTOS} fotos por receita` }, 400);
  }

  const texto = String(corpo.conteudo || "").trim();
  if (!texto && fotos.length === 0) {
    return json({ erro: "escreva a receita ou anexe uma foto" }, 400);
  }

  // O Access põe o e-mail de quem entrou neste cabeçalho.
  const autor = request.headers.get("cf-access-authenticated-user-email") || "";

  let conteudo = texto;
  try {
    if (fotos.length) {
      const nomes = [];
      for (const [indice, foto] of fotos.entries()) {
        nomes.push(await subirFoto(env, foto, indice));
      }
      // O worker local acha esses nomes em data/fotos/ depois de sincronizar.
      conteudo = [texto, ...nomes].filter(Boolean).join("\n");
    }

    const titulo = String(corpo.titulo || "").trim();
    const issue = await github(env, "/issues", {
      method: "POST",
      body: JSON.stringify({
        title: `[receita] ${titulo || "sem título"}`,
        body: corpoDaIssue({
          tipo,
          conteudo,
          titulo,
          notas: corpo.notas,
          autor,
        }),
        labels: ["receita", "status:novo"],
      }),
    });

    return json({ issue: issue.number, url: issue.html_url }, 201);
  } catch (e) {
    // A mensagem do GitHub pode conter detalhe demais; o log fica no Cloudflare.
    console.error("falha ao criar receita:", e.message);
    return json({ erro: "não consegui criar a issue no GitHub" }, 502);
  }
}

const html = (corpo, status = 200, cabecalhos = {}) =>
  new Response(corpo, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...cabecalhos },
  });

/** Quantas tentativas de senha esta origem ainda pode gastar. */
async function podeTentar(request, env) {
  // Sem o binding configurado, recusa: um login sem freio de tentativa é pior
  // que um site fora do ar, e o erro fica visível em vez de silencioso.
  if (!env.LIMITE_LOGIN || !env.LIMITE_GLOBAL) return false;

  const ip = request.headers.get("cf-connecting-ip") || "desconhecido";
  const porIp = await env.LIMITE_LOGIN.limit({ key: ip });
  const geral = await env.LIMITE_GLOBAL.limit({ key: "entrar" });

  return porIp.success && geral.success;
}

async function entrar(request, env) {
  if (request.method === "GET") return html(paginaLogin());
  if (request.method !== "POST") return html(paginaLogin(), 405);

  if (!env.SENHA_HASH || !env.SEGREDO_SESSAO) {
    return html(paginaLogin("Servidor sem senha configurada."), 500);
  }
  if (!(await podeTentar(request, env))) {
    return html(paginaLogin("Muitas tentativas. Espere um minuto."), 429);
  }

  const formulario = await request.formData();

  if (!(await senhaConfere(formulario.get("senha"), env))) {
    return html(paginaLogin("Senha incorreta."), 401);
  }

  return new Response(null, {
    status: 303, // 303 força o navegador a trocar o POST por um GET
    headers: { location: "/", "set-cookie": await criarSessao(env) },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === LOGIN) return entrar(request, env);

    if (url.pathname === SAIR) {
      return new Response(null, {
        status: 303,
        headers: { location: LOGIN, "set-cookie": encerrarSessao() },
      });
    }

    // Daqui para baixo, nada sai sem sessão — nem os arquivos do site. O bundle
    // do React traz todas as receitas embutidas, então servi-lo a quem não
    // entrou seria entregar os dados junto com a página.
    if (!(await sessaoValida(request, env))) {
      if (url.pathname.startsWith("/api/")) {
        return json({ erro: "não autenticado" }, 401);
      }
      return new Response(null, { status: 302, headers: { location: LOGIN } });
    }

    if (url.pathname === CAMINHO) {
      if (request.method !== "POST") return json({ erro: "use POST" }, 405);
      if (!env.GITHUB_TOKEN) {
        return json({ erro: "servidor sem GITHUB_TOKEN configurado" }, 500);
      }
      return criarReceita(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ erro: "rota não encontrada" }, 404);
    }

    // autenticado: agora sim o arquivo estático
    return env.ASSETS.fetch(request);
  },
};
