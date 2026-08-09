"""Registra (ou remove) a tarefa noturna no Agendador de Tarefas do Windows.

    python worker/agendar.py            # mostra o que faria
    python worker/agendar.py --criar    # cria a tarefa
    python worker/agendar.py --remover  # apaga a tarefa

Por que XML em vez de `schtasks /Create /SC DAILY`:

A linha de comando do schtasks não sabe ligar a opção que mais importa aqui —
"iniciar assim que possível se o horário agendado for perdido". Sem ela, uma
tarefa das 3h da manhã simplesmente nunca roda num PC que fica desligado à
noite, que é exatamente o seu caso. Essa opção só existe via XML.

A tarefa roda com o seu usuário e SEM senha guardada (InteractiveToken): ela só
dispara quando você está logado. É o que a gente quer — a chave SSH e a sessão
do Claude são suas, e guardar senha de Windows em arquivo seria pior.
"""

import argparse
import getpass
import os
import subprocess
import sys
import tempfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
COMANDO = RAIZ / "noturno.cmd"

NOME_TAREFA = "Receitas da Mamae"
HORARIO = "03:00:00"

# O Agendador exige que o XML esteja em UTF-16; em UTF-8 ele recusa sem
# explicar direito o motivo.
CODIFICACAO = "utf-16"

MODELO = """<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Processa a fila de receitas e publica no git.</Description>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2026-01-01T{horario}</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>{usuario}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <!-- o par que faz a tarefa funcionar num PC que vive desligado -->
    <StartWhenAvailable>true</StartWhenAvailable>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT2H</ExecutionTimeLimit>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RestartOnFailure>
      <Interval>PT15M</Interval>
      <Count>2</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{comando}</Command>
      <WorkingDirectory>{pasta}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"""


def montar_xml() -> str:
    return MODELO.format(
        horario=HORARIO,
        usuario=f"{os.environ.get('USERDOMAIN', '')}\\{getpass.getuser()}".lstrip(
            "\\"
        ),
        comando=COMANDO,
        pasta=RAIZ,
    )


def criar() -> None:
    if not COMANDO.exists():
        raise SystemExit(f"não encontrei {COMANDO}")

    xml = montar_xml()
    # delete=False porque o schtasks precisa abrir o arquivo pelo caminho
    with tempfile.NamedTemporaryFile(
        "w", suffix=".xml", encoding=CODIFICACAO, delete=False
    ) as arquivo:
        arquivo.write(xml)
        caminho = arquivo.name

    try:
        resultado = subprocess.run(
            ["schtasks", "/Create", "/TN", NOME_TAREFA, "/XML", caminho, "/F"],
            capture_output=True,
            text=True,
        )
    finally:
        os.unlink(caminho)

    print(resultado.stdout.strip() or resultado.stderr.strip())
    if resultado.returncode != 0:
        raise SystemExit(resultado.returncode)

    print(f"\nTarefa '{NOME_TAREFA}' criada para as {HORARIO[:5]}.")
    print("Para testar agora, sem esperar a madrugada:")
    print(f'    schtasks /Run /TN "{NOME_TAREFA}"')


def remover() -> None:
    resultado = subprocess.run(
        ["schtasks", "/Delete", "/TN", NOME_TAREFA, "/F"],
        capture_output=True,
        text=True,
    )
    print(resultado.stdout.strip() or resultado.stderr.strip())


def main() -> None:
    if sys.platform != "win32":
        raise SystemExit("este script só faz sentido no Windows")

    ap = argparse.ArgumentParser(description="Agenda o worker no Windows.")
    ap.add_argument("--criar", action="store_true")
    ap.add_argument("--remover", action="store_true")
    args = ap.parse_args()

    if args.remover:
        remover()
    elif args.criar:
        criar()
    else:
        print("Isto é o que seria registrado (nada foi criado):\n")
        print(montar_xml())
        print("Use --criar para valer, ou --remover para apagar.")


if __name__ == "__main__":
    main()
