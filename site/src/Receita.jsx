import { useMemo, useState } from "react";

import { receitas } from "./dados.js";

/** Marcar ingrediente usado / passo feito. Some ao sair da página, de propósito:
 *  é para uma sessão de cozinha, não é estado que valha guardar. */
function useMarcados() {
  const [marcados, setMarcados] = useState(() => new Set());

  const alternar = (chave) =>
    setMarcados((antes) => {
      const novo = new Set(antes);
      novo.has(chave) ? novo.delete(chave) : novo.add(chave);
      return novo;
    });

  return [marcados, alternar];
}

function quantidade(ing) {
  if (ing.qtd == null) return "a gosto";
  // 4.0 -> "4", 0.5 -> "0,5"
  const numero = Number.isInteger(ing.qtd)
    ? String(ing.qtd)
    : String(ing.qtd).replace(".", ",");
  // "4 unidade" para dentes de alho lê mal; o próprio ingrediente já diz o quê
  if (!ing.unidade || ing.unidade === "unidade") return numero;
  return `${numero} ${ing.unidade}`;
}

/** Dificuldade derivada do número de passos — sinal honesto, não inventado. */
function dificuldade(passos) {
  if (passos.length <= 4) return "Fácil";
  if (passos.length <= 7) return "Média";
  return "Elaborada";
}

// Placeholders estáticos (demonstração): o back-end ainda não guarda fotos de
// quem cozinhou nem recados. Ficam marcados como demo até existir suporte real.
const ENVIOS_DEMO = ["Cláudia", "Renato", "Bia", "Dona Alzira"];
const RECADOS_DEMO = [
  {
    autor: "Cláudia",
    quando: "há 2 dias",
    texto:
      "Fiz para o aniversário da minha filha e acabou antes do bolo. Segui à risca e deu certo.",
  },
  {
    autor: "Dona Alzira",
    quando: "há um mês",
    texto: "Aprendi o ponto aqui. Mudou tudo, nunca mais errei.",
  },
];

export default function Receita({ receita }) {
  const c = receita.complemento;

  const [usados, alternarUsado] = useMarcados();
  const [feitos, alternarFeito] = useMarcados();

  // sugestão indexada pelo passo que ela comenta — é o "indice" que o worker
  // gravou que permite ancorar a nota no lugar certo
  const notasPorPasso = useMemo(() => {
    const mapa = new Map();
    for (const p of c?.passos_detalhados ?? []) {
      if (p.indice >= 0 && p.indice < receita.passos.length) {
        mapa.set(p.indice, p.detalhe);
      }
    }
    return mapa;
  }, [c, receita.passos.length]);

  // Ficha do topo: valor real (da mamãe) ou, na falta, o que a internet sugeriu.
  const tempo = receita.tempo_min
    ? [`${receita.tempo_min} min`, false]
    : c?.tempo_min
      ? [`${c.tempo_min} min`, true]
      : ["—", false];
  const serve = receita.porcoes
    ? [`${receita.porcoes} porções`, false]
    : c?.porcoes
      ? [`${c.porcoes} porções`, true]
      : ["—", false];

  const outras = useMemo(
    () => receitas.filter((r) => r.id !== receita.id).slice(0, 4),
    [receita.id],
  );

  const temSugestoes =
    c &&
    ((c.ingredientes_ausentes?.length ?? 0) > 0 ||
      (c.dicas?.length ?? 0) > 0 ||
      (c.fontes?.length ?? 0) > 0);

  return (
    <article className="receita">
      <a className="voltar btn btn-ghost" href="#/">
        ← todas as receitas
      </a>

      <div className="receita-hero">
        <div>
          <div className="kicker">{receita.tags[0] ?? "Receita da casa"}</div>
          <h1 className="titulo">{receita.titulo}</h1>
          {receita.notas && <p className="receita-resumo">{receita.notas}</p>}
          <div className="stats">
            <div>
              <div className="stat-rotulo">Tempo</div>
              <div className={`stat-valor${tempo[1] ? " sugerido" : ""}`}>
                {tempo[0]}
              </div>
            </div>
            <div>
              <div className="stat-rotulo">Serve</div>
              <div className={`stat-valor${serve[1] ? " sugerido" : ""}`}>
                {serve[0]}
              </div>
            </div>
            <div>
              <div className="stat-rotulo">Dificuldade</div>
              <div className="stat-valor">{dificuldade(receita.passos)}</div>
            </div>
            {c?.temperatura_c && (
              <div>
                <div className="stat-rotulo">Forno</div>
                <div className="stat-valor sugerido">{c.temperatura_c} °C</div>
              </div>
            )}
          </div>
        </div>
        <div className="plate receita-foto">
          <span className="plate-ph">{receita.titulo}</span>
        </div>
      </div>

      <hr className="hr" />

      <div className="receita-grid">
        <div className="receita-main">
          <h6 className="secao-titulo">
            Ingredientes · {receita.ingredientes.length} itens
          </h6>
          <ul className="ingredientes">
            {receita.ingredientes.map((ing, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="ingrediente"
                  data-usado={usados.has(i)}
                  aria-pressed={usados.has(i)}
                  onClick={() => alternarUsado(i)}
                >
                  <span className="quantidade">{quantidade(ing)}</span>
                  <span className="item">{ing.bruto}</span>
                </button>
              </li>
            ))}
          </ul>

          <h6 className="secao-titulo">
            Modo de preparo · {receita.passos.length} passos
          </h6>
          <p className="secao-lede">
            Ao lado de cada etapa, o que a internet costuma recomendar.
          </p>
          <ol className="passos">
            {receita.passos.map((passo, i) => (
              <li className="passo" key={i}>
                <button
                  type="button"
                  className="passo-corpo"
                  data-feito={feitos.has(i)}
                  aria-pressed={feitos.has(i)}
                  onClick={() => alternarFeito(i)}
                >
                  <span className="passo-texto">{passo}</span>
                </button>

                {notasPorPasso.has(i) && (
                  <aside className="nota">
                    <span className="nota-rotulo">da internet</span>
                    <p className="nota-texto">{notasPorPasso.get(i)}</p>
                  </aside>
                )}
              </li>
            ))}
          </ol>
        </div>

        <aside className="receita-lado">
          <h6 className="secao-titulo">Últimas fotos enviadas</h6>
          <div className="demo-zona" aria-hidden="true" style={{ minHeight: 84 }}>
            <div className="text-muted" style={{ fontSize: "12px" }}>
              Arraste aqui a foto do seu prato
            </div>
          </div>
          <div className="galeria">
            {ENVIOS_DEMO.map((nome) => (
              <figure key={nome}>
                <div className="plate">
                  <span className="plate-ph">{nome[0]}</span>
                </div>
                <figcaption>Foto de {nome}</figcaption>
              </figure>
            ))}
          </div>
          <p style={{ marginTop: "10px" }}>
            <span className="demo-selo">demonstração</span>
          </p>

          {outras.length > 0 && (
            <>
              <hr className="hr" />
              <h6 className="secao-titulo">Nesta cozinha também</h6>
              <div className="outras">
                {outras.map((o) => {
                  const t = o.tempo_min ?? o.complemento?.tempo_min ?? null;
                  return (
                    <a className="outra" key={o.id} href={`#/${o.id}`}>
                      <span className="outra-titulo">{o.titulo}</span>
                      {t && <span className="outra-tempo">{t} min</span>}
                    </a>
                  );
                })}
              </div>
            </>
          )}
        </aside>
      </div>

      {temSugestoes && (
        <>
          <hr className="hr" />
          <section className="internet">
            <h2 className="internet-titulo">Dicas da internet</h2>
            <p className="internet-aviso">
              Nada aqui faz parte da receita original. Veio de busca na web e
              pode estar errado.
            </p>

            {c.ingredientes_ausentes?.length > 0 && (
              <ul className="sugestoes">
                {c.ingredientes_ausentes.map((ing) => (
                  <li key={ing.item}>
                    <strong>{ing.item}</strong> — {ing.motivo}
                  </li>
                ))}
              </ul>
            )}

            {c.dicas?.length > 0 && (
              <div className="dicas-grid">
                {c.dicas.map((dica) => (
                  <div className="card dica-card" key={dica}>
                    <div className="card-kicker">da internet</div>
                    <p className="dica-texto">{dica}</p>
                  </div>
                ))}
              </div>
            )}

            {c.fontes?.length > 0 && (
              <ul className="fontes">
                {c.fontes.map((f) => (
                  <li key={f.url}>
                    {f.aviso && (
                      <span className="nao-verificada" title={f.aviso}>
                        não verificada
                      </span>
                    )}
                    <a href={f.url} target="_blank" rel="noreferrer noopener">
                      {f.titulo || f.url}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <hr className="hr" />

      <section className="recados">
        <div className="recados-grid">
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: "12px",
                marginBottom: "4px",
              }}
            >
              <h2 style={{ fontWeight: 400, margin: 0 }}>Recados de quem fez</h2>
              <span className="demo-selo">demonstração</span>
            </div>
            <p className="internet-aviso">
              Exemplo de como os recados apareceriam — ainda sem envio real.
            </p>
            <div>
              {RECADOS_DEMO.map((r) => (
                <div className="recado" key={r.autor}>
                  <div className="recado-cab">
                    <span className="recado-autor">{r.autor}</span>
                    <span className="recado-quando">{r.quando}</span>
                  </div>
                  <p className="recado-texto">{r.texto}</p>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="field" style={{ marginBottom: "12px" }}>
              <label>Seu nome</label>
              <input className="busca" placeholder="Como quer aparecer" disabled />
            </div>
            <div className="field">
              <label>Deixe um recado</label>
              <textarea className="busca" placeholder="Fiz hoje e…" disabled />
            </div>
            <button className="enviar btn-block" type="button" disabled>
              Enviar recado
            </button>
            <p className="text-muted" style={{ fontSize: "11.5px", marginTop: "12px" }}>
              Só a mãe publica receitas. Recados e fotos ficariam com ela para
              aprovar antes de aparecer.
            </p>
          </div>
        </div>
      </section>

      <footer className="transcricao">
        <p>
          Transcrito da issue #{receita.issue}
          {receita.confianca < 0.8 &&
            ` · leitura incerta (${receita.confianca.toFixed(2)})`}
        </p>
      </footer>
    </article>
  );
}
