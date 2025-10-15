#!/usr/bin/env zx

import { assignWriteRole, createReadOnlyIdentity, ensureProject, waitForService } from './api.mjs';
import { bootstrapOrLogin, generateTemporaryToken } from './auth.mjs';
import { config, loadUACredsFromFile, saveUACredsToFile } from './config.mjs';
import { log } from './utils.mjs';

// ============================================================================
//  Script Entry Point
// ============================================================================
export default async function setupInfisica() {
    try {
        await waitForService(config.BASE);

        // Load any existing credentials from file first
        await loadUACredsFromFile();

        // Try to bootstrap or login
        await bootstrapOrLogin();

        const { state: configState, UA_CLIENT_ID, UA_CLIENT_SECRET } = await import('./config.mjs');
        if (configState.HAVE_ADMIN) {
            // Admin path: ensure everything exists
            await ensureProject();
            await createReadOnlyIdentity();
            await assignWriteRole();
            await saveUACredsToFile(UA_CLIENT_ID, UA_CLIENT_SECRET, configState.ORG_ID, configState.PROJECT_ID, configState.IDENTITY_ID);
        } else {
            // Non-admin path: use existing credentials
            if (!configState.PROJECT_ID || !configState.IDENTITY_ID) {
                if (!UA_CLIENT_ID || !UA_CLIENT_SECRET) {
                    log.die('No admin access and no UA credentials available. Run once with admin credentials or provide UA credentials.');
                }
                log.warning('PROJECT_ID or IDENTITY_ID missing. Will attempt to continue with UA credentials only.');
            }
        }

        // Generate access token
        await generateTemporaryToken();

        // Output results (matching original script format)
        console.log(`${configState.ACCESS_TOKEN} ${configState.PROJECT_ID || ''} ${configState.ADMIN_TOKEN || ''}`);
        return { accessToken: configState.ACCESS_TOKEN, projectId: configState.PROJECT_ID, adminToken: configState.ADMIN_TOKEN };
    } catch (error) {
        log.error(`Unexpected error: ${error.message}`);
        process.exit(1);
    }
}
