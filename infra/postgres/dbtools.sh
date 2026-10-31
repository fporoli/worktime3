#!/bin/sh
# Moves the database to and from a blob. Postgres comes from the standard PG* env vars,
# the blob from BLOB_URL (a short-lived SAS URL, see infra/azure/provision.sh).
set -eu
file=/tmp/worktime.dump

case "${1:-}" in
  dump)
    pg_dump --format=custom --file="$file"
    # Unreadable output must fail here: the caller deletes the server after a good dump.
    pg_restore --list "$file" >/dev/null
    curl --fail --silent --show-error --retry 3 --upload-file "$file" \
      --header 'x-ms-blob-type: BlockBlob' "$BLOB_URL"
    echo "Uploaded $(wc -c < "$file") bytes"
    ;;
  restore)
    curl --fail --silent --show-error --retry 3 --output "$file" "$BLOB_URL"
    pg_restore --no-owner --no-privileges --single-transaction --exit-on-error \
      --dbname="$PGDATABASE" "$file"
    echo "Restored $(wc -c < "$file") bytes"
    ;;
  *)
    echo "Usage: dbtools dump|restore" >&2
    exit 1
    ;;
esac
