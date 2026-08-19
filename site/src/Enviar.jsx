import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Mandar uma receita.
 *
 * O caminho principal é arrastar: a página é uma zona de arraste grande, e o
 * arquivo é que decide o tipo do envio (imagem → foto do caderno; PDF/Word/txt
 * → documento). Só depois de aceitar o arquivo é que abre o pop-up com o resto
 * do formulário — nome e observações —, para ninguém encarar um formulário em
 * branco antes de ter o que mandar. Digitar a receita ou colar um link
 * continuam existindo, como atalhos abaixo da zona, e abrem o mesmo pop-up.
 */

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

/** O que a zona de arraste aceita, somando os dois tipos de arquivo. */
const ACEITA_TUDO = `${ARQUIVO.foto.aceita},${ARQUIVO.documento.aceita}`;

const MB = 1024 * 1024;

// Espelham LIMITE_TOTAL e LIMITE_ARQUIVOS no worker.js.
const LIMITE_TOTAL = 25;
const LIMITE_ARQUIVOS = 6;

const EXT_FOTO = [".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif"];
const EXT_DOCUMENTO = [".pdf", ".docx", ".txt", ".md"];

const emMB = (bytes) => `${(bytes / MB).toFixed(1).replace(".", ",")} MB`;

/** Tamanho para o olho humano: recado de celular em MB vira "0,0 MB". */
const tamanho = (bytes) =>
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
function tipoDoArquivo(arquivo) {
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

/** Identidade estável de um arquivo, para key e para não repetir no monte. */
const chave = (a) => `${a.name}-${a.size}-${a.lastModified}`;

/** Miniatura da imagem; o endereço temporário morre junto com o componente. */
function Miniatura({ arquivo }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    const endereco = URL.createObjectURL(arquivo);
    setUrl(endereco);
    return () => URL.revokeObjectURL(endereco);
  }, [arquivo]);

  return (
    <span className="miniatura plate">
      {url ? <img src={url} alt="" /> : null}
    </span>
  );
}

export default function Enviar() {
  const [tipo, setTipo] = useState(null);
  const [arquivos, setArquivos] = useState([]);
  const [aberto, setAberto] = useState(false);

  const [conteudo, setConteudo] = useState("");
  const [titulo, setTitulo] = useState("");
  const [notas, setNotas] = useState("");

  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState(null);
  const [erroZona, setErroZona] = useState(null);
  const [arrastando, setArrastando] = useState(false);

  // dragenter/dragleave disparam também ao passar sobre os filhos da zona;
  // contar as entradas evita a borda piscando enquanto o mouse atravessa.
  const profundidade = useRef(0);
  const seletor = useRef(null);
  const fundo = useRef(null);
  const primeiroCampo = useRef(null);

  const config = tipo ? ARQUIVO[tipo] : null;

  const fechar = useCallback(() => {
    setAberto(false);
    setErro(null);
  }, []);

  /** Esc fecha o pop-up e a página atrás dele não rola junto. */
  useEffect(() => {
    if (!aberto) return undefined;

    const aoTeclar = (e) => {
      if (e.key === "Escape") fechar();
    };
    const rolagem = document.body.style.overflow;

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", aoTeclar);
    primeiroCampo.current?.focus();

    return () => {
      document.body.style.overflow = rolagem;
      window.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto, fechar]);

  /**
   * Sem isso, soltar o arquivo um centímetro fora da zona faz o navegador
   * abrir o arquivo e o formulário some junto com o que já foi digitado.
   */
  useEffect(() => {
    const engolir = (e) => e.preventDefault();
    window.addEventListener("dragover", engolir);
    window.addEventListener("drop", engolir);
    return () => {
      window.removeEventListener("dragover", engolir);
      window.removeEventListener("drop", engolir);
    };
  }, []);

  /** Recebe o que veio do arraste ou do seletor e abre o pop-up se der. */
  function receber(lista) {
    const novos = [...lista];
    if (novos.length === 0) return;

    const tipos = new Set(novos.map(tipoDoArquivo));

    if (tipos.has(null)) {
      const estranho = novos.find((a) => tipoDoArquivo(a) === null);
      setErroZona(
        `Não sei o que fazer com "${estranho.name}". Mande foto (PNG, JPG, HEIC) ou documento (PDF, .docx, .txt, .md).`,
      );
      return;
    }

    if (tipos.size > 1) {
      setErroZona(
        "Vieram fotos e documentos no mesmo monte. Mande um tipo de cada vez.",
      );
      return;
    }

    const novoTipo = [...tipos][0];
    const problema = conferir(novos, ARQUIVO[novoTipo].limite);
    if (problema) {
      setErroZona(problema);
      return;
    }

    setTipo(novoTipo);
    setArquivos(novos);
    setErroZona(null);
    setErro(null);
    setAberto(true);
  }

  /** "Digitar a receita" e "Link de um site": mesmo pop-up, sem arquivo. */
  function abrirTexto(novoTipo) {
    setTipo(novoTipo);
    setArquivos([]);
    setErroZona(null);
    setErro(null);
    setAberto(true);
  }

  /** Arquivos somados dentro do pop-up — só do mesmo tipo já escolhido. */
  function somar(lista) {
    const vindos = [...lista];
    const novos = vindos.filter((a) => tipoDoArquivo(a) === tipo);
    const juntos = [...arquivos];

    for (const a of novos) {
      if (!juntos.some((b) => chave(b) === chave(a))) juntos.push(a);
    }

    setArquivos(juntos);

    if (novos.length < vindos.length) {
      setErro(
        tipo === "foto"
          ? "Ignorei o que não era imagem: este envio é de fotos do caderno."
          : "Ignorei o que não era documento: este envio é de PDF, Word ou texto.",
      );
    } else {
      setErro(conferir(juntos, config.limite));
    }
  }

  function remover(alvo) {
    const sobrou = arquivos.filter((a) => chave(a) !== chave(alvo));
    setArquivos(sobrou);
    setErro(sobrou.length > 0 ? conferir(sobrou, config.limite) : null);
  }

  function aoSoltar(evento) {
    evento.preventDefault();
    profundidade.current = 0;
    setArrastando(false);
    receber(evento.dataTransfer.files);
  }

  function aoEntrar(evento) {
    evento.preventDefault();
    profundidade.current += 1;
    setArrastando(true);
  }

  function aoSair() {
    profundidade.current = Math.max(0, profundidade.current - 1);
    if (profundidade.current === 0) setArrastando(false);
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
      setAberto(false);
      setConteudo("");
      setTitulo("");
      setNotas("");
      setArquivos([]);
      setTipo(null);
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

  const semArquivo = Boolean(config) && arquivos.length === 0;
  const semTexto = !config && conteudo.trim() === "";

  return (
    <>
      <a className="voltar btn btn-ghost" href="#/">
        ← todas as receitas
      </a>
      <h1 className="titulo">Mandar uma receita</h1>

      <div
        className="zona"
        data-arrastando={arrastando}
        onDragEnter={aoEntrar}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={aoSair}
        onDrop={aoSoltar}
      >
        {/* no celular ninguém arrasta nada: lá o convite é o botão */}
        <p className="zona-titulo">
          <span className="em-mouse">Arraste a receita para cá</span>
          <span className="em-toque">Mande a receita</span>
        </p>
        <p className="zona-dica">
          Foto do caderno, PDF, Word ou texto — eu descubro o que é pelo próprio
          arquivo. Até {LIMITE_ARQUIVOS} arquivos, {LIMITE_TOTAL} MB no total.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => seletor.current?.click()}
        >
          escolher arquivo
        </button>
        <input
          ref={seletor}
          className="escondido"
          type="file"
          accept={ACEITA_TUDO}
          multiple
          onChange={(e) => {
            receber(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {erroZona && <p className="aviso-erro">{erroZona}</p>}

      <p className="zona-alternativas">
        <span>Sem arquivo?</span>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => abrirTexto("texto")}
        >
          digitar a receita
        </button>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => abrirTexto("link")}
        >
          mandar o link de um site
        </button>
      </p>

      {aberto && (
        <div
          className="modal-fundo"
          ref={fundo}
          onMouseDown={(e) => {
            if (e.target === fundo.current) fechar();
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-titulo"
          >
            <div className="modal-topo">
              <h2 className="modal-titulo" id="modal-titulo">
                {config
                  ? "Quase lá"
                  : tipo === "link"
                    ? "Link da receita"
                    : "Digitar a receita"}
              </h2>
              <button
                type="button"
                className="btn btn-ghost modal-fechar"
                onClick={fechar}
                aria-label="Fechar"
              >
                ×
              </button>
            </div>

            <form className="formulario modal-corpo" onSubmit={enviar}>
              {config ? (
                <div className="campo">
                  <span className="secao-titulo">
                    {config.rotulo} ({arquivos.length})
                  </span>
                  <ul className="arquivos-escolhidos">
                    {arquivos.map((a) => (
                      <li key={chave(a)}>
                        {tipo === "foto" && <Miniatura arquivo={a} />}
                        <span className="arquivo-nome">{a.name}</span>
                        <span className="arquivo-tamanho">
                          {tamanho(a.size)}
                        </span>
                        <button
                          type="button"
                          className="arquivo-remover"
                          onClick={() => remover(a)}
                          aria-label={`Tirar ${a.name}`}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                  <span className="dica">
                    {config.dica} Até {config.limite} MB cada, {LIMITE_TOTAL} MB
                    no total.
                  </span>
                  <label className="btn btn-secondary btn-arquivo">
                    juntar mais
                    <input
                      className="escondido"
                      type="file"
                      accept={config.aceita}
                      multiple
                      onChange={(e) => {
                        somar(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              ) : (
                <label className="campo">
                  <span className="secao-titulo">
                    {tipo === "link" ? "Endereço da receita" : "A receita"}
                  </span>
                  <textarea
                    className="busca"
                    ref={primeiroCampo}
                    rows={tipo === "link" ? 2 : 8}
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
                  ref={config ? primeiroCampo : undefined}
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

              <div className="modal-rodape">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={fechar}
                >
                  cancelar
                </button>
                <button
                  className="enviar"
                  type="submit"
                  disabled={enviando || semArquivo || semTexto}
                >
                  {enviando ? "Enviando…" : "Mandar para a fila"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
