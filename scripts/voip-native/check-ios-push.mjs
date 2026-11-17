import { mkdir, copyFile, writeFile, readdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const project = `${root}/out/voip-ios-push-tests`;
await rm(`${project}/Sources/VoipPush`, { recursive: true, force: true });
await mkdir(`${project}/Sources/VoipPush`, { recursive: true });
await mkdir(`${project}/Tests/VoipPushTests`, { recursive: true });
for (const name of ['NuwaxVoipPushInvitation', 'NuwaxVoipApnsRegistration', 'NuwaxVoipSystemCallRegistry', 'NuwaxVoipCallPolicy', 'NuwaxVoipClientState', 'NuwaxVoipCallHistory', 'NuwaxVoipPushWork', 'NuwaxVoipSessionStorage']) {
  await copyFile(`${root}/uni_modules/nuwax-voip/utssdk/app-ios/${name}.swift`, `${project}/Sources/VoipPush/${name}.swift`);
}
for (const file of await readdir(`${root}/tests/voip/ios`)) {
  if (file.endsWith('.swift')) await copyFile(`${root}/tests/voip/ios/${file}`, `${project}/Tests/VoipPushTests/${file}`);
}
await writeFile(`${project}/Package.swift`, `// swift-tools-version:6.1
import PackageDescription
let package = Package(name: "VoipPush", platforms: [.macOS(.v13)], targets: [
  .target(name: "VoipPush"), .testTarget(name: "VoipPushTests", dependencies: ["VoipPush"])
])
`);
const child = spawn('swift', ['test', '--package-path', project], { stdio: 'inherit' });
process.exitCode = await new Promise(resolve => { child.once('exit', code => resolve(code ?? 1)); child.once('error', () => resolve(1)); });
