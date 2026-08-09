"""Passada 2: pesquisa na web e SUGERE complementos. Nunca edita a receita.

Por que uma segunda chamada em vez de pedir tudo de uma vez:

1. Origem virou fato, não promessa. Pedir "complete e marque o que foi você"
   confia no modelo para ser honesto sobre a própria contribuição. Aqui a
   receita e os complementos vêm de chamadas diferentes e vão para arquivos
   diferentes — não tem como um vazar no outro.

2. A passada 1 continua barata. Ligar ferramentas muda o prefixo e portanto o
   cache; são dois caches distintos, e o da transcrição segue intacto.

3. Isolamento de falha. Se a busca falhar, você ainda tem a receita da mamãe
   transcrita e gravada.

Medido neste projeto: o headless CONSEGUE buscar (WebSearch aparece no
stream-json), mas a URL que ele cita na resposta final pode estar errada — a
que testamos devolvia HTTP 301. Por isso verificar_fontes() confere cada link
antes de gravar.
"""

import json

import requests

from .claude import EXECUTAVEL, ErroClaude, MODELO, chamar  # noqa: F401

# Buscar na web leva vários turnos por receita, então o lote é menor que o da
# passada 1: menos coisa perdida se estourar o tempo.
TAMANHO_LOTE = 3

# Sem --max-turns no CLI, o timeout é o único freio contra uma busca que se
# arrasta. Generoso, porque 3 receitas x várias buscas somam.
TIMEOUT_FONTE = 10  # segundos para checar cada URL


# --------------------------------------------------------------------------
# Esquema congelado da passada 2. Repare no que NÃO tem aqui: "ingredientes"
# e "passos". Este esquema é incapaz de expressar uma receita — só adendos.
# --------------------------------------------------------------------------
ESQUEMA = {
    "type": "object",
    "properties": {
        "complementos": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "issue": {"type": "integer"},
                    "porcoes": {"type": "integer"},
                    "tempo_min": {"type": "integer"},
                    "temperatura_c": {"type": "integer"},
                    "ingredientes_ausentes": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "item": {"type": "string"},
                                "motivo": {"type": "string"},
                            },
                            "required": ["item", "motivo"],
                        },
                    },
                    "passos_detalhados": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                # posição do passo original (base 0) que este
                                # detalhe comenta — é assim que o site ancora
                                # a sugestão ao lado do passo certo
                                "indice": {"type": "integer"},
                                "detalhe": {"type": "string"},
                            },
                            "required": ["indice", "detalhe"],
                        },
                    },
                    "dicas": {"type": "array", "items": {"type": "string"}},
                    "fontes": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "url": {"type": "string"},
                                "titulo": {"type": "string"},
                            },
                            "required": ["url"],
                        },
                    },
                    "confianca": {"type": "number"},
                },
                "required": ["issue", "fontes", "confianca"],
            },
        }
    },
    "required": ["complementos"],
}

ESQUEMA_JSON = json.dumps(ESQUEMA, sort_keys=True, ensure_ascii=False)

FLAGS = [
    "-p",
    "--output-format", "json",
    "--model", MODELO,
    "--json-schema", ESQUEMA_JSON,
    "--allowed-tools", "WebSearch,WebFetch",
    "--no-session-persistence",
    "--strict-mcp-config",
]

TIMEOUT = 900  # 15 min: 3 receitas com busca somam bem mais que a passada 1


INSTRUCAO = """\
Você recebe receitas de família JÁ TRANSCRITAS, em JSON. Seu trabalho é \
pesquisar na web e sugerir o que está FALTANDO nelas.

Regra que manda em todas as outras: você NÃO reescreve a receita. Não corrija \
ingredientes, não reordene passos, não "melhore" nada que já está lá. A \
receita é da família e fica como está. Você só acrescenta ao lado.

Regras:
- Pesquise na web antes de sugerir tempo, temperatura ou porções. Não responda \
de memória.
- Só preencha um campo se ele estiver AUSENTE na receita recebida. Se a receita \
já diz o tempo, omita "tempo_min".
- Copie cada URL EXATAMENTE como veio no resultado da busca. Não reconstrua \
link de memória, não adivinhe o caminho do artigo.
- "fontes": as páginas que você realmente consultou para ESTA receita.
- "ingredientes_ausentes": itens que receitas parecidas têm e esta não menciona, \
cada um com o "motivo" em uma frase. No máximo 4.
- "passos_detalhados": "indice" é a posição do passo original (o primeiro é 0) \
e "detalhe" explica o ponto, a técnica ou o sinal de que deu certo. Não repita \
o passo.
- "dicas": no máximo 3, sobre técnica, substituição ou conservação.
- "confianca" de 0 a 1: quanto as fontes concordam entre si e com a receita.
- Se não achar fonte confiável, devolva o complemento com as listas vazias e \
confiança baixa. É melhor não sugerir nada do que sugerir errado.
- "issue" deve repetir EXATAMENTE o número informado no bloco.
- Devolva uma entrada em "complementos" para CADA receita recebida, na mesma ordem.
"""


def montar_prompt(receitas: list[dict]) -> str:
    """Manda a receita já estruturada — ele precisa ver o que falta."""
    partes = [INSTRUCAO]

    for receita in receitas:
        partes.append(f"\n{'=' * 60}\nISSUE: {receita['issue']}")
        partes.append(json.dumps(receita, ensure_ascii=False, indent=2))

    return "\n".join(partes)


def complementar(receitas: list[dict]) -> tuple[list[dict], dict]:
    """Roda a passada 2 sobre um lote de receitas já estruturadas."""
    if not receitas:
        return [], {}

    conteudo, uso = chamar(FLAGS, montar_prompt(receitas), timeout=TIMEOUT)
    return conteudo.get("complementos", []), uso


# Códigos que significam "o servidor recusou a pergunta", não "a página não
# existe": proteção anti-bot. Medido: alguns sites de receita respondem 403 a
# qualquer cliente que não seja um navegador de verdade, com ou sem User-Agent
# falsificado. Descartar essas fontes jogaria fora link possivelmente bom.
INCONCLUSIVOS = (401, 403, 405, 429)


def verificar_fontes(complemento: dict) -> tuple[list[dict], list[dict], list[dict]]:
    """Separa as fontes em (vivas, duvidosas, quebradas).

    allow_redirects=False de propósito: um artigo que redireciona para a home
    do site não é a página que o modelo diz ter lido. Foi exatamente assim que
    pegamos a primeira URL inventada neste projeto — HTTP 301.
    """
    vivas, duvidosas, quebradas = [], [], []

    for fonte in complemento.get("fontes", []):
        url = fonte.get("url", "")
        try:
            resposta = requests.head(
                url, timeout=TIMEOUT_FONTE, allow_redirects=False
            )
            codigo = resposta.status_code
            # alguns servidores simplesmente não implementam HEAD
            if codigo == 405:
                resposta = requests.get(
                    url, timeout=TIMEOUT_FONTE, allow_redirects=False, stream=True
                )
                codigo = resposta.status_code
                resposta.close()
        except requests.RequestException as e:
            quebradas.append({**fonte, "erro": type(e).__name__})
            continue

        if codigo == 200:
            vivas.append(fonte)
        elif codigo in INCONCLUSIVOS:
            duvidosas.append({**fonte, "aviso": f"HTTP {codigo} (não verificável)"})
        else:
            quebradas.append({**fonte, "erro": f"HTTP {codigo}"})

    return vivas, duvidosas, quebradas
