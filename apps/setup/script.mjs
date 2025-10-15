#!/usr/bin/env zx

// Enable verbose mode
$.verbose = true;

import { parseArguments, setupEnvironment, loadFallbackEnvironment, initializeInfisical, upsertSecrets, startContainers } from './cli.mjs';

import { SCRIPT_CONFIG } from './config.mjs';

const { SCRIPT_NAME } = SCRIPT_CONFIG;

// ============================================================================
// Main Function
// ============================================================================
async function main() {
    try {
        // Parse command-line arguments
        const options = parseArguments(process.argv.slice(3)); // Skip node, zx, and script name

        // Setup environment and determine compose file
        const { envFilePath, environment, composeFile, infisicalEnv, useInfisical: initialUseInfisical } = await setupEnvironment(options);

        // Initialize Infisical if needed
        let { useInfisical, token, projectId, adminToken, runtime, compose } = await initializeInfisical(composeFile, options);

        // Load fallback environment variables if Infisical is not available
        if (!useInfisical) {
            await loadFallbackEnvironment(environment);
        }

        // Upsert secrets if requested
        await upsertSecrets(envFilePath, infisicalEnv, adminToken, projectId, options);

        // Start containers
        await startContainers(composeFile, useInfisical, token, infisicalEnv, projectId, runtime, compose, options);

    } catch (error) {
        const { log } = await import('./utils.mjs');
        log.error(`Unexpected error: ${error.message}`);
        console.error(error);
        process.exit(1);
    }
}

// Run main function
await main();