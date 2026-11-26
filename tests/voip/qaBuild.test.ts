import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { qaConfig, qaManager, qaUpdate, testOrigin } from '../../scripts/voip-native/prepare-business-qa.mjs';
describe('standalone QA build boundaries', () => {
  it('uses test origin even when an existing production installation had stored an origin', () => {
    const source = readFileSync(new URL('../../constants/config.uts', import.meta.url), 'utf8');
    const qa = qaConfig(source);
    expect(qa).toContain(`API_BASE_URL = "${testOrigin}";`);
    expect(qa).not.toContain('DEFAULT_API_BASE_URL = "https://agent.nuwax.com";');
    expect(qa).toContain(`if (normalized != "${testOrigin}") return false;`);
    expect(source).toContain('DEFAULT_API_BASE_URL = "https://agent.nuwax.com";');
  });
  it('keeps the isolated QA variant on test while normal builds use their configured HTTPS origin', () => {
    const source = readFileSync(new URL('../../features/voip/callManager.uts', import.meta.url), 'utf8');
    const qa = qaManager(source);
    expect(qa).toContain(`return supported && getApiBaseUrl() == "${testOrigin}";`);
    expect(source).toContain('return supported && getApiBaseUrl().startsWith("https://");');
    expect(() => qaManager(qa)).toThrow(); expect(() => qaConfig(qaConfig(readFileSync(new URL('../../constants/config.uts', import.meta.url), 'utf8')))).toThrow();
  });
  it('retains the signed QA build without changing the main checkout update policy', () => {
    const source = readFileSync(new URL('../../utils/partnerAppUpdate.uts', import.meta.url), 'utf8');
    expect(qaUpdate(source)).toContain('return; // Internal standalone QA: retain this signed build.');
    expect(source).not.toContain('return; // Internal standalone QA: retain this signed build.');
    expect(() => qaUpdate('unexpected source')).toThrow();
  });
});
