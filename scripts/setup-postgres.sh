#!/bin/bash
set -euo pipefail

# Setup PostgreSQL on Mac Mini for the Inbox app.
# Run this script once on the Mac Mini to install Postgres, create the
# database/user, and configure remote access via Tailscale.

DB_NAME="inbox"
DB_USER="inbox"
DB_PASS="${1:-}"
TAILSCALE_CIDR="100.64.0.0/10"

if [ -z "$DB_PASS" ]; then
  echo "Usage: $0 <password>"
  echo "  Creates the '$DB_NAME' database and '$DB_USER' user with the given password."
  exit 1
fi

# --- Ensure Postgres binaries are on PATH ---
# Homebrew's postgresql@17 is keg-only; binaries aren't linked into /opt/homebrew/bin
for candidate in /opt/homebrew/opt/postgresql@17/bin /usr/local/opt/postgresql@17/bin; do
  if [ -d "$candidate" ]; then
    export PATH="$candidate:$PATH"
    break
  fi
done

# --- Install Postgres ---
if ! command -v psql &>/dev/null; then
  echo "Installing PostgreSQL 17 via Homebrew..."
  brew install postgresql@17
  # Add newly installed binaries to PATH
  for candidate in /opt/homebrew/opt/postgresql@17/bin /usr/local/opt/postgresql@17/bin; do
    if [ -d "$candidate" ]; then
      export PATH="$candidate:$PATH"
      break
    fi
  done
  brew services start postgresql@17
  echo "Waiting for Postgres to start..."
  sleep 3
else
  echo "PostgreSQL already installed."
  brew services start postgresql@17 2>/dev/null || true
fi

if ! command -v psql &>/dev/null; then
  echo "ERROR: psql not found. Add postgresql@17/bin to your PATH:"
  echo "  export PATH=\"/opt/homebrew/opt/postgresql@17/bin:\$PATH\""
  exit 1
fi

# --- Create user and database ---
if psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" &>/dev/null; then
  echo "Database '$DB_NAME' and user '$DB_USER' already exist."
else
  echo "Creating user '$DB_USER' and database '$DB_NAME'..."
  psql postgres <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASS}' CREATEDB;
  END IF;
END
\$\$;
SQL
  createdb -O "$DB_USER" "$DB_NAME" 2>/dev/null || echo "Database '$DB_NAME' already exists."
  psql -d "$DB_NAME" -c "ALTER USER ${DB_USER} WITH PASSWORD '${DB_PASS}';"
fi

# --- Configure remote access for Tailscale ---
PG_DATA=$(psql postgres -t -A -c "SHOW data_directory")
PG_CONF="$PG_DATA/postgresql.conf"
PG_HBA="$PG_DATA/pg_hba.conf"

echo "Postgres data directory: $PG_DATA"

# listen_addresses = '*'
if grep -q "^listen_addresses = '\*'" "$PG_CONF"; then
  echo "listen_addresses already set to '*'."
else
  echo "Setting listen_addresses = '*' in postgresql.conf..."
  # Remove any existing listen_addresses lines (commented or not), then add ours
  sed -i '' '/^#*listen_addresses/d' "$PG_CONF"
  echo "listen_addresses = '*'" >> "$PG_CONF"
fi

# pg_hba.conf: allow Tailscale subnet
HBA_LINE="host    ${DB_NAME}    ${DB_USER}    ${TAILSCALE_CIDR}    scram-sha-256"
if grep -qF "$TAILSCALE_CIDR" "$PG_HBA"; then
  echo "Tailscale subnet already in pg_hba.conf."
else
  echo "Adding Tailscale subnet ($TAILSCALE_CIDR) to pg_hba.conf..."
  echo "$HBA_LINE" >> "$PG_HBA"
fi

# Restart to apply config changes
echo "Restarting PostgreSQL..."
brew services restart postgresql@17
sleep 2

# --- Run schema migration ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCHEMA_FILE="$SCRIPT_DIR/../server/db/migrations/001_initial_schema.sql"
if [ -f "$SCHEMA_FILE" ]; then
  echo "Running schema migration..."
  PGPASSWORD="$DB_PASS" psql -U "$DB_USER" -d "$DB_NAME" -f "$SCHEMA_FILE"
  echo "Schema migration complete."
else
  echo "Warning: Schema file not found at $SCHEMA_FILE — run migrations manually."
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Connection string (works from any Tailscale machine):"
echo "  DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@grants-mac-mini.tail21f7c3.ts.net:5432/${DB_NAME}"
echo ""
echo "Add this to your packages/inbox/.env file."
