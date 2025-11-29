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
# Deployment Script - Handles infrastructure and API deployments
# ============================================================================

# Determine script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source all library modules
source "$SCRIPT_DIR/lib/common.sh"
source "$SCRIPT_DIR/lib/config.sh"
source "$SCRIPT_DIR/lib/helpers.sh"
source "$SCRIPT_DIR/lib/infra.sh"
source "$SCRIPT_DIR/lib/quadlet.sh"
source "$SCRIPT_DIR/lib/secrets.sh"
source "$SCRIPT_DIR/lib/database.sh"
source "$SCRIPT_DIR/lib/storage.sh"
source "$SCRIPT_DIR/lib/systemd.sh"
source "$SCRIPT_DIR/lib/runtime.sh"

# ============================================================================
# Error Handling
# ============================================================================

trap 'code=$?; line=$LINENO; cmd=$BASH_COMMAND; file=${BASH_SOURCE[0]};
      log_error "Exit $code at $file:$line while running: $cmd";
      print_stack;
      cleanup_on_error;
      exit $code' ERR

# Cleanup function for error cases
cleanup_on_error() {
    log_info "Performing emergency cleanup..."
    # Add any emergency cleanup tasks here
}

# ============================================================================
# Configuration
# ============================================================================

# Set defaults and validate
setup_default_vars
validate_required_vars
normalize_all_bools

# ============================================================================
# Deploy as Runtime User
# ============================================================================

deploy_as_runtime_user() {
    log_info "Starting deployment as $REMOTE_RUNTIME_USER..."

    local script_path
    script_path=$(readlink -f "${BASH_SOURCE[0]}")

    if ! sudo -iu "$REMOTE_RUNTIME_USER" \
        DEBUG="${DEBUG:-0}" \
        NEEDS_API_CHANGES="$NEEDS_API_CHANGES" \
        NEEDS_SHOPIFY_CHANGES="$NEEDS_SHOPIFY_CHANGES" \
        NEEDS_INFRA_CHANGES="$NEEDS_INFRA_CHANGES" \
        NEEDS_DASHBOARD_CHANGES="${NEEDS_DASHBOARD_CHANGES:-false}" \
        IS_WORKFLOW_DISPATCH="$IS_WORKFLOW_DISPATCH" \
        FORCE_DEPLOY="$FORCE_DEPLOY" \
        FORCE_RESTART="${FORCE_RESTART:-false}" \
        REMOTE_TARGET_BASE_DIR="$REMOTE_TARGET_BASE_DIR" \
        REMOTE_SYSTEMD_USER_DIR="$REMOTE_SYSTEMD_USER_DIR" \
        API_IMAGE_NAME="$API_IMAGE_NAME" \
        CADDY_IMAGE_NAME="${CADDY_IMAGE_NAME}" \
        SHOPIFY_IMAGE_NAME="${SHOPIFY_IMAGE_NAME}" \
        API_IMAGE_REF="${API_IMAGE_REF:-}" \
        CADDY_IMAGE_REF="${CADDY_IMAGE_REF:-}" \
        SHOPIFY_IMAGE_REF="${SHOPIFY_IMAGE_REF:-}" \
        RELEASE_VERSION="${RELEASE_VERSION:-}" \
        REGISTRY="$REGISTRY" \
        IMAGE_OWNER="$IMAGE_OWNER" \
        REMOTE_CONFIGS_DIR="$REMOTE_CONFIGS_DIR" \
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
    log_info "  - API changes: $NEEDS_API_CHANGES"
    log_info "  - Force deploy: $FORCE_DEPLOY"
    log_info "  - Target directory: $REMOTE_TARGET_BASE_DIR"
    log_info "  - Runtime user: $REMOTE_RUNTIME_USER"
    
    # Section 1: Root-level operations
    log_info "=== Section 1: Root-level file operations ==="
    deploy_infrastructure_configs
    
    # Section 2: Runtime user operations
    log_info "=== Section 2: Runtime user operations ==="
    verify_podman_quadlet
    
    log_info "Changing ownership of '$REMOTE_TARGET_BASE_DIR' to '$REMOTE_RUNTIME_USER'"
    if ! sudo chown -R "$REMOTE_RUNTIME_USER:$REMOTE_RUNTIME_USER" "$REMOTE_TARGET_BASE_DIR"; then
        log_error "Failed to change ownership of the target directory."
        exit 1
    fi
    log_success "Ownership changed."

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