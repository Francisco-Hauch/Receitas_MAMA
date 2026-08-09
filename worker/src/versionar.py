"""Faz o worker commitar e empurrar sozinho o que gravou.

Três cuidados que um commit automático exige e um manual não:

1. ESCOPO. O worker commita SÓ data/. Se você estiver no meio de uma edição em
   worker/ quando ele rodar de madrugada, o código pela metade não pode entrar
   no commit junto. Por isso o pathspec no fim do commit -- é obrigatório aqui,
   não é estilo.

2. IDENTIDADE. O commit sai com nome "worker das receitas" e o SEU e-mail: o
   GitHub liga ao seu perfil pelo e-mail, e o nome deixa óbvio no histórico que
   foi a máquina. Passamos com -c em vez de git config, para não mexer na sua
   configuração global.

3. O REMOTO PODE TER ANDADO. Se você commitou do notebook, o push é recusado.
   Aí tentamos um rebase e um segundo push — uma vez só. Se ainda falhar, o
   worker desiste e avisa, em vez de insistir e fazer besteira sozinho.
"""

import subprocess
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]

GIT = "git"
TIMEOUT = 180

# Só isto pode entrar num commit automático.
ESCOPO = "data"

AUTOR_NOME = "worker das receitas"


class ErroGit(RuntimeError):
    """Falha em algum comando do git."""


def _git(*args: str, checar: bool = True) -> subprocess.CompletedProcess:
    processo = subprocess.run(
        [GIT, *args],
        cwd=RAIZ,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=TIMEOUT,
    )
    if checar and processo.returncode != 0:
        raise ErroGit(
            f"git {' '.join(args)} falhou ({processo.returncode}): "
            f"{(processo.stderr or processo.stdout).strip()[:400]}"
        )
    return processo


def _email() -> str:
    """Reaproveita o e-mail já configurado no repo."""
    resultado = _git("config", "user.email", checar=False)
    return resultado.stdout.strip() or "worker@localhost"


def ramo_atual() -> str:
    """Nome do ramo, ou vazio se o HEAD estiver solto."""
    resultado = _git("symbolic-ref", "--quiet", "--short", "HEAD", checar=False)
    return resultado.stdout.strip()


def ha_novidade() -> bool:
    """Tem algo em data/ diferente do último commit?

    --quiet faz o git responder pelo código de saída: 1 = há diferença.
    É mais barato e mais confiável que ler a saída do status.
    """
    resultado = _git("status", "--porcelain", "--", ESCOPO, checar=False)
    return bool(resultado.stdout.strip())


def sincronizar() -> str:
    """Traz o que chegou pelo site do GitHub antes de processar.

    Existe por causa das fotos: você sobe a imagem em data/fotos/ pelo navegador
    do celular, o que cria um commit direto no remoto. Sem este passo o worker
    procuraria no disco um arquivo que só existe no GitHub.

    O autostash guarda mudanças locais antes do rebase e devolve depois — sem
    ele, qualquer arquivo modificado faria o rebase recusar e o worker parar por
    um motivo que ninguém está olhando às 3 da manhã.
    """
    ramo = ramo_atual()
    if not ramo:
        raise ErroGit("HEAD solto (detached): recuso sincronizar")

    _git("fetch", "origin", ramo)

    rebase = _git(
        "-c", "rebase.autostash=true", "rebase", f"origin/{ramo}", checar=False
    )
    if rebase.returncode != 0:
        _git("rebase", "--abort", checar=False)
        raise ErroGit(
            f"não consegui sincronizar com origin/{ramo}: "
            f"{(rebase.stderr or rebase.stdout).strip()[:300]}"
        )

    return _git("rev-parse", "--short", "HEAD").stdout.strip()


def publicar(resumo: str) -> str | None:
    """Commita data/ e empurra. Devolve o hash, ou None se não havia novidade."""
    ramo = ramo_atual()
    if not ramo:
        raise ErroGit("HEAD solto (detached): recuso commitar automaticamente")

    if not ha_novidade():
        return None

    email = _email()
    identidade = ["-c", f"user.name={AUTOR_NOME}", "-c", f"user.email={email}"]

    _git("add", "--", ESCOPO)
    # o "-- ESCOPO" no fim é a trava do cuidado 1: mesmo que haja outra coisa
    # no index, só data/ entra neste commit
    _git(*identidade, "commit", "-m", resumo, "--", ESCOPO)

    empurrado = _git("push", "origin", ramo, checar=False)
    if empurrado.returncode != 0:
        # provavelmente o remoto andou; tenta reconciliar UMA vez
        _git("fetch", "origin", ramo)
        rebase = _git(*identidade, "rebase", f"origin/{ramo}", checar=False)
        if rebase.returncode != 0:
            _git("rebase", "--abort", checar=False)
            raise ErroGit(
                "o remoto tem commits que conflitam com os daqui; "
                "o commit local foi feito, mas o push precisa de você"
            )
        _git("push", "origin", ramo)

    return _git("rev-parse", "--short", "HEAD").stdout.strip()


def resumo_commit(issues: list[int], complementos: int = 0) -> str:
    """Mensagem no mesmo estilo das suas: prefixo, minúscula, direto."""
    quantidade = len(issues)
    numeros = ", ".join(f"#{n}" for n in sorted(issues))
    substantivo = "receita processada" if quantidade == 1 else "receitas processadas"

    linhas = [f"chore: {quantidade} {substantivo} ({numeros})"]
    if complementos:
        linhas.append("")
        plural = "complemento" if complementos == 1 else "complementos"
        linhas.append(f"Inclui {complementos} {plural} da passada 2.")
    return "\n".join(linhas)
