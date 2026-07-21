import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const contractPath = resolve(process.cwd(), 'docs/esp32s3-idf6-provisioning-contract.json');
const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
const errors = [];

const requireValue = (condition, message) => {
  if (!condition) errors.push(message);
};

requireValue(contract.hardware?.chip === 'ESP32-S3', 'hardware.chip 必须为 ESP32-S3');
requireValue(contract.firmware?.espIdfVersion === '6.0', 'firmware.espIdfVersion 必须为 6.0');
requireValue(
  contract.firmware?.component === 'espressif/network_provisioning',
  'firmware.component 必须为 espressif/network_provisioning',
);
requireValue(contract.releaseScope?.primaryTransport === 'ble', '本期 primaryTransport 必须为 ble');
requireValue(contract.releaseScope?.bleRequired === true, '本期必须启用 BLE');
requireValue(contract.releaseScope?.softApSupported === false, '本期不得声明支持 SoftAP');
requireValue(contract.transport?.type === 'ble', 'transport.type 必须为 ble');
requireValue(contract.security?.security0AllowedInProduction === false, '生产环境必须禁用 Security 0');
requireValue([1, 2].includes(contract.security?.version), 'security.version 只能为 1 或 2');
requireValue(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    contract.transport?.primaryServiceUuid ?? '',
  ),
  'primaryServiceUuid 必须是标准 128-bit UUID',
);

if (process.argv.includes('--release')) {
  const visit = (value, fieldPath) => {
    if (typeof value === 'string' && (value.includes('TBD') || value.includes('PENDING'))) {
      errors.push(`发布契约仍有未冻结字段: ${fieldPath}=${value}`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${fieldPath}[${index}]`));
      return;
    }
    if (value && typeof value === 'object') {
      Object.entries(value).forEach(([key, item]) => visit(item, fieldPath ? `${fieldPath}.${key}` : key));
    }
  };
  visit(contract, '');
}

if (errors.length > 0) {
  errors.forEach((message) => console.error(`ERROR: ${message}`));
  process.exit(1);
}

console.log(`OK: BLE provisioning contract ${contract.contractVersion} (${process.argv.includes('--release') ? 'release' : 'draft'})`);
