#!/bin/bash
# .github/scripts/lib/config.sh
# Description: Variable validation, defaults, and normalization

# Prevent double-sourcing
[[ -n "${_ORBITCHECK_CONFIG_SOURCED:-}" ]] && return 0
readonly _ORBITCHECK_CONFIG_SOURCED=1

# Ensure strict mode is inherited
set -Eeuo pipefail

# Source dependencies
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# ============================================================================
# Variable Validation
# ============================================================================

validate_required_vars() {
    local missing_vars=()
    
    # Required variables with no defaults
    local required_vars=(
        "REMOTE_TARGET_BASE_DIR"
        "REMOTE_CONFIGS_DIR"
        "REMOTE_RUNTIME_USER"
        "REMOTE_SYSTEMD_USER_DIR"
        "REGISTRY"
        "IMAGE_OWNER"
        "API_IMAGE_NAME"
        "CADDY_IMAGE_NAME"
        "SHOPIFY_IMAGE_NAME" 
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

# ============================================================================
# Boolean Normalization
# ============================================================================

normalize_bool() {
    case "${1,,}" in
        true|yes|1) echo "true" ;;
        *) echo "false" ;;
    esac
}

# ============================================================================
# Default Variables Setup
# ============================================================================

setup_default_vars() {
    # Set defaults for optional variables
    : "${NEEDS_INFRA_CHANGES:=false}"
    : "${NEEDS_API_CHANGES:=false}"
    : "${NEEDS_SHOPIFY_CHANGES:=false}"
    : "${IS_WORKFLOW_DISPATCH:=false}"
    : "${FORCE_DEPLOY:=false}"
    : "${NEEDS_DASHBOARD_CHANGES:=false}"
    : "${API_IMAGE_REF:=}"        
    : "${CADDY_IMAGE_REF:=}"
    : "${SHOPIFY_IMAGE_REF:=}"
    : "${RELEASE_VERSION:=}"      
    : "${FORCE_RESTART:=false}"

    # Export them so they're available
    export NEEDS_INFRA_CHANGES NEEDS_API_CHANGES NEEDS_SHOPIFY_CHANGES
    export IS_WORKFLOW_DISPATCH FORCE_DEPLOY NEEDS_DASHBOARD_CHANGES
    export API_IMAGE_REF CADDY_IMAGE_REF SHOPIFY_IMAGE_REF
    export RELEASE_VERSION FORCE_RESTART
}

normalize_all_bools() {
    NEEDS_INFRA_CHANGES=$(normalize_bool "$NEEDS_INFRA_CHANGES")
    NEEDS_API_CHANGES=$(normalize_bool "$NEEDS_API_CHANGES")
    NEEDS_SHOPIFY_CHANGES=$(normalize_bool "$NEEDS_SHOPIFY_CHANGES")
    IS_WORKFLOW_DISPATCH=$(normalize_bool "$IS_WORKFLOW_DISPATCH")
    FORCE_DEPLOY=$(normalize_bool "$FORCE_DEPLOY")
    NEEDS_DASHBOARD_CHANGES=$(normalize_bool "$NEEDS_DASHBOARD_CHANGES")
    FORCE_RESTART=$(normalize_bool "$FORCE_RESTART")

    # Export normalized values
    export NEEDS_INFRA_CHANGES NEEDS_API_CHANGES NEEDS_SHOPIFY_CHANGES
    export IS_WORKFLOW_DISPATCH FORCE_DEPLOY NEEDS_DASHBOARD_CHANGES
    export FORCE_RESTART
}

# ============================================================================
# Export Functions
# ============================================================================

export -f validate_required_vars normalize_bool setup_default_vars normalize_all_bools
