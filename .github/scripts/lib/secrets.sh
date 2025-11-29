#!/bin/bash
# .github/scripts/lib/secrets.sh
# Description: Infisical secrets fetching

# Prevent double-sourcing
[[ -n "${_ORBITCHECK_SECRETS_SOURCED:-}" ]] && return 0
readonly _ORBITCHECK_SECRETS_SOURCED=1

# Ensure strict mode is inherited
set -Eeuo pipefail

# Source dependencies
_SECRETS_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$_SECRETS_LIB_DIR/common.sh"

# ============================================================================
# Secrets Functions
# ============================================================================

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
    
    local tmp_secrets
    tmp_secrets=$(mktemp)
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

# ============================================================================
# Export Functions
# ============================================================================

export -f runtime_fetch_infisical_secrets
