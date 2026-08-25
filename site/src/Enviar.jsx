import { useCallback, useEffect, useRef, useState } from "react";

import { Miniatura, useArrasto } from "./Arrastar.jsx";
import {
  ACEITA_TUDO,
  ARQUIVO,
  LIMITE_ARQUIVOS,
  LIMITE_TOTAL,
  chave,
  conferir,
  lerBase64,
  tamanho,
  tipoDoArquivo,
} from "./arquivos.js";

/**
 * Mandar uma receita — bloco da página principal, não uma tela à parte.
 *
 * O caminho principal é arrastar: a home tem uma zona de arraste grande, e o
 * arquivo é que decide o tipo do envio (imagem → foto do caderno; PDF/Word/txt
 * → documento). Só depois de aceitar o arquivo é que abre o pop-up com o resto
 * do formulário — nome e observações —, para ninguém encarar um formulário em
 * branco antes de ter o que mandar. Digitar a receita ou colar um link
 * continuam existindo, como atalhos abaixo da zona, e abrem o mesmo pop-up.
 *
 * `chamado` é um contador que o App incrementa quando alguém clica em "mandar
 * receita" no cabeçalho: em vez de abrir outra página, a home rola até aqui e
 * a zona pisca. Contador em vez de booleano porque o segundo clique também
 * precisa valer.
 */


export default function Enviar({ chamado = 0 }) {
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
  const [destaque, setDestaque] = useState(false);

  // o gesto em si (contagem de dragenter, arquivo solto fora da zona) mora no
  // hook — é o mesmo da zona de fotos da receita
  const { arrastando, props: arraste } = useArrasto(receber);

  const seletor = useRef(null);
  const fundo = useRef(null);
  const primeiroCampo = useRef(null);
  const secao = useRef(null);

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
   * Chamado do cabeçalho: rolar até a zona e piscar a borda.
   *
   * O quadro seguinte, e não este, porque o App rola a página para o topo ao
   * trocar de rota — se rolasse agora, quem viesse de uma receita voltaria
   * para o topo no instante seguinte.
   */
  useEffect(() => {
    if (!chamado) return undefined;

    const quadro = requestAnimationFrame(() => {
      secao.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      setDestaque(true);
    });
    const relogio = setTimeout(() => setDestaque(false), 1800);

    return () => {
      cancelAnimationFrame(quadro);
      clearTimeout(relogio);
    };
  }, [chamado]);

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
      <section className="envio" ref={secao}>
        <h6 className="secao-titulo">Mandar uma receita</h6>
        <div className="zona">
          <p className="zona-titulo">Recebido</p>
          <p className="zona-dica">
            Entrou na fila como issue #{resultado.issue}. Ela fica lá até o
            computador ligar; quando o worker processar, a receita aparece aqui.
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setResultado(null)}
          >
            mandar outra
          </button>
        </div>
      </section>
    );
  }

  const semArquivo = Boolean(config) && arquivos.length === 0;
  const semTexto = !config && conteudo.trim() === "";

  return (
    <section className="envio" ref={secao}>
      <h6 className="secao-titulo">Mandar uma receita</h6>

      <div
        className="zona"
        data-destaque={destaque}
        data-arrastando={arrastando}
        {...arraste}
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
    </section>
  );
}
