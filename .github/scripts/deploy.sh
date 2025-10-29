#!/bin/bash
set -Eeuo pipefail
set -o errtrace
set -o functrace

if [[ "${DEBUG:-0}" == "1" ]]; then
  export BASH_XTRACEFD=2
  export PS4='+ [${BASH_SOURCE##*/}:${LINENO} ${FUNCNAME[0]}] '
  set -x
fi

# ============================================================================
# Deployment Script - Handles infrastructure, dashboard, and API deployments
# ============================================================================

# Color codes for better output visibility
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')] INFO:${NC} $*" >&2
}

log_success() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] SUCCESS:${NC} $*" >&2
}

log_warning() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING:${NC} $*" >&2
}

log_error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR:${NC} $*" >&2
}

print_stack() {
  local i
  for ((i=${#FUNCNAME[@]}-1; i>0; i--)); do
    echo "  at ${FUNCNAME[$i]} (${BASH_SOURCE[$i]}:${BASH_LINENO[$i-1]})" >&2
  done
}


trap 'code=$?; line=$LINENO; cmd=$BASH_COMMAND; file=${BASH_SOURCE[0]};
      log_error "Exit $code at $file:$line while running: $cmd";
      print_stack;
      cleanup_on_error;
      exit $code' ERR

# Error handler
error_handler() {
    local line_no=$1
    local exit_code=$2
    log_error "Script failed at line $line_no with exit code $exit_code"
    cleanup_on_error
    exit "$exit_code"
}

# Set up error handling
trap 'error_handler ${LINENO} $?' ERR

# Cleanup function for error cases
cleanup_on_error() {
    log_info "Performing emergency cleanup..."
    # Add any emergency cleanup tasks here
}

# ============================================================================
# Variable Validation
# ============================================================================

validate_required_vars() {
    local missing_vars=()
    
    # Required variables with no defaults
    local required_vars=(
        "REMOTE_TARGET_BASE_DIR"
        "REMOTE_CONFIGS_DIR"
        "REMOTE_DASHBOARD_VOLUME_DIR"
        "REMOTE_RUNTIME_USER"
        "REMOTE_SYSTEMD_USER_DIR"
        "REGISTRY"
        "IMAGE_OWNER"
        "API_IMAGE_NAME"
    )
    
    for var in "${required_vars[@]}"; do
        if [[ -z "${!var:-}" ]]; then
            missing_vars+=("$var")
        fi
    done
    
    if [[ ${#missing_vars[@]} -gt 0 ]]; then
        log_error "Missing required variables: ${missing_vars[*]}"
        exit 1
    fi
}

# Set defaults for optional variables
: "${NEEDS_INFRA_CHANGES:=false}"
: "${NEEDS_DASHBOARD_CHANGES:=false}"
: "${NEEDS_API_CHANGES:=false}"
: "${IS_WORKFLOW_DISPATCH:=false}"
: "${FORCE_DEPLOY:=false}"

# Validate all required variables
validate_required_vars

# Normalize boolean values
normalize_bool() {
    case "${1,,}" in
        true|yes|1) echo "true" ;;
        *) echo "false" ;;
    esac
}

NEEDS_INFRA_CHANGES=$(normalize_bool "$NEEDS_INFRA_CHANGES")
NEEDS_DASHBOARD_CHANGES=$(normalize_bool "$NEEDS_DASHBOARD_CHANGES")
NEEDS_API_CHANGES=$(normalize_bool "$NEEDS_API_CHANGES")
IS_WORKFLOW_DISPATCH=$(normalize_bool "$IS_WORKFLOW_DISPATCH")
FORCE_DEPLOY=$(normalize_bool "$FORCE_DEPLOY")

# ============================================================================
# Helper Functions
# ============================================================================

# Safe rsync with error handling
safe_rsync() {
    local src="$1"
    local dest="$2"
    local owner="${3:-}"
    
    if ! sudo rsync -a --delete "$src/" "$dest/"; then
        log_error "Failed to sync from $src to $dest"
        return 1
    fi
    
    if [[ -n "$owner" ]]; then
        if ! sudo chown -R "$owner:$owner" "$dest"; then
            log_error "Failed to set ownership on $dest"
            return 1
        fi
    fi
    
    return 0
}

# Check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Verify directory exists and is accessible
verify_directory() {
    local dir="$1"
    local create="${2:-false}"
    
    if [[ "$create" == "true" ]]; then
        sudo mkdir -p "$dir" || return 1
    fi
    
    if [[ ! -d "$dir" ]]; then
        log_error "Directory does not exist: $dir"
        return 1
    fi
    
    return 0
}

# ============================================================================
# Section 1: Root-level file operations
# ============================================================================

deploy_infrastructure_configs() {
    log_info "Deploying infrastructure configurations..."
    
    if [[ "$NEEDS_INFRA_CHANGES" == "true" ]] && [[ -d "$REMOTE_TARGET_BASE_DIR/infra" ]]; then
        if [[ -d "$REMOTE_TARGET_BASE_DIR/infra/config" ]]; then
            verify_directory "$REMOTE_CONFIGS_DIR" true || return 1
            safe_rsync "$REMOTE_TARGET_BASE_DIR/infra/config" "$REMOTE_CONFIGS_DIR" "$REMOTE_RUNTIME_USER" || return 1
            log_success "Infrastructure configurations deployed"
        else
            log_warning "No infrastructure configs found at $REMOTE_TARGET_BASE_DIR/infra/config"
        fi
    else
        log_info "Skipping infrastructure config deployment (no changes or directory missing)"
    fi
}

deploy_dashboard_assets() {
    log_info "Deploying dashboard static assets..."
    
    if [[ "$NEEDS_DASHBOARD_CHANGES" == "true" ]] && [[ -d "$REMOTE_TARGET_BASE_DIR/dashboard-dist" ]]; then
        verify_directory "$REMOTE_DASHBOARD_VOLUME_DIR" true || return 1
        safe_rsync "$REMOTE_TARGET_BASE_DIR/dashboard-dist" "$REMOTE_DASHBOARD_VOLUME_DIR" "$REMOTE_RUNTIME_USER" || return 1
        log_success "Dashboard assets deployed"
    else
        log_info "Skipping dashboard deployment (no changes or directory missing)"
    fi
}

verify_podman_quadlet() {
    log_info "Verifying Podman Quadlet installation..."
    
    local quadlet_paths=(
        "/etc/systemd/user-generators/podman-quadlet"
        "/usr/lib/systemd/user-generators/podman-quadlet"
    )
    
    local found=false
    for path in "${quadlet_paths[@]}"; do
        if sudo test -x "$path"; then
            found=true
            log_info "Found Quadlet generator at: $path"
            break
        fi
    done
    
    if [[ "$found" != "true" ]]; then
        log_error "Podman Quadlet generator not found in any expected location"
        exit 1
    fi
}

# ============================================================================
# Runtime User Functions (defined here for syntax highlighting)
# ============================================================================

# Find the PodName from *.pod (empty if not set)
runtime_get_pod_name() {
  local dest_sys_d="$1"
  local pn=""
  shopt -s nullglob
  local f
  for f in "$dest_sys_d"/*.pod; do
    pn=$(grep -h '^[Pp]od[Nn]ame=' "$f" 2>/dev/null | head -1 | sed 's/.*[Pp]od[Nn]ame=//')
    [[ -n "$pn" ]] && { echo "$pn"; return 0; }
  done
  echo ""
}

# Best-effort: pick the DB container unit by image or filename
runtime_find_db_unit() {
  local dest_sys_d="$1"
  local regex="${2:-db|postgres|timescaledb}"
  shopt -s nullglob
  local f base
  for f in "$dest_sys_d"/*.container; do
    base="$(basename "$f" .container)"
    if grep -qiE '^\s*Image=.*(postgres|timescaledb)' "$f"; then
      echo "${base}.service"; return 0
    fi
    if [[ "$base" =~ $regex ]]; then
      echo "${base}.service"; return 0
    fi
  done
  echo ""
}

# Start the pod + DB unit and wait until DB responds to psql
runtime_start_db_and_wait() {
  local dest_sys_d="$1"
  local admin_env="$2"
  shift 2 || true
  local pod_args=("$@")

  systemctl --user daemon-reload

  # Start pod unit(s) if any
  shopt -s nullglob
  local f pod_unit
  for f in "$dest_sys_d"/*.pod; do
    pod_unit="$(basename "$f" .pod)-pod.service"
    systemctl --user enable "$pod_unit" 2>/dev/null || true
    systemctl --user start "$pod_unit" || true
  done

  # Start DB container unit
  local db_unit
  db_unit="$(runtime_find_db_unit "$dest_sys_d")"
  if [[ -z "$db_unit" ]]; then
    log_warning "Could not determine DB container unit; skipping pre-start"
  else
    systemctl --user enable "$db_unit" 2>/dev/null || true
    systemctl --user start "$db_unit" || true
  fi

  # Wait for DB readiness
  log_info "Waiting for database to become ready..."
  local tries=40
  while (( tries-- > 0 )); do
    if podman run --rm "${pod_args[@]}" --env-file "$admin_env" \
       docker.io/library/postgres:16-alpine sh -c '
         set -e
         : "${PGHOST:?Missing PGHOST}"
         : "${PGADMIN_USER:?Missing PGADMIN_USER}"
         : "${PGADMIN_PASSWORD:?Missing PGADMIN_PASSWORD}"
         : "${PGPORT:=5432}"
         export PGPASSWORD="$PGADMIN_PASSWORD"
         psql "host=$PGHOST port=$PGPORT dbname=postgres user=$PGADMIN_USER" -c "SELECT 1" >/dev/null
       '; then
      log_success "Database is ready"
      return 0
    fi
    sleep 2
  done

  log_error "Database did not become ready in time"
  return 1
}

runtime_deploy_quadlet_files() {
  local src="$1"
  local dest_sys_d="$2"

  log_info "Deploying Quadlet files..."

  # Enable detailed tracing for this critical section
  set -x

  mkdir -p "$dest_sys_d"

  # Create staging directory
  local stage_q
  stage_q=$(mktemp -d)
  trap "rm -rf '$stage_q'" RETURN

  shopt -s nullglob globstar

  local count=0
  for f in "$src"/**/*.container "$src"/**/*.pod; do
        [[ -f "$f" ]] || continue
        cp -f "$f" "$stage_q/$(basename "$f")"
        ((++count))
  done

  if [[ $count -eq 0 ]]; then
    set +x
    log_warning "No Quadlet files found in $src"
    return 0
  fi

  # Avoid owner/group preservation for rootless; surface detailed error on failure
  if ! /usr/bin/rsync -rt --no-owner --no-group --delete "$stage_q"/ "$dest_sys_d"/; then
    code=$?
    set +x
    log_error "rsync failed ($code) copying quadlets from $stage_q to $dest_sys_d"
    /usr/bin/rsync -avvv --no-owner --no-group --delete "$stage_q"/ "$dest_sys_d"/ 2>&1 | sed 's/^/[rsync] /' >&2 || true
    return "$code"
  fi

  set +x
  log_success "Deployed $count Quadlet files"
}

runtime_deploy_env_files() {
    local src="$1"
    local dest_user_cfg="$2"
    
    log_info "Deploying environment files..."
    
    local stage_cfg=$(mktemp -d)
    trap "rm -rf '$stage_cfg'" RETURN
    
    shopt -s nullglob
    local count=0
    for envf in "$src"/*/env/*.env; do
        [[ -f "$envf" ]] || continue
        local svc="$(basename "$(dirname "$(dirname "$envf")")")"
        mkdir -p "$stage_cfg/$svc"
        cp -f "$envf" "$stage_cfg/$svc/$svc.env"
        ((++count))
    done
    
    if [[ $count -eq 0 ]]; then
        log_warning "No environment files found"
        return 0
    fi
    
    # Sync to config directories
    for dir in "$stage_cfg"/*; do
        [[ -d "$dir" ]] || continue
        local svc="$(basename "$dir")"
        mkdir -p "$dest_user_cfg/$svc"
        rsync -a "$dir"/ "$dest_user_cfg/$svc"/
    done
    
    log_success "Deployed environment files for $count services"
}

runtime_fetch_infisical_secrets() {
    local service="$1"
    local token_file="$2"
    local path="$3"
    local output_file="$4"
    
    log_info "Fetching secrets from Infisical path: $path"
    
    if [[ ! -f "$token_file" ]]; then
        log_error "Infisical token file not found: $token_file"
        return 1
    fi
    
    if [[ ! -x /bin/infisical ]]; then
        log_error "Infisical CLI not found at /bin/infisical"
        return 1
    fi
    
    local tmp_secrets=$(mktemp)
    trap "rm -f '$tmp_secrets'" RETURN
    chmod 600 "$tmp_secrets"
    
    INFISICAL_TOKEN="$(cat "$token_file")" \
    INFISICAL_DOMAIN="${INFISICAL_DOMAIN:-https://infisical.bastiat.xyz}" \
    /bin/infisical export \
        --domain="${INFISICAL_DOMAIN:-https://infisical.bastiat.xyz}" \
        --path="$path" \
        --env="${INFISICAL_ENV:-prod}" \
        --format=json \
        --silent \
        --include-imports \
        | jq -r '.[] | "\(.key)=\(.value)"' \
    > "$tmp_secrets" || {
        log_error "Failed to fetch secrets from $path"
        return 1
    }
    
    mv "$tmp_secrets" "$output_file"
    chmod 600 "$output_file"
    log_success "Secrets fetched and saved to $output_file"
}

runtime_provision_database() {
    local admin_env="$1"
    shift || true
    local pod_args=("$@")

    log_info "Starting database provisioning..."

    [[ -f "$admin_env" ]] || { log_error "Admin env not found: $admin_env"; return 1; }

    podman pull docker.io/library/postgres:16-alpine 2>/dev/null || true

    if ! podman run --rm "${pod_args[@]}" \
        --env-file "$admin_env" \
        docker.io/library/postgres:16-alpine sh -c '
        set -euo pipefail
    
        # Validate required variables
        : "${PGHOST:?Missing PGHOST}"
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
        
        echo "Connecting to PostgreSQL at $PGHOST:$PGPORT..."
        
        # Test connection first
        if ! psql "host=$PGHOST port=$PGPORT dbname=postgres user=$PGADMIN_USER" -c "SELECT 1" >/dev/null 2>&1; then
            echo "ERROR: Cannot connect to database"
            exit 1
        fi
        
        # Check if database exists
        DB_EXISTS=$(psql "host=$PGHOST port=$PGPORT dbname=postgres user=$PGADMIN_USER" -tAc \
            "SELECT 1 FROM pg_database WHERE datname = '"'"'$APP_DB_NAME'"'"'" || echo "0")
        
        if [[ "$DB_EXISTS" != "1" ]]; then
            echo "Creating database: $APP_DB_NAME"
            createdb -h "$PGHOST" -p "$PGPORT" -U "$PGADMIN_USER" "$APP_DB_NAME"
        fi
        
        # Now work within the application database
        psql "host=$PGHOST port=$PGPORT dbname=$APP_DB_NAME user=$PGADMIN_USER" -v ON_ERROR_STOP=1 <<'"'"'EOSQL'"'"'
        -- Create roles if they dont exist
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'"'"'MIGRATION_DB_USER'"'"') THEN
                EXECUTE format('"'"'CREATE ROLE %I LOGIN'"'"', :'"'"'MIGRATION_DB_USER'"'"');
                RAISE NOTICE '"'"'Created role: %'"'"', :'"'"'MIGRATION_DB_USER'"'"';
            END IF;
            
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'"'"'APP_DB_USER'"'"') THEN
                EXECUTE format('"'"'CREATE ROLE %I LOGIN'"'"', :'"'"'APP_DB_USER'"'"');
                RAISE NOTICE '"'"'Created role: %'"'"', :'"'"'APP_DB_USER'"'"';
            END IF;
        END
        $$;
        
        -- Update passwords
        ALTER ROLE :"MIGRATION_DB_USER" WITH PASSWORD :'"'"'MIGRATION_DB_PASSWORD'"'"';
        ALTER ROLE :"APP_DB_USER" WITH PASSWORD :'"'"'APP_DB_PASSWORD'"'"';
        
        -- Set database owner
        ALTER DATABASE :"APP_DB_NAME" OWNER TO :"MIGRATION_DB_USER";
        
        -- Revoke default PUBLIC privileges
        REVOKE CREATE ON SCHEMA public FROM PUBLIC;
        REVOKE ALL ON DATABASE :"APP_DB_NAME" FROM PUBLIC;
        
        -- Grant connection rights
        GRANT CONNECT ON DATABASE :"APP_DB_NAME" TO :"MIGRATION_DB_USER", :"APP_DB_USER";
        
        -- Create schema if needed
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = :'"'"'APP_DB_SCHEMA'"'"') THEN
                EXECUTE format('"'"'CREATE SCHEMA %I AUTHORIZATION %I'"'"', :'"'"'APP_DB_SCHEMA'"'"', :'"'"'MIGRATION_DB_USER'"'"');
                RAISE NOTICE '"'"'Created schema: %'"'"', :'"'"'APP_DB_SCHEMA'"'"';
            ELSIF :'"'"'APP_DB_SCHEMA'"'"' != '"'"'public'"'"' THEN
                EXECUTE format('"'"'ALTER SCHEMA %I OWNER TO %I'"'"', :'"'"'APP_DB_SCHEMA'"'"', :'"'"'MIGRATION_DB_USER'"'"');
            END IF;
        END
        $$;
        
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
        
        # Install extensions if specified
        if [[ -n "$DB_EXTENSIONS" ]]; then
            echo "Installing extensions: $DB_EXTENSIONS"
            IFS='"'"','"'"' read -ra EXT_ARR <<< "$DB_EXTENSIONS"
            for ext in "${EXT_ARR[@]}"; do
                ext="$(echo "$ext" | xargs)"
                [[ -z "$ext" ]] && continue
                echo "Installing extension: $ext"
                psql "host=$PGHOST port=$PGPORT dbname=$APP_DB_NAME user=$PGADMIN_USER" -v ON_ERROR_STOP=1 \
                    -c "CREATE EXTENSION IF NOT EXISTS \"$ext\" WITH SCHEMA \"$APP_DB_SCHEMA\""
            done
        fi
        
        echo "Database provisioning completed successfully"
    '; then
        log_error "Database provisioning failed"
        return 1
    fi

    log_success "Database provisioned successfully"
}

runtime_run_migrations() {
    local image="$1"
    local env_file="$2"
    local max_attempts="${3:-10}"
    shift 3 || true
    local pod_args=("$@")

    log_info "Running database migrations with image: $image"
    podman pull "$image" 2>/dev/null || log_warning "Could not pull latest image, using cached"

    local attempt=1
    while [[ $attempt -le $max_attempts ]]; do
        log_info "Migration attempt $attempt/$max_attempts..."
        if podman run --rm "${pod_args[@]}" \
            --env-file "$env_file" \
            "$image" sh -lc "npm run migrate:ci"; then
            log_success "Migrations completed successfully"
            return 0
        fi
        (( attempt < max_attempts )) && { log_warning "Migration failed, retrying in 3s..."; sleep 3; }
        ((attempt++))
    done

    log_error "Migrations failed after $max_attempts attempts"
    return 1
}

runtime_manage_systemd_services() {
    local dest_sys_d="$1"
    
    log_info "Managing systemd services..."
    
    # Reload systemd to pick up new unit files
    systemctl --user daemon-reload
    
    # Discover units from Quadlet files
    local pod_units=()
    local container_units=()
    
    shopt -s nullglob
    for f in "$dest_sys_d"/*.pod; do
        [[ -f "$f" ]] || continue
        local name="$(basename "$f" .pod)"
        pod_units+=("${name}-pod.service")
    done
    
    for f in "$dest_sys_d"/*.container; do
        [[ -f "$f" ]] || continue
        local name="$(basename "$f" .container)"
        container_units+=("${name}.service")
    done
    
    log_info "Found ${#pod_units[@]} pod units and ${#container_units[@]} container units"
    
    # Stop existing services
    if [[ ${#pod_units[@]} -gt 0 || ${#container_units[@]} -gt 0 ]]; then
        log_info "Stopping existing services..."
        
        # Build pattern for matching
        local pattern=""
        if [[ ${#pod_units[@]} -gt 0 ]]; then
            pattern=$(printf "%s\n" "${pod_units[@]}" | sed 's/\.service$//' | paste -sd '|')
        fi
        if [[ ${#container_units[@]} -gt 0 ]]; then
            if [[ -n "$pattern" ]]; then
                pattern="$pattern|"
            fi
            pattern="$pattern$(printf "%s\n" "${container_units[@]}" | sed 's/\.service$//' | paste -sd '|')"
        fi
        
        if [[ -n "$pattern" ]]; then
            systemctl --user list-units --all --no-legend --plain '*-pod.service' '*.service' | \
                grep -E "($pattern)" | awk '{print $1}' | \
                xargs -r systemctl --user stop 2>/dev/null || true
        fi
    fi
    
    # Clean up old containers and pods
    log_info "Cleaning up old containers and pods..."
    podman pod rm -fa 2>/dev/null || true
    podman rm -fa 2>/dev/null || true
    
    # Start services (pods first, then containers)
    local started_units=()
    
    # Start pod services
    for unit in "${pod_units[@]}"; do
        log_info "Starting pod unit: $unit"
        systemctl --user enable "$unit" 2>/dev/null || true
        
        if systemctl --user start "$unit"; then
            started_units+=("$unit")
            log_success "Started: $unit"
        else
            log_error "Failed to start: $unit"
            systemctl --user status "$unit" --no-pager || true
            journalctl --user -u "$unit" --no-pager -n 50 || true
        fi
    done
    
    # Start container services
    for unit in "${container_units[@]}"; do
        log_info "Starting container unit: $unit"
        systemctl --user enable "$unit" 2>/dev/null || true
        
        if systemctl --user start "$unit"; then
            started_units+=("$unit")
            log_success "Started: $unit"
        else
            log_error "Failed to start: $unit"
            systemctl --user status "$unit" --no-pager || true
            journalctl --user -u "$unit" --no-pager -n 50 || true
        fi
    done
    
    # Show final status
    if [[ ${#started_units[@]} -gt 0 ]]; then
        log_info "Final status of started units:"
        for unit in "${started_units[@]}"; do
            systemctl --user is-active "$unit" >/dev/null 2>&1 && \
                log_success "$unit is running" || \
                log_warning "$unit is not running"
        done
    fi
}

runtime_main_deployment() {
    set -euo pipefail
    for cmd in rsync podman; do
        command -v "$cmd" >/dev/null 2>&1 || { log_error "Required '$cmd' missing"; exit 1; }
    done

    export XDG_RUNTIME_DIR="/run/user/$(id -u)"

    local src="$REMOTE_TARGET_BASE_DIR/infra/quadlets"
    local dest_sys_d="$HOME/$REMOTE_SYSTEMD_USER_DIR"
    local dest_user_cfg="$HOME/.config"

    runtime_deploy_quadlet_files "$src" "$dest_sys_d"
    runtime_deploy_env_files "$src" "$dest_user_cfg"

    local service="$API_IMAGE_NAME"
    local cfg_dir="$dest_user_cfg/$service"
    mkdir -p "$cfg_dir"

    local token_file="$HOME/.secrets/infisical/${service}.token"
    runtime_fetch_infisical_secrets "$service" "$token_file" "/api" "$cfg_dir/${service}.secrets.env"

    # Pod args
    local pod_name
    pod_name="$(runtime_get_pod_name "$dest_sys_d")"
    local -a pod_args=()
    [[ -n "$pod_name" ]] && pod_args+=(--pod "$pod_name")

    if [[ "$NEEDS_API_CHANGES" == "true" ]] || [[ "$IS_WORKFLOW_DISPATCH" == "true" && "$FORCE_DEPLOY" == "true" ]]; then
        log_info "API changes or force deploy - running DB operations"

        # Admin secrets + ensure DB is running
        local admin_token_file="$HOME/.secrets/infisical/${service}-infra.token"
        local admin_env="$cfg_dir/${service}.dbadmin.env"
        runtime_fetch_infisical_secrets "$service" "$admin_token_file" "/api-infra" "$admin_env"

        runtime_start_db_and_wait "$dest_sys_d" "$admin_env" "${pod_args[@]}"

        # Provision
        runtime_provision_database "$admin_env" "${pod_args[@]}"

        # Prepare env for migrations
        local image="$REGISTRY/$IMAGE_OWNER/$API_IMAGE_NAME:prod"
        local mig_env
        mig_env="$(mktemp)"
        trap "rm -f '$mig_env'" EXIT
        chmod 600 "$mig_env"
        [[ -f "$cfg_dir/$service.env" ]] && cat "$cfg_dir/$service.env" >> "$mig_env"
        [[ -f "$cfg_dir/${service}.secrets.env" ]] && cat "$cfg_dir/${service}.secrets.env" >> "$mig_env"

        # Migrate
        runtime_run_migrations "$image" "$mig_env" 10 "${pod_args[@]}"
    else
        log_info "No API changes - skipping DB operations"
    fi

    runtime_manage_systemd_services "$dest_sys_d"
    log_success "Runtime deployment completed successfully"
}

# Export all functions for use in subshell
export -f log_info log_success log_warning log_error
export -f runtime_deploy_quadlet_files runtime_deploy_env_files
export -f runtime_fetch_infisical_secrets runtime_provision_database
export -f runtime_run_migrations runtime_manage_systemd_services
export -f runtime_main_deployment
export -f runtime_get_pod_name runtime_find_db_unit runtime_start_db_and_wait

# ============================================================================
# Section 2: Podman/Systemd operations
# ============================================================================

deploy_as_runtime_user() {
  log_info "Starting deployment as $REMOTE_RUNTIME_USER..."

  local script_path
  script_path=$(readlink -f "${BASH_SOURCE[0]}")

  if ! sudo -iu "$REMOTE_RUNTIME_USER" \
      DEBUG="${DEBUG:-0}" \
      NEEDS_API_CHANGES="$NEEDS_API_CHANGES" \
      IS_WORKFLOW_DISPATCH="$IS_WORKFLOW_DISPATCH" \
      FORCE_DEPLOY="$FORCE_DEPLOY" \
      REMOTE_TARGET_BASE_DIR="$REMOTE_TARGET_BASE_DIR" \
      REMOTE_SYSTEMD_USER_DIR="$REMOTE_SYSTEMD_USER_DIR" \
      API_IMAGE_NAME="$API_IMAGE_NAME" \
      REGISTRY="$REGISTRY" \
      IMAGE_OWNER="$IMAGE_OWNER" \
      REMOTE_CONFIGS_DIR="$REMOTE_CONFIGS_DIR" \
      REMOTE_DASHBOARD_VOLUME_DIR="$REMOTE_DASHBOARD_VOLUME_DIR" \
      REMOTE_RUNTIME_USER="$REMOTE_RUNTIME_USER" \
      RED="$RED" GREEN="$GREEN" YELLOW="$YELLOW" BLUE="$BLUE" NC="$NC" \
      bash -Eeuo pipefail -c "source \"$script_path\"; runtime_main_deployment"; then

    log_error "Deployment as runtime user failed"
    exit 1
  fi

  log_success "Runtime user deployment completed"
}

# ============================================================================
# Main Execution
# ============================================================================
main() {
    log_info "=== Starting Deployment Process ==="
    log_info "Configuration:"
    log_info "  - Infrastructure changes: $NEEDS_INFRA_CHANGES"
    log_info "  - Dashboard changes: $NEEDS_DASHBOARD_CHANGES"
    log_info "  - API changes: $NEEDS_API_CHANGES"
    log_info "  - Force deploy: $FORCE_DEPLOY"
    log_info "  - Target directory: $REMOTE_TARGET_BASE_DIR"
    log_info "  - Runtime user: $REMOTE_RUNTIME_USER"
    
    # Section 1: Root-level operations
    log_info "=== Section 1: Root-level file operations ==="
    deploy_infrastructure_configs
    deploy_dashboard_assets
    
    # Section 2: Runtime user operations
    log_info "=== Section 2: Runtime user operations ==="
    verify_podman_quadlet
    
    # --- NEW CODE BLOCK ---
    # Change ownership of the entire temp directory to the runtime user
    # so that it can read the source files for deployment.
    log_info "Changing ownership of '$REMOTE_TARGET_BASE_DIR' to '$REMOTE_RUNTIME_USER'"
    if ! sudo chown -R "$REMOTE_RUNTIME_USER:$REMOTE_RUNTIME_USER" "$REMOTE_TARGET_BASE_DIR"; then
        log_error "Failed to change ownership of the target directory."
        exit 1
    fi
    log_success "Ownership changed."
    # --- END NEW CODE BLOCK ---

    deploy_as_runtime_user
    
    # Section 3: Cleanup
    log_info "=== Section 3: Cleanup ==="
    if [[ -d "$REMOTE_TARGET_BASE_DIR" ]]; then
        log_info "Removing temporary deployment directory: $REMOTE_TARGET_BASE_DIR"
        sudo rm -rf "$REMOTE_TARGET_BASE_DIR"
        log_success "Cleanup completed"
    fi
    
    log_success "=== Deployment Process Completed Successfully ==="
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main
fi