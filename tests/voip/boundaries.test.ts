import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(uts|uvue)$/.test(path)) files.push(path);
  }
  return files;
}

describe('VoIP feature integration boundary', () => {
  it('keeps host imports on the public lifecycle, audio and UI entries', () => {
    const allowed = new Set([
      '@/features/voip/integration',
      '@/features/voip/audioFocus',
      '@/features/voip/components/chat-actions.uvue',
      '@/features/voip/components/incoming-call-setup-hint.uvue',
      '@/features/voip/components/return-to-call.uvue',
    ]);
    const hosts = ['App.uvue', ...['pages', 'components', 'utils', 'hooks'].flatMap(sourceFiles)];
    for (const path of hosts) {
      const source = read(path);
      for (const match of source.matchAll(/from\s+["'](@\/features\/voip\/[^"']+)["']/g)) {
        expect(allowed.has(match[1]), `${path} imports private feature code ${match[1]}`).toBe(true);
      }
      expect(source, path).not.toMatch(/@\/utils\/voip\//);
    }
  });

  it('keeps registered routes as screen mounts and the main launch free of test routing', () => {
    for (const [route, screen] of [['voip-call', 'call'], ['voip-dev', 'development'], ['voip-history', 'history']]) {
      const page = read(`subpackages/pages/${route}/${route}.uvue`);
      expect(page).toContain(`@/features/voip/screens/${screen}.uvue`);
      expect(page).not.toMatch(/uni\.|onMounted|setInterval|callManager|servers\/voip/);
    }
    expect(read('pages/launch/launch.uvue')).not.toMatch(/voip/i);
  });

  it('keeps development-service declarations in the dedicated build support', () => {
    expect(read('scripts/android-esp/configure_app.py')).not.toMatch(/voip/i);
    expect(read('uni_modules/nuwax-voip/utssdk/app-android/AndroidManifest.xml')).not.toMatch(/VoipDevControlService|FOREGROUND_SERVICE_SPECIAL_USE/);
    expect(read('scripts/voip-native/device/configure-android.py')).toContain('VoipDevControlService');
  });

  it('uses the shared Android background UI for meeting invitations and leaves foreground presentation to the app', () => {
    const bridge = read('uni_modules/nuwax-voip/utssdk/app-android/src/com/nuwax/voip/VoipBridge.kt');
    const meetingReceiver = bridge.slice(
      bridge.indexOf('private fun receiveMeetingInvitation('),
      bridge.indexOf('private fun emitMeeting('),
    );
    expect(bridge).toContain('type == "voip" || (type == "meeting_invite" && hidden)');
    expect(meetingReceiver).toContain('if (!hidden) return');
    expect(meetingReceiver).toMatch(/requestBackgroundCallUi\(inviteId\)\s+publishCall\(\)/);
    expect(meetingReceiver).not.toContain('requestIncomingCallUi(');
  });

  it('skips iOS system presentation for foreground meetings only when PushKit permits it', () => {
    const bridge = read('uni_modules/nuwax-voip/utssdk/app-ios/NuwaxVoipBridge.swift');
    expect(bridge).toContain('receiveVoipPush(payload, mustReport: true, completion: completion)');
    expect(bridge).toMatch(/if !mustReport, invitation\?\.scene == "meeting", UIApplication\.shared\.applicationState == \.active \{[^}]+completion\(\)\s+return/);
  });
});
