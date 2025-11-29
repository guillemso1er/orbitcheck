#!/bin/bash
# .github/scripts/lib/runtime.sh
# Description: Runtime user main deployment orchestration

# Prevent double-sourcing
[[ -n "${_ORBITCHECK_RUNTIME_SOURCED:-}" ]] && return 0
readonly _ORBITCHECK_RUNTIME_SOURCED=1

# Ensure strict mode is inherited
set -Eeuo pipefail

# Source dependencies
_RUNTIME_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$_RUNTIME_LIB_DIR/common.sh"
source "$_RUNTIME_LIB_DIR/infra.sh"
source "$_RUNTIME_LIB_DIR/quadlet.sh"
source "$_RUNTIME_LIB_DIR/secrets.sh"
source "$_RUNTIME_LIB_DIR/database.sh"
source "$_RUNTIME_LIB_DIR/storage.sh"
source "$_RUNTIME_LIB_DIR/systemd.sh"

# ============================================================================
# Runtime Main Deployment
# ============================================================================

runtime_main_deployment() {
    set -euo pipefail
    
    # Set XDG_RUNTIME_DIR early - required for rootless podman to work
    export XDG_RUNTIME_DIR="/run/user/$(id -u)"
    
    for cmd in rsync podman; do
        command -v "$cmd" >/dev/null 2>&1 || { log_error "Required '$cmd' missing"; exit 1; }
    done

    local src="$REMOTE_TARGET_BASE_DIR/infra/quadlets"
    local dest_sys_d="$HOME/$REMOTE_SYSTEMD_USER_DIR"
    local dest_user_cfg="$HOME/.config"

    runtime_preflight_storage 2048 95
    runtime_deploy_quadlet_files "$src" "$dest_sys_d"
    runtime_patch_quadlet_images "$dest_sys_d"
    runtime_deploy_env_files "$src" "$dest_user_cfg"

    # --- Handle Secrets ---
    
    # 1. API Secrets
    local service="$API_IMAGE_NAME"
    local cfg_dir="$dest_user_cfg/$service"
    mkdir -p "$cfg_dir"
    local token_file="$HOME/.secrets/infisical/${service}.token"
    runtime_fetch_infisical_secrets "$service" "$token_file" "/api" "$cfg_dir/${service}.secrets.env"

    # 2. Shopify Secrets
    local shopify_svc="$SHOPIFY_IMAGE_NAME"
    local shopify_cfg_dir="$dest_user_cfg/$shopify_svc"
    mkdir -p "$shopify_cfg_dir"
    local shopify_token_file="$HOME/.secrets/infisical/${shopify_svc}.token"
    # Assuming Infisical path is /shopify and token file exists
    if [[ -f "$shopify_token_file" ]]; then
        runtime_fetch_infisical_secrets "$shopify_svc" "$shopify_token_file" "/shopify" "$shopify_cfg_dir/${shopify_svc}.secrets.env"
    else
        log_warning "Shopify token file not found at $shopify_token_file, skipping secret fetch"
    fi

    # Pod args
    local pod_name
    pod_name="$(runtime_get_pod_name "$dest_sys_d")"
    local -a pod_args=()
    [[ -n "$pod_name" ]] && pod_args+=(--pod "$pod_name")

    # Decide what to do
    local should_restart="false"
    local run_migrations="false"

    if [[ -n "$RELEASE_VERSION" ]]; then
        should_restart="true"
        run_migrations="true"
    fi

    if [[ "$NEEDS_API_CHANGES" == "true" ]]; then
        should_restart="true"
        run_migrations="true"
    fi
    if [[ "$NEEDS_SHOPIFY_CHANGES" == "true" ]]; then
        should_restart="true"
    fi
    if [[ "$NEEDS_INFRA_CHANGES" == "true" || "$NEEDS_DASHBOARD_CHANGES" == "true" ]]; then
        should_restart="true"
    fi

    if [[ "$IS_WORKFLOW_DISPATCH" == "true" && "$FORCE_DEPLOY" == "true" ]]; then
        should_restart="true"
        run_migrations="true"
    fi
    if [[ "$FORCE_RESTART" == "true" ]]; then
        should_restart="true"
    fi

    if [[ "$should_restart" == "true" ]]; then
        log_info "Restarting systemd units (reason: release/change/force)"
        runtime_manage_systemd_services "$dest_sys_d"

        if [[ "$run_migrations" == "true" ]]; then
            log_info "Executing DB wait + provision + migrations for API"
            
            local admin_token_file="$HOME/.secrets/infisical/${service}-infra.token"
            local admin_env="$cfg_dir/${service}.dbadmin.env"

            runtime_fetch_infisical_secrets "$service" "$admin_token_file" "/api-infra" "$admin_env"
            runtime_wait_for_db "$admin_env" "${pod_args[@]}"
            runtime_provision_database "$admin_env" "${pod_args[@]}"

            local migration_image
            migration_image="$(resolve_image_ref "api" "$API_IMAGE_NAME" "$API_IMAGE_REF")"

            local -a migration_args=()
            migration_args+=("${pod_args[@]}")
            local env_file="$cfg_dir/$service.env"
            local secrets_file="$cfg_dir/${service}.secrets.env"
            
            if [[ -f "$env_file" ]]; then migration_args+=(--env-file "$env_file"); fi
            if [[ -f "$secrets_file" ]]; then migration_args+=(--env-file "$secrets_file"); fi

            runtime_run_migrations "$migration_image" 10 "${migration_args[@]}"

            # --- Shopify Migrations ---
            if [[ "$NEEDS_SHOPIFY_CHANGES" == "true" || "$FORCE_DEPLOY" == "true" || -n "$RELEASE_VERSION" ]]; then
                log_info "Executing DB wait + provision + migrations for Shopify App"

                # 1. Ensure we have the Shared DB Admin Credentials
                # (If API changes weren't needed, admin_env might not be defined/fetched yet)
                local api_svc_name="$API_IMAGE_NAME" # Assuming API holds the primary DB infra tokens
                local admin_token_file="$HOME/.secrets/infisical/${api_svc_name}-infra.token"
                local admin_env="$dest_user_cfg/$api_svc_name/${api_svc_name}.dbadmin.env"

                if [[ ! -f "$admin_env" ]]; then
                    log_info "Fetching shared DB admin credentials (API deploy was skipped)..."
                    mkdir -p "$(dirname "$admin_env")"
                    runtime_fetch_infisical_secrets "$api_svc_name" "$admin_token_file" "/api-infra" "$admin_env"
                fi

                # 2. Prepare the Shopify Provisioning Environment
                # We need: PGHOST/PGADMIN from admin_env + APP_SCHEMA/APP_USER from shopify-infra
                local shopify_provision_env="$shopify_cfg_dir/${shopify_svc}.provision.env"
                
                # Start by copying ONLY the Postgres Connection/Admin details from the shared DB env
                # Exclude previous APP_ vars to prevent variable collision
                grep -E "^(PG|POSTGRES|DB_)" "$admin_env" > "$shopify_provision_env"

                # Fetch Shopify-specific infrastructure secrets (Schema name, DB Users, Passwords)
                # Expected vars in /shopify-infra: 
                #   APP_DB_SCHEMA (e.g., "shopify")
                #   APP_DB_NAME (e.g., "production_db")
                #   MIGRATION_DB_USER, MIGRATION_DB_PASSWORD
                #   APP_DB_USER, APP_DB_PASSWORD
                local shopify_infra_token="$HOME/.secrets/infisical/${shopify_svc}-infra.token"
                
                if [[ -f "$shopify_infra_token" ]]; then
                     runtime_fetch_infisical_secrets "$shopify_svc" "$shopify_infra_token" "/shopify-infra" "$shopify_provision_env.tmp"
                     cat "$shopify_provision_env.tmp" >> "$shopify_provision_env"
                     rm "$shopify_provision_env.tmp"
                else
                    log_error "Missing Shopify Infra token at $shopify_infra_token. Cannot provision Shopify DB users."
                    exit 1
                fi

                # 3. Wait for DB and Provision (Create Schema 'shopify', Users 'shopify_app' etc)
                # The runtime_provision_database function reads APP_DB_SCHEMA from the env file passed to it.
                runtime_wait_for_db "$shopify_provision_env" "${pod_args[@]}"
                runtime_provision_database "$shopify_provision_env" "${pod_args[@]}"
                
                # 4. Run Shopify Migrations
                local shopify_migration_image
                shopify_migration_image="$(resolve_image_ref "shopify" "$SHOPIFY_IMAGE_NAME" "$SHOPIFY_IMAGE_REF")"
                
                local -a shopify_migration_args=()
                shopify_migration_args+=("${pod_args[@]}")
                
                # Load standard environment variables
                local shopify_env_file="$shopify_cfg_dir/$shopify_svc.env"
                local shopify_secrets_file="$shopify_cfg_dir/${shopify_svc}.secrets.env"
                
                if [[ -f "$shopify_env_file" ]]; then shopify_migration_args+=(--env-file "$shopify_env_file"); fi
                if [[ -f "$shopify_secrets_file" ]]; then shopify_migration_args+=(--env-file "$shopify_secrets_file"); fi

                # 5. Inject the Migrator Connection String
                # Migrations should run as MIGRATION_DB_USER, not the generic admin or the restricted app user.
                # We construct the DATABASE_URL dynamically using the vars we fetched in step 2.
                
                local mig_url
                # We source the provision env in a subshell to get the values without polluting current shell
                # shellcheck disable=SC1090
                mig_url=$(source "$shopify_provision_env" && echo "postgresql://${MIGRATION_DB_USER}:${MIGRATION_DB_PASSWORD}@${PGHOST}:${PGPORT:-5432}/${APP_DB_NAME}?schema=${APP_DB_SCHEMA}")
                
                # Pass the constructed URL explicitly to the container
                shopify_migration_args+=(--env "DATABASE_URL=$mig_url")

                runtime_run_migrations "$shopify_migration_image" 10 "${shopify_migration_args[@]}"
            fi

        else
            log_info "Skipping migrations for this deploy"
        fi
    else
        log_info "No restart needed (no release/changes/force flags)"
    fi

    log_success "Runtime deployment completed successfully"
}

# ============================================================================
# Export Functions
# ============================================================================

export -f runtime_main_deployment
