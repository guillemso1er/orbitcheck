#!/usr/bin/env zx

import { config, HAVE_ADMIN, ADMIN_TOKEN, ACCESS_TOKEN, UA_CLIENT_ID, UA_CLIENT_SECRET, ORG_ID } from './config.mjs';
import { waitForService, retryApiCall, makeApiRequest, ensureIdentityUniversalAuth } from './api.mjs';
import { loadUACredsFromFile, saveUACredsToFile } from './config.mjs';

// ============================================================================
// Authentication Functions
// ============================================================================
export async function bootstrapOrLogin() {
    import('./utils.mjs').then(({ log }) => {
        log.info('Checking instance status and obtaining credentials...');
    });

    // Try to use existing admin token from env first
    if (config.ADMIN_TOKEN_ENV) {
        ADMIN_TOKEN = config.ADMIN_TOKEN_ENV;
        HAVE_ADMIN = true;
        import('./utils.mjs').then(({ log }) => {
            log.info('Using admin token from environment.');
        });

        // Try to get ORG_ID if we don't have it
        if (!ORG_ID) {
            try {
                const { data } = await retryApiCall(config.MAX_RETRIES, async () => {
                    return await makeApiRequest(`${config.BASE}/api/v1/organizations`, {
                        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }
                    });
                });

                if (data?.organizations) {
                    const org = data.organizations.find(o => o.name === config.ORG_NAME);
                    if (org) ORG_ID = org.id;
                }
            } catch {
                // Continue without ORG_ID
            }
        }
        return;
    }

    // Try bootstrap
    import('./utils.mjs').then(({ log }) => {
        log.info('Attempting to bootstrap instance (will skip if already initialized)...');
    });

    try {
        const { data, status } = await makeApiRequest(`${config.BASE}/api/v1/admin/bootstrap`, {
            method: 'POST',
            body: {
                email: config.ADMIN_EMAIL,
                password: config.ADMIN_PASSWORD,
                organization: config.ORG_NAME
            }
        });

        if (status === 200) {
            ADMIN_TOKEN = data?.identity?.credentials?.token || data?.token || data?.accessToken || '';
            ORG_ID = data?.organization?.id || '';

            if (ADMIN_TOKEN && ORG_ID) {
                import('./utils.mjs').then(({ log }) => {
                    log.success('Bootstrapped instance and obtained admin token.');
                });
                HAVE_ADMIN = true;
                return;
            }
        }

        if (data?.message?.includes('already been set up')) {
            import('./utils.mjs').then(({ log }) => {
                log.info('Instance already initialized.');
            });
        } else {
            import('./utils.mjs').then(({ log }) => {
                log.info(`Bootstrap returned HTTP ${status} (instance may already be initialized).`);
            });
        }
    } catch (error) {
        import('./utils.mjs').then(({ log }) => {
            log.info('Bootstrap failed (instance may already be initialized).');
        });
    }

    // No admin token available, will work with UA credentials only
    HAVE_ADMIN = false;
    await loadUACredsFromFile();

    if (UA_CLIENT_ID && UA_CLIENT_SECRET) {
        import('./utils.mjs').then(({ log }) => {
            log.info('Will use UA credentials for access token (no admin auth available).');
        });
    } else {
        import('./utils.mjs').then(({ log }) => {
            log.warning('No admin token or UA credentials available. Will attempt to continue...');
        });
    }
}

export async function generateTemporaryToken() {
    import('./utils.mjs').then(({ log }) => {
        log.info('Generating access token using Universal Auth credentials...');
    });

    await loadUACredsFromFile();

    if (HAVE_ADMIN) {
        const { IDENTITY_ID } = await import('./config.mjs');
        if (IDENTITY_ID) {
            await ensureIdentityUniversalAuth();
        }
    }

    if (!UA_CLIENT_ID) {
        import('./utils.mjs').then(({ log }) => {
            log.die(`UA clientId missing. Run with admin credentials first or set in ${UA_CRED_FILE}.`);
        });
    }
    if (!UA_CLIENT_SECRET) {
        import('./utils.mjs').then(({ log }) => {
            log.die(`UA clientSecret missing. Run with admin credentials first or set in ${UA_CRED_FILE}.`);
        });
    }

    import('./utils.mjs').then(({ log }) => {
        log.info('Attempting to generate token with Universal Auth...');
        log.info(` >> URL: ${config.BASE}/api/v1/auth/universal-auth/login`);
    });

    try {
        const { data, status } = await makeApiRequest(
            `${config.BASE}/api/v1/auth/universal-auth/login`,
            {
                method: 'POST',
                body: {
                    clientId: UA_CLIENT_ID,
                    clientSecret: UA_CLIENT_SECRET
                }
            }
        );

        if (status.toString().startsWith('2')) {
            ACCESS_TOKEN = data?.accessToken;
            if (!ACCESS_TOKEN) {
                import('./utils.mjs').then(({ log }) => {
                    log.die('UA login successful but accessToken missing');
                });
            }
            import('./utils.mjs').then(({ log }) => {
                log.success('Access token generated');
            });
            return;
        }

        if (status === 401 && HAVE_ADMIN && IDENTITY_ID) {
            import('./utils.mjs').then(({ log }) => {
                log.warning('UA login 401 with admin available. Rotating client secret and retrying...');
            });
            await ensureIdentityUniversalAuth(true);
            await saveUACredsToFile(UA_CLIENT_ID, UA_CLIENT_SECRET, ORG_ID, PROJECT_ID, IDENTITY_ID);

            // Retry
            const retryResult = await makeApiRequest(
                `${config.BASE}/api/v1/auth/universal-auth/login`,
                {
                    method: 'POST',
                    body: {
                        clientId: UA_CLIENT_ID,
                        clientSecret: UA_CLIENT_SECRET
                    }
                }
            );

            if (retryResult.status.toString().startsWith('2')) {
                ACCESS_TOKEN = retryResult.data?.accessToken;
                if (!ACCESS_TOKEN) {
                    import('./utils.mjs').then(({ log }) => {
                        log.die('UA login successful on retry but accessToken missing');
                    });
                }
                import('./utils.mjs').then(({ log }) => {
                    log.success('Access token generated after secret rotation');
                });
                return;
            }
        }

        import('./utils.mjs').then(({ log }) => {
            log.die(`Failed to obtain access token. Status: ${status}`);
        });
    } catch (error) {
        import('./utils.mjs').then(({ log }) => {
            log.error('Connection error during token generation:');
        });
        console.error(error);
        import('./utils.mjs').then(({ log }) => {
            log.die('Failed to connect to Infisical API');
        });
    }
}