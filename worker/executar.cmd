@echo off
REM Lancador do worker. Usado tanto no dia a dia quanto pelo Task Scheduler.
REM
REM PYTHONUTF8=1 forca o Python a usar UTF-8 em vez do cp1252 do Windows,
REM que quebra os acentos das receitas.

setlocal
set PYTHONUTF8=1

REM %~dp0 = pasta deste .cmd (worker\); sobe um nivel para a raiz do projeto,
REM porque o modulo e chamado como "worker.src.main".
cd /d "%~dp0.."

".venv\Scripts\python.exe" -m worker.src.main %*
endlocal
