import { useMemo, useState } from "react";

import Enviar from "./Enviar.jsx";
import { filtrar, receitas, tags } from "./dados.js";
import { useSessao } from "./sessao.js";

/** Uma linha de meta curta para o card, sempre com dois campos. */
function metaCard(r) {
  const tempo = r.tempo_min ?? r.complemento?.tempo_min ?? null;
  const porcoes = r.porcoes ?? r.complemento?.porcoes ?? null;
  return {
    esquerda: tempo ? `${tempo} min` : `${r.ingredientes.length} ingredientes`,
    direita: porcoes ? `${porcoes} porções` : `${r.passos.length} passos`,
  };
}

/** Inicial da receita, como monograma na moldura da foto (não há foto real). */
function monograma(titulo) {
  return (titulo.trim()[0] ?? "?").toUpperCase();
}

export default function Lista({ chamado = 0 }) {
  const [termo, setTermo] = useState("");
  const [tag, setTag] = useState(null);
  const { podeEnviar } = useSessao();

  const encontradas = useMemo(() => filtrar(termo, tag), [termo, tag]);

  const semReceitas = receitas.length === 0;

  return (
    <>
      <section className="hero">
        <div>
          <div className="kicker">Cozinha de casa · desde sempre</div>
          <h1 className="display">
            As receitas
            <br />
            da Mamãe
          </h1>
        </div>
        <p className="hero-lede">
          Tudo o que ela cozinha há anos, escrito em ordem, com as medidas de
          verdade — colher de sopa, xícara, "até dar o ponto". Cada receita traz
          o tempo, quantas pessoas serve e o que a internet ensina sobre cada
          etapa. Quem faz em casa manda a foto e o recado: ela gosta de ver.
        </p>
      </section>

      <hr className="hr" />

      {/* o envio mora aqui, na página principal: não há mais tela à parte.
          As duas caixas de "demonstração" do mockup viraram esta zona só. */}
      {podeEnviar && <Enviar chamado={chamado} />}

      {semReceitas ? (
        <p className="vazio">
          Nenhuma receita ainda. Abra uma issue no repositório para mandar a
          primeira — o worker processa quando o computador ligar.
        </p>
      ) : (
        <>
          <input
            className="busca"
            type="search"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Buscar por nome ou ingrediente"
            aria-label="Buscar receita"
          />

          {tags.length > 0 && (
            <ul className="tags">
              {tags.map((t) => (
                <li key={t}>
                  <button
                    type="button"
                    className="tag"
                    aria-pressed={tag === t}
                    onClick={() => setTag(tag === t ? null : t)}
                  >
                    {t}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="lista-cabecalho">
            <h2>{tag ? tag : "Todas as receitas"}</h2>
            <span className="text-muted">
              {encontradas.length}
              {encontradas.length === 1 ? " receita" : " receitas"}
            </span>
          </div>

          {encontradas.length === 0 ? (
            <p className="vazio">Nada com esse nome. Tente outra palavra.</p>
          ) : (
            <ul className="lista">
              {encontradas.map((r) => {
                const meta = metaCard(r);
                return (
                  <li key={r.id}>
                    <a className="entrada" href={`#/${r.id}`}>
                      <div className="plate entrada-foto">
                        <span className="plate-ph">{monograma(r.titulo)}</span>
                      </div>
                      <div className="entrada-corpo">
                        <div className="entrada-tags">
                          <span className="tag tag-accent">
                            {r.tags[0] ?? "Receita"}
                          </span>
                          <span className="tag tag-neutral">
                            {r.passos.length} passos
                          </span>
                        </div>
                        <h3 className="entrada-titulo">{r.titulo}</h3>
                        <div className="entrada-meta">
                          <span>{meta.esquerda}</span>
                          <span className="sep" />
                          <span>{meta.direita}</span>
                        </div>
                      </div>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </>
  );
}
