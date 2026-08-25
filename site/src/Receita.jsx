import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { FotoDestaque, ProvedorDeFotos } from "./Galeria.jsx";
import { Regua } from "./Lista.jsx";
import Momentos from "./Momentos.jsx";
import { Contador, ItemRevelado, ListaRevelada, Revelar, TituloRevelado } from "./Revelar.jsx";
import { receitas } from "./dados.js";
import { DUR, EASE, MOLA, MOLA_MACIA, subir, useEntrada } from "./movimento.js";

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

export default function Receita({ receita }) {
  return (
    <ProvedorDeFotos fotos={receita.fotos}>
      <CorpoDaReceita receita={receita} />
    </ProvedorDeFotos>
  );
}

function CorpoDaReceita({ receita }) {
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
    ? [receita.tempo_min, "min", false]
    : c?.tempo_min
      ? [c.tempo_min, "min", true]
      : [null, "", false];
  const serve = receita.porcoes
    ? [receita.porcoes, "porções", false]
    : c?.porcoes
      ? [c.porcoes, "porções", true]
      : [null, "", false];

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
      <motion.a
        className="voltar btn btn-ghost"
        href="#/"
        whileHover={{ x: -4 }}
        transition={MOLA}
      >
        ← todas as receitas
      </motion.a>

      <div className="receita-hero">
        <div>
          <motion.div
            className="kicker"
            initial={{ opacity: 0, letterSpacing: "0.32em" }}
            animate={{ opacity: 1, letterSpacing: "0.16em" }}
            transition={{ duration: 1, ease: EASE.papel }}
          >
            {receita.tags[0] ?? "Receita da casa"}
          </motion.div>

          <TituloRevelado
            className="titulo"
            texto={receita.titulo}
            atraso={0.08}
          />

          {receita.notas && (
            <motion.p
              className="receita-resumo"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: DUR.lento, ease: EASE.papel, delay: 0.4 }}
            >
              {receita.notas}
            </motion.p>
          )}

          <motion.div
            className="stats"
            initial="oculto"
            animate="visivel"
            variants={{
              visivel: { transition: { delayChildren: 0.5, staggerChildren: 0.08 } },
            }}
          >
            <Estatistica rotulo="Tempo" valor={tempo[0]} sufixo={tempo[1]} sugerido={tempo[2]} />
            <Estatistica rotulo="Serve" valor={serve[0]} sufixo={serve[1]} sugerido={serve[2]} />
            <Estatistica rotulo="Dificuldade" texto={dificuldade(receita.passos)} />
            {c?.temperatura_c && (
              <Estatistica rotulo="Forno" valor={c.temperatura_c} sufixo="°C" sugerido />
            )}
          </motion.div>
        </div>

        <FotoDestaque receita={receita} className="receita-foto" />
      </div>

      <Regua />

      <div className="receita-grid">
        <div className="receita-main">
          <Revelar como="h6" className="secao-titulo">
            Ingredientes · {receita.ingredientes.length} itens
          </Revelar>

          <ListaRevelada como="ul" className="ingredientes" intervalo={0.045}>
            {receita.ingredientes.map((ing, i) => (
              <ItemRevelado como="li" key={i}>
                <Ingrediente
                  texto={quantidade(ing)}
                  item={ing.bruto}
                  usado={usados.has(i)}
                  aoAlternar={() => alternarUsado(i)}
                />
              </ItemRevelado>
            ))}
          </ListaRevelada>

          <Revelar como="h6" className="secao-titulo">
            Modo de preparo · {receita.passos.length} passos
          </Revelar>
          <Revelar como="p" className="secao-lede" atraso={0.06}>
            Ao lado de cada etapa, o que a internet costuma recomendar.
          </Revelar>

          <Progresso feitos={feitos.size} total={receita.passos.length} />

          <ol className="passos">
            {receita.passos.map((passo, i) => (
              <Passo
                key={i}
                indice={i}
                texto={passo}
                nota={notasPorPasso.get(i)}
                feito={feitos.has(i)}
                aoAlternar={() => alternarFeito(i)}
              />
            ))}
          </ol>
        </div>

        <aside className="receita-lado">
          <Momentos receita={receita} />

          {outras.length > 0 && (
            <>
              <Regua />
              <Revelar como="h6" className="secao-titulo">
                Nesta cozinha também
              </Revelar>
              <ListaRevelada className="outras">
                {outras.map((o) => {
                  const t = o.tempo_min ?? o.complemento?.tempo_min ?? null;
                  return (
                    <ItemRevelado key={o.id} como="a" className="outra" href={`#/${o.id}`}>
                      <span className="outra-titulo">{o.titulo}</span>
                      {t && <span className="outra-tempo">{t} min</span>}
                    </ItemRevelado>
                  );
                })}
              </ListaRevelada>
            </>
          )}
        </aside>
      </div>

      {temSugestoes && (
        <>
          <Regua />
          <section className="internet">
            <Revelar como="h2" className="internet-titulo">
              Dicas da internet
            </Revelar>
            <Revelar como="p" className="internet-aviso" atraso={0.06}>
              Nada aqui faz parte da receita original. Veio de busca na web e
              pode estar errado.
            </Revelar>

            {c.ingredientes_ausentes?.length > 0 && (
              <ListaRevelada como="ul" className="sugestoes">
                {c.ingredientes_ausentes.map((ing) => (
                  <ItemRevelado como="li" key={ing.item}>
                    <strong>{ing.item}</strong> — {ing.motivo}
                  </ItemRevelado>
                ))}
              </ListaRevelada>
            )}

            {c.dicas?.length > 0 && (
              <ListaRevelada className="dicas-grid" intervalo={0.08}>
                {c.dicas.map((dica) => (
                  <ItemRevelado
                    className="card dica-card"
                    key={dica}
                    whileHover={{ y: -4, borderColor: "var(--color-accent)" }}
                    transition={MOLA}
                  >
                    <div className="card-kicker">da internet</div>
                    <p className="dica-texto">{dica}</p>
                  </ItemRevelado>
                ))}
              </ListaRevelada>
            )}

            {c.fontes?.length > 0 && (
              <ListaRevelada como="ul" className="fontes">
                {c.fontes.map((f) => (
                  <ItemRevelado como="li" key={f.url}>
                    {f.aviso && (
                      <span className="nao-verificada" title={f.aviso}>
                        não verificada
                      </span>
                    )}
                    <a href={f.url} target="_blank" rel="noreferrer noopener">
                      {f.titulo || f.url}
                    </a>
                  </ItemRevelado>
                ))}
              </ListaRevelada>
            )}
          </section>
        </>
      )}

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

/* ------------------------------------------------------------- peças */

/** Uma coluna da ficha do topo. Número conta até o valor; texto só aparece. */
function Estatistica({ rotulo, valor = null, sufixo = "", texto, sugerido = false }) {
  return (
    <motion.div variants={subir}>
      <div className="stat-rotulo">{rotulo}</div>
      <div className={`stat-valor${sugerido ? " sugerido" : ""}`}>
        {texto ?? (valor == null ? "—" : <Contador valor={valor} sufixo={sufixo} />)}
      </div>
    </motion.div>
  );
}

/**
 * Item da lista de ingredientes.
 *
 * O risco não é `text-decoration`: é uma linha que **cresce** da esquerda para
 * a direita quando a pessoa marca, e recolhe quando desmarca. A diferença é o
 * que faz parecer riscado à mão em vez de trocado por outro texto.
 */
function Ingrediente({ texto, item, usado, aoAlternar }) {
  return (
    <motion.button
      type="button"
      className="ingrediente"
      data-usado={usado}
      aria-pressed={usado}
      onClick={aoAlternar}
      whileHover={{ x: 3 }}
      whileTap={{ scale: 0.99 }}
      transition={MOLA}
    >
      <span className="quantidade">{texto}</span>
      <span className="item">
        {item}
        <motion.span
          className="risco"
          aria-hidden="true"
          initial={false}
          animate={{ scaleX: usado ? 1 : 0 }}
          style={{ originX: 0 }}
          transition={{ duration: DUR.medio, ease: EASE.papel }}
        />
      </span>
      <motion.span
        className="ingrediente-marca"
        aria-hidden="true"
        initial={false}
        animate={{ scale: usado ? 1 : 0, opacity: usado ? 1 : 0 }}
        transition={MOLA}
      >
        ✓
      </motion.span>
    </motion.button>
  );
}

/**
 * Um passo do preparo. Entra com a rolagem; a nota da internet chega logo
 * depois, vindo da direita — a ordem de leitura é passo primeiro, comentário
 * depois, e o movimento diz isso sem precisar de rótulo.
 */
function Passo({ indice, texto, nota, feito, aoAlternar }) {
  const entrada = useEntrada("-14% 0px -10% 0px");
  const calmo = useReducedMotion();
  return (
    <motion.li
      className="passo"
      variants={subir}
      {...entrada}
      transition={{ duration: DUR.medio, ease: EASE.papel }}
    >
      <motion.button
        type="button"
        className="passo-corpo"
        data-feito={feito}
        aria-pressed={feito}
        onClick={aoAlternar}
        whileHover={{ x: 3 }}
        whileTap={{ scale: 0.995 }}
        transition={MOLA}
      >
        <motion.span
          className="passo-num"
          aria-hidden="true"
          animate={
            feito
              ? { color: "var(--color-accent)", scale: 0.92 }
              : { color: "var(--color-accent-300)", scale: 1 }
          }
          transition={MOLA}
        >
          {String(indice + 1).padStart(2, "0")}
        </motion.span>
        <span className="passo-texto">
          {texto}
          <motion.span
            className="risco risco-passo"
            aria-hidden="true"
            initial={false}
            animate={{ scaleX: feito ? 1 : 0 }}
            style={{ originX: 0 }}
            transition={{ duration: DUR.lento, ease: EASE.papel }}
          />
        </span>
      </motion.button>

      {nota && (
        <motion.aside
          className="nota"
          initial={calmo ? false : { opacity: 0, x: 18 }}
          whileInView={calmo ? undefined : { opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-14% 0px -10% 0px" }}
          transition={{ duration: DUR.medio, ease: EASE.papel, delay: 0.14 }}
          whileHover={{ x: -2, borderColor: "var(--color-accent)" }}
        >
          <span className="nota-rotulo">da internet</span>
          <p className="nota-texto">{nota}</p>
        </motion.aside>
      )}
    </motion.li>
  );
}

/**
 * Barra de progresso da cozinha.
 *
 * Não estava no mockup: nasceu do fato de os passos já serem marcáveis e de
 * ninguém, de mão suja, conseguir contar quantos faltam. Só aparece depois do
 * primeiro passo marcado — antes disso seria ruído mostrando "0%".
 */
function Progresso({ feitos, total }) {
  const calmo = useReducedMotion();
  const fracao = total ? feitos / total : 0;
  const pronto = feitos === total && total > 0;

  return (
    <AnimatePresence initial={false}>
      {feitos > 0 && (
        <motion.div
          className="progresso"
          initial={{ opacity: 0, height: 0, marginBottom: 0 }}
          animate={{ opacity: 1, height: "auto", marginBottom: 26 }}
          exit={{ opacity: 0, height: 0, marginBottom: 0 }}
          transition={{ duration: DUR.medio, ease: EASE.papel }}
        >
          <div className="progresso-linha">
            <motion.div
              className="progresso-barra"
              animate={{ scaleX: fracao }}
              style={{ originX: 0 }}
              transition={calmo ? { duration: 0 } : MOLA_MACIA}
            />
          </div>
          {/* `role="status"`: quem usa leitor de tela ouve "3 de 8 passos" ao
              marcar, em vez de descobrir o progresso só se voltar até aqui */}
          <div className="progresso-texto" role="status">
            {pronto ? (
              <motion.span
                className="progresso-pronto"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={MOLA}
              >
                pronto · bom apetite
              </motion.span>
            ) : (
              <span>
                {feitos} de {total} passos
              </span>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
