#!/usr/bin/env zx

import { config, HAVE_ADMIN, ADMIN_TOKEN, sleep } from './config.mjs';

// ============================================================================
// API Utility Functions
// ============================================================================
export async function retryApiCall(maxRetries, fn) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (i < maxRetries - 1) {
                import('./utils.mjs').then(({ log }) => {
                    log.warning(`API call failed, retrying in ${config.RETRY_DELAY}s... (attempt ${i + 2}/${maxRetries})`);
                });
                await sleep(config.RETRY_DELAY * 1000);
            }
        }
    }
    throw lastError;
}

export async function waitForService(url, timeout = 90) {
    const startTime = Date.now();
    import('./utils.mjs').then(({ log }) => {
        log.info(`Waiting for Infisical to be ready at ${url}...`);
    });

    while ((Date.now() - startTime) / 1000 < timeout) {
        try {
            const response = await fetch(`${url}/api/status`);
            if (response.ok) {
                import('./utils.mjs').then(({ log }) => {
                    log.success('Infisical is ready!');
                });
                return;
            }
        } catch {
            // Service not ready yet
        }
        process.stderr.write('.');
        await sleep(2000);
    }

    console.error('');
    import('./utils.mjs').then(({ log }) => {
        log.die('Timeout waiting for Infisical to be ready');
    });
}

export function requireAdmin() {
    if (!HAVE_ADMIN && !ADMIN_TOKEN) {
        import('./utils.mjs').then(({ log }) => {
            log.die('This operation requires admin auth. Provide INFISICAL_ADMIN_TOKEN or run once with bootstrap.');
        });
    }
}

export async function makeApiRequest(url, options = {}) {
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        }
    };

    if (options.body && typeof options.body === 'object') {
        options.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, { ...defaultOptions, ...options });
    const text = await response.text();

    let data;
    try {
        data = JSON.parse(text);
    } catch {
        data = text;
    }

    return { response, data, status: response.status };
}

// ============================================================================
// Identity Management
// ============================================================================
export async function discoverOrgId() {
    requireAdmin();
    const { ORG_ID } = await import('./config.mjs');
    if (ORG_ID) return;

    import('./utils.mjs').then(({ log }) => {
        log.info('Discovering organization ID...');
    });

    const { data } = await retryApiCall(config.MAX_RETRIES, async () => {
        const result = await makeApiRequest(`${config.BASE}/api/v1/organizations`, {
            headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }
        });
        if (result.status !== 200) throw new Error('Failed to fetch organizations');
        return result;
    });

    const { ORG_ID: orgId } = await import('./config.mjs');
    const org = data.organizations?.find(o => o.name === config.ORG_NAME);
    if (!org) {
        import('./utils.mjs').then(({ log }) => {
            log.die(`Organization '${config.ORG_NAME}' not found`);
        });
    }

    // Import and set ORG_ID
    const configModule = await import('./config.mjs');
    configModule.ORG_ID = org.id;
    import('./utils.mjs').then(({ log }) => {
        log.info(`Found organization ID: ${configModule.ORG_ID}`);
    });
}

export async function ensureProject() {
    requireAdmin();
    await discoverOrgId();

    const { PROJECT_ID, ORG_ID } = await import('./config.mjs');
    import('./utils.mjs').then(({ log }) => {
        log.info(`Checking for project '${config.PROJECT_NAME}'...`);
    });

    const { data } = await retryApiCall(config.MAX_RETRIES, async () => {
        const result = await makeApiRequest(`${config.BASE}/api/v1/projects`, {
            headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }
        });
        if (result.status !== 200) throw new Error('Failed to fetch projects');
        return result;
    });

    const project = data.projects?.find(p =>
        (p.name || p.projectName) === config.PROJECT_NAME
    );

    if (project) {
        const configModule = await import('./config.mjs');
        configModule.PROJECT_ID = project.id || project.projectId || project.workspaceId;
        import('./utils.mjs').then(({ log }) => {
            log.info(`Project exists with ID: ${configModule.PROJECT_ID}`);
        });
        return;
    }

    import('./utils.mjs').then(({ log }) => {
        log.info(`Creating project '${config.PROJECT_NAME}'...`);
    });

    const { SCRIPT_NAME } = await import('./config.mjs');
    // Try new API shape first
    let createResult = await makeApiRequest(`${config.BASE}/api/v1/projects`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
        body: {
            projectName: config.PROJECT_NAME,
            orgId: ORG_ID,
            description: `Managed by ${SCRIPT_NAME}`
        }
    });

    // If failed, try legacy shape
    if (!createResult.status.toString().startsWith('2')) {
        import('./utils.mjs').then(({ log }) => {
            log.warning('Create project failed. Retrying with legacy payload shape...');
        });
        createResult = await makeApiRequest(`${config.BASE}/api/v1/projects`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
            body: {
                name: config.PROJECT_NAME,
                organizationId: ORG_ID,
                description: `Managed by ${SCRIPT_NAME}`
            }
        });
    }

    if (!createResult.status.toString().startsWith('2')) {
        import('./utils.mjs').then(({ log }) => {
            log.die(`Failed to create project (HTTP ${createResult.status})`);
        });
    }

    const configModule = await import('./config.mjs');
    configModule.PROJECT_ID = createResult.data?.project?.id || createResult.data?.id ||
        createResult.data?.projectId || createResult.data?.workspace?.id ||
        createResult.data?.workspaceId;

    if (!configModule.PROJECT_ID) {
        import('./utils.mjs').then(({ log }) => {
            log.die('Project creation response missing ID');
        });
    }

    import('./utils.mjs').then(({ log }) => {
        log.success(`Project created with ID: ${configModule.PROJECT_ID}`);
    });
}

export async function createReadOnlyIdentity() {
    requireAdmin();
    await discoverOrgId();

    const { ORG_ID, IDENTITY_ID } = await import('./config.mjs');
    import('./utils.mjs').then(({ log }) => {
        log.info('Setting up read-only machine identity...');
    });

    const { data } = await retryApiCall(config.MAX_RETRIES, async () => {
        const result = await makeApiRequest(
            `${config.BASE}/api/v1/identities?orgId=${ORG_ID}`,
            { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }
        );
        if (result.status !== 200) throw new Error('Failed to fetch identities');
        return result;
    });

    const identity = data.identities?.find(i => i.name === config.IDENTITY_NAME);

    if (identity) {
        const configModule = await import('./config.mjs');
        configModule.IDENTITY_ID = identity.id;
        import('./utils.mjs').then(({ log }) => {
            log.info(`Identity exists with ID: ${configModule.IDENTITY_ID}`);
        });
    } else {
        import('./utils.mjs').then(({ log }) => {
            log.info(`Creating machine identity '${config.IDENTITY_NAME}'...`);
        });

        const createResult = await retryApiCall(config.MAX_RETRIES, async () => {
            const result = await makeApiRequest(`${config.BASE}/api/v1/identities`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
                body: {
                    name: config.IDENTITY_NAME,
                    organizationId: ORG_ID
                }
            });
            if (result.status !== 200) throw new Error('Failed to create identity');
            return result;
        });

        const configModule = await import('./config.mjs');
        configModule.IDENTITY_ID = createResult.data?.identity?.id || createResult.data?.id;
        if (!configModule.IDENTITY_ID) {
            import('./utils.mjs').then(({ log }) => {
                log.die('Identity creation response missing ID');
            });
        }

        import('./utils.mjs').then(({ log }) => {
            log.success(`Identity created with ID: ${configModule.IDENTITY_ID}`);
        });
    }

    await ensureIdentityUniversalAuth();
}

export async function assignReadOnlyRole() {
    requireAdmin();

    const { PROJECT_ID, IDENTITY_ID } = await import('./config.mjs');
    import('./utils.mjs').then(({ log }) => {
        log.info('Configuring read-only permissions...');
    });

    const rolesResult = await retryApiCall(config.MAX_RETRIES, async () => {
        const result = await makeApiRequest(
            `${config.BASE}/api/v1/projects/${PROJECT_ID}/roles`,
            { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }
        );
        if (result.status !== 200) throw new Error('Failed to fetch project roles');
        return result;
    });

    const roles = rolesResult.data?.roles || [];

    // Find suitable read-only role
    let roleSlug = roles.find(r => r.slug === 'project_viewer')?.slug;
    if (!roleSlug) {
        roleSlug = roles.find(r => /viewer|read/i.test(r.slug))?.slug;
    }
    if (!roleSlug) {
        const sortedRoles = roles.sort((a, b) =>
            (a.permissions?.length || 0) - (b.permissions?.length || 0)
        );
        roleSlug = sortedRoles[0]?.slug;
    }

    if (!roleSlug) {
        import('./utils.mjs').then(({ log }) => {
            log.die('No suitable read-only role found');
        });
    }
    import('./utils.mjs').then(({ log }) => {
        log.info(`Using role: ${roleSlug}`);
    });

    // Check existing membership
    const membershipsResult = await retryApiCall(config.MAX_RETRIES, async () => {
        const result = await makeApiRequest(
            `${config.BASE}/api/v1/projects/${PROJECT_ID}/identity-memberships`,
            { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }
        );
        if (result.status !== 200) throw new Error('Failed to fetch memberships');
        return result;
    });

    const isMember = membershipsResult.data?.identityMemberships?.find(
        m => m.identity?.id === IDENTITY_ID
    );

    if (!isMember) {
        import('./utils.mjs').then(({ log }) => {
            log.info('Adding identity to project with read-only access...');
        });

        await retryApiCall(config.MAX_RETRIES, async () => {
            const result = await makeApiRequest(
                `${config.BASE}/api/v1/projects/${PROJECT_ID}/identity-memberships/${IDENTITY_ID}`,
                {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
                    body: {
                        roles: [{
                            role: roleSlug,
                            isTemporary: false
                        }]
                    }
                }
            );
            if (result.status !== 200) throw new Error('Failed to add identity to project');
            return result;
        });

        import('./utils.mjs').then(({ log }) => {
            log.success('Identity added to project with read-only access');
        });
    } else {
        import('./utils.mjs').then(({ log }) => {
            log.info('Identity already has project access');
        });
    }
}

export async function ensureIdentityUniversalAuth(forceRotate = false) {
    requireAdmin();

    const { IDENTITY_ID, UA_CLIENT_ID, UA_CLIENT_SECRET } = await import('./config.mjs');
    import('./utils.mjs').then(({ log }) => {
        log.info(`Ensuring Universal Auth is configured for identity '${config.IDENTITY_NAME}' (${IDENTITY_ID})...`);
        log.info('Attaching Universal Auth to identity (idempotent)...');
    });

    const { data, status } = await makeApiRequest(
        `${config.BASE}/api/v1/auth/universal-auth/identities/${IDENTITY_ID}`,
        {
            method: 'POST',
            headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
            body: {
                clientSecretTrustedIps: [
                    { ipAddress: '0.0.0.0/0' },
                    { ipAddress: '::/0' }
                ],
                accessTokenTTL: config.TOKEN_TTL
            }
        }
    );

    if (status === 200) {
        import('./utils.mjs').then(({ log }) => {
            log.success('Universal Auth created for identity.');
        });
    } else if (status === 400 && data?.message?.includes('already configured')) {
        import('./utils.mjs').then(({ log }) => {
            log.success('Universal Auth already configured for identity.');
        });
    } else {
        import('./utils.mjs').then(({ log }) => {
            log.die(`Failed to attach Universal Auth to identity (HTTP ${status})`);
        });
    }

    // Retrieve UA details
    import('./utils.mjs').then(({ log }) => {
        log.info('Retrieving Universal Auth details for identity...');
    });
    const uaCheck = await retryApiCall(config.MAX_RETRIES, async () => {
        const result = await makeApiRequest(
            `${config.BASE}/api/v1/auth/universal-auth/identities/${IDENTITY_ID}`,
            { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }
        );
        if (result.status !== 200) throw new Error('Failed to verify UA configuration');
        return result;
    });

    const clientId = uaCheck.data?.identityUniversalAuth?.clientId || uaCheck.data?.clientId;
    if (!clientId) {
        import('./utils.mjs').then(({ log }) => {
            log.die('Failed to determine clientId for identity');
        });
    }

    const configModule = await import('./config.mjs');
    configModule.UA_CLIENT_ID = clientId;

    // Load existing secret if available
    await loadUASecretOnly();

    const needSecret = forceRotate || !UA_CLIENT_SECRET;

    if (needSecret) {
        import('./utils.mjs').then(({ log }) => {
            log.info(`Creating client secret (ttl=${config.UA_SECRET_TTL}s; 0 => omit ttl)...`);
        });

        const secretPayload = {
            description: `Persistent secret for ${config.IDENTITY_NAME} (generated by ${SCRIPT_NAME})`,
            numUsesLimit: 0
        };

        if (config.UA_SECRET_TTL > 0) {
            secretPayload.ttl = config.UA_SECRET_TTL;
        }

        const secretResult = await retryApiCall(config.MAX_RETRIES, async () => {
            const result = await makeApiRequest(
                `${config.BASE}/api/v1/auth/universal-auth/identities/${IDENTITY_ID}/client-secrets`,
                {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
                    body: secretPayload
                }
            );
            if (result.status !== 200) throw new Error('Failed to create client secret');
            return result;
        });

        configModule.UA_CLIENT_SECRET = secretResult.data?.clientSecret;
        if (!configModule.UA_CLIENT_SECRET) {
            import('./utils.mjs').then(({ log }) => {
                log.die('Client secret missing in response');
            });
        }

        const { ORG_ID, PROJECT_ID } = await import('./config.mjs');
        await saveUACredsToFile(configModule.UA_CLIENT_ID, configModule.UA_CLIENT_SECRET, ORG_ID, PROJECT_ID, IDENTITY_ID);
    } else {
        import('./utils.mjs').then(({ log }) => {
            log.info('Using existing client secret');
        });
    }
}