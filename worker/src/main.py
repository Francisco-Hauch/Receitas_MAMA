"""Etapa 4: lê a fila de receitas e mostra o que entendeu de cada issue.

Uso, a partir da raiz do projeto:

    .venv/Scripts/python.exe -m worker.src.main
"""

from .config import carregar
from .github import GitHub
from .parser import parsear


def main() -> None:
    cfg = carregar()
    gh = GitHub(cfg)

    fila = gh.listar_fila()
    print(f"Repositório: {cfg.owner}/{cfg.repo}")
    print(f"Na fila: {len(fila)} receita(s) aguardando\n")

    for issue in fila:
        campos = parsear(issue["body"])

        print("=" * 60)
        print(f"Issue #{issue['number']}: {issue['title']}")
        print(f"Aberta em {issue['created_at']}")
        print("-" * 60)

        for rotulo, valor in campos.items():
            if valor is None:
                print(f"  {rotulo}: (vazio)")
            else:
                # mostra só a primeira linha, pra saída não virar uma parede
                primeira = valor.splitlines()[0]
                resto = len(valor.splitlines()) - 1
                sufixo = f"  (+{resto} linha(s))" if resto else ""
                print(f"  {rotulo}: {primeira}{sufixo}")

        print()


if __name__ == "__main__":
    main()
