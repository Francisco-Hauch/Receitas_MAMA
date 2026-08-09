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

/** "../../data/receitas/0001-pasta-de-alho.json" -> "0001-pasta-de-alho" */
function idDoCaminho(caminho) {
  return caminho.split("/").pop().replace(/\.json$/, "");
}

// Indexa os complementos pelo número da issue: é a chave que liga as duas
// passadas do worker, e ela não muda quando o título muda.
const porIssue = new Map(
  Object.values(complementosCrus).map((c) => [c.issue, c]),
);

export const receitas = Object.entries(receitasCruas)
  .map(([caminho, receita]) => ({
    ...receita,
    id: idDoCaminho(caminho),
    complemento: porIssue.get(receita.issue) ?? null,
  }))
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
