#!/usr/bin/env bash

set -euo pipefail
HAVE_ADMIN=0
ADMIN_TOKEN=""
ACCESS_TOKEN=""
# ============================================================================
# Configuration
# ============================================================================
readonly SCRIPT_NAME="$(basename "$0")"
readonly BASE="${INFISICAL_SITE_URL:-http://localhost:8085}"
readonly ADMIN_EMAIL="${INFISICAL_ADMIN_EMAIL:-admin@orbicheck.local}"
readonly ADMIN_PASSWORD="${INFISICAL_ADMIN_PASSWORD:-AdminPass123!}"
readonly ORG_NAME="${INFISICAL_ORG:-orbicheck}"
readonly PROJECT_NAME="${INFISICAL_PROJECT:-orbicheck}"
readonly IDENTITY_NAME="${INFISICAL_IDENTITY:-orbicheck-reader}"
readonly TOKEN_TTL="${INFISICAL_TOKEN_TTL:-3600}"  # access token TTL (seconds)
readonly UA_SECRET_TTL="${INFISICAL_UA_SECRET_TTL:-0}" # 0 => non-expiring client secret (if supported)
readonly MAX_RETRIES=3
readonly RETRY_DELAY=2
readonly ADMIN_TOKEN_ENV="${INFISICAL_ADMIN_TOKEN:-${INFISICAL_TOKEN:-}}"

# UA credentials (can be provided via env or read from file later)
UA_CLIENT_ID="${INFISICAL_UA_CLIENT_ID:-${INFISICAL_CLIENT_ID:-}}"
UA_CLIENT_SECRET="${INFISICAL_UA_CLIENT_SECRET:-${INFISICAL_CLIENT_SECRET:-}}"

# Script location and UA credentials file
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
readonly UA_CRED_FILE_DEFAULT="$SCRIPT_DIR/.${IDENTITY_NAME}.ua.env"
readonly UA_CRED_FILE="${INFISICAL_UA_CRED_FILE:-$UA_CRED_FILE_DEFAULT}"

# Color codes for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# ============================================================================
# Logging Functions
# ============================================================================
log_info()    { echo -e "${BLUE}[INFO]${NC} $*" >&2; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $*" >&2; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $*" >&2; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
die() { log_error "$@"; exit 1; }

# ============================================================================
# Utility Functions
# ============================================================================
install_dependencies() {
  if ! command -v jq >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
    log_info "Installing required packages..."
    apk add --no-cache jq curl &>/dev/null || {
      apt-get update && apt-get install -y jq curl
    } || die "Failed to install dependencies"
  fi
}

retry_api_call() {
  local retries=$1; shift
  local count=0
  local output
  until [ $count -ge $retries ]; do
    if output=$("$@" 2>&1); then
      echo "$output"
      return 0
    fi
    count=$((count + 1))
    [ $count -lt $retries ] && {
      log_warning "API call failed, retrying in ${RETRY_DELAY}s... (attempt $((count + 1))/$retries)"
      sleep $RETRY_DELAY
    }
  done
  return 1
}

wait_for_service() {
  local url=$1
  local timeout=${2:-90}
  local elapsed=0

  log_info "Waiting for Infisical to be ready at $url..."
  while [ $elapsed -lt $timeout ]; do
    if curl -sf "$url/api/status" >/dev/null 2>&1; then
      log_success "Infisical is ready!"
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
    echo -n "." >&2
  done
  echo >&2
  die "Timeout waiting for Infisical to be ready"
}

validate_json() {
  local json=$1
  local field=$2
  echo "$json" | jq -e ".$field" >/dev/null 2>&1
}

require_admin() {
  [ "${HAVE_ADMIN:-0}" -eq 1 ] || [ -n "${ADMIN_TOKEN:-}" ] || die "This operation requires admin auth. Provide INFISICAL_ADMIN_TOKEN or run once with bootstrap."
}

# ============================================================================
# UA Credential Helpers (file I/O)
# ============================================================================
load_ua_creds_from_file() {
  # Load UA creds + saved IDs if file exists
  if [ -f "$UA_CRED_FILE" ]; then
    log_info "Loading Universal Auth credentials from $UA_CRED_FILE"
    # shellcheck disable=SC1090,SC1091
    set +u
    . "$UA_CRED_FILE"
    set -u

    # Only update if current value is empty (don't overwrite existing values)
    [ -z "${UA_CLIENT_ID:-}" ] && [ -n "${INFISICAL_CLIENT_ID:-}" ] && UA_CLIENT_ID="${INFISICAL_CLIENT_ID}"
    [ -z "${UA_CLIENT_SECRET:-}" ] && [ -n "${INFISICAL_CLIENT_SECRET:-}" ] && UA_CLIENT_SECRET="${INFISICAL_CLIENT_SECRET}"
    [ -z "${ORG_ID:-}" ] && [ -n "${INFISICAL_ORG_ID:-}" ] && ORG_ID="${INFISICAL_ORG_ID}"
    [ -z "${PROJECT_ID:-}" ] && [ -n "${INFISICAL_PROJECT_ID:-}" ] && PROJECT_ID="${INFISICAL_PROJECT_ID}"
    [ -z "${IDENTITY_ID:-}" ] && [ -n "${INFISICAL_IDENTITY_ID:-}" ] && IDENTITY_ID="${INFISICAL_IDENTITY_ID}"
  fi
}

load_ua_secret_only() {
  # Only load the client secret if we don't have one
  if [ -z "${UA_CLIENT_SECRET:-}" ] && [ -f "$UA_CRED_FILE" ]; then
    local secret
    secret=$(grep "^INFISICAL_CLIENT_SECRET=" "$UA_CRED_FILE" 2>/dev/null | cut -d= -f2-)
    [ -n "$secret" ] && UA_CLIENT_SECRET="$secret"
  fi
}

save_ua_creds_to_file() {
  local client_id="${1:-${UA_CLIENT_ID:-}}"
  local client_secret="${2:-${UA_CLIENT_SECRET:-}}"
  local org_id="${3:-${ORG_ID:-}}"
  local project_id="${4:-${PROJECT_ID:-}}"
  local identity_id="${5:-${IDENTITY_ID:-}}"

  umask 077
  {
    echo "# Generated by $SCRIPT_NAME on $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
    echo "# Universal Auth credentials + stable IDs for identity: $IDENTITY_NAME"
    [ -n "$client_id" ]     && echo "INFISICAL_CLIENT_ID=$client_id"
    [ -n "$client_secret" ] && echo "INFISICAL_CLIENT_SECRET=$client_secret"
    [ -n "$org_id" ]        && echo "INFISICAL_ORG_ID=$org_id"
    [ -n "$project_id" ]    && echo "INFISICAL_PROJECT_ID=$project_id"
    [ -n "$identity_id" ]   && echo "INFISICAL_IDENTITY_ID=$identity_id"
  } > "$UA_CRED_FILE"
  chmod 600 "$UA_CRED_FILE" || true
  log_success "Saved UA creds and IDs to $UA_CRED_FILE"
}

# ============================================================================
# Core Functions
# ============================================================================

bootstrap_or_login() {
  log_info "Checking instance status and obtaining credentials..."

  # Try to use existing admin token from env first
  if [ -n "${ADMIN_TOKEN_ENV:-}" ]; then
    ADMIN_TOKEN="$ADMIN_TOKEN_ENV"
    HAVE_ADMIN=1
    log_info "Using admin token from environment."
    
    # Try to get ORG_ID if we don't have it
    if [ -z "${ORG_ID:-}" ]; then
      local orgs_response
      orgs_response=$(retry_api_call "$MAX_RETRIES" curl -sf \
        -H "Authorization: Bearer $ADMIN_TOKEN" \
        "$BASE/api/v1/organizations") 2>/dev/null || true
      
      if [ -n "$orgs_response" ]; then
        ORG_ID=$(echo "$orgs_response" | jq -r --arg name "$ORG_NAME" \
          '.organizations[] | select(.name==$name) | .id' | head -n1)
      fi
    fi
    return 0
  fi

  # Try bootstrap
  log_info "Attempting to bootstrap instance (will skip if already initialized)..."
  local payload
  payload=$(jq -n --arg email "$ADMIN_EMAIL" --arg password "$ADMIN_PASSWORD" --arg organization "$ORG_NAME" \
    '{email:$email,password:$password,organization:$organization}')

  # capture both body and HTTP code
  local resp http
  resp=$(curl -sS -w "\n%{http_code}" -X POST "$BASE/api/v1/admin/bootstrap" \
           -H "Content-Type: application/json" -d "$payload" 2>/dev/null) || true
  http="${resp##*$'\n'}"
  resp="${resp%$'\n'*}"

  if [ "$http" = "200" ]; then
    ADMIN_TOKEN=$(echo "$resp" | jq -r '.identity.credentials.token // .token // .accessToken // empty')
    ORG_ID=$(echo "$resp" | jq -r '.organization.id // empty')
    
    if [ -n "${ADMIN_TOKEN:-}" ] && [ -n "${ORG_ID:-}" ]; then
      log_success "Bootstrapped instance and obtained admin token."
      HAVE_ADMIN=1
      return 0
    fi
  fi

  # Bootstrap failed or instance already initialized
  if echo "$resp" | grep -qi "already been set up"; then
    log_info "Instance already initialized."
  else
    log_info "Bootstrap returned HTTP $http (instance may already be initialized)."
  fi

  # No admin token available, will work with UA credentials only
  HAVE_ADMIN=0
  load_ua_creds_from_file
  if [ -n "${UA_CLIENT_ID:-}" ] && [ -n "${UA_CLIENT_SECRET:-}" ]; then
    log_info "Will use UA credentials for access token (no admin auth available)."
  else
    log_warning "No admin token or UA credentials available. Will attempt to continue..."
  fi
}

discover_org_id() {
  require_admin
  if [ -n "${ORG_ID:-}" ]; then
    return 0
  fi

  log_info "Discovering organization ID..."
  
  # Try to find org by name
  local orgs_response
  orgs_response=$(retry_api_call "$MAX_RETRIES" curl -sf \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    "$BASE/api/v1/organizations") || die "Failed to fetch organizations"
  
  ORG_ID=$(echo "$orgs_response" | jq -r --arg name "$ORG_NAME" \
    '.organizations[] | select(.name==$name) | .id' | head -n1)
  
  [ -z "${ORG_ID:-}" ] && die "Organization '$ORG_NAME' not found"
  log_info "Found organization ID: $ORG_ID"
}

ensure_project() {
  require_admin
  discover_org_id
  
  log_info "Checking for project '$PROJECT_NAME'..."

  local projects_response
  projects_response=$(retry_api_call $MAX_RETRIES curl -sf \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    "$BASE/api/v1/projects") || die "Failed to fetch projects"

  PROJECT_ID=$(
    echo "$projects_response" | jq -r \
      --arg name "$PROJECT_NAME" \
      '.projects[] 
        | select((.name // .projectName) == $name) 
        | (.id // .projectId // .workspaceId)' \
      | head -n1
  )

  if [ -z "$PROJECT_ID" ]; then
    log_info "Creating project '$PROJECT_NAME'..."

    # New API shape first: { projectName, orgId }
    local payload resp http body
    payload=$(jq -n \
      --arg name "$PROJECT_NAME" \
      --arg org "$ORG_ID" \
      --arg desc "Managed by $SCRIPT_NAME" \
      '{projectName:$name, orgId:$org, description:$desc}')

    # Capture body + HTTP status (don't use -f so we can read 4xx/5xx)
    resp=$(curl -sS -w "\n%{http_code}" -X POST "$BASE/api/v1/projects" \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$payload") || true
    http="${resp##*$'\n'}"
    body="${resp%$'\n'*}"

    # If not 2xx, try legacy shape: { name, organizationId }
    if [[ "$http" != 2* ]]; then
      log_warning "Create project failed with HTTP $http. Retrying with legacy payload shape..."
      payload=$(jq -n \
        --arg name "$PROJECT_NAME" \
        --arg org "$ORG_ID" \
        --arg desc "Managed by $SCRIPT_NAME" \
        '{name:$name, organizationId:$org, description:$desc}')

      resp=$(curl -sS -w "\n%{http_code}" -X POST "$BASE/api/v1/projects" \
        -H "Authorization: Bearer $ADMIN_TOKEN" \
        -H "Content-Type: application/json" \
        -d "$payload") || true
      http="${resp##*$'\n'}"
      body="${resp%$'\n'*}"
    fi

    if [[ "$http" != 2* ]]; then
      die "Failed to create project (HTTP $http): $body"
    fi

    PROJECT_ID=$(echo "$body" | jq -r '.project.id // .id // .projectId // .workspace.id // .workspaceId // empty')
    [ -z "$PROJECT_ID" ] && die "Project creation response missing ID. Body: $body"

    log_success "Project created with ID: $PROJECT_ID"
  else
    log_info "Project exists with ID: $PROJECT_ID"
  fi
}

ensure_identity_universal_auth() {
  require_admin
  # usage: ensure_identity_universal_auth [force_secret_rotation]
  # force_secret_rotation: "force" or empty
  local force_rotate="${1:-}"

  log_info "Ensuring Universal Auth is configured for identity '$IDENTITY_NAME' ($IDENTITY_ID)..."

  # Instead of checking first, we will try to create the Universal Auth configuration directly.
  # This is more resilient to race conditions. We handle both 200 (created) and
  # 400 (already configured) as success cases.
  log_info "Attaching Universal Auth to identity (idempotent)..."
  local attach_resp attach_http_code attach_body
  attach_resp=$(curl -sS -w "\n%{http_code}" -X POST \
    "$BASE/api/v1/auth/universal-auth/identities/$IDENTITY_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg ttl "$TOKEN_TTL" '{
          clientSecretTrustedIps: [{ipAddress:"0.0.0.0/0"},{ipAddress:"::/0"}],
          accessTokenTTL: ($ttl|tonumber)
        }')")
  attach_http_code="${attach_resp##*$'\n'}"
  attach_body="${attach_resp%$'\n'*}"

  # A 200 means it was created. A 400 with the specific message means it already exists.
  # Both are success cases for our "ensure" logic.
  if [[ "$attach_http_code" == "200" ]]; then
    log_success "Universal Auth created for identity."
  elif [[ "$attach_http_code" == "400" ]] && echo "$attach_body" | jq -e '.message | test("already configured")' >/dev/null; then
    log_success "Universal Auth already configured for identity."
  else
    die "Failed to attach Universal Auth to identity (HTTP $attach_http_code). Body: $attach_body"
  fi

  # Now that we are sure the UA resource exists, we can safely query it.
  log_info "Retrieving Universal Auth details for identity..."
  local ua_check
  ua_check=$(retry_api_call "$MAX_RETRIES" curl -sf \
    "$BASE/api/v1/auth/universal-auth/identities/$IDENTITY_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN") || die "Failed to verify Universal Auth configuration"

  local client_id
  client_id=$(echo "$ua_check" | jq -r '.identityUniversalAuth.clientId // .clientId // empty')
  [ -z "${client_id:-}" ] && die "Failed to determine clientId for identity"

  # Always use the server clientId
  UA_CLIENT_ID="$client_id"

  # Load any existing creds from file (may set UA_CLIENT_SECRET)
  local old_secret="${UA_CLIENT_SECRET:-}"
  load_ua_secret_only
  # Decide if we must create/rotate secret
  local need_secret=0
  if [ -n "$force_rotate" ]; then
    need_secret=1
  elif [ -z "${UA_CLIENT_SECRET:-}" ]; then
    need_secret=1
  fi

  if [ "$need_secret" -eq 1 ]; then
    log_info "Creating client secret (ttl=${UA_SECRET_TTL}s; 0 => omit ttl)..."
    local secret_response
    secret_response=$(retry_api_call $MAX_RETRIES curl -sf -X POST \
      "$BASE/api/v1/auth/universal-auth/identities/$IDENTITY_ID/client-secrets" \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$(jq -n --arg desc "Persistent secret for $IDENTITY_NAME (generated by $SCRIPT_NAME)" --arg ttl "$UA_SECRET_TTL" '
            ($ttl|tonumber) as $t
            | { description: $desc, numUsesLimit: 0 }
            + (if $t > 0 then { ttl: $t } else {} end)
          ')") \
      || die "Failed to create client secret"

    UA_CLIENT_SECRET=$(echo "$secret_response" | jq -r '.clientSecret // empty')
    [ -z "${UA_CLIENT_SECRET:-}" ] && die "Client secret missing in response"

    save_ua_creds_to_file "$UA_CLIENT_ID" "$UA_CLIENT_SECRET" "$ORG_ID" "$PROJECT_ID" "$IDENTITY_ID"
  else
    log_info "Using existing client secret"
  fi
}

create_read_only_identity() {
  require_admin
  discover_org_id
  
  log_info "Setting up read-only machine identity..."

  local identities_response
  identities_response=$(retry_api_call $MAX_RETRIES curl -sf \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    "$BASE/api/v1/identities?orgId=$ORG_ID") || die "Failed to fetch identities"

  IDENTITY_ID=$(echo "$identities_response" | jq -r ".identities[] | select(.name==\"$IDENTITY_NAME\") | .id" | head -n1)

  if [ -z "$IDENTITY_ID" ]; then
    log_info "Creating machine identity '$IDENTITY_NAME'..."

    local identity_response
    identity_response=$(retry_api_call $MAX_RETRIES curl -sf -X POST "$BASE/api/v1/identities" \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"name\":\"$IDENTITY_NAME\",\"organizationId\":\"$ORG_ID\"}") || die "Failed to create identity"

    IDENTITY_ID=$(echo "$identity_response" | jq -r '.identity.id // .id')
    [ -z "$IDENTITY_ID" ] && die "Identity creation response missing ID"

    log_success "Identity created with ID: $IDENTITY_ID"
  else
    log_info "Identity exists with ID: $IDENTITY_ID"
  fi

  # Ensure UA is attached and credentials are saved to file
  ensure_identity_universal_auth
}

assign_read_only_role() {
  require_admin
  log_info "Configuring read-only permissions..."

  local roles_response
  roles_response=$(retry_api_call $MAX_RETRIES curl -sf \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    "$BASE/api/v1/projects/$PROJECT_ID/roles") || die "Failed to fetch project roles"

  # Prefer project_viewer; fallback to viewer/read; then pick least privileged
  local role_slug
  role_slug=$(echo "$roles_response" | jq -r '.roles[] | select(.slug=="project_viewer") | .slug' | head -n1)
  if [ -z "$role_slug" ]; then
    role_slug=$(echo "$roles_response" | jq -r '.roles[] | select(.slug | test("viewer|read"; "i")) | .slug' | head -n1)
  fi
  if [ -z "$role_slug" ]; then
    role_slug=$(echo "$roles_response" | jq -r '.roles | sort_by((.permissions // []) | length) | .[0].slug')
  fi
  [ -z "$role_slug" ] && die "No suitable read-only role found"
  log_info "Using role: $role_slug"

  # Check existing membership
  local memberships_response
  memberships_response=$(retry_api_call $MAX_RETRIES curl -sf \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    "$BASE/api/v1/projects/$PROJECT_ID/identity-memberships") || die "Failed to fetch memberships"

  local is_member
  is_member=$(echo "$memberships_response" | jq -r ".identityMemberships[] | select(.identity.id==\"$IDENTITY_ID\") | .id" | head -n1)

  if [ -z "$is_member" ]; then
    log_info "Adding identity to project with read-only access..."

    retry_api_call $MAX_RETRIES curl -sf -X POST \
    "$BASE/api/v1/projects/$PROJECT_ID/identity-memberships/$IDENTITY_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"roles\":[{\"role\":\"$role_slug\",\"isTemporary\":false}]}" >/dev/null \
    || die "Failed to add identity to project"

    log_success "Identity added to project with read-only access"
  else
    log_info "Identity already has project access"
  fi
}

generate_temporary_token() {
  log_info "Generating access token using Universal Auth credentials..."

  # Load credentials from file if not already loaded
  load_ua_creds_from_file
  
  # Only rotate/attach if we have admin
  if [ "${HAVE_ADMIN:-0}" -eq 1 ] && [ -n "${IDENTITY_ID:-}" ]; then
    ensure_identity_universal_auth
  fi

  [ -n "${UA_CLIENT_ID:-}" ] || die "UA clientId missing. Run with admin credentials first or set in $UA_CRED_FILE."
  [ -n "${UA_CLIENT_SECRET:-}" ] || die "UA clientSecret missing. Run with admin credentials first or set in $UA_CRED_FILE."

  local payload http body curl_exit_code
  payload=$(jq -n --arg id "$UA_CLIENT_ID" --arg secret "$UA_CLIENT_SECRET" '{clientId:$id, clientSecret:$secret}')

  log_info "Attempting to generate token with Universal Auth..."
  log_info " >> URL: $BASE/api/v1/auth/universal-auth/login"

  # Temporarily disable 'exit on error' to capture the exit code and output
  set +e 

  # Use curl with -v (verbose) to see detailed connection info.
  # We pipe stderr to stdout to capture everything.
  local raw_response
  raw_response=$(curl -v -S -w "\nHTTP_STATUS:%{http_code}" \
      -X POST "$BASE/api/v1/auth/universal-auth/login" \
      -H "Content-Type: application/json" \
      -d "$payload" 2>&1)
  curl_exit_code=$?

  # Re-enable 'exit on error'
  set -e

  # Check for a fundamental curl error (e.g., connection refused)
  if [ "$curl_exit_code" -ne 0 ]; then
      log_error "The curl command itself failed. This often indicates a network or connection issue."
      log_error "Verbose output from curl:"
      echo -e "${RED}$raw_response${NC}" >&2 # Print the full verbose output in red
      die "curl exited with code $curl_exit_code. See the detailed log above."
  fi

  # If curl succeeded, separate the response body from our status code marker
  http=$(echo "$raw_response" | grep "HTTP_STATUS:" | sed 's/.*HTTP_STATUS://')
  body=$(echo "$raw_response" | sed '/HTTP_STATUS:/d')

  # Separate the HTTP status from the response body
  http="${resp##*$'\n'}"
  body="${resp%$'\n'*}"

  # Check for connection-level errors (e.g., could not resolve host)
  if [ "$curl_exit_code" -ne 0 ]; then
    die "curl command failed with exit code $curl_exit_code. Details: $body"
  fi

  if [[ "$http" == 2* ]]; then
    ACCESS_TOKEN=$(echo "$body" | jq -r '.accessToken // empty') || die "Failed to parse accessToken from response: $body"
    [ -n "$ACCESS_TOKEN" ] || die "UA login 2xx but accessToken missing. Body: $body"
    log_success "Access token generated"
    return
  fi

  if [ "$http" = "401" ] && [ "${HAVE_ADMIN:-0}" -eq 1 ] && [ -n "${IDENTITY_ID:-}" ]; then
    log_warning "UA login 401 with admin available. Rotating client secret and retrying..."
    ensure_identity_universal_auth "force"
    save_ua_creds_to_file "$UA_CLIENT_ID" "$UA_CLIENT_SECRET" "$ORG_ID" "$PROJECT_ID" "$IDENTITY_ID"

    # Retry the login call
    resp=$(curl -sS -w "\n%{http_code}" -X POST \
      "$BASE/api/v1/auth/universal-auth/login" \
      -H "Content-Type: application/json" \
      -d "$(jq -n --arg id "$UA_CLIENT_ID" --arg secret "$UA_CLIENT_SECRET" '{clientId:$id, clientSecret:$secret}')" 2>&1)
    curl_exit_code=$?
    http="${resp##*$'\n'}"
    body="${resp%$'\n'*}"

    if [ "$curl_exit_code" -ne 0 ]; then
      die "curl retry command failed with exit code $curl_exit_code. Details: $body"
    fi

    if [[ "$http" == 2* ]]; then
      ACCESS_TOKEN=$(echo "$body" | jq -r '.accessToken // empty') || die "Failed to parse accessToken from response on retry: $body"
      [ -z "$ACCESS_TOKEN" ] && die "UA login 2xx but accessToken missing on retry. Body: $body"
      log_success "Access token generated after secret rotation"
      return
    fi
  fi

  die "Failed to obtain access token. Status: $http, Response: $body"
}

# ============================================================================
# Main Execution
# ============================================================================
main() {
  install_dependencies
  wait_for_service "$BASE"

  # Load any existing credentials from file first
  load_ua_creds_from_file

  # Try to bootstrap or login
  bootstrap_or_login

  if [ "${HAVE_ADMIN:-0}" -eq 1 ]; then
    # Admin path: ensure everything exists
    ensure_project
    create_read_only_identity
    assign_read_only_role
    save_ua_creds_to_file "$UA_CLIENT_ID" "$UA_CLIENT_SECRET" "$ORG_ID" "$PROJECT_ID" "$IDENTITY_ID"
  else
    # Non-admin path: use existing credentials
    if [ -z "${PROJECT_ID:-}" ] || [ -z "${IDENTITY_ID:-}" ]; then
      # Try to use UA credentials if available
      if [ -z "${UA_CLIENT_ID:-}" ] || [ -z "${UA_CLIENT_SECRET:-}" ]; then
        die "No admin access and no UA credentials available. Run once with admin credentials or provide UA credentials."
      fi
      log_warning "PROJECT_ID or IDENTITY_ID missing. Will attempt to continue with UA credentials only."
    fi
  fi

  # Generate access token
  generate_temporary_token
  
  # Output results
  echo "$ACCESS_TOKEN ${PROJECT_ID:-} ${ADMIN_TOKEN:-}"
}

main "$@"