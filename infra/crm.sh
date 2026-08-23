#!/bin/sh
# =====================================================================
#  crm.sh — comandos de operación del servidor
# ---------------------------------------------------------------------
#  Se corre desde la carpeta infra/:
#
#      ./crm.sh instalar     despliegue nuevo, de cero a funcionando
#      ./crm.sh actualizar   traer cambios y aplicarlos
#      ./crm.sh migrar       solo las migraciones
#      ./crm.sh demo         cargar el consultorio de demostración
#      ./crm.sh consultorio   dar de alta un cliente nuevo
#      ./crm.sh usuario ...  gestión de usuarios
#      ./crm.sh estado       qué está corriendo
#      ./crm.sh logs [srv]   ver los registros
#      ./crm.sh backup       copia de la base ahora mismo
#      ./crm.sh reiniciar    reiniciar todo
#
#  La contraseña de la base sale del .env: nunca hay que pegarla a mano.
# =====================================================================
set -e

cd "$(dirname "$0")"

rojo()  { printf '\033[31m%s\033[0m\n' "$1"; }
verde() { printf '\033[32m%s\033[0m\n' "$1"; }
info()  { printf '\033[36m\n== %s\033[0m\n' "$1"; }

if [ ! -f .env ]; then
  rojo "No existe el archivo .env en $(pwd)"
  echo "  Docker Compose lo busca acá, al lado del docker-compose.yml."
  echo "  Ver docs/PUESTA-EN-MARCHA.md, sección 2.5."
  exit 1
fi

# La contraseña del dueño de la base, para las migraciones y los scripts.
PG_PASS=$(grep -m1 '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)
if [ -z "$PG_PASS" ]; then
  rojo "POSTGRES_PASSWORD está vacío en el .env"
  exit 1
fi
DB_URL="postgres://crm_owner:${PG_PASS}@db:5432/crm"

# Corre un script de mantenimiento dentro del contenedor del panel.
en_web() {
  docker compose exec -T -e MIGRATE_DATABASE_URL="$DB_URL" \
    web node --experimental-strip-types "$@" 2>&1 |
    grep -v 'Reparsing as ES module\|MODULE_TYPELESS_PACKAGE_JSON\|trace-warnings\|eliminate this warning' || true
}

esperar_base() {
  printf '  esperando a la base'
  i=0
  while [ $i -lt 60 ]; do
    if docker compose exec -T db pg_isready -U crm_owner -d crm >/dev/null 2>&1; then
      printf ' listo\n'
      return 0
    fi
    printf '.'
    sleep 1
    i=$((i + 1))
  done
  printf '\n'
  rojo "La base no respondió en 60 segundos. Mirá: ./crm.sh logs db"
  exit 1
}

case "${1:-ayuda}" in

  instalar)
    info "1/5  Construyendo y levantando los contenedores"
    docker compose up -d --build

    info "2/5  Esperando a PostgreSQL"
    esperar_base

    info "3/5  Aplicando migraciones"
    en_web scripts/migrate.ts

    info "4/5  Reiniciando el worker de WhatsApp"
    # Arranca antes de que existan las tablas, así que hay que reiniciarlo
    # una vez que las migraciones pasaron.
    docker compose restart wa-worker >/dev/null
    sleep 5

    info "5/5  Estado"
    docker compose ps --format '  {{.Service}}\t{{.State}}'

    verde ""
    verde "Listo."
    echo "  Cargar datos de demostración : ./crm.sh demo"
    echo "  Crear el consultorio real    : ./crm.sh usuario --help"
    echo "  Ver los registros            : ./crm.sh logs"
    ;;

  actualizar)
    info "1/4  Trayendo cambios"
    git -C .. pull

    info "2/4  Reconstruyendo"
    docker compose up -d --build

    info "3/4  Migraciones pendientes"
    esperar_base
    en_web scripts/migrate.ts

    info "4/4  Reiniciando el worker"
    docker compose restart wa-worker >/dev/null
    sleep 5
    docker compose ps --format '  {{.Service}}\t{{.State}}'
    verde ""
    verde "Actualizado."
    ;;

  migrar)
    esperar_base
    en_web scripts/migrate.ts
    ;;

  demo)
    esperar_base
    en_web scripts/seed.ts
    ;;

  consultorio)
    shift
    esperar_base
    en_web scripts/consultorio.ts "$@"
    ;;

  usuario)
    shift
    esperar_base
    en_web scripts/usuario.ts "$@"
    ;;

  estado)
    docker compose ps --format '  {{.Service}}\t{{.State}}\t{{.Status}}'
    echo ""
    printf '  worker: '
    docker compose exec -T wa-worker node -e \
      "fetch('http://localhost:4000/health').then(r=>r.json()).then(j=>console.log(JSON.stringify(j))).catch(()=>console.log('no responde'))" \
      2>/dev/null || echo "no responde"
    ;;

  logs)
    if [ -n "$2" ]; then
      docker compose logs -f --tail 80 "$2"
    else
      docker compose logs -f --tail 40
    fi
    ;;

  backup)
    archivo="backup-$(date +%Y%m%d-%H%M%S).sql.gz"
    docker compose exec -T db pg_dump -U crm_owner crm | gzip > "$archivo"
    verde "  Guardado: $(pwd)/$archivo  ($(du -h "$archivo" | cut -f1))"
    echo "  Bajalo a tu máquina con:"
    echo "    scp root@$(hostname -I | awk '{print $1}'):$(pwd)/$archivo ."
    ;;

  reiniciar)
    # `up -d` y NO `restart`: restart reinicia el proceso pero NO vuelve a
    # leer el docker-compose.yml, así que los cambios de configuración
    # (puertos, variables de entorno, volúmenes) no se aplican. Los
    # contenedores siguen con la configuración vieja y uno se vuelve loco
    # buscando por qué un cambio no surte efecto.
    # `up -d` recrea solo lo que cambió y deja el resto intacto.
    info "Aplicando configuración y reiniciando"
    docker compose up -d
    sleep 5
    docker compose ps --format '  {{.Service}}\t{{.State}}'
    ;;

  *)
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
    ;;
esac
