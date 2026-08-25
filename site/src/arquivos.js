/**
 * O que os dois pontos de envio sabem sobre arquivo.
 *
 * Existem duas zonas de arraste no site e elas não fazem a mesma coisa:
 *
 * - a da home (`Enviar.jsx`) manda **a receita** — foto do caderno, PDF, Word;
 * - a da receita (`Momentos.jsx`) manda **foto de momento** para uma receita
 *   que já existe.
 *
 * O que elas compartilham é isto aqui: descobrir o tipo pelo arquivo, conferir
 * limite e ler em base64. O que NÃO compartilham está dito em `encolher()`.
 */

export const MB = 1024 * 1024;

// Espelham LIMITE_TOTAL e LIMITE_ARQUIVOS no worker.js.
export const LIMITE_TOTAL = 25;
export const LIMITE_ARQUIVOS = 6;

/** Tipos que mandam arquivo em vez de texto, com a configuração de cada um. */
export const ARQUIVO = {
  foto: {
    rotulo: "Fotos do caderno",
    dica: "Pode mandar mais de uma se a receita ocupar duas páginas.",
    aceita: "image/png,image/jpeg,image/webp,image/heic",
    // Espelha LIMITE_FOTO no worker.js. Conferir aqui é cortesia: quem recusa
    // de verdade é o servidor, mas descobrir o excesso depois de subir 20 MB
    // pelo celular é castigo desnecessário.
    limite: 8,
  },
  documento: {
    rotulo: "Documentos da receita",
    dica: "PDF, Word (.docx) ou texto (.txt, .md). Pode mandar mais de um.",
    aceita:
      ".pdf,.docx,.txt,.md,application/pdf," +
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
      "text/plain,text/markdown",
    // Espelha LIMITE_DOCUMENTO no worker.js.
    limite: 10,
  },
};

/** O que a zona da home aceita, somando os dois tipos de arquivo. */
export const ACEITA_TUDO = `${ARQUIVO.foto.aceita},${ARQUIVO.documento.aceita}`;

/** O que a zona da receita aceita. `image/*` para o seletor do celular abrir
 *  a câmera e a galeria juntas — lá ninguém quer escolher formato. */
export const ACEITA_IMAGEM = "image/*";

const EXT_FOTO = [".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif"];
const EXT_DOCUMENTO = [".pdf", ".docx", ".txt", ".md"];

export const emMB = (bytes) => `${(bytes / MB).toFixed(1).replace(".", ",")} MB`;

/** Tamanho para o olho humano: recado de celular em MB vira "0,0 MB". */
export const tamanho = (bytes) =>
  bytes < 0.1 * MB ? `${Math.max(1, Math.round(bytes / 1024))} KB` : emMB(bytes);

const termina = (nome, extensoes) =>
  extensoes.some((e) => nome.toLowerCase().endsWith(e));

/**
 * "foto", "documento" ou null — o arquivo é que diz o tipo do envio.
 *
 * O `type` do navegador é a primeira palavra, mas não é confiável: HEIC do
 * iPhone e .md costumam chegar com type vazio. Por isso a extensão decide no
 * empate.
 */
export function tipoDoArquivo(arquivo) {
  if (arquivo.type.startsWith("image/")) return "foto";
  if (
    arquivo.type === "application/pdf" ||
    arquivo.type.startsWith("text/") ||
    arquivo.type.includes("wordprocessingml")
  ) {
    return "documento";
  }
  if (termina(arquivo.name, EXT_FOTO)) return "foto";
  if (termina(arquivo.name, EXT_DOCUMENTO)) return "documento";
  return null;
}

/** A queixa sobre os arquivos escolhidos, ou null se estiver tudo bem. */
export function conferir(arquivos, limite) {
  if (arquivos.length > LIMITE_ARQUIVOS) {
    return `São ${arquivos.length} arquivos; o limite é ${LIMITE_ARQUIVOS} por receita.`;
  }

  const grande = arquivos.find((a) => a.size > limite * MB);
  if (grande) {
    return `"${grande.name}" tem ${emMB(grande.size)} e o limite por arquivo é ${limite} MB.`;
  }

  const total = arquivos.reduce((soma, a) => soma + a.size, 0);
  if (total > LIMITE_TOTAL * MB) {
    return `Os arquivos somam ${emMB(total)} e o limite é ${LIMITE_TOTAL} MB. Mande em duas vezes.`;
  }

  return null;
}

/** Lê o arquivo como base64 puro (sem o "data:image/png;base64," na frente). */
export function lerBase64(arquivo, nome = arquivo.name) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error(`não consegui ler ${nome}`));
    leitor.onload = () => resolve(String(leitor.result).split(",")[1]);
    leitor.readAsDataURL(arquivo);
  });
}

/** Identidade estável de um arquivo, para key e para não repetir no monte. */
export const chave = (a) => `${a.name}-${a.size}-${a.lastModified}`;

/* --------------------------------------------------------------- encolher */

/** Maior lado depois de encolher. Acima disso ninguém enxerga diferença numa
 *  galeria de 86px e num visor de tela cheia. */
const LADO_MAX = 2000;
const QUALIDADE = 0.82;

/**
 * Reduz e converte a foto para WebP **antes** de subir. Vale por três motivos:
 *
 * 1. **HEIC.** O site só varre `png,jpg,jpeg,webp` no `dados.js`. Uma foto de
 *    iPhone subiria e nunca apareceria — e o navegador nem sabe desenhá-la.
 *    Convertendo aqui, o formato que chega ao repositório é sempre um que o
 *    site mostra. Se este navegador não souber abrir o arquivo, é melhor
 *    recusar na cara da pessoa do que guardar algo invisível.
 * 2. **Peso.** Foto de celular tem 4 MB; encolhida fica em centenas de KB. O
 *    envio pelo 4G da cozinha deixa de ser uma aposta, e o repositório não
 *    engorda para sempre.
 * 3. **Rotação.** `imageOrientation: "from-image"` gasta o EXIF ao desenhar,
 *    então a foto deitada do iPhone chega em pé.
 *
 * Isto é SÓ para foto de momento. A foto do caderno que vem pela home continua
 * subindo como veio: ela é o bruto da transcrição, e o worker do PC relê esse
 * arquivo quando o prompt melhora. Encolher o bruto seria perder original.
 */
export async function encolher(arquivo) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
  } catch {
    throw new Error(
      `não consegui abrir "${arquivo.name}" neste navegador. ` +
        "Se veio de iPhone, mande em JPG (Ajustes → Câmera → Formatos → Mais Compatível).",
    );
  }

  const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height));
  const largura = Math.max(1, Math.round(bitmap.width * escala));
  const altura = Math.max(1, Math.round(bitmap.height * escala));

  const tela = document.createElement("canvas");
  tela.width = largura;
  tela.height = altura;
  tela.getContext("2d").drawImage(bitmap, 0, 0, largura, altura);
  bitmap.close?.();

  const desenhar = (tipo) =>
    new Promise((pronto) => tela.toBlob(pronto, tipo, QUALIDADE));

  // toBlob com formato que o navegador não conhece devolve PNG calado — daí a
  // conferência do tipo em vez de confiar no pedido.
  let blob = await desenhar("image/webp");
  if (!blob || blob.type !== "image/webp") blob = await desenhar("image/jpeg");
  if (!blob) throw new Error(`não consegui converter "${arquivo.name}"`);

  const extensao = blob.type === "image/webp" ? "webp" : "jpg";
  const nome = `${arquivo.name.replace(/\.[^.]+$/, "")}.${extensao}`;

  return { nome, tipo: blob.type, blob, bytes: blob.size };
}
