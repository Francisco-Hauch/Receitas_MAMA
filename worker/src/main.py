"""Worker das receitas.

Uso, a partir da raiz do projeto (ou via worker\\executar.cmd):

    python -m worker.src.main               # só lista a fila
    python -m worker.src.main --processar   # transcreve, grava e fecha a issue
    python -m worker.src.main --enriquecer  # o mesmo + busca na web o que falta
    python -m worker.src.main --simular     # roda tudo sem gravar nem mexer nas issues
    python -m worker.src.main --processar --sem-commit   # grava, mas não publica

A ORDEM das operações em processar() é o que torna uma queda no meio segura:

    1. issue -> status:processando     (ninguém mais pega esta)
    2. grava o texto bruto             (nunca mais depende da issue)
    3. chama o Claude, valida
    4. GRAVA a receita                 <- ponto de virada
    5. issue -> status:pronto, fecha

Se o PC desligar entre o 4 e o 5, a issue fica presa em "processando" com a
receita já em disco. Por isso a próxima execução começa por recuperar(): ela
olha o DISCO, não a memória, e conserta a label. Gravar antes de marcar é o
que torna isso possível — o contrário perderia trabalho.
"""

import argparse
import json

from pydantic import ValidationError

from . import armazenar, claude, enriquecer, github, versionar
from .config import carregar
from .github import GitHub
from .modelos import Complemento, Receita
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


def recuperar(gh: GitHub) -> None:
    """Conserta issues que ficaram presas em 'processando' por uma queda.

    O disco decide: se a receita está gravada, o trabalho foi feito e só faltou
    marcar. Se não está, nada se perdeu e a issue volta para a fila.
    """
    presas = gh.listar_fila(github.PROCESSANDO)
    if not presas:
        return

    print(f"Retomando {len(presas)} issue(s) presa(s) em processando:")
    for issue in presas:
        numero = issue["number"]
        if armazenar.tem_receita(numero):
            gh.trocar_status(numero, github.PROCESSANDO, github.PRONTO)
            gh.fechar(numero)
            print(f"  #{numero}: receita já em disco -> pronto")
        else:
            gh.trocar_status(numero, github.PROCESSANDO, github.NOVO)
            print(f"  #{numero}: sem arquivo -> volta para a fila")
    print()


def validar(brutas: list[dict], modelo, rotulo: str) -> tuple[list, dict[int, str]]:
    """Passa cada item pelo Pydantic. Devolve (válidos, {issue: erro})."""
    validos, erros = [], {}

    for bruto in brutas:
        numero = bruto.get("issue")
        try:
            validos.append(modelo.model_validate(bruto))
        except ValidationError as e:
            # primeira falha basta para o relatório; o detalhe completo vai
            # para o comentário na issue
            problemas = "; ".join(
                f"{'.'.join(str(p) for p in d['loc'])}: {d['msg']}"
                for d in e.errors()[:5]
            )
            erros[numero] = problemas
            print(f"    #{numero}: {rotulo} inválido -> {problemas}")

    return validos, erros


def comentario_pronto(receita: Receita, caminho) -> str:
    return (
        f"Receita processada e gravada.\n\n"
        f"- **Título:** {receita.titulo}\n"
        f"- **Ingredientes:** {len(receita.ingredientes)}\n"
        f"- **Passos:** {len(receita.passos)}\n"
        f"- **Confiança:** {receita.confianca:.2f}\n"
        f"- **Arquivo:** `{caminho.relative_to(armazenar.RAIZ).as_posix()}`\n"
        + (f"\n**Observações do processamento:**\n{receita.notas}\n"
           if receita.notas else "")
    )


def processar(
    gh: GitHub,
    fila: list[dict],
    enriquecer_tambem: bool = False,
    simular: bool = False,
) -> tuple[dict[int, Receita], int]:
    itens = [issue_para_item(i) for i in fila]

    # Sem conteúdo não há o que fazer — evita gastar chamada à toa.
    validos = [i for i in itens if i["conteudo"]]
    if len(validos) < len(itens):
        vazios = [i["issue"] for i in itens if not i["conteudo"]]
        print(f"  ignorando {len(vazios)} issue(s) sem conteúdo: {vazios}\n")

    gravadas: dict[int, Receita] = {}

    for numero_lote, lote in enumerate(claude.em_lotes(validos), start=1):
        numeros = [i["issue"] for i in lote]
        print(f"--- lote {numero_lote}: issues {numeros}")

        if not simular:
            for n in numeros:
                gh.trocar_status(n, github.NOVO, github.PROCESSANDO)
            # o bruto vai para o disco ANTES da chamada: a partir daqui a
            # receita não depende mais da issue existir
            for item in lote:
                armazenar.salvar_bruto(item)

        try:
            receitas, uso = claude.estruturar(lote)
        except claude.ErroClaude as e:
            print(f"    FALHOU: {e}\n")
            if not simular:
                for n in numeros:
                    gh.trocar_status(n, github.PROCESSANDO, github.ERRO)
                    gh.comentar(n, f"Falha ao processar:\n\n```\n{e}\n```")
            continue

        print(f"    cache_creation={uso.get('cache_creation_input_tokens')} "
              f"cache_read={uso.get('cache_read_input_tokens')} "
              f"saida={uso.get('output_tokens')}")

        boas, erros = validar(receitas, Receita, "receita")

        for receita in boas:
            if simular:
                print(json.dumps(receita.model_dump(), ensure_ascii=False, indent=2))
                gravadas[receita.issue] = receita
                continue

            caminho = armazenar.salvar_receita(receita)  # <- ponto de virada
            gh.comentar(receita.issue, comentario_pronto(receita, caminho))
            gh.trocar_status(receita.issue, github.PROCESSANDO, github.PRONTO)
            gh.fechar(receita.issue)
            gravadas[receita.issue] = receita
            print(f"    #{receita.issue}: {caminho.name}")

        # o que o modelo não devolveu não pode ficar preso em "processando"
        mudas = set(numeros) - {r.issue for r in boas} - set(erros)
        for n in mudas:
            erros[n] = "o modelo não devolveu resposta para esta issue"
            print(f"    #{n}: sem resposta do modelo")

        if not simular:
            for n, motivo in erros.items():
                gh.trocar_status(n, github.PROCESSANDO, github.ERRO)
                gh.comentar(n, f"Não foi possível processar:\n\n> {motivo}")
        print()

    complementos = 0
    if enriquecer_tambem and gravadas:
        complementos = complementar(gravadas, simular)

    return gravadas, complementos


def complementar(gravadas: dict[int, Receita], simular: bool = False) -> int:
    """Passada 2. Falhar aqui NÃO invalida a receita: ela já está gravada."""
    print("\n=== passada 2: pesquisando complementos na web ===\n")

    receitas = list(gravadas.values())
    salvos = 0

    for numero_lote, lote in enumerate(
        claude.em_lotes(receitas, enriquecer.TAMANHO_LOTE), start=1
    ):
        print(f"--- lote {numero_lote}: issues {[r.issue for r in lote]}")

        try:
            brutos, uso = enriquecer.complementar(
                [r.model_dump(exclude_none=True) for r in lote]
            )
        except claude.ErroClaude as e:
            # sem trocar label: a receita continua pronta, só ficou sem sugestão
            print(f"    FALHOU (receitas seguem válidas): {e}\n")
            continue

        print(f"    cache_creation={uso.get('cache_creation_input_tokens')} "
              f"cache_read={uso.get('cache_read_input_tokens')} "
              f"saida={uso.get('output_tokens')}")

        for bruto in brutos:
            vivas, duvidosas, quebradas = enriquecer.verificar_fontes(bruto)
            if quebradas:
                print(f"    #{bruto.get('issue')}: {len(quebradas)} fonte(s) "
                      f"descartada(s): {[q['erro'] for q in quebradas]}")
            # duvidosas ficam, mas carregam "aviso" para o site sinalizar
            bruto["fontes"] = vivas + duvidosas

        bons, _ = validar(brutos, Complemento, "complemento")

        for comp in bons:
            receita = gravadas.get(comp.issue)
            if receita is None:
                print(f"    #{comp.issue}: complemento de issue não pedida")
                continue
            if comp.vazio():
                print(f"    #{comp.issue}: nada a acrescentar")
                continue

            if simular:
                print(json.dumps(comp.model_dump(), ensure_ascii=False, indent=2))
                continue

            caminho = armazenar.salvar_complemento(comp, receita.titulo)
            salvos += 1
            print(f"    #{comp.issue}: {caminho.name} "
                  f"({len(comp.fontes)} fonte(s), confiança {comp.confianca:.2f})")
        print()

    return salvos


def main() -> None:
    ap = argparse.ArgumentParser(description="Processa a fila de receitas.")
    ap.add_argument("--processar", action="store_true",
                    help="transcreve, grava os JSONs e fecha as issues")
    ap.add_argument("--enriquecer", action="store_true",
                    help="segunda passada: pesquisa na web o que falta (mais lento)")
    ap.add_argument("--simular", action="store_true",
                    help="mostra o resultado sem gravar nada nem mexer nas issues")
    ap.add_argument("--sem-commit", action="store_true",
                    help="grava os arquivos mas não commita nem empurra")
    args = ap.parse_args()

    cfg = carregar()
    gh = GitHub(cfg)

    print(f"Repositório: {cfg.owner}/{cfg.repo}")
    if args.simular:
        print("MODO SIMULAÇÃO: nada será gravado nem alterado.")

    # antes de pegar trabalho novo, conserta o que ficou pela metade
    if not args.simular:
        recuperar(gh)

    fila = gh.listar_fila()
    print(f"Na fila: {len(fila)} receita(s)\n")
    if not fila:
        return

    if not (args.processar or args.enriquecer or args.simular):
        listar(fila)
        print("\n(use --processar para gravar, ou --simular para só ver)")
        return

    gravadas, complementos = processar(
        gh, fila, enriquecer_tambem=args.enriquecer, simular=args.simular
    )

    if args.simular or args.sem_commit or not gravadas:
        return

    try:
        resumo = versionar.resumo_commit(list(gravadas), complementos)
        commit = versionar.publicar(resumo)
        print(f"Publicado: {commit}" if commit else "Nada novo em data/ para publicar.")
    except versionar.ErroGit as e:
        # os arquivos estão em disco e as issues já foram fechadas; só o envio
        # falhou, e isso o próximo `git push` seu resolve
        print(f"AVISO: não consegui publicar no git -> {e}")


if __name__ == "__main__":
    main()
