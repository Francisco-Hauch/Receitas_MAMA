import { useMemo, useState } from "react";

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

  const ficha = [];
  if (receita.porcoes) ficha.push([`${receita.porcoes} porções`, false]);
  else if (c?.porcoes) ficha.push([`${c.porcoes} porções`, true]);

  if (receita.tempo_min) ficha.push([`${receita.tempo_min} min`, false]);
  else if (c?.tempo_min) ficha.push([`${c.tempo_min} min`, true]);

  if (c?.temperatura_c) ficha.push([`${c.temperatura_c} °C`, true]);

  const temSugestoes =
    c &&
    ((c.ingredientes_ausentes?.length ?? 0) > 0 ||
      (c.dicas?.length ?? 0) > 0 ||
      (c.fontes?.length ?? 0) > 0);

  return (
    <article>
      <a className="voltar" href="#/">
        ← todas as receitas
      </a>

      <h1 className="titulo">{receita.titulo}</h1>

      <p className="ficha-tecnica">
        <span>{receita.ingredientes.length} ingredientes</span>
        <span>{receita.passos.length} passos</span>
        {ficha.map(([texto, daInternet]) => (
          <span key={texto} className={daInternet ? "sugerido" : undefined}>
            {texto}
            {daInternet && " (sugerido)"}
          </span>
        ))}
      </p>

      <section className="secao secao-recuada">
        <h2 className="secao-titulo">Ingredientes</h2>
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
      </section>

      <section className="secao">
        <h2 className="secao-titulo secao-recuada">Modo de preparo</h2>
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
                  {notasPorPasso.get(i)}
                </aside>
              )}
            </li>
          ))}
        </ol>
      </section>

      {temSugestoes && (
        <section className="internet">
          <div className="internet-cabecalho">
            <h2 className="internet-titulo">Sugestões da internet</h2>
          </div>
          <p className="internet-aviso">
            Nada aqui faz parte da receita original. Veio de busca na web e pode
            estar errado.
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
            <ul className="sugestoes">
              {c.dicas.map((dica) => (
                <li key={dica}>{dica}</li>
              ))}
            </ul>
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
      )}

      <footer className="transcricao">
        <p>
          Transcrito da issue #{receita.issue}
          {receita.confianca < 0.8 &&
            ` · leitura incerta (${receita.confianca.toFixed(2)})`}
        </p>
        {receita.notas && <p>{receita.notas}</p>}
      </footer>
    </article>
  );
}
