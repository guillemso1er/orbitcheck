import { spawn } from 'node:child_process';

const env = {
    ...process.env,
    LIBPOSTAL_DATA_DIR: process.env.LIBPOSTAL_DATA_DIR || '/opt/libpostal/data',
};

function runCli(cmd: string, args: string[], input: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const ps = spawn(cmd, args, { env });
        let stdout = '';
        let stderr = '';
        ps.stdout.on('data', (b) => (stdout += b));
        ps.stderr.on('data', (b) => (stderr += b));
        ps.on('error', reject);
        ps.on('close', (code) => {
            if (code === 0) resolve(stdout);
            else reject(new Error(`${cmd} exited with ${code}: ${stderr}`));
        });
        ps.stdin.end(input);
    });
}

// address_parser prints component: value lines
export async function parseAddressCLI(text: string): Promise<Record<string, string>> {
    const out = await runCli('address_parser', [], text);
    const parts: Record<string, string> = {};
    for (const line of out.split('\n')) {
        const m = line.match(/^\s*([a-z_]+)\s*:\s*(.+)\s*$/i);
        if (m) parts[m[1]] = m[2];
    }
    return parts;
}

// expand_address prints one expanded variant per line
export async function expandAddressCLI(text: string): Promise<string[]> {
    const out = await runCli('expand_address', [], text);
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
}