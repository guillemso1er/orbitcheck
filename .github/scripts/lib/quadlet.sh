#!/bin/bash
# .github/scripts/lib/quadlet.sh
# Description: Quadlet file deployment & image patching

# Prevent double-sourcing
[[ -n "${_ORBITCHECK_QUADLET_SOURCED:-}" ]] && return 0
readonly _ORBITCHECK_QUADLET_SOURCED=1

# Ensure strict mode is inherited
set -Eeuo pipefail

# Source dependencies
_QUADLET_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$_QUADLET_LIB_DIR/common.sh"
source "$_QUADLET_LIB_DIR/infra.sh"

# ============================================================================
# Quadlet Helper Functions
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

# ============================================================================
# Quadlet Deployment Functions
# ============================================================================

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
    for f in "$src"/**/*.container "$src"/**/*.pod "$src"/**/*.build "$src"/**/*.Containerfile; do
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

# Replace Image= lines for API and Caddy with pinned refs
runtime_patch_quadlet_images() {
    local dest_sys_d="$1"

    local api_ref
    api_ref="$(resolve_image_ref "api" "$API_IMAGE_NAME" "$API_IMAGE_REF")" || return 1
    local caddy_ref
    caddy_ref="$(resolve_image_ref "caddy" "$CADDY_IMAGE_NAME" "$CADDY_IMAGE_REF")" || return 1
    local shopify_ref
    shopify_ref="$(resolve_image_ref "shopify" "$SHOPIFY_IMAGE_NAME" "$SHOPIFY_IMAGE_REF")" || return 1

    log_info "Patching Quadlet Image= lines with immutable refs"
    log_info "  API     -> $api_ref"
    log_info "  Caddy   -> $caddy_ref"
    log_info "  Shopify -> $shopify_ref"

    shopt -s nullglob
    local f
    local api_patched=0 caddy_patched=0 shopify_patched=0

    for f in "$dest_sys_d"/*.container "$dest_sys_d"/*.pod; do
        [[ -f "$f" ]] || continue

        # Patch API
        if grep -Eq "^\s*Image\s*=\s*.*/${API_IMAGE_NAME}(:|@)" "$f"; then
            sed -i -E "s#^(\s*Image\s*=\s*).*/${API_IMAGE_NAME}(:|@)[^[:space:]]*#\1${api_ref}#g" "$f"
            ((++api_patched))
        fi

        # Patch Caddy
        if grep -Eq "^\s*Image\s*=\s*.*/${CADDY_IMAGE_NAME}(:|@)" "$f"; then
            sed -i -E "s#^(\s*Image\s*=\s*).*/${CADDY_IMAGE_NAME}(:|@)[^[:space:]]*#\1${caddy_ref}#g" "$f"
            ((++caddy_patched))
        fi

        # Patch Shopify
        if grep -Eq "^\s*Image\s*=\s*.*/${SHOPIFY_IMAGE_NAME}(:|@)" "$f"; then
            sed -i -E "s#^(\s*Image\s*=\s*).*/${SHOPIFY_IMAGE_NAME}(:|@)[^[:space:]]*#\1${shopify_ref}#g" "$f"
            ((++shopify_patched))
        fi
    done

    if (( api_patched == 0 )); then log_warning "No API Image= lines patched"; fi
    if (( caddy_patched == 0 )); then log_warning "No Caddy Image= lines patched"; fi
    if (( shopify_patched == 0 )); then log_warning "No Shopify Image= lines patched"; fi
    
    log_success "Quadlet images patched (API: $api_patched, Caddy: $caddy_patched, Shopify: $shopify_patched)"
}

runtime_deploy_env_files() {
    local src="$1"
    local dest_user_cfg="$2"
    
    log_info "Deploying environment files..."
    
    local stage_cfg
    stage_cfg=$(mktemp -d)
    trap "rm -rf '$stage_cfg'" RETURN
    
    shopt -s nullglob
    local count=0
    for envf in "$src"/*/env/*.env; do
        [[ -f "$envf" ]] || continue
        local svc
        svc="$(basename "$(dirname "$(dirname "$envf")")")"
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
        local svc
        svc="$(basename "$dir")"
        mkdir -p "$dest_user_cfg/$svc"
        rsync -a "$dir"/ "$dest_user_cfg/$svc"/
    done
    
    log_success "Deployed environment files for $count services"
}

# ============================================================================
# Export Functions
# ============================================================================

export -f runtime_get_pod_name runtime_find_db_unit
export -f runtime_deploy_quadlet_files runtime_patch_quadlet_images runtime_deploy_env_files
