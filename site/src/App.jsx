import { useEffect, useState } from "react";

import Enviar from "./Enviar.jsx";
import Lista from "./Lista.jsx";
import Receita from "./Receita.jsx";
import { acharReceita } from "./dados.js";
import { useSessao } from "./sessao.js";

/**
 * Rotas pelo hash da URL (#/0001-pao-de-alho).
 *
 * Sem biblioteca de rota de propósito: hash funciona em qualquer hospedagem
 * estática sem configurar nada no servidor. Com caminho normal, abrir o link
 * direto de uma receita daria 404 até alguém configurar o redirecionamento.
 */
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
  const enviando = rota === "enviar";
  const receita = rota && !enviando ? acharReceita(rota) : null;

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
              <a className="btn btn-ghost" href="#/enviar">
                mandar receita
              </a>
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
        {enviando ? (
          podeEnviar ? (
            <Enviar />
          ) : (
            <>
              <a className="voltar btn btn-ghost" href="#/">
                ← todas as receitas
              </a>
              <h1 className="titulo">Só leitura</h1>
              <p className="vazio">
                Este acesso vê as receitas, mas não manda novas. Entre com a
                senha da família para mandar.
              </p>
            </>
          )
        ) : rota && !receita ? (
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
          <Lista />
        )}
      </main>

      <footer className="rodape">
        <span>Caderno de Receitas da Mamãe</span>
        <span>Feito em casa</span>
      </footer>
    </>
  );
}
