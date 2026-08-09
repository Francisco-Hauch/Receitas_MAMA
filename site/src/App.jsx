import { useEffect, useState } from "react";

import Lista from "./Lista.jsx";
import Receita from "./Receita.jsx";
import { acharReceita, receitas } from "./dados.js";

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
  const receita = rota ? acharReceita(rota) : null;

  // ao abrir uma receita, começa do topo — senão o leitor cai no meio
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [rota]);

  return (
    <>
      <header className="topo">
        <div className="topo-interno">
          <a className="marca" href="#/">
            Receitas da Mamãe
          </a>
          <span className="contagem">
            {receitas.length} {receitas.length === 1 ? "receita" : "receitas"}
          </span>
        </div>
      </header>

      <main className={receita ? "pagina pagina-receita" : "pagina"}>
        {rota && !receita ? (
          <>
            <a className="voltar" href="#/">
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
    </>
  );
}
