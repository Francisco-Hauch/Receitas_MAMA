# Receitas da Mamãe

Central de receitas de família. Recebo receitas por foto, áudio ou link,
elas ficam numa fila até meu PC ligar, são estruturadas e publicadas
num site estático.

## Como funciona

```
Você (celular)          PC pessoal (quando liga)           Web
──────────────          ────────────────────────           ───
abre uma Issue    ──▶   worker lê as issues
com foto/áudio/link     ├─ foto  → OCR local (Llama)
                        ├─ áudio → transcrição local (Whisper)
                        ├─ link  → extração do HTML
                        │
                        └─ texto bruto → Claude Code headless
                                         └─ JSON estruturado  ──▶  site React
```

## Estrutura

| Pasta            | Conteúdo                                      |
|------------------|-----------------------------------------------|
| `worker/`        | worker em Python: fila, extração, Claude       |
| `data/brutos/`   | texto cru saído do OCR/transcrição             |
| `data/receitas/` | receitas em JSON — a fonte da verdade          |
| `site/`          | site em React                                  |

## Estado

Em construção. Etapa atual: fundação do repositório.
