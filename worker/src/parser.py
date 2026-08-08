"""Converte o corpo em Markdown de um Issue Form num dicionário.

O GitHub renderiza cada campo do formulário como:

    ### Rótulo do campo

    valor digitado

Campos opcionais deixados em branco viram a string literal "_No response_".
"""

import re

SEM_RESPOSTA = "_No response_"

# Captura as linhas que começam com "### " e guarda o texto do rótulo.
# MULTILINE faz o ^ casar no início de cada linha, não só do texto todo.
CABECALHO = re.compile(r"^###\s+(.+?)\s*$", re.MULTILINE)


def parsear(corpo: str | None) -> dict[str, str | None]:
    """Devolve {rótulo: valor}, com None onde o campo veio vazio."""
    if not corpo:
        return {}

    campos: dict[str, str | None] = {}
    marcas = list(CABECALHO.finditer(corpo))

    for i, marca in enumerate(marcas):
        rotulo = marca.group(1)

        # o valor vai do fim deste cabeçalho até o começo do próximo
        # (ou até o fim do texto, se for o último campo)
        inicio = marca.end()
        fim = marcas[i + 1].start() if i + 1 < len(marcas) else len(corpo)

        valor = corpo[inicio:fim].strip()
        campos[rotulo] = None if not valor or valor == SEM_RESPOSTA else valor

    return campos
