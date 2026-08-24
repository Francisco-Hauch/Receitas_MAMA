/**
 * Camada de movimento do design system "Caderno de Receitas".
 *
 * A regra que manda aqui é a mesma do resto do sistema: o site é um livro de
 * receitas de família, não um painel de startup. Então o movimento é
 * *editorial* — lento, com curva de saída longa, como página virando e tinta
 * assentando. Nada pula, nada pisca, nada gira.
 *
 * Três decisões que valem para tudo:
 *
 * 1. **Uma entrada, uma saída.** Elemento entra subindo e clareando
 *    (`EASE.papel`, desaceleração longa); sai encolhendo de leve
 *    (`EASE.saida`, aceleração curta). Saída é sempre mais rápida que entrada:
 *    quem já viu não precisa esperar.
 * 2. **Feedback é mola, cena é duração.** Toque do dedo (marcar ingrediente,
 *    abrir foto) usa mola — responde ao gesto. Troca de cena (página, foto do
 *    carrossel) usa duração fixa — é narrativa, não reação.
 * 3. **Distância curta.** 18px é o padrão de reveal; 34px só no hero. Movimento
 *    grande em tipografia serifada lê como instabilidade.
 *
 * Os mesmos valores existem em CSS (`--mov-*` e `--ease-*` no estilo.css) para
 * o que é animado por folha de estilo. Mudar aqui exige mudar lá.
 */

import { useEffect, useRef, useState } from "react";
import { useMotionValue, useReducedMotion, useSpring } from "motion/react";

/* ------------------------------------------------------------------ tokens */

/** Durações, em segundos (a API da Motion é em segundos, o CSS é em ms). */
export const DUR = {
  instante: 0.12, // troca de cor, opacidade de hover
  rapido: 0.22, // feedback direto de clique
  medio: 0.42, // reveal de item, entrada de card
  lento: 0.72, // hero, seções grandes
  cena: 1.1, // crossfade de foto, troca de página
};

/** Curvas. Nome pelo que a curva *parece*, não pela fórmula. */
export const EASE = {
  papel: [0.22, 1, 0.36, 1], // entra e assenta — a curva padrão do site
  tinta: [0.65, 0, 0.35, 1], // simétrica: para trocas (A vira B)
  colher: [0.34, 1.4, 0.64, 1], // passa do ponto e volta — confirmação
  saida: [0.4, 0, 1, 1], // acelera e some — saída
};

/** Molas. Feedback ao gesto, não a um relógio. */
export const MOLA = { type: "spring", stiffness: 420, damping: 34, mass: 0.7 };
export const MOLA_MACIA = { type: "spring", stiffness: 190, damping: 26 };
export const MOLA_LENTA = { type: "spring", stiffness: 90, damping: 20 };

/** Distâncias de reveal, em px. */
export const DIST = { curta: 10, padrao: 18, hero: 34 };

/** Intervalo entre irmãos numa lista escalonada, em segundos. */
export const ESCALONAR = 0.065;

/* ---------------------------------------------------------------- variants */

/** Sobe e clareia. O reveal padrão de qualquer bloco. */
export const subir = {
  oculto: { opacity: 0, y: DIST.padrao },
  visivel: {
    opacity: 1,
    y: 0,
    transition: { duration: DUR.medio, ease: EASE.papel },
  },
};

/** Igual, com distância de hero e duração longa. */
export const subirHero = {
  oculto: { opacity: 0, y: DIST.hero },
  visivel: {
    opacity: 1,
    y: 0,
    transition: { duration: DUR.lento, ease: EASE.papel },
  },
};

/** Container que escalona os filhos. Use com `subir` nos filhos. */
export const lista = (atraso = 0, intervalo = ESCALONAR) => ({
  oculto: {},
  visivel: {
    transition: { delayChildren: atraso, staggerChildren: intervalo },
  },
});

/**
 * Revelação por máscara: o pai corta (`overflow: hidden`) e o filho sobe de
 * dentro. É o efeito de linha de título saindo de trás do papel — só funciona
 * se o pai tiver a classe `.mascara`.
 */
export const mascarado = {
  oculto: { y: "110%" },
  visivel: {
    y: "0%",
    transition: { duration: DUR.lento, ease: EASE.papel },
  },
};

/** Pop-up: fundo escurece, caixa sobe com mola. */
export const fundoModal = {
  oculto: { opacity: 0 },
  visivel: { opacity: 1, transition: { duration: DUR.medio, ease: EASE.tinta } },
  saindo: { opacity: 0, transition: { duration: DUR.rapido } },
};

/* ------------------------------------------------------------------ hooks */

/**
 * `whileInView` da Motion com os defaults da casa: revela uma vez só, um pouco
 * antes de o elemento chegar ao meio da tela. Espalhar `{...useEntrada()}` num
 * `motion.*` é o jeito padrão de fazer um bloco aparecer com o scroll.
 *
 * É hook e não função pura por um motivo de acessibilidade: para quem pediu
 * menos movimento, o certo não é "revelar sem animar" — é **não esconder**. O
 * `<MotionConfig reducedMotion="user">` desliga transform mas mantém opacidade,
 * então sem isto o texto abaixo da dobra nasceria em `opacity: 0` e só
 * apareceria ao rolar. Conteúdo dependendo de scroll para existir é exatamente
 * o que essa preferência pede para evitar.
 */
export function useEntrada(margem = "-12% 0px -12% 0px") {
  const calmo = useReducedMotion();
  if (calmo) return { initial: false, animate: "visivel" };
  return {
    initial: "oculto",
    whileInView: "visivel",
    viewport: { once: true, margin: margem },
  };
}

/**
 * Número que sobe até o valor. Devolve uma MotionValue — jogue direto como
 * filho de um `motion.span` que a Motion assina a atualização sem re-render.
 *
 * `casas` existe porque tempo é inteiro ("35 min") mas nota não é.
 */
export function useContagem(alvo, { casas = 0, atraso = 0 } = {}) {
  const calmo = useReducedMotion();
  const bruto = useMotionValue(calmo ? alvo : 0);
  const suave = useSpring(bruto, MOLA_LENTA);
  const [texto, setTexto] = useState(() => alvo.toFixed(casas));

  useEffect(() => {
    if (calmo) {
      setTexto(alvo.toFixed(casas));
      return;
    }
    const t = setTimeout(() => bruto.set(alvo), atraso * 1000);
    return () => clearTimeout(t);
  }, [alvo, atraso, calmo, bruto, casas]);

  useEffect(
    () => suave.on("change", (v) => setTexto(v.toFixed(casas))),
    [suave, casas],
  );

  return texto;
}

/**
 * Quebra um texto em palavras para revelar uma a uma. Devolve pares
 * `[palavra, atraso]` — quebra de linha explícita vira `null`.
 *
 * Usado só em título de hero: aplicar isto em parágrafo deixaria o texto
 * dançando enquanto a pessoa tenta ler.
 */
export function palavras(texto, intervalo = 0.055) {
  let i = 0;
  return texto.split("\n").map((linha) =>
    linha.split(" ").map((palavra) => {
      const item = { palavra, atraso: i * intervalo };
      i += 1;
      return item;
    }),
  );
}

/**
 * Posição do ponteiro dentro do elemento, de -0.5 a 0.5 nos dois eixos.
 * Serve para o brilho que segue o mouse nas fotos. Volta a zero quando o
 * ponteiro sai — e nunca liga em quem pediu menos movimento ou navega no dedo.
 */
export function usePonteiro() {
  const ref = useRef(null);
  const calmo = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, MOLA_MACIA);
  const sy = useSpring(y, MOLA_MACIA);

  const aoMover = (e) => {
    if (calmo || !ref.current || e.pointerType === "touch") return;
    const r = ref.current.getBoundingClientRect();
    x.set((e.clientX - r.left) / r.width - 0.5);
    y.set((e.clientY - r.top) / r.height - 0.5);
  };

  const aoSair = () => {
    x.set(0);
    y.set(0);
  };

  return { ref, x: sx, y: sy, aoMover, aoSair };
}

/**
 * Relógio de carrossel: avança sozinho e devolve quanto falta (0 a 1) para o
 * anel de progresso. Pausa quando `pausado` — e fica parado de vez para quem
 * pediu menos movimento, senão a foto trocaria embaixo de quem está lendo.
 */
export function useRelogio(intervalo, aoVirar, pausado = false) {
  const calmo = useReducedMotion();
  const [fracao, setFracao] = useState(0);
  const virar = useRef(aoVirar);
  virar.current = aoVirar;

  useEffect(() => {
    if (calmo || pausado || intervalo <= 0) {
      setFracao(0);
      return;
    }
    let inicio = performance.now();
    let quadro;
    const passo = (agora) => {
      const f = (agora - inicio) / intervalo;
      if (f >= 1) {
        inicio = agora;
        setFracao(0);
        virar.current();
      } else {
        setFracao(f);
      }
      quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [calmo, pausado, intervalo]);

  return fracao;
}

/**
 * Troca de rota com a View Transitions API: o navegador tira uma foto do
 * antes, outra do depois, e interpola os elementos que têm `view-transition-name`
 * igual nos dois lados — é o que faz a foto do card virar a foto do topo da
 * receita sem nenhum truque de posição.
 *
 * Onde a API não existe (Firefox e Safari antigos), a troca acontece direto e
 * a animação de página da Motion cobre a diferença. Nunca deixe a navegação
 * depender disto: aqui é enfeite, não mecanismo.
 */
export function comTransicao(troca) {
  const calmo = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (calmo || !document.startViewTransition) {
    troca();
    return;
  }
  document.startViewTransition(troca);
}
