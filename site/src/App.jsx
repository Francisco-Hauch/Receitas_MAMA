import { useCallback, useEffect, useState } from "react";

import Lista from "./Lista.jsx";
import Receita from "./Receita.jsx";
import { acharReceita } from "./dados.js";
import { useSessao } from "./sessao.js";

function useRota() {
  const [rota, setRota] = useState(() => window.location.hash.slice(2));

  useEffect(() => {
    const aoTrocar = () => setRota(window.location.hash.slice(2));
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

  return (
    <>
      <header className="topo">
        <div className="topo-interno">
          <a className="marca" href="#/">
            Receitas <span className="marca-sub">da Mamãe</span>
          </a>
          <div className="topo-acoes">
            {podeEnviar && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={chamarEnvio}
              >
                mandar receita
              </button>
            )}
            {sessao?.rotulo && (
              <span className="topo-sessao">
                {sessao.rotulo} · <a href="/sair">sair</a>
              </span>
            )}
          </div>
        </div>
      </header>

      <main className={receita ? "pagina pagina-receita" : "pagina"}>
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
    </>
  );
}
