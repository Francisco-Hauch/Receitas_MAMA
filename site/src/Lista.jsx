import { useMemo, useRef, useState } from "react";
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
} from "motion/react";

import Enviar from "./Enviar.jsx";
import { FotoDoCard } from "./Galeria.jsx";
import { Revelar, TituloRevelado } from "./Revelar.jsx";
import { filtrar, receitas, tags } from "./dados.js";
import { DUR, EASE, MOLA, MOLA_MACIA, subir, useEntrada } from "./movimento.js";
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

export default function Lista({ chamado = 0 }) {
  const [termo, setTermo] = useState("");
  const [tag, setTag] = useState(null);
  const { podeEnviar } = useSessao();
  const calmo = useReducedMotion();

  const encontradas = useMemo(() => filtrar(termo, tag), [termo, tag]);
  const semReceitas = receitas.length === 0;

  /* O hero sobe mais devagar que a página: 60px de defasagem ao longo da
   * primeira dobra. Bem pouco de propósito — parallax forte em tipografia
   * serifada grande dá a impressão de que o texto está escorregando. */
  const heroRef = useRef(null);
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  const heroY = useTransform(scrollYProgress, [0, 1], [0, calmo ? 0 : 60]);
  const heroOpacidade = useTransform(scrollYProgress, [0, 0.85], [1, 0.35]);

  return (
    <>
      <motion.section
        className="hero"
        ref={heroRef}
        style={{ y: heroY, opacity: heroOpacidade }}
      >
        <div>
          <motion.div
            className="kicker"
            initial={{ opacity: 0, letterSpacing: "0.34em" }}
            animate={{ opacity: 1, letterSpacing: "0.16em" }}
            transition={{ duration: 1.1, ease: EASE.papel }}
          >
            Cozinha de casa · desde sempre
          </motion.div>
          <TituloRevelado
            className="display"
            texto={"As receitas\nda Mamãe"}
            atraso={0.12}
          />
        </div>
        <motion.p
          className="hero-lede"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR.lento, ease: EASE.papel, delay: 0.5 }}
        >
          Tudo o que ela cozinha há anos, escrito em ordem, com as medidas de
          verdade — colher de sopa, xícara, "até dar o ponto". Cada receita traz
          o tempo, quantas pessoas serve e o que a internet ensina sobre cada
          etapa. Quem faz em casa manda a foto e o recado: ela gosta de ver.
        </motion.p>
      </motion.section>

      <Regua />

      {/* o envio mora aqui, na página principal: não há mais tela à parte. */}
      {podeEnviar && <Enviar chamado={chamado} />}

      {semReceitas ? (
        <p className="vazio">
          Nenhuma receita ainda. Abra uma issue no repositório para mandar a
          primeira — o worker processa quando o computador ligar.
        </p>
      ) : (
        <>
          <Revelar atraso={0.05} className="busca-caixa">
            <input
              className="busca"
              type="search"
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder="Buscar por nome ou ingrediente"
              aria-label="Buscar receita"
            />
            {/* fio dourado que cresce do centro quando o campo recebe foco */}
            <span className="busca-fio" aria-hidden="true" />
          </Revelar>

          {tags.length > 0 && (
            /* LayoutGroup + layoutId: a marca dourada do filtro ativo não
             * aparece e some — ela *desliza* de uma tag para a outra, porque é
             * um elemento só sendo remedido pela Motion. */
            <LayoutGroup id="filtros">
              <ul className="tags">
                {tags.map((t) => (
                  <li key={t}>
                    <motion.button
                      type="button"
                      className="tag"
                      aria-pressed={tag === t}
                      onClick={() => setTag(tag === t ? null : t)}
                      whileHover={{ y: -2 }}
                      whileTap={{ scale: 0.95 }}
                      transition={MOLA}
                    >
                      {tag === t && (
                        <motion.span
                          className="tag-marca"
                          layoutId="tag-ativa"
                          transition={MOLA_MACIA}
                        />
                      )}
                      <span className="tag-texto">{t}</span>
                    </motion.button>
                  </li>
                ))}
              </ul>
            </LayoutGroup>
          )}

          <Revelar className="lista-cabecalho" como="div">
            <h2>{tag ? tag : "Todas as receitas"}</h2>
            <Conta n={encontradas.length} />
          </Revelar>

          {encontradas.length === 0 ? (
            <motion.p
              className="vazio"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: DUR.medio, ease: EASE.papel }}
            >
              Nada com esse nome. Tente outra palavra.
            </motion.p>
          ) : (
            /* `layout` em cada card + AnimatePresence: filtrar não recorta a
             * grade, ela se reorganiza — o card que fica escorrega para o lugar
             * novo em vez de pular. `popLayout` tira quem sai do fluxo antes,
             * senão os que ficam esperam a saída terminar para se mover. */
            <motion.ul className="lista" layout>
              <AnimatePresence mode="popLayout" initial={false}>
                {encontradas.map((r, i) => (
                  <CardDeReceita key={r.id} receita={r} ordem={i} />
                ))}
              </AnimatePresence>
            </motion.ul>
          )}
        </>
      )}
    </>
  );
}

/**
 * O card. Entra escalonado pela posição na grade (só até o oitavo — depois
 * disso a pessoa já rolou e o atraso viraria espera).
 */
function CardDeReceita({ receita, ordem }) {
  const meta = metaCard(receita);
  const entrada = useEntrada("-8% 0px");

  return (
    <motion.li
      layout
      variants={subir}
      {...entrada}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: DUR.rapido } }}
      transition={{
        duration: DUR.medio,
        ease: EASE.papel,
        delay: Math.min(ordem, 8) * 0.055,
        layout: MOLA_MACIA,
      }}
    >
      <motion.a
        className="entrada"
        href={`#/${receita.id}`}
        /* `initial` e `animate` no mesmo rótulo: sem um `animate` declarado os
         * filhos com variants não têm estado de repouso e nascem no valor final
         * — o fio dourado e a seta apareciam de saída, sem ninguém passar o
         * mouse. `whileHover` continua tendo prioridade sobre `animate`. */
        initial="parado"
        animate="parado"
        whileHover="pairando"
        whileTap={{ scale: 0.985 }}
        transition={MOLA}
      >
        <motion.div
          className="entrada-moldura"
          variants={{ parado: { y: 0 }, pairando: { y: -6 } }}
          transition={MOLA}
        >
          <FotoDoCard receita={receita} className="entrada-foto" />
        </motion.div>

        <div className="entrada-corpo">
          <div className="entrada-tags">
            <span className="tag tag-accent">
              {receita.tags[0] ?? "Receita"}
            </span>
            <span className="tag tag-neutral">
              {receita.passos.length} passos
            </span>
          </div>
          <h3 className="entrada-titulo">
            {receita.titulo}
            {/* o fio dourado é desenhado da esquerda para a direita no hover;
             * `originX: 0` para ele crescer, não aparecer inteiro de uma vez */}
            <motion.span
              className="entrada-fio"
              aria-hidden="true"
              variants={{
                parado: { scaleX: 0 },
                pairando: { scaleX: 1 },
              }}
              style={{ originX: 0 }}
              transition={{ duration: DUR.medio, ease: EASE.papel }}
            />
          </h3>
          <div className="entrada-meta">
            <span>{meta.esquerda}</span>
            <span className="sep" />
            <span>{meta.direita}</span>
            <motion.span
              className="entrada-seta"
              aria-hidden="true"
              variants={{
                parado: { opacity: 0, x: -6 },
                pairando: { opacity: 1, x: 0 },
              }}
              transition={MOLA}
            >
              →
            </motion.span>
          </div>
        </div>
      </motion.a>
    </motion.li>
  );
}

/**
 * Contagem de resultados. O número troca com um giro curto de rolete em vez de
 * simplesmente virar outro — é o único sinal de que a busca respondeu.
 */
function Conta({ n }) {
  return (
    <span className="text-muted conta">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={n}
          className="conta-num"
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -12, opacity: 0 }}
          transition={{ duration: DUR.rapido, ease: EASE.papel }}
        >
          {n}
        </motion.span>
      </AnimatePresence>
      <span className="conta-rotulo">
        {n === 1 ? "receita" : "receitas"}
      </span>
    </span>
  );
}

/** A linha divisória que se desenha do centro para as pontas ao entrar. */
export function Regua({ className = "" }) {
  const calmo = useReducedMotion();
  if (calmo) return <hr className={`hr ${className}`} />;
  return (
    <motion.hr
      className={`hr ${className}`}
      initial={{ scaleX: 0, opacity: 0 }}
      whileInView={{ scaleX: 1, opacity: 1 }}
      viewport={{ once: true, margin: "-10% 0px" }}
      transition={{ duration: DUR.lento, ease: EASE.papel }}
    />
  );
}
