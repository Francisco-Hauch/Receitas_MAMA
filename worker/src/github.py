"""Cliente mínimo da API REST do GitHub — só o que este projeto usa."""

import requests

from .config import Config

TIMEOUT = 30  # segundos; sem isso um servidor mudo trava o worker pra sempre

LABEL_MARCADOR = "receita"
NOVO = "status:novo"
PROCESSANDO = "status:processando"
PRONTO = "status:pronto"
ERRO = "status:erro"


class GitHub:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        # Session reaproveita a conexão TCP entre chamadas e guarda os headers.
        self.sessao = requests.Session()
        self.sessao.headers.update(
            {
                "Authorization": f"Bearer {cfg.token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            }
        )

    def _url(self, caminho: str) -> str:
        return f"{self.cfg.url_repo}{caminho}"

    def listar_fila(self, status: str = NOVO) -> list[dict]:
        """Issues abertas com as labels 'receita' E o status pedido."""
        resposta = self.sessao.get(
            self._url("/issues"),
            params={
                "state": "open",
                "labels": f"{LABEL_MARCADOR},{status}",
                "per_page": 100,
                "sort": "created",
                "direction": "asc",  # mais antigas primeiro: fila de verdade
            },
            timeout=TIMEOUT,
        )
        resposta.raise_for_status()

        # PEGADINHA: /issues devolve pull requests junto com as issues.
        # Só PR tem a chave "pull_request", então dá pra separar por ela.
        return [item for item in resposta.json() if "pull_request" not in item]

    def trocar_status(self, numero: int, de: str, para: str) -> None:
        """Remove uma label de status e coloca outra."""
        # 404 aqui significa "essa label já não estava na issue" — não é erro.
        self.sessao.delete(
            self._url(f"/issues/{numero}/labels/{de}"), timeout=TIMEOUT
        )
        resposta = self.sessao.post(
            self._url(f"/issues/{numero}/labels"),
            json={"labels": [para]},
            timeout=TIMEOUT,
        )
        resposta.raise_for_status()

    def comentar(self, numero: int, texto: str) -> None:
        resposta = self.sessao.post(
            self._url(f"/issues/{numero}/comments"),
            json={"body": texto},
            timeout=TIMEOUT,
        )
        resposta.raise_for_status()

    def fechar(self, numero: int) -> None:
        resposta = self.sessao.patch(
            self._url(f"/issues/{numero}"),
            json={"state": "closed"},
            timeout=TIMEOUT,
        )
        resposta.raise_for_status()
