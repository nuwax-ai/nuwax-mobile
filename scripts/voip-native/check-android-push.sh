#!/usr/bin/env bash
# Real Kotlin/JSONObject tests against the isolated, already prepared 5.34 full App project.
set -euo pipefail
VOIP_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if [[ -n "${NUWAX_SIGNING_ENV:-}" ]]; then
  set -a
  source "$NUWAX_SIGNING_ENV"
  set +a
fi
[[ -n "${ANDROID_RELEASE_STORE_FILE:-}" ]] || { echo 'Provide the same controlled NUWAX_SIGNING_ENV used to prepare the local App project.' >&2; exit 1; }
VOIP_PROJECTS=("$VOIP_ROOT"/out/voip-native-work/android/Android-uni-app-x-SDK@*-5.34/uniappxnativepackage)
[[ ${#VOIP_PROJECTS[@]} -eq 1 && -f "${VOIP_PROJECTS[0]}/gradlew" ]] || { echo 'Prepare the isolated HBuilderX 5.34 full App base first.' >&2; exit 1; }
VOIP_PROJECT="${VOIP_PROJECTS[0]}"
VOIP_TEST_INIT="$VOIP_ROOT/out/voip-unipush-tests.init.gradle"
python3 - "$VOIP_ROOT" "$VOIP_TEST_INIT" <<'PY'
import sys
from pathlib import Path
root, target = map(Path, sys.argv[1:])
tests = str(root / 'tests/voip/android').replace('\\', '\\\\').replace("'", "\\'")
target.write_text("""gradle.afterProject { project, state ->
    if (project.path == ':app') {
        project.dependencies.add('testImplementation', 'junit:junit:4.13.2')
        project.dependencies.add('testImplementation', 'org.json:json:20240303')
        project.android.sourceSets.test.java.srcDir('%s')
    }
}
""" % tests)
PY
export JAVA_HOME="${JAVA_HOME:-/Applications/HBuilderX.app/Contents/HBuilderX/plugins/amazon-corretto}"
cd "$VOIP_PROJECT"
./gradlew -I "$VOIP_TEST_INIT" :app:testDebugUnitTest --tests com.nuwax.voip.VoipPushPayloadTest
