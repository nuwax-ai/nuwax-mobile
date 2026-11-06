import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isIPv4 } from 'node:net';
import { randomBytes, createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = new URL('../../out/voip-dev/', import.meta.url);
await mkdir(out, { recursive: true });
const secretFile = new URL('livekit-secret', out);
let secret;
try { secret = await readFile(secretFile, 'utf8'); }
catch { secret = randomBytes(32).toString('hex'); await writeFile(secretFile, secret, { mode: 0o600 }); }
const config = new URL('livekit.yaml', out);
const advertise = process.env.VOIP_ADVERTISE_IP ?? '127.0.0.1';
if (!isIPv4(advertise)) throw new Error('VOIP_ADVERTISE_IP must be an IPv4 address');
await writeFile(config, `port: 7880\nrtc:\n  node_ip: ${advertise}\n  use_external_ip: false\n  tcp_port: 7881\n  udp_port: 7882\nkeys:\n  devkey: ${secret}\n`, { mode: 0o600 });
const bind = advertise === '127.0.0.1' ? '127.0.0.1' : '0.0.0.0';
const compose = new URL('compose.yaml', out);
await writeFile(compose, `services:\n  livekit:\n    image: livekit/livekit-server:v1.13.11\n    command: ["--config", "/etc/livekit.yaml"]\n    ports: ["${bind}:7880:7880", "${bind}:7881:7881", "${bind}:7882:7882/udp"]\n    volumes: ["${fileURLToPath(config)}:/etc/livekit.yaml:ro"]\n`, { mode: 0o600 });
const args = ['compose', '--project-name', 'nuwax-mobile-voip-' + createHash('sha256').update(root).digest('hex').slice(0, 8), '-f', fileURLToPath(compose)];
const result = spawnSync('docker', [...args, 'up', '-d'], { stdio: 'inherit' });
if (result.status !== 0) throw new Error('Docker LiveKit startup failed');
const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
  cwd: root, stdio: 'inherit', env: { ...process.env, VOIP_LIVEKIT_SECRET: secret,
    VOIP_LIVEKIT_URL: process.env.VOIP_LIVEKIT_URL ?? `ws://${advertise}:7880` },
});
let stopping = false;
function stop() {
  if (stopping) return; stopping = true;
  child.kill('SIGTERM');
  spawnSync('docker', [...args, 'down'], { stdio: 'inherit' });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
child.once('exit', code => { stop(); process.exitCode = code ?? 1; });
