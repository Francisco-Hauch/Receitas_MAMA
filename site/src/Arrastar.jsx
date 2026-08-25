/**
 * O gesto de arrastar, sozinho — sem saber o que vai ser feito do arquivo.
 *
 * Nasceu de ter uma segunda zona de arraste (a da receita, em `Momentos.jsx`):
 * copiar a contagem de `dragenter` e o `preventDefault` da janela para lá seria
 * duplicar exatamente o tipo de detalhe que dá errado calado.
 */

import { useEffect, useRef, useState } from "react";

/**
 * Devolve `{ arrastando, props }` — espalhe `props` na caixa que recebe o
 * arquivo e use `arrastando` para acender a borda.
 *
 * Dois detalhes que parecem paranoia e não são:
 *
 * - **Contar entradas.** `dragenter`/`dragleave` também disparam ao passar
 *   sobre os filhos da zona; sem o contador a borda pisca enquanto o mouse
 *   atravessa o texto de dentro.
 * - **Engolir o arraste na janela.** Soltar um centímetro fora da zona faz o
 *   navegador ABRIR o arquivo — a página some, junto com o que já foi digitado.
 */
export function useArrasto(aoReceber) {
  const [arrastando, setArrastando] = useState(false);
  const profundidade = useRef(0);
  const receber = useRef(aoReceber);
  receber.current = aoReceber;

  useEffect(() => {
    const engolir = (e) => e.preventDefault();
    window.addEventListener("dragover", engolir);
    window.addEventListener("drop", engolir);
    return () => {
      window.removeEventListener("dragover", engolir);
      window.removeEventListener("drop", engolir);
    };
  }, []);

  const props = {
    onDragEnter: (e) => {
      e.preventDefault();
      profundidade.current += 1;
      setArrastando(true);
    },
    onDragOver: (e) => e.preventDefault(),
    onDragLeave: () => {
      profundidade.current = Math.max(0, profundidade.current - 1);
      if (profundidade.current === 0) setArrastando(false);
    },
    onDrop: (e) => {
      e.preventDefault();
      profundidade.current = 0;
      setArrastando(false);
      receber.current(e.dataTransfer.files);
    },
  };

  return { arrastando, props };
}

/** Miniatura da imagem; o endereço temporário morre junto com o componente. */
export function Miniatura({ arquivo }) {
  const url = usePrevia(arquivo);

  return (
    <span className="miniatura plate">
      {url ? <img src={url} alt="" /> : null}
    </span>
  );
}

/**
 * Endereço local de um arquivo, para mostrar a foto antes de ela existir no
 * servidor. Revogado ao trocar de arquivo ou ao sair — `createObjectURL` segura
 * o arquivo inteiro na memória da aba até alguém devolver.
 */
export function usePrevia(arquivo) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    if (!arquivo) {
      setUrl(null);
      return undefined;
    }
    const endereco = URL.createObjectURL(arquivo);
    setUrl(endereco);
    return () => URL.revokeObjectURL(endereco);
  }, [arquivo]);

  return url;
}
