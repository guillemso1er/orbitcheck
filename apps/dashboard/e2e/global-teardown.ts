import { execSync } from 'child_process';
async function globalTeardown() {
    console.log('--- Global Teardown: Stopping httpbin container ---');
    try {
        execSync('podman stop httpbin');
        console.log('--- Container stopped successfully ---');
    } catch (error) {
        // Log a warning if stopping fails; the container might already be gone.
        console.warn('Could not stop container, it might have been already stopped or removed.');
    }
}
export default globalTeardown;