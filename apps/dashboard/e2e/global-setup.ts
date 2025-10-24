import { execSync } from 'child_process';

async function globalSetup() {
    console.log('--- Global Setup: Starting httpbin container ---');
    try {
        // Robust cleanup of any old containers to prevent conflicts
        console.log('Performing cleanup of old containers...');
        execSync('podman stop httpbin || true && podman rm httpbin || true');

        // Pull the latest image if not present
        console.log('Pulling httpbin container image...');
        execSync('podman pull mccutchen/go-httpbin');

        // Start the new container
        console.log('Starting new httpbin container...');
        execSync('podman run -d --rm --name httpbin -p 8054:8080 mccutchen/go-httpbin');

        // Give the container a moment to initialize before tests start
        await new Promise(resolve => setTimeout(resolve, 2000));

        console.log('--- Container started successfully on port 8054 ---');
    } catch (error) {
        console.error('🔴 --- Global Setup Failed --- 🔴');
        console.error(error.message);
        // Exit the process if the container setup fails, as tests will not be able to run.
        process.exit(1);
    }
}

export default globalSetup;