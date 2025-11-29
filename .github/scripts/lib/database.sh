#!/bin/bash
# .github/scripts/lib/database.sh
# Description: Database provisioning, migrations, and wait logic

# Prevent double-sourcing
[[ -n "${_ORBITCHECK_DATABASE_SOURCED:-}" ]] && return 0
readonly _ORBITCHECK_DATABASE_SOURCED=1

# Ensure strict mode is inherited
set -Eeuo pipefail

# Source dependencies
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"
source "$SCRIPT_DIR/quadlet.sh"

# ============================================================================
# Database Functions
# ============================================================================

runtime_wait_for_db() {
    local admin_env="$1"
    shift || true
    local pod_args=("$@")

    if [[ -f "$admin_env" ]]; then
        log_info "Sourcing environment from $admin_env"
        # shellcheck disable=SC1090
        source "$admin_env"
    fi

    log_info "Waiting for database to become ready..."
    local tries=40
    while (( tries-- > 0 )); do
        # The podman run command now succeeds only if the DB container is already running
        if podman run --rm "${pod_args[@]}" --env-file "$admin_env" \
           docker.io/library/postgres:18-alpine sh -c '
             set -e
             : "${PGHOST:=127.0.0.1}"
             : "${PGADMIN_USER:?Missing PGADMIN_USER}"
             : "${PGADMIN_PASSWORD:?Missing PGADMIN_PASSWORD}"
             : "${PGPORT:=5432}"
             export PGPASSWORD="$PGADMIN_PASSWORD"
             psql "host=$PGHOST port=$PGPORT dbname=postgres user=$PGADMIN_USER" -c "SELECT 1" >/dev/null
           '; then
            log_success "Database is ready"
            return 0
        fi
        log_info "Database not ready, waiting 2s..."
        sleep 2
    done

    log_error "Database did not become ready in time"
    # For better debugging, show the status of the DB unit
    local db_unit
    db_unit="$(runtime_find_db_unit "$HOME/$REMOTE_SYSTEMD_USER_DIR")"
    if [[ -n "$db_unit" ]]; then
        log_error "Status of the database service ($db_unit):"
        systemctl --user status "$db_unit" --no-pager || true
        journalctl --user -u "$db_unit" --no-pager -n 20 || true
    fi
    return 1
}

runtime_provision_database() {
    local admin_env="$1"
    shift || true
    local pod_args=("$@")

    log_info "Starting database provisioning..."

    [[ -f "$admin_env" ]] || { log_error "Admin env not found: $admin_env"; return 1; }

    podman pull docker.io/library/postgres:18-alpine 2>/dev/null || true

    # Prepare the SQL script - avoiding psql variables inside DO blocks
    local sql_script
    sql_script=$(cat <<'EOSQL'
-- Create or update the migration role to ensure it has LOGIN permission
DO $proc$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_setting('vars.migration_user')) THEN
        EXECUTE format('CREATE ROLE %I WITH LOGIN', current_setting('vars.migration_user'));
        RAISE NOTICE 'Created role: %', current_setting('vars.migration_user');
    ELSE
        EXECUTE format('ALTER ROLE %I WITH LOGIN', current_setting('vars.migration_user'));
        RAISE NOTICE 'Ensured role % has LOGIN permission', current_setting('vars.migration_user');
    END IF;
END
$proc$;

-- Create or update the app role to ensure it has LOGIN permission
DO $proc$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_setting('vars.app_user')) THEN
        EXECUTE format('CREATE ROLE %I WITH LOGIN', current_setting('vars.app_user'));
        RAISE NOTICE 'Created role: %', current_setting('vars.app_user');
    ELSE
        EXECUTE format('ALTER ROLE %I WITH LOGIN', current_setting('vars.app_user'));
        RAISE NOTICE 'Ensured role % has LOGIN permission', current_setting('vars.app_user');
    END IF;
END
$proc$;

-- Update passwords (these work fine outside DO blocks)
ALTER ROLE :"MIGRATION_DB_USER" WITH PASSWORD :'MIGRATION_DB_PASSWORD';
ALTER ROLE :"APP_DB_USER" WITH PASSWORD :'APP_DB_PASSWORD';

-- Set database owner
ALTER DATABASE :"APP_DB_NAME" OWNER TO :"MIGRATION_DB_USER";

-- Revoke default PUBLIC privileges
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM :"MIGRATION_DB_USER";
REVOKE ALL ON DATABASE :"APP_DB_NAME" FROM PUBLIC;

-- Grant connection rights
GRANT CONNECT ON DATABASE :"APP_DB_NAME" TO :"MIGRATION_DB_USER", :"APP_DB_USER";

-- Create schema if needed
DO $proc$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = current_setting('vars.app_schema')) THEN
        EXECUTE format('CREATE SCHEMA %I AUTHORIZATION %I', 
            current_setting('vars.app_schema'), 
            current_setting('vars.migration_user'));
        RAISE NOTICE 'Created schema: %', current_setting('vars.app_schema');
    ELSIF current_setting('vars.app_schema') != 'public' THEN
        EXECUTE format('ALTER SCHEMA %I OWNER TO %I', 
            current_setting('vars.app_schema'), 
            current_setting('vars.migration_user'));
    END IF;
END
$proc$;

-- Set search paths
ALTER ROLE :"MIGRATION_DB_USER" IN DATABASE :"APP_DB_NAME" SET search_path = :"APP_DB_SCHEMA", public;
ALTER ROLE :"APP_DB_USER" IN DATABASE :"APP_DB_NAME" SET search_path = :"APP_DB_SCHEMA", public;

-- Grant schema usage
GRANT USAGE ON SCHEMA :"APP_DB_SCHEMA" TO :"APP_DB_USER";

-- Grant privileges on existing objects
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA :"APP_DB_SCHEMA" TO :"APP_DB_USER";
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA :"APP_DB_SCHEMA" TO :"APP_DB_USER";

-- Set default privileges for future objects
ALTER DEFAULT PRIVILEGES FOR ROLE :"MIGRATION_DB_USER" IN SCHEMA :"APP_DB_SCHEMA"
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"APP_DB_USER";
ALTER DEFAULT PRIVILEGES FOR ROLE :"MIGRATION_DB_USER" IN SCHEMA :"APP_DB_SCHEMA"
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO :"APP_DB_USER";
EOSQL
)

    # Execute the SQL script - using POSIX-compatible shell syntax
    if ! podman run --rm "${pod_args[@]}" \
        --env-file "$admin_env" \
        -i \
        docker.io/library/postgres:18-alpine sh -c '
        set -e
        
        # Create a temporary file to hold our SQL script
        SQL_FILE=$(mktemp)
        # Read the script from stdin into the temp file
        cat > "$SQL_FILE"

        : "${PGHOST:=127.0.0.1}"
        : "${PGPORT:=5432}"
        : "${PGADMIN_USER:?Missing PGADMIN_USER}"
        : "${PGADMIN_PASSWORD:?Missing PGADMIN_PASSWORD}"
        : "${APP_DB_NAME:?Missing APP_DB_NAME}"
        : "${APP_DB_SCHEMA:=public}"
        : "${MIGRATION_DB_USER:=api_migrator}"
        : "${MIGRATION_DB_PASSWORD:?Missing MIGRATION_DB_PASSWORD}"
        : "${APP_DB_USER:=api_app}"
        : "${APP_DB_PASSWORD:?Missing APP_DB_PASSWORD}"
        : "${DB_EXTENSIONS:=}"
        
        export PGPASSWORD="$PGADMIN_PASSWORD"
        
        echo "Connecting to PostgreSQL at $PGHOST:$PGPORT..." >&2
        
        psql "host=$PGHOST port=$PGPORT dbname=postgres user=$PGADMIN_USER" -c "SELECT 1" >/dev/null 2>&1 || {
            echo "ERROR: Cannot connect to database" >&2; exit 1;
        }
        
        DB_EXISTS=$(psql "host=$PGHOST port=$PGPORT dbname=postgres user=$PGADMIN_USER" -tAc \
            "SELECT 1 FROM pg_database WHERE datname = '"'"'$APP_DB_NAME'"'"'" || echo "0")
        
        if [ "$DB_EXISTS" != "1" ]; then
            echo "Creating database: $APP_DB_NAME" >&2
            createdb -h "$PGHOST" -p "$PGPORT" -U "$PGADMIN_USER" "$APP_DB_NAME"
        fi
        
        # Set session variables that can be accessed in DO blocks
        # Then execute the SQL file with regular psql variables
        psql "host=$PGHOST port=$PGPORT dbname=$APP_DB_NAME user=$PGADMIN_USER" \
            -v ON_ERROR_STOP=1 \
            -v MIGRATION_DB_USER="$MIGRATION_DB_USER" \
            -v MIGRATION_DB_PASSWORD="'"'"'$MIGRATION_DB_PASSWORD'"'"'" \
            -v APP_DB_USER="$APP_DB_USER" \
            -v APP_DB_PASSWORD="'"'"'$APP_DB_PASSWORD'"'"'" \
            -v APP_DB_NAME="$APP_DB_NAME" \
            -v APP_DB_SCHEMA="$APP_DB_SCHEMA" \
            -c "SET vars.migration_user = '"'"'$MIGRATION_DB_USER'"'"';" \
            -c "SET vars.app_user = '"'"'$APP_DB_USER'"'"';" \
            -c "SET vars.app_schema = '"'"'$APP_DB_SCHEMA'"'"';" \
            -f "$SQL_FILE"
        
        # Clean up the temp file
        rm "$SQL_FILE"
        
        if [ -n "$DB_EXTENSIONS" ]; then
            echo "Installing extensions: $DB_EXTENSIONS" >&2
            # Use echo and pipe instead of here-string
            echo "$DB_EXTENSIONS" | tr "," "\n" | while IFS= read -r ext; do
                ext=$(echo "$ext" | sed "s/^[[:space:]]*//;s/[[:space:]]*$//")
                [ -z "$ext" ] && continue
                echo "Installing extension: $ext" >&2
                psql "host=$PGHOST port=$PGPORT dbname=$APP_DB_NAME user=$PGADMIN_USER" -v ON_ERROR_STOP=1 \
                    -c "CREATE EXTENSION IF NOT EXISTS \"$ext\" WITH SCHEMA \"$APP_DB_SCHEMA\""
            done
        fi
        
        echo "Database provisioning completed successfully" >&2
    ' <<< "$sql_script"; then
        log_error "Database provisioning failed"
        return 1
    fi

    log_success "Database provisioned successfully"
}

runtime_run_migrations() {
    local image="$1"
    local max_attempts="${2:-10}"
    shift 2 || true
    # All remaining arguments are passed to podman run
    local podman_args=("$@")

    log_info "Running database migrations with image: $image"
    podman pull "$image" 2>/dev/null || log_warning "Could not pull latest image, using cached"

    local attempt=1
    while [[ $attempt -le $max_attempts ]]; do
        log_info "Migration attempt $attempt/$max_attempts..."
        # Pass the podman_args array directly
        if podman run --rm "${podman_args[@]}" "$image" sh -c "npm run migrate:ci"; then
            log_success "Migrations completed successfully"
            return 0
        fi
        (( attempt < max_attempts )) && { log_warning "Migration failed, retrying in 3s..."; sleep 3; }
        ((attempt++))
    done

    log_error "Migrations failed after $max_attempts attempts"
    return 1
}

# ============================================================================
# Export Functions
# ============================================================================

export -f runtime_wait_for_db runtime_provision_database runtime_run_migrations
