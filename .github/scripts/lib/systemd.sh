#!/bin/bash
# .github/scripts/lib/systemd.sh
# Description: Systemd service management

# Prevent double-sourcing
[[ -n "${_ORBITCHECK_SYSTEMD_SOURCED:-}" ]] && return 0
readonly _ORBITCHECK_SYSTEMD_SOURCED=1

# Ensure strict mode is inherited
set -Eeuo pipefail

# Source dependencies
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# ============================================================================
# Systemd Functions
# ============================================================================

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
        local name
        name="$(basename "$f" .pod)"
        pod_units+=("${name}-pod.service")
    done
    
    for f in "$dest_sys_d"/*.container; do
        [[ -f "$f" ]] || continue
        local name
        name="$(basename "$f" .container)"
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

# ============================================================================
# Export Functions
# ============================================================================

export -f runtime_manage_systemd_services
