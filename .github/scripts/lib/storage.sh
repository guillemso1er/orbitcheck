#!/bin/bash
# .github/scripts/lib/storage.sh
# Description: Container storage management & cleanup

# Prevent double-sourcing
[[ -n "${_ORBITCHECK_STORAGE_SOURCED:-}" ]] && return 0
readonly _ORBITCHECK_STORAGE_SOURCED=1

# Ensure strict mode is inherited
set -Eeuo pipefail

# Source dependencies
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# ============================================================================
# Storage Functions
# ============================================================================

runtime_graphroot() {
    local p=""
    # Use || true to prevent set -e from triggering on podman failure
    p="$(podman info --format '{{ .Store.GraphRoot }}' 2>/dev/null | tr -d '\r')" || true
    if [[ -z "$p" ]]; then
        # Check common custom location first
        if [[ -d "$HOME/containers/storage" ]]; then
            p="$HOME/containers/storage"
        else
            # Fallback default for rootless
            p="$HOME/.local/share/containers/storage"
        fi
    fi
    echo "$p"
}

runtime_cleanup_corrupted_storage() {
    log_info "Cleaning up any corrupted container storage..."
    local gr
    gr="$(runtime_graphroot)"
    
    # Remove incomplete/tmp files that can cause issues
    find "$gr" -name '.tmp-*' -type f -delete 2>/dev/null || true
    find "$gr" -name '*.tmp' -type f -delete 2>/dev/null || true
    
    # Remove incomplete layers directory entries
    if [[ -d "$gr/overlay-layers" ]]; then
        find "$gr/overlay-layers" -name '.tmp-*' -delete 2>/dev/null || true
    fi
    
    # Reset storage if severely corrupted
    if podman info 2>&1 | grep -q "corrupted"; then
        log_warning "Detected corrupted storage, attempting reset..."
        podman system reset --force 2>/dev/null || true
    fi
}

# Emergency cleanup when disk is critically full - bypasses podman
runtime_emergency_disk_cleanup() {
    local gr="$1"
    log_warning "EMERGENCY: Disk critically full, performing direct filesystem cleanup..."
    
    # First, remove all temp files to free up some inodes
    find "$gr" -type f -name '.tmp-*' -delete 2>/dev/null || true
    find "$gr" -type f -name '*.tmp' -delete 2>/dev/null || true
    find "$gr" -type f -name 'tmp*' -delete 2>/dev/null || true
    
    # Remove incomplete layers that are causing issues
    if [[ -d "$gr/overlay-layers" ]]; then
        # Delete the problematic incomplete layer
        local incomplete_layer="651d8dd47961b18afb71d05779897afcdd79f1f77099702afea56cf91fca6258"
        if [[ -d "$gr/overlay/$incomplete_layer" ]]; then
            log_info "Removing incomplete layer: $incomplete_layer"
            rm -rf "$gr/overlay/$incomplete_layer" 2>/dev/null || true
        fi
    fi
    
    # Try to stop systemd services first to release container locks
    log_info "Stopping all container services..."
    systemctl --user stop 'orbitcheck-*' 2>/dev/null || true
    systemctl --user stop '*-pod.service' 2>/dev/null || true
    
    # Kill any running podman/conmon processes
    pkill -u "$(id -u)" -f 'conmon' 2>/dev/null || true
    pkill -u "$(id -u)" -f 'podman' 2>/dev/null || true
    sleep 2
    
    # Now try podman reset which should work with some space freed
    log_info "Attempting podman system reset..."
    podman system reset --force 2>/dev/null || true
    
    # If that still fails, manually clean the storage
    if [[ "$(runtime_free_mb "$gr")" -lt 100 ]]; then
        log_warning "Podman reset insufficient, manually cleaning overlay storage..."
        # Remove overlay diff directories (largest space consumers)
        if [[ -d "$gr/overlay" ]]; then
            # Keep the 'l' symlink directory, remove layer data
            find "$gr/overlay" -maxdepth 1 -type d ! -name 'overlay' ! -name 'l' -exec rm -rf {} \; 2>/dev/null || true
        fi
        # Clear the layers metadata
        rm -f "$gr/overlay-layers/layers.json" 2>/dev/null || true
        rm -f "$gr/overlay-images/images.json" 2>/dev/null || true
        rm -f "$gr/overlay-containers/containers.json" 2>/dev/null || true
    fi
    
    log_info "Emergency cleanup completed. Disk status:"
    df -h "$gr" || true
}

runtime_report_storage() {
    local gr
    gr="$(runtime_graphroot)"
    log_info "Podman GraphRoot: $gr"
    log_info "Disk usage (GraphRoot):"
    df -h "$gr" || true
    log_info "Inode usage (GraphRoot):"
    df -i "$gr" || true
    log_info "Podman storage usage:"
    podman system df || true
}

runtime_free_mb() {
    local path="${1:-$HOME}"
    df -Pk "$path" | awk 'NR==2 {print int($4/1024)}'
}

runtime_inodes_used_pct() {
    local path="${1:-$HOME}"
    df -Pi "$path" | awk 'NR==2 {gsub(/%/,"",$5); print $5}'
}

runtime_maybe_prune_images() {
    log_warning "Low space at Podman GraphRoot; pruning unused images..."
    runtime_cleanup_corrupted_storage
    podman stop -a 2>/dev/null || true
    podman container prune -f || true
    podman image prune -a -f || true
    podman volume prune -f || true
    podman builder prune -a -f 2>/dev/null || true
    podman system prune -a -f --volumes 2>/dev/null || true
    runtime_report_storage
}

runtime_preflight_storage() {
    local min_mb="${1:-2048}"      # need at least 2 GiB free
    local max_inode_pct="${2:-95}" # don't proceed if inodes > 95%
    local critical_mb=100          # below this, use emergency cleanup
    local critical_inode_pct=98    # above this, use emergency cleanup
    local gr free_mb inode_used
    gr="$(runtime_graphroot)"
    
    free_mb="$(runtime_free_mb "$gr")"
    inode_used="$(runtime_inodes_used_pct "$gr")"
    
    # Check if we're in critical state (podman can't even operate)
    if (( free_mb < critical_mb || inode_used >= critical_inode_pct )); then
        log_warning "CRITICAL: Storage nearly full (free=${free_mb}MB, inodes=${inode_used}%)"
        runtime_emergency_disk_cleanup "$gr"
        free_mb="$(runtime_free_mb "$gr")"
        inode_used="$(runtime_inodes_used_pct "$gr")"
    fi
    
    runtime_cleanup_corrupted_storage
    runtime_report_storage

    free_mb="$(runtime_free_mb "$gr")"
    inode_used="$(runtime_inodes_used_pct "$gr")"

    if (( free_mb < min_mb || inode_used > max_inode_pct )); then
        log_warning "Preflight: free=${free_mb}MB, inodes=${inode_used}% at $gr - attempting prune"
        runtime_maybe_prune_images
        free_mb="$(runtime_free_mb "$gr")"
        inode_used="$(runtime_inodes_used_pct "$gr")"
        if (( free_mb < min_mb || inode_used > max_inode_pct )); then
            log_error "Insufficient space after prune (free=${free_mb}MB, inodes=${inode_used}%) at $gr. Aborting."
            exit 1
        fi
    fi
}

# ============================================================================
# Export Functions
# ============================================================================

export -f runtime_graphroot runtime_cleanup_corrupted_storage
export -f runtime_emergency_disk_cleanup runtime_report_storage
export -f runtime_free_mb runtime_inodes_used_pct
export -f runtime_maybe_prune_images runtime_preflight_storage
