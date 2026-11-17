"""Run the real Kotlin policy on the JVM without building/installing an App.

Uses the pinned compiler/dependencies already cached by the 5.34 local build.
No signing environment, network access, Gradle daemon or device is needed.
"""
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
CACHE = Path(os.environ.get('GRADLE_USER_HOME', str(Path.home() / '.gradle'))) / 'caches/modules-2/files-2.1'

def jar(group, artifact, version):
    files = sorted((CACHE / group / artifact / version).glob(f'*/{artifact}-{version}.jar'))
    if len(files) != 1:
        raise SystemExit(f'Missing cached dependency: {group}:{artifact}:{version}; prepare the 5.34 toolchain first')
    return str(files[0])

compiler = [jar('org.jetbrains.kotlin', artifact, version) for artifact, version in [
    ('kotlin-compiler-embeddable', '2.2.0'), ('kotlin-stdlib', '2.2.0'),
    ('kotlin-script-runtime', '2.2.0'), ('kotlin-reflect', '1.6.10'), ('kotlin-daemon-embeddable', '2.2.0')]]
compiler += [jar('org.jetbrains.kotlinx', 'kotlinx-coroutines-core-jvm', '1.8.0'), jar('org.jetbrains', 'annotations', '13.0')]
runtime = [jar('org.jetbrains.kotlin', 'kotlin-stdlib', '2.2.0')]
java = Path(os.environ.get('JAVA_HOME', '/Applications/HBuilderX.app/Contents/HBuilderX/plugins/amazon-corretto')) / 'bin/java'
output = ROOT / 'out/voip-android-policy-tests'
output.mkdir(parents=True, exist_ok=True)
subprocess.run([str(java), '-cp', os.pathsep.join(compiler), 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler',
    '-no-stdlib', '-no-reflect', '-jvm-target', '17', '-classpath', os.pathsep.join(runtime), '-d', str(output),
    str(ROOT / 'uni_modules/nuwax-voip/utssdk/app-android/src/com/nuwax/voip/VoipCallPolicy.kt'),
    str(ROOT / 'tests/voip/android/VoipCallPolicyTest.kt')], check=True, timeout=90)
subprocess.run([str(java), '-cp', os.pathsep.join([str(output), *runtime]), 'com.nuwax.voip.VoipCallPolicyTest'], check=True, timeout=30)
