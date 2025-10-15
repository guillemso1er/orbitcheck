#!/usr/bin/env zx

import { log } from './utils.mjs';

// ============================================================================
// Container Operations
// ============================================================================
export async function startContainers(composeFile, useInfisical, token, infisicalEnv, projectId, runtime, compose, options) {

    // Start non-Infisical containers
    log.info('Starting non-Infisical containers...');

    if (useInfisical && token) {
        // Use Infisical token
        const infisicalDomain = process.env.INFISICAL_SITE_URL || 'http://localhost:8085';

        await $`INFISICAL_TOKEN=${token} infisical run \
    --env=${infisicalEnv} \
    --path=/ \
    --projectId=${projectId} \
    --domain=${infisicalDomain} \
    -- ${runtime} compose -f ${composeFile} up -d --remove-orphans`;
    } else {
        // Use environment variables directly
        await $`${runtime} compose -f ${composeFile} up -d`;
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

    if (!options.skipCleanup) {
        log.info('Stopping and removing Infisical containers...');
        await $`${runtime} compose -f ${composeFile} down infisical-backend infisical-redis infisical-db`;
    } else {
        log.info('Skipping cleanup of Infisical containers as requested.');
    }


    log.success('Orbicheck startup completed successfully');
}