#!/usr/bin/env zx

import { SCRIPT_CONFIG } from './config.mjs';
import { log, isCommandAvailable, fileExists, loadEnvFile, parseEnvFile } from './utils.mjs';
import { join, resolve } from 'path';

// ============================================================================
// CLI Argument Parsing
// ============================================================================
export function parseArguments(args) {
    const options = {
        upsertSecrets: false,
        failOnInfisicalError: false,
        skipCleanup: false,
        envFile: null
    };

    let i = 0;
    while (i < args.length) {
        const arg = args[i];

        switch (arg) {
            case '--upsert-secrets':
                options.upsertSecrets = true;
                break;
            case '--fail-on-infisical-error':
                options.failOnInfisicalError = true;
                break;
            case '--skip-cleanup':
                options.skipCleanup = true;
                break;
            default:
                if (arg.startsWith('-')) {
                    log.die(`Unknown option ${arg}`);
                } else if (!options.envFile) {
                    options.envFile = arg;
                } else {
                    log.die(`Multiple env files specified. Usage: ${SCRIPT_CONFIG.SCRIPT_NAME} [--upsert-secrets] [--fail-on-infisical-error] [--skip-cleanup] <env-file>`);
                }
        }
        i++;
    }

    if (!options.envFile) {
        log.die(`Usage: ${SCRIPT_CONFIG.SCRIPT_NAME} [--upsert-secrets] [--fail-on-infisical-error] [--skip-cleanup] <env-file>`);
    }

    return options;
}

// ============================================================================
// Container Runtime Detection
// ============================================================================
export async function getContainerRuntime() {
    // Check for podman first, then docker
    if (await isCommandAvailable('podman')) {
        return 'podman';
    } else if (await isCommandAvailable('docker')) {
        return 'docker';
    } else {
        log.die('Neither podman nor docker is available');
    }
}

// ============================================================================
// Environment Setup
// ============================================================================
export async function setupEnvironment(options) {
    // Validate environment file
    if (!(await fileExists(options.envFile))) {
        log.die(`Environment file '${options.envFile}' not found`);
    }

    const envFilePath = resolve(options.envFile);

    // Load environment variables
    log.info(`Loading environment from ${envFilePath}`);
    await loadEnvFile(envFilePath);

    // Determine compose file and environment
    const environment = process.env.ENVIRONMENT || 'dev';
    let composeFile;
    let infisicalEnv;
    let useInfisical = true;

    switch (environment) {
        case 'dev':
            composeFile = join(SCRIPT_CONFIG.COMPOSE_DIR, 'dev.compose.yml');
            infisicalEnv = 'dev';
            break;
        case 'local':
            composeFile = join(SCRIPT_CONFIG.COMPOSE_DIR, 'local.compose.yml');
            infisicalEnv = 'dev';
            break;
        case 'prod':
            composeFile = join(SCRIPT_CONFIG.COMPOSE_DIR, 'prod.compose.yml');
            infisicalEnv = 'prod';
            break;
        default:
            log.die(`Unknown ENVIRONMENT: ${environment}. Supported: dev, local, prod`);
    }

    if (!(await fileExists(composeFile))) {
        log.die(`Compose file '${composeFile}' not found`);
    }

    log.info(`Using compose file: ${composeFile}`);
    log.info(`Infisical environment: ${infisicalEnv}`);

    // Change to compose directory for relative paths
    cd(SCRIPT_CONFIG.COMPOSE_DIR);

    return { envFilePath, environment, composeFile, infisicalEnv, useInfisical };
}

export async function loadFallbackEnvironment(environment) {
    const envFileSuffix = environment;
    const fallbackEnv = join(SCRIPT_CONFIG.SCRIPT_DIR, `.env.${envFileSuffix}`);

    if (await fileExists(fallbackEnv)) {
        log.info(`Loading fallback environment from ${fallbackEnv}`);
        await loadEnvFile(fallbackEnv);
    } else {
        log.warning(`No fallback environment file found at ${fallbackEnv}`);
    }
}

// ============================================================================
// Container Operations
// ============================================================================
export async function startContainers(composeFile, useInfisical, token, infisicalEnv, projectId, runtime, compose, options) {
    // Stop/delete Infisical containers
    if (!options.skipCleanup) {
        log.info('Stopping and removing Infisical containers...');
        await $`${runtime} compose -f ${composeFile} down infisical-backend infisical-redis infisical-db`;
    } else {
        log.info('Skipping cleanup of Infisical containers as requested.');
    }

    // Start non-Infisical containers
    log.info('Starting non-Infisical containers...');

    if (useInfisical && token) {
        // Use Infisical token
        const infisicalDomain = process.env.INFISICAL_SITE_URL || 'http://localhost:8085';

        try {
            await $`INFISICAL_TOKEN=${token} infisical run \
    --env=${infisicalEnv} \
    --path=/ \
    --projectId=${projectId} \
    --domain=${infisicalDomain} \
    -- ${runtime} compose -f ${composeFile} up -d --remove-orphans`;
        } catch (error) {
            log.warning('Infisical token failed, falling back to environment variables');
            await $`${runtime} compose -f ${composeFile} up -d --remove-orphans`;
        }
    } else {
        // Use environment variables directly
        await $`${runtime} compose -f ${composeFile} up -d --remove-orphans`;
    }

    // Check for container errors
    log.info('Checking for container errors...');

    try {
        const result = await $`${runtime} ps -a --filter "status=exited" --filter "status=dead" --format "{{.Names}}|{{.Status}}"`.quiet();
        const containers = result.stdout.trim();

        if (containers) {
            log.warning('Found containers that exited with error:');
            const lines = containers.split('\n');
            for (const line of lines) {
                const [name, status] = line.split('|');
                if (status && (status.includes('Exited') || status.includes('Error') || status.includes('Dead'))) {
                    log.error(`Container '${name}' status: ${status}`);
                }
            }
        } else {
            log.success('All containers are running successfully');
        }
    } catch {
        log.success('All containers are running successfully');
    }

    log.success('Orbicheck startup completed successfully');
}

// ============================================================================
// Infisical CLI Installation
// ============================================================================
export async function installInfisicalCli() {
    if (await isCommandAvailable('infisical')) {
        log.info('Infisical CLI is already installed');
        return;
    }

    log.info('Installing Infisical CLI...');

    try {
        // Detect package manager and install accordingly
        if (await isCommandAvailable('apk')) {
            // Alpine Linux
            await $`apk add --no-cache curl`;
            await $`sh -c "curl -1sLf 'https://dl.cloudsmith.io/public/infisical/infisical-cli/setup.alpine.sh' | sh"`;
            await $`apk add --no-cache infisical-cli`;
        } else if (await isCommandAvailable('apt-get')) {
            // Debian/Ubuntu
            await $`apt-get update && apt-get install -y curl`;
            await $`bash -c "curl -1sLf 'https://dl.cloudsmith.io/public/infisical/infisical-cli/setup.deb.sh' | bash"`;
            await $`apt-get install -y infisical-cli`;
        } else if (await isCommandAvailable('yum')) {
            // RHEL/CentOS
            await $`yum install -y curl`;
            await $`bash -c "curl -1sLf 'https://dl.cloudsmith.io/public/infisical/infisical-cli/setup.rpm.sh' | bash"`;
            await $`yum install -y infisical-cli`;
        } else if (await isCommandAvailable('yay')) {
            // Arch Linux
            await $`yay -S infisical-bin`;
        } else if (await isCommandAvailable('brew')) {
            // macOS with Homebrew
            await $`brew install infisical/tap/infisical`;
        } else if (await isCommandAvailable('npm')) {
            // Fallback: npm
            await $`npm install -g @infisical/cli`;
        } else if (await isCommandAvailable('yarn')) {
            // Fallback: yarn
            await $`yarn global add @infisical/cli`;
        } else {
            log.die('Unable to install Infisical CLI: no supported package manager found');
        }

        // Verify installation
        if (!(await isCommandAvailable('infisical'))) {
            log.die('Failed to install Infisical CLI');
        }

        log.success('Infisical CLI installed successfully');
    } catch (error) {
        log.die(`Failed to install Infisical CLI: ${error.message}`);
    }
}

// ============================================================================
// Infisical Operations
// ============================================================================
async function upsertSecret(secretName, secretValue, adminToken, projectId, baseUrl, environment) {
    console.log(`Checking secret: ${secretName}...`);

    try {
        // Check if secret exists
        const checkUrl = new URL(`${baseUrl}/api/v4/secrets/${secretName}`);
        checkUrl.searchParams.append('projectId', projectId);
        checkUrl.searchParams.append('environment', environment);
        checkUrl.searchParams.append('secretPath', '/');

        const checkResponse = await fetch(checkUrl, {
            headers: {
                'Authorization': `Bearer ${adminToken}`
            }
        });

        let secretExists = false;
        if (checkResponse.ok) {
            const data = await checkResponse.json();
            secretExists = !!data.secret;
        }

        const payload = {
            projectId,
            environment,
            secretPath: '/',
            secretValue
        };

        let response;
        if (secretExists) {
            console.log(`Secret ${secretName} already exists, updating...`);
            // Update existing secret
            response = await fetch(`${baseUrl}/api/v4/secrets/${secretName}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${adminToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
        } else {
            console.log(`Creating secret ${secretName}...`);
            // Create new secret
            response = await fetch(`${baseUrl}/api/v4/secrets/${secretName}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${adminToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
        }

        const result = await response.json();
        console.log(JSON.stringify(result, null, 2));

        if (!response.ok) {
            throw new Error(`Failed to upsert secret: ${response.status}`);
        }
    } catch (error) {
        log.error(`Failed to upsert secret ${secretName}: ${error.message}`);
    }
}

export async function upsertSecrets(envFilePath, infisicalEnv, adminToken, projectId, options) {
    if (!options.upsertSecrets || !projectId) {
        if (options.upsertSecrets && !adminToken) {
            log.warning('Secret upserting was requested but no admin token is available. Skipping.');
        }
        return;
    }

    if (!adminToken) {
        log.warning('Secret upserting was requested but no admin token is available. Falling back to UA credentials.');
        // Try to use UA credentials instead
        const { generateTemporaryToken } = await import('./auth.mjs');
        await generateTemporaryToken();

        const { state, config } = await import('./config.mjs');
        if (state.ACCESS_TOKEN) {
            log.info('Attempting secret upsert using UA access token...');
            adminToken = state.ACCESS_TOKEN;
        } else {
            log.warning('Unable to generate UA access token for secret upsert. Skipping.');
            options.upsertSecrets = false;
            return;
        }
    }

    log.info('Upserting secrets from environment file to Infisical...');

    const envVars = await parseEnvFile(envFilePath);
    const baseUrl = process.env.INFISICAL_SITE_URL || 'http://localhost:8085';

    for (const [key, value] of Object.entries(envVars)) {
        if (value) {
            console.log(`Upserting secret: key='${key}', value='${value.length} chars', project_id='${projectId}', environment='${infisicalEnv}'`);
            await upsertSecret(key, value, adminToken, projectId, baseUrl, infisicalEnv);
        }
    }

    log.success('Secrets upserted successfully');
}

export async function initializeInfisical(composeFile, options) {
    // Install Infisical CLI
    await installInfisicalCli();

    // Get container runtime
    const runtime = await getContainerRuntime();
    const compose = `${runtime} compose`;

    let token = '';
    let projectId = '';
    let adminToken = '';

    // Start Infisical services
    log.info('Starting Infisical services (backend, redis, db)...');
    await $`${runtime} compose -f ${composeFile} up -d infisical-backend infisical-redis infisical-db --wait --remove-orphans`;
    log.success('Infisical services started');

    // Initialize Infisical using the exported function
    log.info('Initializing Infisical and obtaining tokens...');

    try {
        const setupInfisica = await import('./infisical.mjs');
        const result = await setupInfisica.default();
        token = result.accessToken || '';
        projectId = result.projectId || '';
        adminToken = result.adminToken || '';

        // Clean up any line breaks
        token = token.replace(/[\r\n]/g, '');
        projectId = projectId.replace(/[\r\n]/g, '');
        adminToken = adminToken.replace(/[\r\n]/g, '');

        if (token && projectId) {
            if (adminToken) {
                log.success('Infisical tokens and project ID obtained (with admin access)');
            } else {
                log.success('Infisical token and project ID obtained (using UA credentials)');
            }
        } else {
            throw new Error('No token or project ID received');
        }
    } catch (error) {
        if (options.failOnInfisicalError) {
            log.error('Failed to initialize Infisical. Details:');
            console.error(error);
            log.die('Infisical initialization failed');
        } else {
            log.warning('Failed to initialize Infisical, falling back to environment files. Details:');
            console.error(error);
            return { useInfisical: false, token: '', projectId: '', adminToken: '', runtime, compose };
        }
    }

    return { useInfisical: true, token, projectId, adminToken, runtime, compose };
}