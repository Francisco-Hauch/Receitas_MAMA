@echo off
REM Sobe o site em modo desenvolvimento (recarrega sozinho ao salvar arquivo).
REM
REM Existe porque no PowerShell "npm run dev" esbarra na politica de execucao:
REM o PowerShell escolhe o npm.ps1, que nao e assinado, e recusa. Este .cmd
REM chama o npm.cmd direto e nao depende de politica nenhuma.

setlocal
cd /d "%~dp0"
call npm.cmd run dev -- --host
endlocal
