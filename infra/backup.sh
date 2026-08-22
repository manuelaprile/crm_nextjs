#!/bin/sh
# Backup diario de Postgres a object storage, con retención de 30 días.
set -eu
apk add --no-cache aws-cli >/dev/null 2>&1 || true
while true; do
  STAMP=$(date +%Y%m%d-%H%M%S)
  FILE="/tmp/crm-${STAMP}.sql.gz"
  echo "[backup] dump ${STAMP}"
  pg_dump -h db -U crm_owner -d crm | gzip > "$FILE"
  aws s3 cp "$FILE" "s3://${S3_BUCKET}/crm-${STAMP}.sql.gz" \
    --endpoint-url "$S3_ENDPOINT" && rm -f "$FILE"
  # Retención: borra lo que tenga más de 30 días.
  CUTOFF=$(date -d '30 days ago' +%Y%m%d 2>/dev/null || date -v-30d +%Y%m%d)
  aws s3 ls "s3://${S3_BUCKET}/" --endpoint-url "$S3_ENDPOINT" \
    | awk '{print $4}' | while read -r key; do
      d=$(echo "$key" | sed -n 's/^crm-\([0-9]\{8\}\)-.*/\1/p')
      [ -n "$d" ] && [ "$d" -lt "$CUTOFF" ] && \
        aws s3 rm "s3://${S3_BUCKET}/${key}" --endpoint-url "$S3_ENDPOINT"
    done
  sleep 86400
done
