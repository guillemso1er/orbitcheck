#!/bin/bash
# .github/scripts/lib/helpers.sh
# Description: Generic utility functions

# Prevent double-sourcing
[[ -n "${_ORBITCHECK_HELPERS_SOURCED:-}" ]] && return 0
readonly _ORBITCHECK_HELPERS_SOURCED=1

# Ensure strict mode is inherited
set -Eeuo pipefail

# Source dependencies
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# ============================================================================
# Utility Functions
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
# Export Functions
# ============================================================================

export -f safe_rsync command_exists verify_directory
