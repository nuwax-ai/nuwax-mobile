import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function nativeStage() {
  const source = readFileSync(new URL('../../uni_modules/nuwax-livekit/utssdk/app-harmony/MeetingStage.ets', import.meta.url), 'utf8');
  // Execute the host and NodeController state machine. ArkUI's declarative layout
  // and component lifecycle are tested on a device, outside this suite.
  const hostSource = source.split('\n@Builder\n')[0].replace(/^import .*$/gm, '').replace(/^export /gm, '');
  const stages: MockBuilderNode[] = [];
  class MockBuilderNode {
    build = vi.fn();
    frame = {};
    getFrameNode() { return this.frame; }
    dispose = vi.fn();
  }
  class MockNodeController {
    rebuild = vi.fn();
  }
  class MockController {
    onActive = vi.fn();
    runJavaScript = vi.fn().mockResolvedValue('1');
  }
  const context = vm.createContext({
    BuilderNode: class extends MockBuilderNode {
      constructor() { super(); stages.push(this); }
    },
    NodeController: MockNodeController,
    webview: { WebviewController: MockController },
    wrapBuilder: (builder: unknown) => builder,
    buildMeetingStage: vi.fn(),
  });
  const session = vm.runInContext(stripTypeScriptTypes(hostSource) + '\nMeetingStageSession;', context);
  return { session, stages };
}

describe('Harmony meeting native stage', () => {
  it('reuses the same ArkWeb frame and connection after minimizing and returning', () => {
    const { session, stages } = nativeStage();
    const initial = session.attach({});
    const frame = initial.makeNode({});
    const host = session.host;
    host.ready = true;
    session.connect('wss://room.test', 'seat-token');
    session.connection = 'connected';
    const roomGeneration = session.id;
    host.controller.runJavaScript.mockClear();

    expect(session.releaseView(initial.id)).toBe(true);
    expect(initial.makeNode({})).toBeNull();
    expect(host.controller.onActive).toHaveBeenCalledOnce();
    expect(stages[0].dispose).not.toHaveBeenCalled();
    const restored = session.attach({});
    expect(restored.makeNode({})).toBe(frame);
    expect(stages).toHaveLength(1);
    expect(session.id).toBe(roomGeneration);
    expect(session.isConnected()).toBe(true);
    expect(host.controller.runJavaScript).not.toHaveBeenCalled();
  });

  it('ignores a stale unmount and disposes the detached frame after leaving', () => {
    const { session, stages } = nativeStage();
    const old = session.attach({});
    const frame = old.makeNode({});
    const host = session.host;
    host.ready = true;
    session.connect('wss://room.test', 'seat-token');
    session.connection = 'connected';
    const restored = session.attach({});

    expect(session.releaseView(old.id)).toBe(false);
    expect(restored.makeNode({})).toBe(frame);
    expect(session.releaseView(restored.id)).toBe(true);
    session.disconnect();
    session.releaseIdleHost();
    expect(stages[0].dispose).toHaveBeenCalledOnce();
    expect(session.host).toBeUndefined();
    expect(session.isConnected()).toBe(false);
  });

  it('disposes a page that never joined a room', () => {
    const { session, stages } = nativeStage();
    const mount = session.attach({});
    mount.makeNode({});
    expect(session.releaseView(mount.id)).toBe(true);
    expect(stages[0].dispose).toHaveBeenCalledOnce();
    expect(session.host).toBeUndefined();
  });
});
