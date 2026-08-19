import { useState } from "react";

const TIPOS = [
  ["foto", "Foto do caderno"],
  ["documento", "Documento (PDF, Word…)"],
  ["texto", "Digitar a receita"],
  ["link", "Link de um site"],
];

/** Tipos que mandam arquivo em vez de texto, com a configuração de cada um. */
const ARQUIVO = {
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

const MB = 1024 * 1024;

// Espelham LIMITE_TOTAL e LIMITE_ARQUIVOS no worker.js.
const LIMITE_TOTAL = 25;
const LIMITE_ARQUIVOS = 6;

const emMB = (bytes) => `${(bytes / MB).toFixed(1).replace(".", ",")} MB`;

/** A queixa sobre os arquivos escolhidos, ou null se estiver tudo bem. */
function conferir(arquivos, limite) {
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
function lerBase64(arquivo) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error(`não consegui ler ${arquivo.name}`));
    leitor.onload = () => resolve(String(leitor.result).split(",")[1]);
    leitor.readAsDataURL(arquivo);
  });
}

export default function Enviar() {
  const [tipo, setTipo] = useState("foto");
  const [conteudo, setConteudo] = useState("");
  const [titulo, setTitulo] = useState("");
  const [notas, setNotas] = useState("");
  const [arquivos, setArquivos] = useState([]);

  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState(null);

  const config = ARQUIVO[tipo];

  /** Trocar de tipo limpa os arquivos: PDF não vale como foto e vice-versa. */
  function trocarTipo(novo) {
    setTipo(novo);
    setArquivos([]);
    setErro(null);
  }

  function escolher(lista, limite) {
    const escolhidos = [...lista];
    setArquivos(escolhidos);
    setErro(conferir(escolhidos, limite));
  }

  async function enviar(evento) {
    evento.preventDefault();

    // Antes de ler qualquer arquivo: montar 25 MB de base64 para depois tomar
    // 413 do servidor é trabalho jogado fora, e no celular demora.
    if (config) {
      const problema = conferir(arquivos, config.limite);
      if (problema) {
        setErro(problema);
        return;
      }
    }

    setEnviando(true);
    setErro(null);

    try {
      const anexos = await Promise.all(
        arquivos.map(async (a) => ({
          nome: a.name,
          tipo: a.type,
          base64: await lerBase64(a),
        })),
      );

      const resposta = await fetch("/api/receita", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tipo,
          conteudo,
          titulo,
          notas,
          fotos: tipo === "foto" ? anexos : [],
          documentos: tipo === "documento" ? anexos : [],
        }),
      });

      const dados = await resposta.json();
      if (!resposta.ok) throw new Error(dados.erro || "falhou ao enviar");

      setResultado(dados);
      setConteudo("");
      setTitulo("");
      setNotas("");
      setArquivos([]);
    } catch (e) {
      setErro(e.message);
    } finally {
      setEnviando(false);
    }
  }

  if (resultado) {
    return (
      <>
        <a className="voltar btn btn-ghost" href="#/">
          ← todas as receitas
        </a>
        <h1 className="titulo">Recebido</h1>
        <p className="internet-aviso">
          Entrou na fila como issue #{resultado.issue}. Ela fica lá até o
          computador ligar; quando o worker processar, a receita aparece aqui.
        </p>
        <p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setResultado(null)}
          >
            mandar outra
          </button>
        </p>
      </>
    );
  }

  return (
    <>
      <a className="voltar btn btn-ghost" href="#/">
        ← todas as receitas
      </a>
      <h1 className="titulo">Mandar uma receita</h1>

      <form className="formulario" onSubmit={enviar}>
        <fieldset className="campo">
          <legend className="secao-titulo">Como você vai mandar</legend>
          <ul className="tags">
            {TIPOS.map(([valor, rotulo]) => (
              <li key={valor}>
                <button
                  type="button"
                  className="tag"
                  aria-pressed={tipo === valor}
                  onClick={() => trocarTipo(valor)}
                >
                  {rotulo}
                </button>
              </li>
            ))}
          </ul>
        </fieldset>

        {config ? (
          <label className="campo">
            <span className="secao-titulo">{config.rotulo}</span>
            <input
              className="busca"
              type="file"
              accept={config.aceita}
              multiple
              onChange={(e) => escolher(e.target.files, config.limite)}
            />
            <span className="dica">
              {config.dica} Até {config.limite} MB cada, {LIMITE_TOTAL} MB no
              total.
            </span>
            {arquivos.length > 0 && (
              <ul className="arquivos-escolhidos">
                {arquivos.map((a) => (
                  <li key={`${a.name}-${a.size}`}>
                    <span>{a.name}</span>
                    <span>{emMB(a.size)}</span>
                  </li>
                ))}
              </ul>
            )}
          </label>
        ) : (
          <label className="campo">
            <span className="secao-titulo">
              {tipo === "link" ? "Endereço da receita" : "A receita"}
            </span>
            <textarea
              className="busca"
              rows={tipo === "link" ? 2 : 10}
              value={conteudo}
              onChange={(e) => setConteudo(e.target.value)}
              placeholder={
                tipo === "link"
                  ? "https://..."
                  : "Ingredientes e modo de preparo, do jeito que estiver."
              }
              required
            />
          </label>
        )}

        <label className="campo">
          <span className="secao-titulo">Nome da receita</span>
          <input
            className="busca"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Se souber. Senão eu sugiro um."
          />
        </label>

        <label className="campo">
          <span className="secao-titulo">Observações</span>
          <textarea
            className="busca"
            rows={3}
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="A vó usava banha no lugar do óleo."
          />
        </label>

        {erro && <p className="aviso-erro">{erro}</p>}

        <button
          className="enviar"
          type="submit"
          disabled={enviando || (Boolean(config) && arquivos.length === 0)}
        >
          {enviando ? "Enviando…" : "Mandar para a fila"}
        </button>
      </form>
    </>
  );
}
