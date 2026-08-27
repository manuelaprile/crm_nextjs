#!/bin/sh
# =====================================================================
#  crm.sh — comandos de operación del servidor
# ---------------------------------------------------------------------
#  Se corre desde la carpeta infra/:
#
#      ./crm.sh instalar     despliegue nuevo, de cero a funcionando
#      ./crm.sh actualizar   traer cambios y aplicarlos
#      ./crm.sh volver       deshacer la ultima actualizacion
#      ./crm.sh migrar       solo las migraciones
#      ./crm.sh demo         cargar la cuenta de demostración
#      ./crm.sh cuenta ...   dar de alta un cliente nuevo
#      ./crm.sh borrar ...   dar de baja una cuenta o un usuario
#      ./crm.sh usuario ...  gestión de usuarios
#      ./crm.sh estado       qué está corriendo
#      ./crm.sh logs [srv]   ver los registros (termina)
#      ./crm.sh seguir [srv] seguirlos en vivo (Ctrl+C para salir)
#      ./crm.sh backup       copia de la base ahora mismo
#      ./crm.sh db           abrir la consola de PostgreSQL
#      ./crm.sh sql "..."    correr una consulta suelta
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
  echo "  Ver docs/SERVIDOR.md, sección 1.5."
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
#
# La salida se guarda y se filtra DESPUES, en vez de mandarla por una tuberia.
# Con la tuberia, el codigo de salida que quedaba era el del `grep`, asi que
# una migracion que fallaba terminaba en "Actualizado." igual. Eso es
# exactamente lo que no puede pasar: si la migracion se cae, el deploy tiene
# que frenar ahi y NO cambiar el contenedor.
RUIDO='Reparsing as ES module\|MODULE_TYPELESS_PACKAGE_JSON\|trace-warnings\|eliminate this warning'
en_web() {
  salida=$(docker compose exec -T -e MIGRATE_DATABASE_URL="$DB_URL" \
    web node --experimental-strip-types "$@" 2>&1) && codigo=0 || codigo=$?
  printf '%s\n' "$salida" | grep -v "$RUIDO" || true
  return $codigo
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

# =====================================================================
#  DESPLIEGUE SEGURO
# ---------------------------------------------------------------------
#  Todos los clientes comparten UN contenedor y UNA base. No existe
#  "actualizar solo a un cliente": el día que algo sale mal, sale mal para
#  todos a la vez. Lo que sí se puede es que salga mal por poco tiempo.
#
#  De eso se ocupan estas tres piezas:
#
#    1. La versión que está andando se guarda ANTES de tocar nada, con
#       nombre propio (`:anterior`). Volver es renombrar y recrear: unos
#       segundos, sin reconstruir, sin internet y sin git.
#    2. Si hay migraciones pendientes se hace una copia de la base ANTES de
#       aplicarlas. Volver atrás el código es fácil; volver atrás una
#       columna borrada no existe, y esa copia es lo único que la trae.
#    3. Terminado el cambio se le pregunta al panel si está vivo. Si no
#       contesta, el script vuelve solo a la versión anterior.
# =====================================================================
IMG_WEB=crm-web
IMG_WORKER=crm-worker
COPIAS_A_GUARDAR=5

# Deja la versión que está corriendo etiquetada como `:anterior`.
guardar_version_actual() {
  # `|| true` a propósito: en la primera actualización después de sumar esto
  # todavía no existe ninguna imagen `:actual`, y eso no es un error.
  docker image tag "${IMG_WEB}:actual"    "${IMG_WEB}:anterior"    2>/dev/null || true
  docker image tag "${IMG_WORKER}:actual" "${IMG_WORKER}:anterior" 2>/dev/null || true
  {
    echo "commit=$(git -C .. rev-parse --short HEAD 2>/dev/null || echo desconocido)"
    echo "fecha=$(date '+%Y-%m-%d %H:%M:%S')"
  } > .version-anterior
}

# ¿Quedan migraciones por aplicar? Compara los archivos con lo registrado.
#
# Se cuenta desde afuera, sin tocar migrate.ts: lo único que hace falta saber
# es si corresponde la copia de seguridad ANTES de arrancar.
hay_migraciones_pendientes() {
  archivos=$(ls ../packages/db/migrations/*.sql 2>/dev/null | wc -l | tr -d ' ')
  aplicadas=$(docker compose exec -T db psql -U crm_owner -d crm -tAc \
    'select count(*) from _migrations' 2>/dev/null | tr -d ' \r\n')
  # Sin tabla `_migrations` la base está sin migrar: todo está pendiente.
  [ -z "$aplicadas" ] && aplicadas=0
  [ "$archivos" -gt "$aplicadas" ]
}

copia_previa() {
  archivo="pre-deploy-$(date +%Y%m%d-%H%M%S).sql.gz"
  docker compose exec -T db pg_dump -U crm_owner crm | gzip > "$archivo"
  verde "  Copia guardada: $archivo  ($(du -h "$archivo" | cut -f1))"
  # Que no se llene el disco del servidor con copias viejas.
  ls -1t pre-deploy-*.sql.gz 2>/dev/null | tail -n +$((COPIAS_A_GUARDAR + 1)) |
    while read -r viejo; do rm -f "$viejo"; done
}

# ¿Contesta el panel? Es la prueba de que el deploy quedó usable.
esperar_salud() {
  printf '  probando el panel'
  i=0
  while [ $i -lt 40 ]; do
    if docker compose exec -T web node -e \
      "fetch('http://localhost:3000/api/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
      >/dev/null 2>&1; then
      printf ' contesta OK\n'
      return 0
    fi
    printf '.'
    sleep 2
    i=$((i + 1))
  done
  printf '\n'
  return 1
}

# Vuelve a la imagen anterior. No reconstruye: solo renombra y recrea.
restaurar_version_anterior() {
  if ! docker image inspect "${IMG_WEB}:anterior" >/dev/null 2>&1; then
    rojo "  No hay una versión anterior guardada: no se puede volver solo."
    echo "  Es normal la primera vez. Mirá qué pasó con: ./crm.sh logs web"
    return 1
  fi
  docker image tag "${IMG_WEB}:anterior"    "${IMG_WEB}:actual"
  docker image tag "${IMG_WORKER}:anterior" "${IMG_WORKER}:actual"
  docker compose up -d --force-recreate web wa-worker >/dev/null
  sleep 5
  return 0
}

# Lo que hay que decirle a alguien que acaba de volver atrás.
aviso_post_vuelta() {
  echo ""
  echo "  El servidor quedó con la versión anterior, pero el CÓDIGO bajado"
  echo "  sigue siendo el nuevo: si volvés a correr 'actualizar' sin arreglar"
  echo "  nada, se reconstruye lo mismo que falló."
  if [ -f .version-anterior ]; then
    echo ""
    echo "  Esa versión anterior es el commit: $(grep '^commit=' .version-anterior | cut -d= -f2)"
  fi
  echo ""
  echo "  OJO con las migraciones: si esta actualización AGREGÓ columnas, el"
  echo "  código viejo convive bien con ellas. Si BORRÓ o renombró algo, no."
  echo "  Para ese caso está la copia: ls pre-deploy-*.sql.gz"
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
    echo "  Crear la cuenta real         : ./crm.sh cuenta --help"
    echo "  Ver los registros            : ./crm.sh logs"
    ;;

  actualizar)
    # ORDEN DE LOS PASOS: se construye ANTES de tocar lo que está andando, y
    # se migra ANTES de cambiar el contenedor.
    #
    # Migrar antes del cambio deja al código VIEJO corriendo unos segundos
    # contra el esquema NUEVO. Al revés —cambiar primero y migrar después—
    # sería el código NUEVO contra el esquema VIEJO, que es peor: una columna
    # que todavía no existe rompe la pantalla en el acto. Con migraciones que
    # solo agregan cosas, el código viejo ni se entera.
    #
    # De ahí sale la regla de oro para escribir migraciones: NUNCA borrar ni
    # renombrar una columna en el mismo deploy en que el código deja de
    # usarla. Primero se deja de usar y se sube; se borra un deploy después.
    # Así siempre hay un momento donde las dos versiones funcionan, que es lo
    # que hace posible volver atrás.
    info "1/6  Guardando la versión que está andando"
    guardar_version_actual
    echo "  Se puede deshacer con: ./crm.sh volver"

    info "2/6  Trayendo cambios"
    git -C .. pull

    info "3/6  Construyendo la versión nueva"
    echo "  (lo que está andando sigue intacto mientras tanto)"
    docker compose build web wa-worker

    info "4/6  Base de datos"
    esperar_base
    if hay_migraciones_pendientes; then
      echo "  Hay migraciones pendientes: primero la copia de seguridad."
      copia_previa
      # Si una migración se cae, se corta ACÁ: el contenedor sigue con la
      # versión vieja, que es la que anda con el esquema que quedó. Cambiarlo
      # igual dejaría código nuevo pidiendo columnas que nunca se crearon.
      if ! en_web scripts/migrate.ts; then
        rojo ""
        rojo "Falló una migración. NO se cambió nada: el servidor sigue"
        rojo "andando con la versión anterior."
        echo ""
        echo "  El error de PostgreSQL está arriba de este mensaje."
        echo "  Arreglalo, subilo, y volvé a correr: ./crm.sh actualizar"
        echo ""
        echo "  Cada migración corre en su propia transacción, así que la que"
        echo "  falló no dejó nada a medio aplicar. Las anteriores SÍ"
        echo "  quedaron aplicadas; para deshacerlas está la copia:"
        echo "    $(ls -1t pre-deploy-*.sql.gz 2>/dev/null | head -1)"
        exit 1
      fi
    else
      echo "  Sin migraciones pendientes."
    fi

    info "5/6  Cambiando a la versión nueva"
    docker compose up -d
    docker compose restart wa-worker >/dev/null

    info "6/6  Comprobando"
    if esperar_salud; then
      docker compose ps --format '  {{.Service}}\t{{.State}}'
      verde ""
      verde "Actualizado."
      echo "  Si algo quedó raro: ./crm.sh volver"
    else
      rojo ""
      rojo "El panel no contesta. Volviendo a la versión anterior."
      if restaurar_version_anterior && esperar_salud; then
        verde ""
        verde "Listo: el servidor quedó con la versión anterior, funcionando."
      else
        rojo ""
        rojo "Tampoco contesta con la versión anterior. Esto no es el deploy."
        echo "  Mirá: ./crm.sh logs web   y   ./crm.sh estado"
      fi
      aviso_post_vuelta
      exit 1
    fi
    ;;

  volver)
    # Para lo que un chequeo de salud no puede ver: arranca bien, contesta
    # bien, y sin embargo está roto. Eso lo detecta una persona mirando, y
    # cuando pasa lo único que importa es que deshacer sea inmediato.
    info "Volviendo a la versión anterior"
    if ! restaurar_version_anterior; then
      exit 1
    fi
    if esperar_salud; then
      verde ""
      verde "Hecho."
    else
      rojo ""
      rojo "La versión anterior tampoco contesta. Mirá: ./crm.sh logs web"
    fi
    aviso_post_vuelta
    ;;

  migrar)
    esperar_base
    en_web scripts/migrate.ts
    ;;

  demo)
    esperar_base
    en_web scripts/seed.ts
    ;;

  cuenta|consultorio)
    shift
    esperar_base
    en_web scripts/cuenta.ts "$@"
    ;;

  usuario)
    shift
    esperar_base
    en_web scripts/usuario.ts "$@"
    ;;

  borrar|baja)
    shift
    esperar_base
    en_web scripts/borrar.ts "$@"
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
    # SIN -f por defecto. Con `-f` el comando se queda siguiendo el registro
    # en vivo y nunca termina: parece colgado, y quien lo corre para copiar un
    # error se queda mirando una pantalla quieta sin saber que tiene que
    # cortar con Ctrl+C. Para seguirlo en vivo está `./crm.sh seguir`.
    if [ -n "$2" ]; then
      docker compose logs --tail 120 "$2"
    else
      docker compose logs --tail 60
    fi
    ;;

  seguir)
    echo "  Siguiendo el registro en vivo. Ctrl+C para salir."
    if [ -n "$2" ]; then
      docker compose logs -f --tail 80 "$2"
    else
      docker compose logs -f --tail 40
    fi
    ;;

  db)
    # Consola interactiva. Se conecta como crm_owner: ve todo, sin las
    # restricciones por cuenta que tiene el panel. Útil para mirar,
    # peligroso para escribir sin pensar.
    echo "  Conectado como crm_owner (ve todas las cuentas)."
    echo "  \dt = tablas   \d tabla = columnas   \x = formato vertical   \q = salir"
    echo ""
    docker compose exec db psql -U crm_owner -d crm
    ;;

  sql)
    if [ -z "$2" ]; then
      rojo "  Falta la consulta."
      echo "  Ejemplo: ./crm.sh sql \"select slug, name from tenants\""
      exit 1
    fi
    docker compose exec -T db psql -U crm_owner -d crm -c "$2"
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
    sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
    ;;
esac
