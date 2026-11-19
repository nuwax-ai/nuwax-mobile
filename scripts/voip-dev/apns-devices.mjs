import { CallError } from './registry.mjs';

// Development contract only. Never contacts APNs or claims native push delivery.
export class ApnsDeviceRegistry {
  constructor(devices = new Map()) { this.devices = devices; this.revoked = new Set(); }
  apply(userId, deviceId, value) {
    const uuid = s => typeof s === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.exec(s)?.[0] === s;
    const bundle = s => typeof s === 'string' && s.length <= 255 && /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.exec(s)?.[0] === s;
    if (value.provider !== 'apns' || value.channel !== 'pushKit' || value.platform !== 'ios' || value.deviceId !== deviceId ||
        !['register', 'revoke'].includes(value.action) || !['development', 'production'].includes(value.environment) ||
        !bundle(value.bundleId) || !uuid(value.registrationId) ||
        (value.previousRegistrationId !== '' && !uuid(value.previousRegistrationId)) ||
        typeof value.token !== 'string' || /^(?:[0-9a-f]{2}){1,1024}$/.exec(value.token)?.[0] !== value.token) throw new CallError('CALL_INVALID_ARGUMENT');
    const id = value.registrationId.toLowerCase(), previousId = value.previousRegistrationId.toLowerCase();
    const key = JSON.stringify([userId, deviceId, 'pushKit', value.environment, value.bundleId, 'apns']);
    const tombstone = `${key}|${id}`, previous = this.devices.get(key);
    if (value.action === 'revoke') {
      if (previous?.registrationId === id && previous.token !== value.token) throw new CallError('CALL_PUSH_REGISTRATION_CONFLICT');
      this.revoked.add(tombstone);
      if (previous?.registrationId === id && previous.token === value.token) this.devices.delete(key);
    } else {
      if (this.revoked.has(tombstone)) throw new CallError('CALL_PUSH_REGISTRATION_REVOKED');
      if (previous && previous.registrationId !== id && previous.registrationId !== previousId) throw new CallError('CALL_PUSH_REGISTRATION_CONFLICT');
      if (previous?.registrationId === id && previous.token !== value.token) throw new CallError('CALL_PUSH_REGISTRATION_CONFLICT');
      if (previous && previous.registrationId !== id) this.revoked.add(`${key}|${previous.registrationId}`);
      this.devices.set(key, { ...value, registrationId: id, previousRegistrationId: previousId, userId, deviceId });
    }
    return { provider: 'apns', channel: 'pushKit', deviceId, bundleId: value.bundleId, environment: value.environment,
      registrationId: id, registered: value.action === 'register', nativePush: false };
  }
}
