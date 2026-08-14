import { useState } from "react";

const TIPOS = [
  ["foto", "Foto do caderno"],
  ["texto", "Digitar a receita"],
  ["link", "Link de um site"],
];

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

  async function enviar(evento) {
    evento.preventDefault();
    setEnviando(true);
    setErro(null);

    try {
      const fotos = await Promise.all(
        arquivos.map(async (a) => ({
          tipo: a.type,
          base64: await lerBase64(a),
        })),
      );

      const resposta = await fetch("/api/receita", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tipo, conteudo, titulo, notas, fotos }),
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
                  onClick={() => setTipo(valor)}
                >
                  {rotulo}
                </button>
              </li>
            ))}
          </ul>
        </fieldset>

        {tipo === "foto" ? (
          <label className="campo">
            <span className="secao-titulo">Fotos do caderno</span>
            <input
              className="busca"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/heic"
              multiple
              onChange={(e) => setArquivos([...e.target.files])}
            />
            <span className="dica">
              Pode mandar mais de uma se a receita ocupar duas páginas.
            </span>
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
          disabled={enviando || (tipo === "foto" && arquivos.length === 0)}
        >
          {enviando ? "Enviando…" : "Mandar para a fila"}
        </button>
      </form>
    </>
  );
}
