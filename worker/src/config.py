"""Carrega e valida a configuração vinda do arquivo .env."""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# __file__ é .../worker/src/config.py
#   parents[0] = src   parents[1] = worker   parents[2] = raiz do projeto
RAIZ = Path(__file__).resolve().parents[2]

OBRIGATORIAS = ("GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPO")


@dataclass(frozen=True)
class Config:
    token: str
    owner: str
    repo: str

    @property
    def url_repo(self) -> str:
        return f"https://api.github.com/repos/{self.owner}/{self.repo}"


def carregar() -> Config:
    """Lê o .env da raiz e devolve a configuração já validada."""
    load_dotenv(RAIZ / ".env")

    faltando = [nome for nome in OBRIGATORIAS if not os.getenv(nome)]
    if faltando:
        raise SystemExit(
            f"Faltam variáveis no .env: {', '.join(faltando)}\n"
            f"Copie o .env.example para .env e preencha."
        )

    return Config(
        token=os.environ["GITHUB_TOKEN"],
        owner=os.environ["GITHUB_OWNER"],
        repo=os.environ["GITHUB_REPO"],
    )
