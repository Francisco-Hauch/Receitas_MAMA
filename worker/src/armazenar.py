"""Grava os JSONs em disco. O disco é a fonte da verdade do projeto.

Decisão do nome do arquivo: "0001-pasta-de-alho-classica.json".

O número da issue vem na frente porque o título NÃO é estável. Na issue #1 a
mamãe escreveu "Pão de Alho" e o Claude devolveu "Pasta de Alho Clássica" —
se o nome do arquivo dependesse só do título, reprocessar a mesma receita
criaria um arquivo novo em vez de atualizar o antigo, e o site mostraria a
receita duplicada. Com o número na frente, "quem é o dono deste arquivo" é uma
pergunta com resposta única, e o resto do nome existe só para humano ler.
"""

import json
import re
import unicodedata
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
DADOS = RAIZ / "data"

RECEITAS = DADOS / "receitas"
COMPLEMENTOS = DADOS / "complementos"
BRUTOS = DADOS / "brutos"
FOTOS = DADOS / "fotos"

EXTENSOES_IMAGEM = {".jpg", ".jpeg", ".png", ".webp", ".heic"}


def slug(texto: str) -> str:
    """"Pão de Alho Clássico" -> "pao-de-alho-classico"."""
    # NFKD separa a letra do acento ("ã" vira "a" + "~"); o encode/decode em
    # ASCII descarta os acentos, que não sobrevivem à conversão.
    sem_acento = (
        unicodedata.normalize("NFKD", texto)
        .encode("ascii", "ignore")
        .decode("ascii")
    )
    limpo = re.sub(r"[^a-zA-Z0-9]+", "-", sem_acento).strip("-").lower()
    # nome de arquivo no Windows tem limite; 60 é folgado e ainda legível
    return limpo[:60] or "sem-titulo"


def nome_arquivo(issue: int, titulo: str) -> str:
    return f"{issue:04d}-{slug(titulo)}.json"


def _gravar(pasta: Path, issue: int, titulo: str, dados: dict) -> Path:
    """Grava e remove versões antigas da MESMA issue com título diferente."""
    pasta.mkdir(parents=True, exist_ok=True)
    destino = pasta / nome_arquivo(issue, titulo)

    # Se o título mudou entre execuções, sobrou um arquivo com o nome velho.
    # Sem isso, o site mostraria a receita duas vezes.
    for antigo in pasta.glob(f"{issue:04d}-*.json"):
        if antigo != destino:
            antigo.unlink()

    destino.write_text(
        json.dumps(dados, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",  # sem isso o Windows grava cp1252 e o site lê lixo
        newline="\n",  # e sem isso ele grava CRLF, que o .gitattributes teria
                       # de normalizar a cada gravação — ruído no diff quando o
                       # worker passar a commitar sozinho
    )
    return destino


def salvar_receita(receita) -> Path:
    return _gravar(RECEITAS, receita.issue, receita.titulo, receita.model_dump())


def salvar_complemento(complemento, titulo: str) -> Path:
    return _gravar(
        COMPLEMENTOS, complemento.issue, titulo, complemento.model_dump()
    )


def salvar_bruto(item: dict) -> Path:
    """Guarda o texto original como veio da issue.

    Vale o espaço: quando você melhorar o prompt, dá para reprocessar tudo sem
    precisar pedir a foto de novo pra mamãe.
    """
    return _gravar(
        BRUTOS, item["issue"], item.get("titulo") or "sem-titulo", item
    )


def salvar_foto(issue: int, indice: int, dados: bytes, extensao: str) -> Path:
    """Guarda uma foto anexada à issue. O nome traz a issue, como os JSONs.

    A foto fica no repositório de propósito: é o "bruto" das receitas que vieram
    por imagem. Sem ela, melhorar o prompt depois exigiria pedir a foto de novo.
    """
    FOTOS.mkdir(parents=True, exist_ok=True)
    destino = FOTOS / f"{issue:04d}-{indice}{extensao}"
    destino.write_bytes(dados)
    return destino


def achar_fotos(conteudo: str) -> tuple[list[Path], list[str]]:
    """Resolve os nomes escritos na issue para caminhos em data/fotos/.

    Devolve (encontradas, faltando). Aceita um nome por linha e ignora barras
    que a pessoa tenha digitado por hábito ("data/fotos/x.jpg" e "x.jpg" dão no
    mesmo) — o arquivo é sempre procurado dentro de FOTOS, nunca fora dela.
    """
    encontradas, faltando = [], []

    for linha in conteudo.splitlines():
        nome = linha.strip().strip("`").replace("\\", "/").split("/")[-1]
        if not nome:
            continue
        if Path(nome).suffix.lower() not in EXTENSOES_IMAGEM:
            faltando.append(f"{nome} (não parece nome de imagem)")
            continue

        caminho = FOTOS / nome
        if caminho.is_file():
            encontradas.append(caminho)
        else:
            faltando.append(nome)

    return encontradas, faltando


def tem_receita(issue: int) -> bool:
    """A receita desta issue já está gravada?

    É esta pergunta que permite se recuperar de uma queda no meio do processo:
    o arquivo em disco diz o que realmente aconteceu, sem depender de nenhum
    estado guardado em memória.
    """
    return any(RECEITAS.glob(f"{issue:04d}-*.json"))
