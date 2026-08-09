"""Passada 1: transcreve a receita da mamãe, fielmente e sem internet.

Este módulo NUNCA acrescenta nada. Se a receita não diz o tempo de forno, o
JSON sai sem tempo de forno. Completar é trabalho do enriquecer.py, que grava
em outro arquivo — assim a origem de cada informação é um fato sobre qual
chamada a produziu, e não uma auto-declaração do modelo.

Duas medições feitas neste projeto ditam o desenho deste módulo:

1. Cada invocação carrega ~38 mil tokens fixos (system prompt + definição das
   ferramentas), independente do tamanho do prompt. Por isso mandamos VÁRIAS
   receitas por chamada — o overhead é pago uma vez para o lote inteiro.

2. Chamadas com prefixo byte-a-byte idêntico reaproveitam o cache de prompt e
   custam ~5x menos. Por isso FLAGS e ESQUEMA são constantes congeladas: basta
   mudar uma vírgula no esquema para o cache ser descartado.
"""

import json
import subprocess

EXECUTAVEL = "claude"
MODELO = "sonnet"

# Segundos. Um lote de 5 receitas levou ~20s nos testes; 10 min é folga larga
# para o caso de a API estar lenta, sem deixar o worker pendurado pra sempre.
TIMEOUT = 600

# Quantas receitas por chamada. Maior = menos overhead, mas resposta mais longa
# e mais trabalho perdido se a chamada falhar.
TAMANHO_LOTE = 5


# --------------------------------------------------------------------------
# Esquema congelado. NÃO edite sem entender que isso invalida o cache.
# --------------------------------------------------------------------------
ESQUEMA = {
    "type": "object",
    "properties": {
        "receitas": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "issue": {"type": "integer"},
                    "titulo": {"type": "string"},
                    "porcoes": {"type": "integer"},
                    "tempo_min": {"type": "integer"},
                    "ingredientes": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "bruto": {"type": "string"},
                                "qtd": {"type": "number"},
                                "unidade": {"type": "string"},
                                "item": {"type": "string"},
                            },
                            "required": ["bruto", "item"],
                        },
                    },
                    "passos": {"type": "array", "items": {"type": "string"}},
                    "tags": {"type": "array", "items": {"type": "string"}},
                    "notas": {"type": "string"},
                    "confianca": {"type": "number"},
                },
                "required": [
                    "issue",
                    "titulo",
                    "ingredientes",
                    "passos",
                    "tags",
                    "confianca",
                ],
            },
        }
    },
    "required": ["receitas"],
}

# sort_keys garante que o JSON saia sempre na mesma ordem de chaves — se a
# serialização variasse entre execuções, o cache seria perdido toda vez.
ESQUEMA_JSON = json.dumps(ESQUEMA, sort_keys=True, ensure_ascii=False)

FLAGS = [
    "-p",
    "--output-format", "json",
    "--model", MODELO,
    "--json-schema", ESQUEMA_JSON,
    "--no-session-persistence",
    "--strict-mcp-config",
]

# Receita que veio em foto: o Claude precisa da ferramenta Read para abrir o
# arquivo. Medido: ele lê .jpg/.png e descreve corretamente — por isso este
# projeto NÃO precisa de um modelo de OCR separado.
#
# Ligar a ferramenta muda o prefixo e portanto o cache: são dois caches
# distintos, um para texto e um para foto. Cada um se mantém quente sozinho.
FLAGS_FOTO = [*FLAGS, "--allowed-tools", "Read"]

# Fotos são mais caras e mais lentas que texto; lote menor.
TAMANHO_LOTE_FOTO = 2


INSTRUCAO = """\
Você recebe receitas em texto bruto: OCR de caderno manuscrito, transcrição de \
áudio ou texto colado. Estruture cada uma.

Regras:
- Escreva tudo em português do Brasil, corrigindo ortografia e acentuação.
- Em cada ingrediente mantenha o texto original em "bruto" e normalize em \
"qtd"/"unidade"/"item". Use g para sólidos e ml para líquidos quando a \
conversão for razoável; para contáveis (ovos, dentes de alho) use "unidade".
- Se não souber um valor opcional, OMITA o campo. Nunca invente número.
- "passos" contém só o modo de preparo, uma ação por item, no imperativo.
- "tags" em minúsculas, sem acento em palavra composta desnecessária: tipo do \
prato, método e ocasião. Entre 2 e 6.
- "confianca" de 0 a 1: quanto você confia na leitura. Abaixe quando o texto \
estiver ilegível ou ambíguo, e quando você tiver estimado conversões.
- "notas": registre aqui o que ficou duvidoso e o que você assumiu.
- "issue" deve repetir EXATAMENTE o número informado no bloco.
- Devolva uma entrada em "receitas" para CADA bloco recebido, na mesma ordem.
"""


INSTRUCAO_FOTO = """\
Cada bloco abaixo indica arquivos de imagem de uma receita: foto de caderno \
manuscrito, de livro ou de papel avulso. ABRA cada arquivo com a ferramenta \
Read e transcreva o que está escrito.

Regras:
- Leia TODOS os arquivos listados no bloco antes de responder: uma receita \
costuma ocupar mais de uma foto (ingredientes numa, preparo noutra).
- Escreva tudo em português do Brasil, corrigindo ortografia e acentuação.
- Em cada ingrediente mantenha o texto original em "bruto" e normalize em \
"qtd"/"unidade"/"item". Use g para sólidos e ml para líquidos quando a \
conversão for razoável; para contáveis (ovos, dentes de alho) use "unidade".
- Se não souber um valor opcional, OMITA o campo. Nunca invente número.
- Se um trecho estiver ilegível, NÃO adivinhe: registre em "notas" o que não \
deu para ler e abaixe a "confianca".
- "passos" contém só o modo de preparo, uma ação por item, no imperativo.
- "tags" em minúsculas: tipo do prato, método e ocasião. Entre 2 e 6.
- "confianca" de 0 a 1: quanto você confia na leitura da letra e da foto.
- "issue" deve repetir EXATAMENTE o número informado no bloco.
- Devolva uma entrada em "receitas" para CADA bloco recebido, na mesma ordem.
"""


class ErroClaude(RuntimeError):
    """Falha ao chamar o headless ou ao interpretar a resposta."""


def _cabecalho(item: dict) -> list[str]:
    """A parte do bloco que é igual para texto e para foto."""
    partes = [f"\n{'=' * 60}\nISSUE: {item['issue']}"]
    partes.append(f"ORIGEM: {item.get('tipo') or 'desconhecida'}")
    if item.get("titulo"):
        partes.append(f"NOME SUGERIDO: {item['titulo']}")
    if item.get("notas"):
        partes.append(f"OBSERVAÇÕES DE QUEM ENVIOU: {item['notas']}")
    return partes


def montar_prompt(itens: list[dict]) -> str:
    """Junta vários itens de texto num prompt só."""
    partes = [INSTRUCAO]

    for item in itens:
        partes.extend(_cabecalho(item))
        partes.append(f"\nTEXTO:\n{item['conteudo']}")

    return "\n".join(partes)


def montar_prompt_foto(itens: list[dict]) -> str:
    """Idem, mas cada item traz 'arquivos': caminhos absolutos das imagens."""
    partes = [INSTRUCAO_FOTO]

    for item in itens:
        partes.extend(_cabecalho(item))
        arquivos = "\n".join(str(caminho) for caminho in item["arquivos"])
        partes.append(f"\nARQUIVOS PARA LER:\n{arquivos}")

    return "\n".join(partes)


def chamar(flags: list[str], prompt: str, timeout: int = TIMEOUT) -> tuple[dict, dict]:
    """Roda o headless e devolve (JSON do modelo, métricas de uso).

    Genérica de propósito: quem chama escolhe as flags. A segunda passada
    (enriquecer.py) usa as mesmas mecânicas com outro esquema e outras
    ferramentas, e não queremos duas cópias deste tratamento de erro.
    """
    try:
        processo = subprocess.run(
            [EXECUTAVEL, *flags],
            input=prompt,
            capture_output=True,
            text=True,
            encoding="utf-8",  # sem isso o Windows usa cp1252 e come os acentos
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as e:
        raise ErroClaude(f"o Claude não respondeu em {timeout}s") from e
    except FileNotFoundError as e:
        raise ErroClaude(f"executável '{EXECUTAVEL}' não encontrado no PATH") from e

    if processo.returncode != 0:
        raise ErroClaude(
            f"claude saiu com código {processo.returncode}: "
            f"{(processo.stderr or '').strip()[:400]}"
        )

    # PRIMEIRA camada de JSON: o envelope do próprio Claude Code.
    try:
        envelope = json.loads(processo.stdout)
    except json.JSONDecodeError as e:
        raise ErroClaude(f"stdout não era JSON: {processo.stdout[:400]}") from e

    if envelope.get("is_error"):
        raise ErroClaude(
            f"erro reportado pelo Claude: {envelope.get('result')} "
            f"(api_error_status={envelope.get('api_error_status')})"
        )

    # SEGUNDA camada: o campo "result" é uma STRING contendo o JSON do modelo.
    try:
        conteudo = json.loads(envelope["result"])
    except (KeyError, json.JSONDecodeError) as e:
        raise ErroClaude(
            f"'result' não continha JSON válido: {str(envelope.get('result'))[:400]}"
        ) from e

    return conteudo, envelope.get("usage", {})


def estruturar(itens: list[dict]) -> tuple[list[dict], dict]:
    """Passada 1: transcreve fielmente. Sem ferramentas, sem internet."""
    if not itens:
        return [], {}

    conteudo, uso = chamar(FLAGS, montar_prompt(itens))
    return conteudo.get("receitas", []), uso


def estruturar_fotos(itens: list[dict]) -> tuple[list[dict], dict]:
    """Passada 1 para fotos: mesma saída, mas lendo imagens do disco."""
    if not itens:
        return [], {}

    conteudo, uso = chamar(FLAGS_FOTO, montar_prompt_foto(itens))
    return conteudo.get("receitas", []), uso


def em_lotes(itens: list[dict], tamanho: int = TAMANHO_LOTE):
    """Fatia a fila em lotes do tamanho configurado."""
    for i in range(0, len(itens), tamanho):
        yield itens[i : i + tamanho]
