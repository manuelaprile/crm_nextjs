# CRM multicanal por verticales

Plataforma CRM multi-tenant con bandeja de WhatsApp y agente de IA que
califica y deriva. Un solo código, varios rubros: un consultorio, una
inmobiliaria o un estudio contable son la misma aplicación con otro rótulo y
otro embudo. El primer cliente en producción es **médico**.

## Arranque rápido

Prender en local: `docker start crm-dev`, después el worker y el panel.
Los comandos exactos están en **[docs/LOCAL.md](docs/LOCAL.md)**.

## Documentación

| Archivo | Para qué |
|---|---|
| **[docs/LEEME.md](docs/LEEME.md)** | Índice y los comandos que se preguntan siempre |
| **[docs/LOCAL.md](docs/LOCAL.md)** | Prender y apagar el proyecto en tu máquina |
| **[docs/SERVIDOR.md](docs/SERVIDOR.md)** | El VPS: instalar, actualizar y qué hace cada comando de `crm.sh` |
| **[docs/CLIENTES.md](docs/CLIENTES.md)** | Dar de alta un cliente, usuarios, permisos y acceso a la base |
| **[docs/prompt-secretaria.md](docs/prompt-secretaria.md)** | El prompt del asistente, listo para copiar y completar |
| **[docs/descargo-whatsapp.md](docs/descargo-whatsapp.md)** | Anexo para que firme el cliente por la conexión vía QR |
| **[CLAUDE.md](CLAUDE.md)** | Contrato del proyecto: modelo conceptual y reglas duras. Leer antes de tocar código |

> `docs/` no se versiona (está en `.gitignore`): son manuales con rutas y
> datos de la instalación de cada uno.

## Estructura

```
apps/web          Panel + API (Next.js 16)
apps/wa-worker    Conexión con WhatsApp (Baileys 6.7.24)
packages/db       Migraciones SQL + test de aislamiento
infra             Docker Compose, Caddy, backups, crm.sh
docs              Manuales
```
