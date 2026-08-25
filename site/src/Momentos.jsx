/**
 * "Fotos de momentos" — a coluna lateral da receita, agora de verdade.
 *
 * Era um placeholder marcado "demonstração": a zona tinha hover e não tinha
 * `onDrop`. O que faltava não era o gesto, era o **destino**: `/api/receita`
 * cria uma receita nova, e ligar a zona nele faria cada foto do jantar virar
 * uma receita fantasma na fila. Por isso existe rota própria
 * (`POST /api/receita/:issue/fotos`), que só acrescenta foto a uma receita que
 * já existe.
 *
 * A associação não precisou ser inventada: o nome do arquivo já é a ligação.
 * `0003-2.webp` é a segunda foto da receita `0003-…` (ver `dados.js`), e o
 * número é o da issue, que não muda quando o título muda. O servidor só
 * continua a contagem.
 *
 * **O tempo é o assunto difícil aqui.** As fotos entram no *build*
 * (`import.meta.glob`), então entre soltar a foto e vê-la na galeria existe o
 * Cloudflare reconstruindo o site — cerca de um minuto. Fingir que a foto já
 * está lá seria mentir; deixar a tela imóvel seria parecer quebrado. A saída é
 * dizer: a foto aparece na hora numa moldura marcada "chegando", e o texto
 * conta o que falta. É o mesmo acordo do selo "demonstração" — o site não
 * finge.
 */

import { useState } from "react";
import { motion } from "motion/react";

import { GradeDeFotos, useFotos } from "./Galeria.jsx";
import { useArrasto, usePrevia } from "./Arrastar.jsx";
import { Revelar } from "./Revelar.jsx";
import {
  ACEITA_IMAGEM,
  ARQUIVO,
  chave,
  conferir,
  encolher,
  lerBase64,
  tipoDoArquivo,
} from "./arquivos.js";
import { DUR, EASE, MOLA } from "./movimento.js";
import { useSessao } from "./sessao.js";

// Quantas molduras vazias a galeria mostra enquanto a receita não tem foto.
const MOMENTOS_DEMO = 4;

export default function Momentos({ receita }) {
  const { podeEnviar } = useSessao();
  const { fotos } = useFotos();

  const [chegando, setChegando] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(null);

  const guardadas = chegando.filter((f) => f.estado === "guardada").length;

  async function receber(lista) {
    const novos = [...lista];
    if (novos.length === 0 || enviando) return;

    const estranho = novos.find((a) => tipoDoArquivo(a) !== "foto");
    if (estranho) {
      setErro(
        `"${estranho.name}" não é foto. Aqui entram só as fotos do preparo — ` +
          "receita nova vai pela página principal.",
      );
      return;
    }

    const problema = conferir(novos, ARQUIVO.foto.limite);
    if (problema) {
      setErro(problema);
      return;
    }

    setErro(null);
    setEnviando(true);

    // as molduras aparecem antes de a rede responder: o gesto teve efeito
    const lote = novos.map((arquivo, i) => ({
      id: `${chave(arquivo)}-${i}`,
      arquivo,
      estado: "subindo",
    }));
    setChegando((antes) => [...lote, ...antes]);

    try {
      const anexos = [];
      for (const arquivo of novos) {
        const pequena = await encolher(arquivo);
        anexos.push({
          nome: pequena.nome,
          tipo: pequena.tipo,
          base64: await lerBase64(pequena.blob, pequena.nome),
        });
      }

      const resposta = await fetch(`/api/receita/${receita.issue}/fotos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fotos: anexos }),
      });

      const dados = await resposta.json();
      if (!resposta.ok) throw new Error(dados.erro || "falhou ao guardar");

      setChegando((antes) =>
        antes.map((f) =>
          lote.some((l) => l.id === f.id) ? { ...f, estado: "guardada" } : f,
        ),
      );
    } catch (e) {
      setErro(e.message);
      // a foto não chegou: manter a moldura no ar seria a mentira que queríamos
      // evitar em primeiro lugar
      setChegando((antes) =>
        antes.filter((f) => !lote.some((l) => l.id === f.id)),
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <Revelar como="h6" className="secao-titulo">
        Fotos de momentos
      </Revelar>
      <Revelar como="p" className="secao-lede" atraso={0.05}>
        De vezes diferentes ou do meio do preparo. A mais recente é a que
        aparece grande aqui em cima e no card da lista.
      </Revelar>

      {podeEnviar && (
        <ZonaDeMomentos aoReceber={receber} enviando={enviando} />
      )}

      {erro && <p className="aviso-erro">{erro}</p>}

      {chegando.length > 0 && (
        <>
          <ul className="galeria galeria-viva">
            {chegando.map((f) => (
              <MolduraChegando key={f.id} foto={f} />
            ))}
          </ul>
          {guardadas > 0 && (
            <p className="momento-recado" role="status">
              {guardadas === 1 ? "Foto guardada" : `${guardadas} fotos guardadas`}
              . Entram na galeria quando o site se reconstruir — cerca de um
              minuto.{" "}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => window.location.reload()}
              >
                atualizar
              </button>
            </p>
          )}
        </>
      )}

      <GradeDeFotos vazias={MOMENTOS_DEMO} />

      {/* o selo de demonstração só faz sentido enquanto não há foto de
          verdade: com foto, a galeria é real e o selo mentiria */}
      {fotos.length === 0 && chegando.length === 0 && (
        <p style={{ marginTop: "10px" }}>
          <span className="demo-selo">demonstração</span>
        </p>
      )}
    </>
  );
}

/* --------------------------------------------------------------- peças */

/**
 * A zona em si. No celular ninguém arrasta: lá o convite é o botão, e o
 * seletor pede `image/*` para a câmera e a galeria aparecerem juntas.
 */
function ZonaDeMomentos({ aoReceber, enviando }) {
  const { arrastando, props } = useArrasto(aoReceber);

  return (
    <motion.div
      className="zona zona-lado"
      data-arrastando={arrastando}
      data-enviando={enviando}
      whileHover={enviando ? undefined : { borderColor: "var(--color-accent)" }}
      transition={MOLA}
      {...props}
    >
      <p className="zona-lado-titulo">
        <span className="em-mouse">Arraste as fotos deste preparo</span>
        <span className="em-toque">Fotos deste preparo</span>
      </p>
      <label className="btn btn-secondary btn-arquivo">
        {enviando ? "guardando…" : "escolher foto"}
        <input
          className="escondido"
          type="file"
          accept={ACEITA_IMAGEM}
          multiple
          disabled={enviando}
          onChange={(e) => {
            aoReceber(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      <span className="zona-lado-dica">
        Entram nesta receita, não na lista geral.
      </span>
    </motion.div>
  );
}

/** Moldura de foto que ainda não existe no servidor — ou que existe e ainda
 *  não entrou no build. Sem piscar: opacidade e selo bastam para dizer. */
function MolduraChegando({ foto }) {
  const url = usePrevia(foto.arquivo);

  return (
    <motion.li
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: DUR.medio, ease: EASE.papel }}
    >
      <span className="plate plate-mini plate-chegando" data-estado={foto.estado}>
        {url && <img className="plate-img" src={url} alt="" />}
        <span className="plate-selo">
          {foto.estado === "guardada" ? "chegando" : "subindo"}
        </span>
      </span>
    </motion.li>
  );
}
