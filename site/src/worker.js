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
  NIVEIS,
  criarSessao,
  encerrarSessao,
  nivelDaSenha,
  nivelDaSessao,
  paginaLogin,
  podeFazer,
  temAlgumaSenha,
} from "./autenticar.js";

const CAMINHO = "/api/receita";
const SESSAO = "/api/sessao";
/** `/api/receita/3/fotos` — acrescentar foto a uma receita que já existe. */
const ROTA_FOTOS = /^\/api\/receita\/(\d+)\/fotos$/;
const LOGIN = "/entrar";
const SAIR = "/sair";

const TIPOS_ACEITOS = new Set(["foto", "audio", "link", "texto", "documento"]);
const SEM_RESPOSTA = "_No response_";

const MB = 1024 * 1024;

// Base64 incha ~33%; 10 MB de arquivo viram ~13 MB de corpo na requisição.
const LIMITE_FOTO = 8 * MB;
const LIMITE_DOCUMENTO = 10 * MB;
// Teto do envio inteiro: o Worker monta tudo em memória, e seis arquivos no
// limite individual somariam bem mais do que cabe com folga.
const LIMITE_TOTAL = 25 * MB;
const LIMITE_ARQUIVOS = 6;

const PASTA_FOTOS = "data/fotos";
const PASTA_DOCUMENTOS = "data/documentos";

const EXTENSOES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/heic": "heic",
};

const EXTENSOES_DOC = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/x-markdown": "md",
};

// O tipo que o navegador manda não basta: para .md ele costuma mandar vazio e
// para .docx, "application/octet-stream" em alguns sistemas. A extensão do nome
// entra como segunda fonte — e como a lista é fechada, confiar no nome aqui não
// abre porta para subir qualquer coisa.
const EXTENSOES_DOC_NOME = new Set(["pdf", "docx", "txt", "md"]);

/** Tamanho real do arquivo a partir do base64, que ocupa 4 bytes a cada 3. */
const bytesDoBase64 = (base64) => Math.floor((base64.length * 3) / 4);

const emMB = (bytes) => `${Math.round(bytes / MB)} MB`;

/** Extensão de um documento aceito, ou null se o formato não serve. */
function extensaoDocumento(documento) {
  const tipo = String(documento?.tipo || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (EXTENSOES_DOC[tipo]) return EXTENSOES_DOC[tipo];

  const doNome = String(documento?.nome || "").split(".").pop().toLowerCase();
  return EXTENSOES_DOC_NOME.has(doNome) ? doNome : null;
}

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

/** Sobe um arquivo para dentro de data/ e devolve o nome criado. */
async function subirArquivo(env, { pasta, extensao, base64 }, indice) {
  // Nome único: duas fotos de celular podem se chamar IMG_1234.jpg e uma
  // sobrescreveria a outra.
  const nome = `${crypto.randomUUID().slice(0, 8)}-${indice + 1}.${extensao}`;

  await github(env, `/contents/${pasta}/${nome}`, {
    method: "PUT",
    body: JSON.stringify({
      message: `chore: arquivo enviado pelo site (${nome})`,
      content: base64,
    }),
  });

  return nome;
}

/**
 * Confere formato e tamanho de tudo que veio, ANTES de subir qualquer coisa.
 *
 * A ordem importa: recusar no meio do lote deixaria os primeiros arquivos
 * commitados no repositório sem issue nenhuma apontando para eles — lixo que
 * ninguém acharia depois.
 *
 * Devolve { anexos } ou { erro, status }.
 */
function conferirArquivos(fotos, documentos) {
  const anexos = [];

  for (const [indice, foto] of fotos.entries()) {
    const extensao = EXTENSOES[String(foto?.tipo || "").toLowerCase()];
    if (!extensao) {
      return {
        erro: `imagem ${indice + 1}: formato não aceito (use JPG, PNG, WEBP ou HEIC)`,
        status: 415,
      };
    }
    anexos.push({
      pasta: PASTA_FOTOS,
      extensao,
      base64: String(foto.base64 || ""),
      rotulo: `imagem ${indice + 1}`,
      limite: LIMITE_FOTO,
    });
  }

  for (const [indice, documento] of documentos.entries()) {
    const extensao = extensaoDocumento(documento);
    if (!extensao) {
      const nome = documento?.nome || `documento ${indice + 1}`;
      return {
        erro: `${nome}: formato não aceito (use PDF, DOCX, TXT ou MD)`,
        status: 415,
      };
    }
    anexos.push({
      pasta: PASTA_DOCUMENTOS,
      extensao,
      base64: String(documento.base64 || ""),
      rotulo: documento?.nome || `documento ${indice + 1}`,
      limite: LIMITE_DOCUMENTO,
    });
  }

  let total = 0;
  for (const anexo of anexos) {
    const bytes = bytesDoBase64(anexo.base64);
    if (bytes > anexo.limite) {
      return {
        erro: `${anexo.rotulo} passa de ${emMB(anexo.limite)}`,
        status: 413,
      };
    }
    total += bytes;
  }

  if (total > LIMITE_TOTAL) {
    return {
      erro: `os arquivos somam mais de ${emMB(LIMITE_TOTAL)}; mande em duas vezes`,
      status: 413,
    };
  }

  return { anexos };
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
  const documentos = Array.isArray(corpo.documentos) ? corpo.documentos : [];

  if (fotos.length + documentos.length > LIMITE_ARQUIVOS) {
    return json(
      { erro: `no máximo ${LIMITE_ARQUIVOS} arquivos por receita` },
      400,
    );
  }

  const texto = String(corpo.conteudo || "").trim();
  if (!texto && fotos.length === 0 && documentos.length === 0) {
    return json(
      { erro: "escreva a receita, anexe uma foto ou mande um documento" },
      400,
    );
  }

  const conferido = conferirArquivos(fotos, documentos);
  if (conferido.erro) return json({ erro: conferido.erro }, conferido.status);

  // O Access põe o e-mail de quem entrou neste cabeçalho.
  const autor = request.headers.get("cf-access-authenticated-user-email") || "";

  let conteudo = texto;
  try {
    if (conferido.anexos.length) {
      const nomes = [];
      for (const [indice, anexo] of conferido.anexos.entries()) {
        nomes.push(await subirArquivo(env, anexo, indice));
      }
      // O worker local acha esses nomes em data/fotos/ e data/documentos/
      // depois de sincronizar.
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

/* ------------------------------------ fotos de uma receita que já existe */

/**
 * Por que esta rota existe separada de `/api/receita`:
 *
 * `/api/receita` **cria** — sobe o arquivo com nome aleatório e abre issue na
 * fila. Serve para receita nova, cujo trabalho (transcrever) exige o Claude no
 * PC de casa. Foto de momento não tem trabalho nenhum a fazer: é só guardar. A
 * fila existe para pensar, não para armazenar — então esta rota commita
 * direto, e a foto não espera o PC de casa ligar às 3h.
 *
 * A associação vem de graça do nome do arquivo: `data/fotos/0003-2.webp` é a
 * segunda foto da receita da issue 3 (ver `dados.js`). O servidor só continua
 * a contagem — e por isso precisa olhar o que já existe antes de escrever.
 */

const PASTA_RECEITAS = "data/receitas";

/** Nomes dentro de uma pasta do repositório; pasta que não existe é lista vazia. */
async function listarPasta(env, pasta) {
  try {
    const itens = await github(env, `/contents/${pasta}`);
    return Array.isArray(itens) ? itens.map((i) => i.name) : [];
  } catch (e) {
    if (String(e.message).includes("GitHub 404")) return [];
    throw e;
  }
}

/**
 * Um único commit com todos os arquivos, pela Git Data API.
 *
 * Um PUT por arquivo (o jeito do `subirArquivo`) custa um commit por arquivo —
 * e cada commit é uma reconstrução do site na Cloudflare. Cinco fotos viravam
 * cinco builds enfileirados, e a pessoa esperando a última.
 *
 * O PATCH da ref vai **sem force**: se alguém commitou nesse meio-tempo (a
 * outra pessoa mandando foto, o worker do PC publicando), o GitHub recusa por
 * não ser fast-forward em vez de apagar o commit do outro. Quem chama tenta de
 * novo, recontando os índices.
 */
async function commitarArquivos(env, arquivos, mensagem) {
  const repo = await github(env, "");
  const ramo = env.GITHUB_BRANCH || repo.default_branch;

  const ref = await github(env, `/git/ref/heads/${ramo}`);
  const base = ref.object.sha;
  const commitBase = await github(env, `/git/commits/${base}`);

  const folhas = [];
  for (const arquivo of arquivos) {
    const blob = await github(env, "/git/blobs", {
      method: "POST",
      body: JSON.stringify({ content: arquivo.base64, encoding: "base64" }),
    });
    folhas.push({
      path: arquivo.caminho,
      mode: "100644",
      type: "blob",
      sha: blob.sha,
    });
  }

  const arvore = await github(env, "/git/trees", {
    method: "POST",
    body: JSON.stringify({ base_tree: commitBase.tree.sha, tree: folhas }),
  });

  const commit = await github(env, "/git/commits", {
    method: "POST",
    body: JSON.stringify({
      message: mensagem,
      tree: arvore.sha,
      parents: [base],
    }),
  });

  await github(env, `/git/refs/heads/${ramo}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha }),
  });

  return commit.sha;
}

/** O ramo andou embaixo de nós — dá para tentar de novo. */
const corridaDeRef = (e) =>
  /GitHub (409|422)/.test(String(e.message));

async function guardarFotos(request, env, numero) {
  let corpo;
  try {
    corpo = await request.json();
  } catch {
    return json({ erro: "corpo da requisição não era JSON" }, 400);
  }

  const fotos = Array.isArray(corpo.fotos) ? corpo.fotos : [];
  if (fotos.length === 0) return json({ erro: "nenhuma foto no envio" }, 400);
  if (fotos.length > LIMITE_ARQUIVOS) {
    return json({ erro: `no máximo ${LIMITE_ARQUIVOS} fotos por vez` }, 400);
  }

  const conferido = conferirArquivos(fotos, []);
  if (conferido.erro) return json({ erro: conferido.erro }, conferido.status);

  // O prefixo é o número da issue com quatro casas — a mesma regra do
  // armazenar.py e do dados.js. Não é enfeite: é a ligação.
  const prefixo = String(numero).padStart(4, "0");

  try {
    // A receita precisa existir. Sem esta conferência, quem souber o endereço
    // planta arquivo com prefixo inventado, que fica órfão em data/fotos para
    // sempre — ninguém vê, ninguém acha, ninguém apaga.
    const receitas = await listarPasta(env, PASTA_RECEITAS);
    const existe = receitas.some(
      (nome) => nome.startsWith(`${prefixo}-`) && nome.endsWith(".json"),
    );
    if (!existe) return json({ erro: "receita não encontrada" }, 404);

    for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
      const nomes = await listarPasta(env, PASTA_FOTOS);
      let proxima = 0;
      for (const nome of nomes) {
        const partes = nome.match(/^(\d+)-(\d+)\./);
        if (partes && partes[1] === prefixo) {
          proxima = Math.max(proxima, Number(partes[2]));
        }
      }

      const criados = conferido.anexos.map((anexo, i) => ({
        ...anexo,
        nome: `${prefixo}-${proxima + i + 1}.${anexo.extensao}`,
      }));
      for (const arquivo of criados) {
        arquivo.caminho = `${PASTA_FOTOS}/${arquivo.nome}`;
      }

      try {
        await commitarArquivos(
          env,
          criados,
          `chore: fotos da receita #${numero} enviadas pelo site`,
        );
        return json({ fotos: criados.map((a) => a.nome) }, 201);
      } catch (e) {
        if (tentativa === 3 || !corridaDeRef(e)) throw e;
        console.warn(`ref andou, tentando de novo (${tentativa}):`, e.message);
      }
    }

    return json({ erro: "não consegui guardar agora; tente de novo" }, 503);
  } catch (e) {
    console.error("falha ao guardar fotos:", e.message);
    return json({ erro: "não consegui guardar a foto no repositório" }, 502);
  }
}

const html = (corpo, status = 200, cabecalhos = {}) =>
  new Response(corpo, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...cabecalhos },
  });

/**
 * Atraso fixo em toda tentativa de senha errada.
 *
 * MEDIDO EM PRODUÇÃO: o binding de rate limit conta por máquina do Cloudflare,
 * não globalmente. Em 15 tentativas seguidas ele barrou uma; em 10 paralelas,
 * três. É amortecedor, não tranca.
 *
 * Este atraso não depende de contador nenhum: cada tentativa errada segura a
 * conexão por um segundo, e isso vale em qualquer máquina. Não custa CPU (a
 * Cloudflare cobra CPU, não tempo de parede), então cabe no plano grátis.
 *
 * Nada disso substitui a senha ser longa. Uma frase de quatro palavras torna a
 * força bruta inviável mesmo sem freio nenhum; uma senha curta cai apesar dele.
 */
const ATRASO_ERRO = 1000;
const esperar = (ms) => new Promise((pronto) => setTimeout(pronto, ms));

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

  if (!temAlgumaSenha(env) || !env.SEGREDO_SESSAO) {
    return html(paginaLogin("Servidor sem senha configurada."), 500);
  }
  if (!(await podeTentar(request, env))) {
    return html(paginaLogin("Muitas tentativas. Espere um minuto."), 429);
  }

  const formulario = await request.formData();
  const nivel = await nivelDaSenha(formulario.get("senha"), env);

  if (!nivel) {
    await esperar(ATRASO_ERRO);
    return html(paginaLogin("Senha incorreta."), 401);
  }

  return new Response(null, {
    status: 303, // 303 força o navegador a trocar o POST por um GET
    headers: { location: "/", "set-cookie": await criarSessao(nivel, env) },
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
    const nivel = await nivelDaSessao(request, env);

    if (!nivel) {
      if (url.pathname.startsWith("/api/")) {
        return json({ erro: "não autenticado" }, 401);
      }
      return new Response(null, { status: 302, headers: { location: LOGIN } });
    }

    // O site pergunta aqui o que pode mostrar. Isto é conveniência de tela:
    // esconder um botão não protege nada, e quem decide de verdade é a checagem
    // logo abaixo, no servidor.
    if (url.pathname === SESSAO) {
      return json({ nivel, rotulo: NIVEIS[nivel].rotulo, pode: NIVEIS[nivel].pode });
    }

    if (url.pathname === CAMINHO) {
      if (request.method !== "POST") return json({ erro: "use POST" }, 405);
      if (!podeFazer(nivel, "enviar")) {
        return json({ erro: "seu acesso é só de leitura" }, 403);
      }
      if (!env.GITHUB_TOKEN) {
        return json({ erro: "servidor sem GITHUB_TOKEN configurado" }, 500);
      }
      return criarReceita(request, env);
    }

    const fotos = url.pathname.match(ROTA_FOTOS);
    if (fotos) {
      if (request.method !== "POST") return json({ erro: "use POST" }, 405);
      if (!podeFazer(nivel, "enviar")) {
        return json({ erro: "seu acesso é só de leitura" }, 403);
      }
      if (!env.GITHUB_TOKEN) {
        return json({ erro: "servidor sem GITHUB_TOKEN configurado" }, 500);
      }
      return guardarFotos(request, env, Number(fotos[1]));
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ erro: "rota não encontrada" }, 404);
    }

    // autenticado: agora sim o arquivo estático
    return env.ASSETS.fetch(request);
  },
};
