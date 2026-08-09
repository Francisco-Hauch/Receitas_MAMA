"""Worker das receitas.

Uso, a partir da raiz do projeto (ou via worker\\executar.cmd):

    python -m worker.src.main               # só lista a fila
    python -m worker.src.main --processar   # passada 1: transcreve fielmente
    python -m worker.src.main --enriquecer  # passada 1 + 2: busca o que falta
"""

import argparse
import json

from . import claude, enriquecer
from .config import carregar
from .github import GitHub
from .parser import parsear

# Rótulos exatamente como aparecem no formulário (.github/ISSUE_TEMPLATE).
# Se mudarem lá, mudam aqui.
CAMPO_TIPO = "Tipo de entrada"
CAMPO_CONTEUDO = "Conteúdo"
CAMPO_TITULO = "Nome da receita"
CAMPO_NOTAS = "Observações"


def issue_para_item(issue: dict) -> dict:
    """Converte uma issue crua da API no formato que o claude.py espera."""
    campos = parsear(issue["body"])
    return {
        "issue": issue["number"],
        "tipo": campos.get(CAMPO_TIPO),
        "conteudo": campos.get(CAMPO_CONTEUDO),
        "titulo": campos.get(CAMPO_TITULO),
        "notas": campos.get(CAMPO_NOTAS),
    }


def listar(fila: list[dict]) -> None:
    for issue in fila:
        item = issue_para_item(issue)
        conteudo = item["conteudo"] or ""
        print(f"  #{item['issue']:<4} [{item['tipo'] or '?'}] "
              f"{item['titulo'] or issue['title']} "
              f"({len(conteudo.splitlines())} linhas)")


def complementar(receitas: list[dict]) -> None:
    """Passada 2: busca na web e mostra as sugestões, com as fontes conferidas."""
    print("\n=== passada 2: pesquisando complementos na web ===\n")

    for numero_lote, lote in enumerate(
        claude.em_lotes(receitas, enriquecer.TAMANHO_LOTE), start=1
    ):
        issues = [r["issue"] for r in lote]
        print(f"--- lote {numero_lote}: issues {issues}")

        try:
            complementos, uso = enriquecer.complementar(lote)
        except claude.ErroClaude as e:
            print(f"    FALHOU: {e}\n")
            continue

        print(f"    cache_creation={uso.get('cache_creation_input_tokens')} "
              f"cache_read={uso.get('cache_read_input_tokens')} "
              f"saida={uso.get('output_tokens')}")

        for c in complementos:
            vivas, duvidosas, quebradas = enriquecer.verificar_fontes(c)
            if quebradas:
                # Não é motivo para descartar o complemento inteiro, mas o site
                # não pode exibir link morto como se fosse referência.
                print(f"    #{c['issue']}: {len(quebradas)} fonte(s) descartada(s): "
                      f"{[q['erro'] for q in quebradas]}")
            if duvidosas:
                print(f"    #{c['issue']}: {len(duvidosas)} fonte(s) não verificável(is)")
            # duvidosas ficam, mas carregam o campo "aviso" para o site sinalizar
            c["fontes"] = vivas + duvidosas

            print()
            print(json.dumps(c, ensure_ascii=False, indent=2))
        print()


def processar(fila: list[dict], enriquecer_tambem: bool = False) -> None:
    itens = [issue_para_item(i) for i in fila]

    # Sem conteúdo não há o que fazer — evita gastar chamada à toa.
    validos = [i for i in itens if i["conteudo"]]
    if len(validos) < len(itens):
        vazios = [i["issue"] for i in itens if not i["conteudo"]]
        print(f"  ignorando {len(vazios)} issue(s) sem conteúdo: {vazios}\n")

    todas: list[dict] = []

    for numero_lote, lote in enumerate(claude.em_lotes(validos), start=1):
        issues = [i["issue"] for i in lote]
        print(f"--- lote {numero_lote}: issues {issues}")

        try:
            receitas, uso = claude.estruturar(lote)
        except claude.ErroClaude as e:
            print(f"    FALHOU: {e}\n")
            continue

        print(f"    cache_creation={uso.get('cache_creation_input_tokens')} "
              f"cache_read={uso.get('cache_read_input_tokens')} "
              f"saida={uso.get('output_tokens')}")

        # O modelo pode devolver menos itens do que pedimos; conferimos.
        devolvidas = {r["issue"] for r in receitas}
        faltando = set(issues) - devolvidas
        if faltando:
            print(f"    ATENÇÃO: sem resposta para {sorted(faltando)}")

        for r in receitas:
            print()
            print(json.dumps(r, ensure_ascii=False, indent=2))
        print()

        todas.extend(receitas)

    if enriquecer_tambem and todas:
        complementar(todas)


def main() -> None:
    ap = argparse.ArgumentParser(description="Processa a fila de receitas.")
    ap.add_argument(
        "--processar",
        action="store_true",
        help="manda a fila para o Claude e mostra o JSON estruturado",
    )
    ap.add_argument(
        "--enriquecer",
        action="store_true",
        help="segunda passada: pesquisa na web e sugere o que falta (mais lento)",
    )
    args = ap.parse_args()

    cfg = carregar()
    gh = GitHub(cfg)

    fila = gh.listar_fila()
    print(f"Repositório: {cfg.owner}/{cfg.repo}")
    print(f"Na fila: {len(fila)} receita(s)\n")

    if not fila:
        return

    if args.processar or args.enriquecer:
        processar(fila, enriquecer_tambem=args.enriquecer)
    else:
        listar(fila)
        print("\n(use --processar para mandar ao Claude)")


if __name__ == "__main__":
    main()
