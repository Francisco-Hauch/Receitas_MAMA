/**
 * Lê os JSONs que o worker gravou.
 *
 * import.meta.glob é do Vite: no build ele troca isto pelo conteúdo dos
 * arquivos, embutido no bundle. Não há requisição em tempo de execução, então
 * o site funciona em qualquer hospedagem estática e não precisa de servidor.
 * O preço é que publicar receita nova exige rebuild — que é exatamente o que
 * o Cloudflare Pages faz sozinho a cada push.
 */

const receitasCruas = import.meta.glob("../../data/receitas/*.json", {
  eager: true,
  import: "default",
});

const complementosCrus = import.meta.glob("../../data/complementos/*.json", {
  eager: true,
  import: "default",
});

/**
 * As fotos entram no build do mesmo jeito, mas o que volta é a URL do arquivo
 * (o Vite copia para `assets/` com hash no nome) — não o conteúdo.
 */
const fotosCruas = import.meta.glob("../../data/fotos/*.{png,jpg,jpeg,webp}", {
  eager: true,
  import: "default",
  query: "?url",
});

/** "../../data/receitas/0001-pasta-de-alho.json" -> "0001-pasta-de-alho" */
function idDoCaminho(caminho) {
  return caminho.split("/").pop().replace(/\.json$/, "");
}

// Indexa os complementos pelo número da issue: é a chave que liga as duas
// passadas do worker, e ela não muda quando o título muda.
const porIssue = new Map(
  Object.values(complementosCrus).map((c) => [c.issue, c]),
);

/**
 * Indexa as fotos pelo número que abre o nome do arquivo — `0003-2.png` é a
 * segunda foto da receita `0003-…`. É o número da issue com zeros à esquerda,
 * então a ligação sobrevive a mudança de título.
 *
 * Ordem: número maior é foto mais recente e vem primeiro. Quem chama conta com
 * isso — `fotos[0]` é a que vai grande no topo da receita e no card da lista.
 */
const fotosPorPrefixo = new Map();
for (const [caminho, url] of Object.entries(fotosCruas)) {
  const nome = caminho.split("/").pop();
  const partes = nome.match(/^(\d+)-(\d+)\./);
  if (!partes) continue;
  const [, prefixo, ordem] = partes;
  const lista = fotosPorPrefixo.get(prefixo) ?? [];
  lista.push({ url, ordem: Number(ordem), id: nome });
  fotosPorPrefixo.set(prefixo, lista);
}
for (const lista of fotosPorPrefixo.values()) {
  lista.sort((a, b) => b.ordem - a.ordem);
}

export const receitas = Object.entries(receitasCruas)
  .map(([caminho, receita]) => {
    const id = idDoCaminho(caminho);
    return {
      ...receita,
      id,
      complemento: porIssue.get(receita.issue) ?? null,
      // sempre array: a lista e a receita iteram sem checar nulo antes
      fotos: fotosPorPrefixo.get(id.split("-")[0]) ?? [],
    };
  })
  .sort((a, b) => a.titulo.localeCompare(b.titulo, "pt-BR"));

export const tags = [...new Set(receitas.flatMap((r) => r.tags))].sort((a, b) =>
  a.localeCompare(b, "pt-BR"),
);

export function acharReceita(id) {
  return receitas.find((r) => r.id === id) ?? null;
}

// Marcas de acento que o NFD separou da letra (U+0300 a U+036F).
const ACENTOS = /[\u0300-\u036f]/g;

/** Busca por nome, tag ou ingrediente: sem acento e sem caixa. */
export function normalizar(texto) {
  return texto
    .normalize("NFD")
    .replace(ACENTOS, "")
    .toLowerCase();
}

export function filtrar(termo, tag) {
  const busca = normalizar(termo.trim());

  return receitas.filter((r) => {
    if (tag && !r.tags.includes(tag)) return false;
    if (!busca) return true;

    const alvo = normalizar(
      [r.titulo, ...r.tags, ...r.ingredientes.map((i) => i.item)].join(" "),
    );
    return alvo.includes(busca);
  });
}
