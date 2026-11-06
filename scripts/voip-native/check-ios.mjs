import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const project = `${root}/out/voip-native-ios`;
await mkdir(`${project}/Sources/VoipNativeCheck`, { recursive: true });
await copyFile(`${root}/uni_modules/nuwax-voip/utssdk/app-ios/NuwaxVoipBridge.swift`, `${project}/Sources/VoipNativeCheck/NuwaxVoipBridge.swift`);
await writeFile(`${project}/Package.swift`, `// swift-tools-version:6.1
import PackageDescription
let package = Package(name: "VoipNativeCheck", platforms: [.iOS(.v15)],
  products: [.library(name: "VoipNativeCheck", type: .dynamic, targets: ["VoipNativeCheck"])],
  dependencies: [.package(url: "https://github.com/livekit/client-sdk-swift.git", exact: "2.19.0")],
  targets: [.target(name: "VoipNativeCheck", dependencies: [.product(name: "LiveKit", package: "client-sdk-swift")],
    linkerSettings: [.unsafeFlags(["-Xlinker", "-weak_framework", "-Xlinker", "LiveCommunicationKit"])])])
`);
console.log('[voip] Checking Swift 6 / LiveKit 2.19.0 / iOS 15 minimum (no installation or signing)');
const child = spawn('xcodebuild', ['-scheme', 'VoipNativeCheck', '-destination', 'generic/platform=iOS Simulator',
  '-derivedDataPath', `${root}/out/voip-native-ios-derived`, 'CODE_SIGNING_ALLOWED=NO', 'build'], { cwd: project, stdio: 'inherit' });
process.exitCode = await new Promise(resolve => { child.once('exit', code => resolve(code ?? 1)); child.once('error', () => resolve(1)); });
