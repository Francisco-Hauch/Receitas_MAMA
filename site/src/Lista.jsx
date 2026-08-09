import { useMemo, useState } from "react";

import { filtrar, receitas, tags } from "./dados.js";

export default function Lista() {
  const [termo, setTermo] = useState("");
  const [tag, setTag] = useState(null);

  const encontradas = useMemo(() => filtrar(termo, tag), [termo, tag]);

  if (receitas.length === 0) {
    return (
      <p className="vazio">
        Nenhuma receita ainda. Abra uma issue no repositório para mandar a
        primeira — o worker processa quando o computador ligar.
      </p>
    );
  }

  return (
    <>
      <input
        className="busca"
        type="search"
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        placeholder="Buscar por nome ou ingrediente"
        aria-label="Buscar receita"
      />

      {tags.length > 0 && (
        <ul className="tags">
          {tags.map((t) => (
            <li key={t}>
              <button
                type="button"
                className="tag"
                aria-pressed={tag === t}
                onClick={() => setTag(tag === t ? null : t)}
              >
                {t}
              </button>
            </li>
          ))}
        </ul>
      )}

      {encontradas.length === 0 ? (
        <p className="vazio">Nada com esse nome. Tente outra palavra.</p>
      ) : (
        <ul className="lista">
          {encontradas.map((r) => (
            <li key={r.id}>
              <a className="entrada" href={`#/${r.id}`}>
                <h2 className="entrada-titulo">{r.titulo}</h2>
                <p className="entrada-meta">
                  {r.ingredientes.length} ingredientes · {r.passos.length} passos
                  {r.tags.length > 0 && ` · ${r.tags.join(" ")}`}
                </p>
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
