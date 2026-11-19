import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSON5 from 'json5';
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = resolve(root, 'out/voip-device-project');
await mkdir(output, { recursive: true });
// Keep one isolated, reproducible source snapshot; native builds/resources never touch the main checkout.
for (const folder of ['constants','utils','servers','types','hooks']) await cp(join(root,folder),join(output,folder),{recursive:true});
await rm(join(output,'features/voip'),{recursive:true,force:true});
await cp(join(root,'features/voip'),join(output,'features/voip'),{recursive:true});
await rm(join(output,'utils/voip'),{recursive:true,force:true});
for (const plugin of ['nuwax-voip','nuwax-device-identity','nuwax-stream-pcm-player']) {
  const target=join(output,'uni_modules',plugin); await rm(target,{recursive:true,force:true});
  await cp(join(root,'uni_modules',plugin),target,{recursive:true});
}
for (const file of ['subpackages/pages/voip-dev/voip-dev.uvue','subpackages/pages/voip-call/voip-call.uvue','components/safety-zone/safety-zone.uvue']) {
  const target=join(output,file); await mkdir(dirname(target),{recursive:true}); await cp(join(root,file),target);
}
await cp(join(root,'scripts/voip-native/device/App.uvue'),join(output,'App.uvue'));
await mkdir(join(output,'pages/launch'),{recursive:true});
await cp(join(root,'scripts/voip-native/device/launch.uvue'),join(output,'pages/launch/launch.uvue'));
await writeFile(join(output,'main.uts'),`import App from './App.uvue'\nimport { createSSRApp } from 'vue'\nexport function createApp() { return { app: createSSRApp(App) }; }\n`);
const manifest=JSON5.parse(await readFile(join(root,'manifest.json'),'utf8'));
manifest.name='Nuwax VoIP Test';
await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2));
await writeFile(join(output,'pages.json'),JSON.stringify({pages:[{path:'pages/launch/launch',style:{navigationStyle:'custom'}}],
  subPackages:[{root:'subpackages',pages:[{path:'pages/voip-dev/voip-dev',style:{navigationStyle:'custom'}},{path:'pages/voip-call/voip-call',style:{navigationStyle:'custom'}}]}],
  easycom:{autoscan:true}, globalStyle:{navigationStyle:'custom',backgroundColor:'#f5f6fa'}},null,2));
await writeFile(join(output,'uni.scss'),'// Isolated device test styles.\n');
await cp(join(root,'static/splash'),join(output,'static/splash'),{recursive:true});
await cp(join(root,'static/app-icon'),join(output,'static/app-icon'),{recursive:true});
await writeFile(join(output,'source.json'),JSON.stringify({source:root,generatedAt:new Date().toISOString(),developmentOnly:true},null,2));
console.log(output);
