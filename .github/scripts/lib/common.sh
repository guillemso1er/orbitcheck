#!/bin/bash
# .github/scripts/lib/common.sh
# Description: Logging, colors, and common utilities

# Prevent double-sourcing
[[ -n "${_ORBITCHECK_COMMON_SOURCED:-}" ]] && return 0
readonly _ORBITCHECK_COMMON_SOURCED=1

# Ensure strict mode is inherited
set -Eeuo pipefail

# ============================================================================
# Color Codes
# ============================================================================

readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# ============================================================================
# Logging Functions
# ============================================================================

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

# ============================================================================
# Stack Trace
# ============================================================================

print_stack() {
    local i
    for ((i=${#FUNCNAME[@]}-1; i>0; i--)); do
        echo "  at ${FUNCNAME[$i]} (${BASH_SOURCE[$i]}:${BASH_LINENO[$i-1]})" >&2
    done
}

# ============================================================================
# Export Functions
# ============================================================================

export -f log_info log_success log_warning log_error print_stack
