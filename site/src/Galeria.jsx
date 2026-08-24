/**
 * As fotos da receita — moldura, carrossel e visor de tela cheia.
 *
 * Contexto que explica as escolhas: quem manda a receita é a mesma pessoa que
 * tira todas as fotos, então **foto não tem autoria nem legenda** em lugar
 * nenhum. São *momentos* — de vezes diferentes ou do meio do preparo. A mais
 * recente (`fotos[0]`, ver `dados.js`) é a que vai grande.
 *
 * Movimento, em ordem de importância:
 *
 * - **Ken Burns** contínuo e lentíssimo na foto grande. Serve para a foto
 *   parada não parecer um erro de carregamento; 22 s por ciclo é lento o
 *   bastante para ninguém "ver" acontecendo.
 * - **Crossfade** entre uma foto e a próxima, com a que sai encolhendo de leve.
 *   Duração de cena (1,1 s): é narrativa, não resposta a clique.
 * - **Visor compartilhado**: a miniatura clicada *vira* a foto grande via
 *   `layoutId`. A Motion mede as duas caixas e interpola — por isso a origem
 *   some do fluxo enquanto o visor está aberto (`layoutId` duplicado quebra a
 *   medição). O buraco fica atrás da foto que voa, ninguém vê.
 *
 * Sem foto (a maioria das receitas hoje) tudo isso desliga sozinho e volta o
 * monograma na moldura vazia — o mesmo placeholder de antes.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useTransform,
} from "motion/react";

import {
  DUR,
  EASE,
  MOLA,
  MOLA_MACIA,
  fundoModal,
  usePonteiro,
  useRelogio,
} from "./movimento.js";

/** Quanto tempo cada foto fica no ar, no carrossel do topo. */
const TEMPO_FOTO = 6200;

/** Inicial da receita, quando não há foto nenhuma. */
export function monograma(titulo) {
  return (titulo.trim()[0] ?? "?").toUpperCase();
}

/* ------------------------------------------------------------------ visor */

const ContextoVisor = createContext(null);

/**
 * Guarda qual foto está aberta em tela cheia. Fica num contexto porque quem
 * abre o visor está em dois lugares distantes da árvore — a foto do topo e a
 * galeria da coluna lateral — e as duas precisam falar com o mesmo visor.
 */
export function ProvedorDeFotos({ fotos, children }) {
  const [indice, setIndice] = useState(null);

  const abrir = useCallback((i) => setIndice(i), []);
  const fechar = useCallback(() => setIndice(null), []);
  const andar = useCallback(
    (passo) =>
      setIndice((i) =>
        i == null ? i : (i + passo + fotos.length) % fotos.length,
      ),
    [fotos.length],
  );

  const valor = useMemo(
    () => ({ fotos, indice, abrir, fechar, andar }),
    [fotos, indice, abrir, fechar, andar],
  );

  return (
    <ContextoVisor.Provider value={valor}>
      {children}
      <Visor />
    </ContextoVisor.Provider>
  );
}

export function useFotos() {
  return (
    useContext(ContextoVisor) ?? {
      fotos: [],
      indice: null,
      abrir: () => {},
      fechar: () => {},
      andar: () => {},
    }
  );
}

/** Tela cheia. Teclado (←/→/Esc), arrasto lateral e clique no fundo fecham. */
function Visor() {
  const { fotos, indice, fechar, andar } = useFotos();
  const aberto = indice != null;
  const foto = aberto ? fotos[indice] : null;
  const botaoFechar = useRef(null);
  const focoAnterior = useRef(null);

  // trava a rolagem do fundo: a foto ocupa a tela, rolar atrás desorienta
  useEffect(() => {
    if (!aberto) return;
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = antes;
    };
  }, [aberto]);

  /**
   * Foco: sem isto, quem abre a foto pelo teclado continua com o foco na
   * miniatura *atrás* do visor — Tab passeia pela página escondida e o Esc
   * parece não fazer nada porque o foco nunca esteve aqui. Ao fechar, o foco
   * volta para onde estava, senão a pessoa é jogada para o topo do documento.
   */
  useEffect(() => {
    if (!aberto) return;
    focoAnterior.current = document.activeElement;
    const t = setTimeout(() => botaoFechar.current?.focus(), 60);
    return () => {
      clearTimeout(t);
      focoAnterior.current?.focus?.();
    };
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e) => {
      if (e.key === "Escape") fechar();
      else if (e.key === "ArrowRight") andar(1);
      else if (e.key === "ArrowLeft") andar(-1);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aberto, fechar, andar]);

  return (
    <AnimatePresence>
      {foto && (
        <motion.div
          className="visor"
          variants={fundoModal}
          initial="oculto"
          animate="visivel"
          exit="saindo"
          onClick={fechar}
          role="dialog"
          aria-modal="true"
          aria-label="Foto em tela cheia"
        >
          <motion.img
            key={foto.id}
            layoutId={`foto-${foto.id}`}
            className="visor-foto"
            src={foto.url}
            alt=""
            drag={fotos.length > 1 ? "x" : false}
            dragElastic={0.18}
            dragConstraints={{ left: 0, right: 0 }}
            onDragEnd={(_, info) => {
              const forca = info.offset.x + info.velocity.x * 0.12;
              if (forca < -90) andar(1);
              else if (forca > 90) andar(-1);
            }}
            onClick={(e) => e.stopPropagation()}
            transition={MOLA_MACIA}
          />

          {fotos.length > 1 && (
            <motion.div
              className="visor-conta"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DUR.medio, ease: EASE.papel, delay: 0.2 }}
            >
              {indice + 1} / {fotos.length}
            </motion.div>
          )}

          <motion.button
            type="button"
            className="visor-fechar"
            ref={botaoFechar}
            onClick={fechar}
            aria-label="Fechar foto"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            whileHover={{ rotate: 90 }}
            transition={MOLA}
          >
            ×
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* -------------------------------------------------------------- foto grande */

/**
 * A foto do topo da receita. Troca sozinha entre os momentos, com anel de
 * progresso mostrando quanto falta para a próxima. Passar o mouse pausa —
 * quem parou para olhar não quer que a imagem fuja.
 */
export function FotoDestaque({ receita, className = "" }) {
  const { fotos, abrir, indice: aberta } = useFotos();
  const calmo = useReducedMotion();
  const [i, setI] = useState(0);
  const [pausado, setPausado] = useState(false);
  const ponteiro = usePonteiro();
  // o brilho anda menos que o ponteiro — reflexo, não cursor
  const brilhoX = useTransform(ponteiro.x, (v) => v * 90);
  const brilhoY = useTransform(ponteiro.y, (v) => v * 60);

  const varias = fotos.length > 1;
  const fracao = useRelogio(
    varias ? TEMPO_FOTO : 0,
    () => setI((n) => (n + 1) % fotos.length),
    pausado || aberta != null,
  );

  if (fotos.length === 0) {
    return (
      <div className={`plate ${className}`}>
        <span className="plate-ph">{receita.titulo}</span>
      </div>
    );
  }

  const foto = fotos[i];
  const escondida = aberta != null && fotos[aberta]?.id === foto.id;

  return (
    <motion.div
      ref={ponteiro.ref}
      className={`plate plate-viva ${className}`}
      style={{ viewTransitionName: `foto-${receita.id}` }}
      onPointerMove={ponteiro.aoMover}
      onPointerLeave={() => {
        ponteiro.aoSair();
        setPausado(false);
      }}
      onPointerEnter={() => setPausado(true)}
      whileHover={calmo ? undefined : { scale: 1.008 }}
      transition={MOLA_MACIA}
    >
      <AnimatePresence initial={false}>
        {!escondida && (
          <motion.img
            key={foto.id}
            layoutId={`foto-${foto.id}`}
            className={`plate-img ${calmo ? "" : "ken-burns"}`}
            src={foto.url}
            alt=""
            initial={{ opacity: 0, scale: 1.05 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.02 }}
            transition={{ duration: DUR.cena, ease: EASE.tinta }}
          />
        )}
      </AnimatePresence>

      {/* brilho que segue o ponteiro: dá volume de louça à moldura chapada */}
      {!calmo && (
        <motion.div
          className="plate-brilho"
          aria-hidden="true"
          style={{ x: brilhoX, y: brilhoY }}
        />
      )}

      <button
        type="button"
        className="plate-abrir"
        onClick={() => abrir(i)}
        aria-label="Ver foto em tela cheia"
      >
        <span className="plate-lupa" aria-hidden="true">
          ⤢
        </span>
      </button>

      {varias && (
        <div className="plate-relogio" aria-hidden="true">
          <AnelDeProgresso fracao={calmo ? 0 : fracao} />
          <span className="plate-conta">
            {i + 1}/{fotos.length}
          </span>
        </div>
      )}
    </motion.div>
  );
}

/** Anel fino que se fecha enquanto a foto atual está no ar. */
function AnelDeProgresso({ fracao }) {
  const r = 9;
  const volta = 2 * Math.PI * r;
  return (
    <svg className="anel" viewBox="0 0 24 24" width="24" height="24">
      <circle className="anel-trilho" cx="12" cy="12" r={r} />
      <circle
        className="anel-arco"
        cx="12"
        cy="12"
        r={r}
        strokeDasharray={volta}
        strokeDashoffset={volta * (1 - fracao)}
      />
    </svg>
  );
}

/* ------------------------------------------------------------- miniaturas */

/**
 * A grade de miniaturas da coluna lateral. Sem legenda, de propósito.
 *
 * Enquanto não houver foto, mantém as molduras vazias que o mockup previa —
 * marcadas como demonstração por quem chama, não aqui.
 */
export function GradeDeFotos({ vazias = 4 }) {
  const { fotos, abrir, indice } = useFotos();

  if (fotos.length === 0) {
    return (
      <div className="galeria" aria-hidden="true">
        {Array.from({ length: vazias }, (_, i) => (
          <div className="plate" key={i} />
        ))}
      </div>
    );
  }

  return (
    <motion.ul
      className="galeria galeria-viva"
      initial="oculto"
      animate="visivel"
      variants={{ visivel: { transition: { staggerChildren: 0.07 } } }}
    >
      {fotos.map((f, i) => (
        <motion.li
          key={f.id}
          variants={{
            oculto: { opacity: 0, y: 12, scale: 0.96 },
            visivel: { opacity: 1, y: 0, scale: 1 },
          }}
          transition={{ duration: DUR.medio, ease: EASE.papel }}
        >
          <motion.button
            type="button"
            className="plate plate-mini"
            onClick={() => abrir(i)}
            aria-label={`Abrir foto ${i + 1} de ${fotos.length}`}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
            transition={MOLA}
          >
            {indice !== i && (
              <motion.img
                layoutId={`foto-${f.id}`}
                className="plate-img"
                src={f.url}
                alt=""
                transition={MOLA_MACIA}
              />
            )}
          </motion.button>
        </motion.li>
      ))}
    </motion.ul>
  );
}

/**
 * Moldura do card da lista. Foto quando existe, monograma quando não.
 * O zoom no hover mora aqui para o card não precisar saber de foto.
 */
export function FotoDoCard({ receita, className = "" }) {
  const foto = receita.fotos[0] ?? null;

  return (
    <div
      className={`plate ${className}`}
      style={{ viewTransitionName: `foto-${receita.id}` }}
    >
      {foto ? (
        <img className="plate-img plate-zoom" src={foto.url} alt="" loading="lazy" />
      ) : (
        <span className="plate-ph">{monograma(receita.titulo)}</span>
      )}
      {receita.fotos.length > 1 && (
        <span className="plate-selo" aria-hidden="true">
          {receita.fotos.length} fotos
        </span>
      )}
    </div>
  );
}
