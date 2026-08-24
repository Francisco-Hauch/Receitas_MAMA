import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import {
  MotionConfig,
  motion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";

import Lista from "./Lista.jsx";
import Receita from "./Receita.jsx";
import { acharReceita } from "./dados.js";
import { DUR, EASE, comTransicao } from "./movimento.js";
import { useSessao } from "./sessao.js";

/**
 * Rota por hash. A novidade aqui é o `comTransicao`: a troca de estado acontece
 * **dentro** de `document.startViewTransition`, o que exige `flushSync` para o
 * React aplicar o DOM novo antes de o navegador tirar a segunda foto. Sem isso
 * a transição capturaria a mesma tela duas vezes e não animaria nada.
 *
 * É o que faz a foto do card virar a foto do topo da receita: as duas têm o
 * mesmo `view-transition-name` (ver `Galeria.jsx`), e o navegador liga uma na
 * outra sozinho. Onde a API não existe, cai no caminho direto e a animação de
 * página da Motion cobre a diferença.
 */
function useRota() {
  const [rota, setRota] = useState(() => window.location.hash.slice(2));

  useEffect(() => {
    const aoTrocar = () => {
      const nova = window.location.hash.slice(2);
      comTransicao(() => flushSync(() => setRota(nova)));
    };
    window.addEventListener("hashchange", aoTrocar);
    return () => window.removeEventListener("hashchange", aoTrocar);
  }, []);

  return rota;
}

export default function App() {
  const rota = useRota();
  const { sessao, podeEnviar } = useSessao();
  const receita = rota ? acharReceita(rota) : null;

  // Contador de "quero mandar uma receita". Não é rota nem booleano: mandar
  // duas seguidas precisa levar a pessoa até a zona nas duas vezes.
  const [chamado, setChamado] = useState(0);

  const chamarEnvio = useCallback(() => {
    if (window.location.hash !== "#/") window.location.hash = "#/";
    setChamado((n) => n + 1);
  }, []);

  /**
   * #/enviar era uma tela; hoje o envio mora na home. Link antigo, favorito
   * ou botão de voltar caem aqui e vão para a zona em vez de dar
   * "receita não encontrada". `replace` para o voltar não ficar em laço.
   */
  useEffect(() => {
    if (rota !== "enviar") return;
    window.location.replace("#/");
    setChamado((n) => n + 1);
  }, [rota]);

  // ao abrir uma receita, começa do topo — senão o leitor cai no meio
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [rota]);

  /* --- movimento ligado à rolagem ------------------------------------- */

  const { scrollY, scrollYProgress } = useScroll();
  // mola no progresso: sem ela o fio treme junto com o passo da roda do mouse
  const progresso = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 28,
    restDelta: 0.001,
  });
  // o cabeçalho encolhe nos primeiros 120px e ganha sombra: a marca continua
  // presente, só para de ocupar o mesmo que ocupava com a página no topo
  const alturaTopo = useTransform(scrollY, [0, 120], [14, 9], { clamp: true });
  const sombraTopo = useTransform(
    scrollY,
    [0, 120],
    ["0 0px 0px rgba(45,43,43,0)", "0 6px 20px rgba(45,43,43,0.09)"],
    { clamp: true },
  );

  const chaveDaPagina = receita ? `receita:${receita.id}` : "lista";

  return (
    <MotionConfig reducedMotion="user">
      {/* fio dourado de progresso de leitura, colado no topo da janela */}
      <motion.div
        className="progresso-leitura"
        style={{ scaleX: progresso }}
        aria-hidden="true"
      />

      <motion.header className="topo" style={{ boxShadow: sombraTopo }}>
        <motion.div
          className="topo-interno"
          style={{ paddingTop: alturaTopo, paddingBottom: alturaTopo }}
        >
          <a className="marca" href="#/">
            Receitas <span className="marca-sub">da Mamãe</span>
          </a>
          <div className="topo-acoes">
            {podeEnviar && (
              <motion.button
                type="button"
                className="btn btn-ghost"
                onClick={chamarEnvio}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.96 }}
              >
                mandar receita
              </motion.button>
            )}
            {sessao?.rotulo && (
              <motion.span
                className="topo-sessao"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: DUR.lento, ease: EASE.papel }}
              >
                {sessao.rotulo} · <a href="/sair">sair</a>
              </motion.span>
            )}
          </div>
        </motion.div>
      </motion.header>

      {/* A entrada da página é CSS puro (`.pagina`, animação de montagem), não
          AnimatePresence — de propósito. Um `<AnimatePresence mode="wait">`
          segura o filho antigo montado até a saída terminar, e o `flushSync`
          da View Transition tiraria a segunda foto com a página *velha* ainda
          na tela: a transição não animaria nada. Com a montagem em CSS, a foto
          compartilhada morfa (nativo) e o conteúdo novo sobe (CSS) ao mesmo
          tempo, e onde não há View Transitions só a segunda metade acontece.
          A `key` é o que faz o React remontar e a animação rodar de novo. */}
      <main
        key={chaveDaPagina}
        className={receita ? "pagina pagina-receita" : "pagina"}
      >
        {rota && rota !== "enviar" && !receita ? (
          <>
            <a className="voltar btn btn-ghost" href="#/">
              ← todas as receitas
            </a>
            <h1 className="titulo">Receita não encontrada</h1>
            <p className="vazio">
              O endereço aponta para uma receita que não existe mais.
            </p>
          </>
        ) : receita ? (
          <Receita receita={receita} />
        ) : (
          <Lista chamado={chamado} />
        )}
      </main>

      <footer className="rodape">
        <span>Caderno de Receitas da Mamãe</span>
        <span>Feito em casa</span>
      </footer>
    </MotionConfig>
  );
}
