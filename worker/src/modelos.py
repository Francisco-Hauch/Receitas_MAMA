"""Validação do que o Claude devolveu, antes de virar arquivo.

Por que isto existe se já usamos --json-schema:

O --json-schema garante o FORMATO — que "confianca" é um número, que
"ingredientes" é uma lista. Ele não garante SENTIDO. Passam sem reclamar:

    "confianca": 7.5          número, mas a escala é 0 a 1
    "ingredientes": []        lista, mas receita sem ingrediente não é receita
    "qtd": -200               número, mas não existe -200g de farinha
    "passos": ["", "  "]      strings, mas vazias

Cada regra abaixo nasceu de uma dessas. O objetivo é que nada torto chegue ao
disco — depois que grava, o site exibe.
"""

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Base(BaseModel):
    # extra="forbid": se o modelo inventar um campo que não pedimos, queremos
    # saber, não engolir calado.
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


# --------------------------------------------------------------------------
# Passada 1 — a receita da mamãe
# --------------------------------------------------------------------------
class Ingrediente(Base):
    bruto: str = Field(min_length=1)
    item: str = Field(min_length=1)
    # None é legítimo: "sal a gosto" não tem quantidade. O que não pode é zero
    # ou negativo, que seria erro de leitura.
    qtd: float | None = Field(default=None, gt=0)
    unidade: str | None = None


class Receita(Base):
    issue: int = Field(gt=0)
    titulo: str = Field(min_length=1)
    porcoes: int | None = Field(default=None, gt=0)
    tempo_min: int | None = Field(default=None, gt=0)
    ingredientes: list[Ingrediente] = Field(min_length=1)
    passos: list[str] = Field(min_length=1)
    tags: list[str] = Field(min_length=1)
    notas: str | None = None
    confianca: float = Field(ge=0, le=1)

    @field_validator("passos")
    @classmethod
    def sem_passo_vazio(cls, valor: list[str]) -> list[str]:
        limpos = [p.strip() for p in valor if p.strip()]
        if not limpos:
            raise ValueError("todos os passos vieram vazios")
        return limpos

    @field_validator("tags")
    @classmethod
    def normalizar_tags(cls, valor: list[str]) -> list[str]:
        # minúsculas e sem repetição, preservando a ordem em que vieram —
        # o site agrupa por tag, e "Forno" e "forno" virariam dois grupos.
        vistas, saida = set(), []
        for tag in valor:
            t = tag.strip().lower()
            if t and t not in vistas:
                vistas.add(t)
                saida.append(t)
        if not saida:
            raise ValueError("nenhuma tag válida")
        return saida


# --------------------------------------------------------------------------
# Passada 2 — o que a internet sugere. Nunca substitui nada acima.
# --------------------------------------------------------------------------
class Fonte(Base):
    url: str = Field(min_length=1)
    titulo: str | None = None
    # preenchido pelo verificar_fontes quando o site respondeu 403 e não deu
    # para confirmar que a página existe
    aviso: str | None = None


class IngredienteAusente(Base):
    item: str = Field(min_length=1)
    motivo: str = Field(min_length=1)


class PassoDetalhado(Base):
    # posição do passo original que este detalhe comenta; o primeiro passo é 0
    indice: int = Field(ge=0)
    detalhe: str = Field(min_length=1)


class Complemento(Base):
    issue: int = Field(gt=0)
    porcoes: int | None = Field(default=None, gt=0)
    tempo_min: int | None = Field(default=None, gt=0)
    temperatura_c: int | None = Field(default=None, gt=0)
    ingredientes_ausentes: list[IngredienteAusente] = []
    passos_detalhados: list[PassoDetalhado] = []
    dicas: list[str] = []
    fontes: list[Fonte] = []
    confianca: float = Field(ge=0, le=1)

    def vazio(self) -> bool:
        """Sem nada a acrescentar — não vale gravar arquivo."""
        return not any(
            (
                self.porcoes,
                self.tempo_min,
                self.temperatura_c,
                self.ingredientes_ausentes,
                self.passos_detalhados,
                self.dicas,
            )
        )
