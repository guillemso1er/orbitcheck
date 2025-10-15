#!/bin/bash

# ============================================================================
# Script Configuration
# ============================================================================
set -euo pipefail

readonly SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Color codes for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# ============================================================================
# Logging Functions
# ============================================================================
log_info() {
    echo -e "${BLUE}[INFO]${NC} $*" >&2
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $*" >&2
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $*" >&2
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*" >&2
}

die() {
    log_error "$@"
    exit 1
}

# ============================================================================
# Utility Functions
# ============================================================================
is_command_available() {
    command -v "$1" >/dev/null 2>&1
}

install_infisical_cli() {
    if is_command_available infisical; then
        log_info "Infisical CLI is already installed"
        return 0
    fi

    log_info "Installing Infisical CLI..."

    if is_command_available apk; then
        # Alpine Linux
        apk add --no-cache curl
        curl -1sLf 'https://dl.cloudsmith.io/public/infisical/infisical-cli/setup.alpine.sh' | sh
        apk add --no-cache infisical-cli
    elif is_command_available apt-get; then
        # Debian/Ubuntu
        apt-get update && apt-get install -y curl
        curl -1sLf 'https://dl.cloudsmith.io/public/infisical/infisical-cli/setup.deb.sh' | bash
        apt-get install -y infisical-cli
    elif is_command_available yum; then
        # RHEL/CentOS
        yum install -y curl
        curl -1sLf 'https://dl.cloudsmith.io/public/infisical/infisical-cli/setup.rpm.sh' | bash
        yum install -y infisical-cli
    elif is_command_available yay; then
        # Arch Linux
        yay -S infisical-bin
    elif is_command_available brew; then
        # macOS with Homebrew
        brew install infisical/tap/infisical
    else
        # Fallback: try to install via npm (cross-platform)
        if is_command_available npm; then
            npm install -g @infisical/cli
        elif is_command_available yarn; then
            yarn global add @infisical/cli
        else
            die "Unable to install Infisical CLI: no supported package manager found"
        fi
    fi

    if ! is_command_available infisical; then
        die "Failed to install Infisical CLI"
    fi

    log_success "Infisical CLI installed successfully"
}

# ============================================================================
# Utility Functions
# ============================================================================
upsert_secret() {
    # --- Local variable declarations ---
    local secret_name="$1"
    local secret_value="$2"
    local admin_token="$3"
    local project_id="$4"
    local base_url="$5"
    local environment="$6"

    echo "Checking secret: ${secret_name}..."

    # --- Check if the secret already exists ---
    # The result of this curl command is stored in the SECRET_CHECK variable.
    # We redirect stderr to /dev/null to suppress curl's progress meter.
    # If the curl command fails, we default to an empty JSON object '{}'.
    SECRET_CHECK=$(curl -s "${base_url}/api/v4/secrets/${secret_name}" \
        -H "Authorization: Bearer ${admin_token}" \
        -G \
        --data-urlencode "projectId=${project_id}" \
        --data-urlencode "environment=${environment}" \
        --data-urlencode "secretPath=/" 2>/dev/null || echo '{}')

    # --- Conditional logic to create or update the secret ---
    # We use jq to check if the '.secret' key exists in the JSON response.
    if echo "${SECRET_CHECK}" | jq -e '.secret' > /dev/null 2>&1; then
        echo "Secret ${secret_name} already exists, updating..."
        # Use PATCH to update the existing secret.
        curl -s -X PATCH "${base_url}/api/v4/secrets/${secret_name}" \
            -H "Authorization: Bearer ${admin_token}" \
            -H "Content-Type: application/json" \
            -d "{
                    \"projectId\": \"${project_id}\",
                    \"environment\": \"${environment}\",
                    \"secretPath\": \"/\",
                    \"secretValue\": \"${secret_value}\"
                }" \
            | jq .
    else
       echo "Creating secret ${secret_name}..."
        # Use POST to create a new secret.
        curl -s -X POST "${base_url}/api/v4/secrets/${secret_name}" \
            -H "Authorization: Bearer ${admin_token}" \
            -H "Content-Type: application/json" \
            -d "{
                    \"projectId\": \"${project_id}\",
                    \"environment\": \"${environment}\",
                    \"secretPath\": \"/\",
                    \"secretValue\": \"${secret_value}\"
                }" \
            | jq .
    fi
}

# ============================================================================
# Main Functions
# ============================================================================
main() {
    # Parse arguments
    local upsert_secrets=false
    local fail_on_infisical_error=false
    local skip_cleanup=false
    local env_file=""

    while [[ $# -gt 0 ]]; do
        case $1 in
            --upsert-secrets)
                upsert_secrets=true
                shift
                ;;
            --fail-on-infisical-error)
                fail_on_infisical_error=true
                shift
                ;;
            --skip-cleanup)
                skip_cleanup=true
                shift
                ;;
            -*|--*)
                die "Unknown option $1"
                ;;
            *)
                if [ -z "$env_file" ]; then
                    env_file="$1"
                else
                    die "Multiple env files specified. Usage: $SCRIPT_NAME [--upsert-secrets] [--fail-on-infisical-error] [--skip-cleanup] <env-file>"
                fi
                shift
                ;;
        esac
    done

    if [ -z "$env_file" ]; then
        die "Usage: $SCRIPT_NAME [--upsert-secrets] [--fail-on-infisical-error] [--skip-cleanup] <env-file>"
    fi

    if [ ! -f "$env_file" ]; then
        die "Environment file '$env_file' not found"
    fi
    env_file="$(readlink -f "$env_file")"

    # Load environment variables
    log_info "Loading environment from $env_file"
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a

    # Determine compose file and environment
    local compose_file
    local infisical_env
    local use_infisical=true

    case "${ENVIRONMENT}" in
        dev)
            compose_file="$SCRIPT_DIR/infra/compose/dev.compose.yml"
            infisical_env="dev"
            ;;
        local)
            compose_file="$SCRIPT_DIR/infra/compose/local.compose.yml"
            infisical_env="dev"
            ;;
        prod)
            compose_file="$SCRIPT_DIR/infra/compose/prod.compose.yml"
            infisical_env="prod"
            ;;
        *)
            die "Unknown ENVIRONMENT: ${ENVIRONMENT:-dev}. Supported: dev, local, prod"
            ;;
    esac

    if [ ! -f "$compose_file" ]; then
        die "Compose file '$compose_file' not found"
    fi

    log_info "Using compose file: $compose_file"
    log_info "Infisical environment: $infisical_env"

    # Change to compose directory for relative paths
    cd "$SCRIPT_DIR/infra/compose"

    # Install Infisical CLI
    install_infisical_cli

    # Check if Infisical should be used
    if [ "$use_infisical" = true ]; then
        # Start Infisical services
        log_info "Starting Infisical services (backend, redis, db)..."
        podman compose -f "$compose_file" up -d infisical-backend infisical-redis infisical-db --wait --remove-orphans

        log_success "Infisical services started"

        # Make init_infisical.sh executable
        chmod +x "$SCRIPT_DIR/scripts/init_infisical.sh"

        # Call init_infisical.sh to get token and project ID
        log_info "Initializing Infisical and obtaining tokens..."
        local token project_id admin_token

        if output=$("$SCRIPT_DIR/scripts/init_infisical.sh"  2>&1); then
            read -r token project_id admin_token <<< "$output"
            token="${token//[$'\r\n']}"
            project_id="${project_id//[$'\r\n']}"
            admin_token="${admin_token//[$'\r\n']}"
            
            # Check if we have the essential values (token and project_id)
            # admin_token is optional and only required for upserting secrets
            if [ -n "$token" ] && [ -n "$project_id" ]; then
                if [ -n "$admin_token" ]; then
                    log_success "Infisical tokens and project ID obtained (with admin access)"
                else
                    log_success "Infisical token and project ID obtained (using UA credentials)"
                    # If upsert_secrets is requested but no admin token, warn the user
                    if [ "$upsert_secrets" = true ]; then
                        log_warning "Secret upserting requested but no admin token available. Skipping secret upsert."
                        upsert_secrets=false
                    fi
                fi
            else
                if [ "$fail_on_infisical_error" = true ]; then
                    die "No token or project ID received from init_infisical.sh: $output"
                else
                    log_warning "No token or project ID received from init_infisical.sh, falling back to environment files: $output"
                    use_infisical=false
                fi
            fi
        else
            if [ "$fail_on_infisical_error" = true ]; then
                log_error "Failed to initialize Infisical. Details:"
                echo "$output" >&2
                die "Infisical initialization failed"
            else
                log_warning "Failed to initialize Infisical, falling back to environment files. Details:"
                echo "$output" >&2
                use_infisical=false
            fi
        fi
    fi

    # Load fallback environment variables if Infisical is not available
    if [ "$use_infisical" = false ]; then
        local env_file_suffix="${ENVIRONMENT:-dev}"
        local fallback_env="$SCRIPT_DIR/.env.$env_file_suffix"

        if [ -f "$fallback_env" ]; then
            log_info "Loading fallback environment from $fallback_env"
            set -a
            # shellcheck disable=SC1090
            source "$fallback_env"
            set +a
        else
            log_warning "No fallback environment file found at $fallback_env"
        fi
    fi

    # Upsert secrets if requested
    # Now we explicitly check for admin_token before attempting to upsert
    if [ "$upsert_secrets" = true ] && [ "$use_infisical" = true ] && [ -n "${admin_token:-}" ] && [ -n "${project_id:-}" ]; then
        log_info "Upserting secrets from environment file to Infisical..."

        # Parse the environment file and upsert each secret
        while IFS='=' read -r key value; do
            # Skip comments and empty lines
            [[ $key =~ ^[[:space:]]*# ]] && continue
            [[ -z "$key" ]] && continue

            # Remove quotes from value if present
            value=$(echo "$value" | sed 's/^"KATEX_INLINE_OPEN.*KATEX_INLINE_CLOSE"$/\1/' | sed "s/^'KATEX_INLINE_OPEN.*KATEX_INLINE_CLOSE'$/\1/")

            # Skip if value is empty
            [[ -z "$value" ]] && continue

            # echo debug parameters values
            echo "Upserting secret: key='$key', value='${#value} chars', project_id='$project_id', environment='$infisical_env'"
            upsert_secret "$key" "$value" "$admin_token" "$project_id" "${INFISICAL_SITE_URL:-http://localhost:8085}" "$infisical_env"
        done < "$env_file"

        log_success "Secrets upserted successfully"
    elif [ "$upsert_secrets" = true ] && [ -z "${admin_token:-}" ]; then
        log_warning "Secret upserting was requested but no admin token is available. Skipping."
    fi

    # Stop/delete Infisical containers
    if [ "$skip_cleanup" = false ]; then
        log_info "Stopping and removing Infisical containers..."
        podman compose -f "$compose_file" down infisical-backend infisical-redis infisical-db
    else
        log_info "Skipping cleanup of Infisical containers as requested."
    fi

    # Start non-Infisical containers
    log_info "Starting non-Infisical containers..."

    if [ "$use_infisical" = true ] && [ -n "$token" ]; then
        # Use Infisical token
        INFISICAL_TOKEN="$token" infisical run \
            --env="$infisical_env" \
            --path="/" \
            --projectId="$project_id" \
            --domain="${INFISICAL_SITE_URL:-http://localhost:8085}" \
            -- podman compose -f "$compose_file" up -d --remove-orphans
    else
        # Use environment variables directly
        podman compose -f "$compose_file" up -d 
    fi

    # Log container errors
    log_info "Checking for container errors..."

    local containers
    containers=$(podman ps -a --filter "status=exited" --filter "status=dead" --format "{{.Names}}|{{.Status}}" 2>/dev/null || true)

    if [ -n "$containers" ]; then
        log_warning "Found containers that exited with error:"
        echo "$containers" | while IFS='|' read -r name status; do
            if echo "$status" | grep -q "Exited\|Error\|Dead"; then
                log_error "Container '$name' status: $status"
            fi
        done
    else
        log_success "All containers are running successfully"
    fi

    log_success "Orbicheck startup completed successfully"
}

# Run main function
main "$@"