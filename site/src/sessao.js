import { useEffect, useState } from "react";

/**
 * Pergunta ao Worker qual é o nível desta sessão.
 *
 * Serve só para a tela: esconder o botão de enviar de quem não pode enviar é
 * cortesia, não segurança. Quem recusa de verdade é o Worker, no POST — e é
 * lá que a regra tem que estar certa, porque um botão escondido volta com dois
 * cliques no navegador.
 */
export function useSessao() {
  const [sessao, setSessao] = useState(null);

  useEffect(() => {
    let cancelado = false;

    fetch("/api/sessao")
      .then((r) => (r.ok ? r.json() : null))
      .then((dados) => {
        if (!cancelado) setSessao(dados);
      })
      .catch(() => {
        // sem resposta, o site segue em modo leitura: errar para o lado de
        // mostrar menos é melhor que oferecer o que vai falhar depois
        if (!cancelado) setSessao({ nivel: null, pode: ["ver"] });
      });

    return () => {
      cancelado = true;
    };
  }, []);

  return {
    sessao,
    podeEnviar: Boolean(sessao?.pode?.includes("enviar")),
  };
}
