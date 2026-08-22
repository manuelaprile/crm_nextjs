# CRM multicanal por verticales

Plataforma CRM multi-tenant con bandeja de WhatsApp y agente de IA que
califica y deriva. Un solo código, varios nichos. El primer vertical en
producción es **médico**.

## Documentación

| Archivo | Para qué |
|---|---|
| **[docs/PRENDER-Y-APAGAR.md](docs/PRENDER-Y-APAGAR.md)** | Los comandos para prender y apagar el proyecto en tu máquina, en orden. Empezá por acá. |
| **[docs/MODO-PRUEBA.md](docs/MODO-PRUEBA.md)** | Cómo probar el circuito completo sin vincular un celular. |
| **[docs/prompt-secretaria.md](docs/prompt-secretaria.md)** | El prompt del asistente, listo para copiar y completar. |
| **[docs/USUARIOS-Y-BASE-DE-DATOS.md](docs/USUARIOS-Y-BASE-DE-DATOS.md)** | Roles, cómo crear un superadmin, y cómo conectarte a la base. |
| **[docs/DBEAVER-BASICO.md](docs/DBEAVER-BASICO.md)** | Cómo usar DBeaver si venís de phpMyAdmin. Consultas listas para copiar. |
| **[docs/PUESTA-EN-MARCHA.md](docs/PUESTA-EN-MARCHA.md)** | Cómo subirlo a un VPS de Hostinger, el número de WhatsApp y el asistente de IA. |
| **[docs/DECISIONES-Y-PRUEBAS.md](docs/DECISIONES-Y-PRUEBAS.md)** | Qué se decidió y por qué, y qué se verificó ejecutándolo. |
| **[docs/descargo-whatsapp.md](docs/descargo-whatsapp.md)** | Anexo para que firme el cliente por la conexión vía QR. |
| **[CLAUDE.md](CLAUDE.md)** | Contrato del proyecto: modelo conceptual y reglas duras. Leer antes de tocar código. |

## Arranque rápido

Ver **[docs/PRENDER-Y-APAGAR.md](docs/PRENDER-Y-APAGAR.md)** — comandos en
orden, listos para copiar.

## Estructura

```
apps/web          Panel + API (Next.js 16)
apps/wa-worker    Conexión con WhatsApp (Baileys 6.7.24)
packages/db       Migraciones SQL + test de aislamiento
infra             Docker Compose, Caddy, backups
docs              Manuales
```
