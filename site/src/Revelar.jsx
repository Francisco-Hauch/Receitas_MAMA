/**
 * Peças de movimento que aparecem em mais de uma tela.
 *
 * Ficam juntas aqui para que "como um bloco entra" seja uma decisão só, tomada
 * num lugar só. Componente de página não deve escrever `initial`/`animate` na
 * mão: usa `<Revelar>` e herda o jeito da casa.
 */

import { motion } from "motion/react";

import {
  DUR,
  EASE,
  lista,
  mascarado,
  palavras,
  subir,
  subirHero,
  useContagem,
  useEntrada,
} from "./movimento.js";

/**
 * Bloco que sobe e clareia quando entra na tela. Revela uma vez só.
 *
 * `atraso` escalona irmãos que não estão dentro de um `<ListaRevelada>`;
 * `hero` usa a distância e a duração grandes do topo de página.
 */
export function Revelar({
  children,
  atraso = 0,
  hero = false,
  como = "div",
  ...resto
}) {
  const Tag = motion[como] ?? motion.div;
  const entrada = useEntrada();
  const base = hero ? subirHero : subir;
  const variantes = atraso
    ? {
        oculto: base.oculto,
        visivel: {
          ...base.visivel,
          transition: { ...base.visivel.transition, delay: atraso },
        },
      }
    : base;

  return (
    <Tag variants={variantes} {...entrada} {...resto}>
      {children}
    </Tag>
  );
}

/**
 * Container que escalona os filhos. Os filhos precisam usar `variants={subir}`
 * (ou ser um `<ItemRevelado>`) — o container só distribui o atraso.
 */
export function ListaRevelada({
  children,
  atraso = 0,
  intervalo,
  como = "div",
  ...resto
}) {
  const Tag = motion[como] ?? motion.div;
  const entrada = useEntrada();
  return (
    <Tag variants={lista(atraso, intervalo)} {...entrada} {...resto}>
      {children}
    </Tag>
  );
}

/** Filho de `<ListaRevelada>`. Não tem `whileInView`: quem manda é o pai. */
export function ItemRevelado({ children, como = "div", ...resto }) {
  const Tag = motion[como] ?? motion.div;
  return (
    <Tag variants={subir} {...resto}>
      {children}
    </Tag>
  );
}

/**
 * Título que sai de trás do papel, palavra por palavra.
 *
 * Cada palavra vive dentro de um `<span class="mascara">` que corta o que
 * transborda; a palavra começa 110% abaixo e sobe. Quebra de linha no texto
 * (`\n`) vira linha de verdade.
 *
 * Só para título de hero. Em parágrafo isso vira ruído: a pessoa está lendo,
 * não assistindo.
 */
export function TituloRevelado({ texto, como = "h1", atraso = 0, ...resto }) {
  const Tag = motion[como] ?? motion.h1;
  const linhas = palavras(texto);

  return (
    <Tag initial="oculto" animate="visivel" {...resto}>
      {linhas.map((linha, i) => (
        <span className="mascara-linha" key={i}>
          {linha.map(({ palavra, atraso: a }, j) => (
            <span className="mascara" key={j}>
              <motion.span
                className="mascara-alvo"
                variants={mascarado}
                transition={{
                  duration: DUR.lento,
                  ease: EASE.papel,
                  delay: atraso + a,
                }}
              >
                {palavra}
              </motion.span>
            </span>
          ))}
        </span>
      ))}
    </Tag>
  );
}

/**
 * Número que sobe até o valor com mola. Usado nas estatísticas da receita.
 *
 * `sufixo` fica fora da contagem para "35 min" não virar "3 min", "12 min",
 * "35 min" com a unidade dançando junto.
 */
export function Contador({ valor, sufixo = "", casas = 0, atraso = 0 }) {
  const texto = useContagem(valor, { casas, atraso });
  return (
    <span className="contador">
      <span className="contador-num">{texto}</span>
      {sufixo && <span className="contador-sufixo">{sufixo}</span>}
    </span>
  );
}
