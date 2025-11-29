#!/bin/bash
# .github/scripts/lib/infra.sh
# Description: Infrastructure deployment (root-level operations)

# Prevent double-sourcing
[[ -n "${_ORBITCHECK_INFRA_SOURCED:-}" ]] && return 0
readonly _ORBITCHECK_INFRA_SOURCED=1

# Ensure strict mode is inherited
set -Eeuo pipefail

# Source dependencies
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"
source "$SCRIPT_DIR/helpers.sh"

# ============================================================================
# Infrastructure Functions
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

# Resolve immutable image ref for a service:
# - Prefer explicit digest ref (SERVICE_IMAGE_REF)
# - Else use version tag (RELEASE_VERSION)
# - Else error (we don't want floating tags in prod)
resolve_image_ref() {
    local svc_name="$1"           # "api" or "caddy" or "shopify"
    local image_name="$2"         # e.g., "$API_IMAGE_NAME"
    local explicit_ref="$3"       # e.g., "$API_IMAGE_REF"

    local repo="${REGISTRY}/${IMAGE_OWNER}/${image_name}"

    if [[ -n "$explicit_ref" ]]; then
        echo "$explicit_ref"
        return 0
    fi

    if [[ -n "$RELEASE_VERSION" ]]; then
        echo "${repo}:${RELEASE_VERSION}"
        return 0
    fi

    log_error "No immutable ref or version provided for ${svc_name} (${repo})."
    return 1
}

# ============================================================================
# Export Functions
# ============================================================================

export -f deploy_infrastructure_configs verify_podman_quadlet resolve_image_ref
