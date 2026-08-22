#!/bin/sh
# =====================================================================
#  Backup diario de PostgreSQL a object storage, con 30 días de retención.
# ---------------------------------------------------------------------
#  Si el object storage todavía no está configurado, este servicio se queda
#  esperando en vez de fallar en bucle. Antes reintentaba cada pocos
#  segundos y llenaba los registros de errores, haciendo parecer que algo
#  estaba roto cuando en realidad solo faltaba completar el .env.
#
#  Para hacer una copia manual mientras tanto:  ./crm.sh backup
# =====================================================================
set -eu

if [ -z "${S3_ENDPOINT:-}" ] || [ -z "${S3_BUCKET:-}" ] ||
   [ -z "${S3_ACCESS_KEY:-}" ] || [ -z "${S3_SECRET_KEY:-}" ]; then
  echo "[backup] Object storage sin configurar: no se harán copias automáticas."
  echo "[backup] Completá S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY y S3_SECRET_KEY"
  echo "[backup] en el archivo .env y reiniciá este servicio."
  # Dormir en vez de salir: con `restart: unless-stopped`, salir haría que
  # Docker lo levante una y otra vez.
  while true; do sleep 3600; done
fi

apk add --no-cache aws-cli >/dev/null 2>&1 || true

echo "[backup] Activo. Copia diaria a s3://${S3_BUCKET}"

while true; do
  STAMP=$(date +%Y%m%d-%H%M%S)
  FILE="/tmp/crm-${STAMP}.sql.gz"

  echo "[backup] Generando copia ${STAMP}"
  if pg_dump -h db -U crm_owner -d crm | gzip > "$FILE"; then
    if aws s3 cp "$FILE" "s3://${S3_BUCKET}/crm-${STAMP}.sql.gz" \
         --endpoint-url "$S3_ENDPOINT"; then
      echo "[backup] Subida OK ($(du -h "$FILE" | cut -f1))"
    else
      echo "[backup] ERROR: no se pudo subir la copia"
    fi
    rm -f "$FILE"
  else
    echo "[backup] ERROR: falló pg_dump"
    rm -f "$FILE"
  fi

  # Retención: borrar lo que tenga más de 30 días.
  CUTOFF=$(date -d '30 days ago' +%Y%m%d 2>/dev/null || date -v-30d +%Y%m%d)
  aws s3 ls "s3://${S3_BUCKET}/" --endpoint-url "$S3_ENDPOINT" 2>/dev/null |
    awk '{print $4}' | while read -r key; do
      d=$(echo "$key" | sed -n 's/^crm-\([0-9]\{8\}\)-.*/\1/p')
      if [ -n "$d" ] && [ "$d" -lt "$CUTOFF" ]; then
        aws s3 rm "s3://${S3_BUCKET}/${key}" --endpoint-url "$S3_ENDPOINT" >/dev/null
        echo "[backup] Eliminada copia vieja: $key"
      fi
    done

  sleep 86400
done
