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
requireValue(contract.security?.version === 2, '首轮联调 security.version 必须为 2');
requireValue(contract.firmware?.componentVersion === '1.2.4', 'network_provisioning 版本必须为 1.2.4');
requireValue(contract.firmware?.bleHost === 'NimBLE', 'BLE Host 必须为 NimBLE');
requireValue(contract.transport?.serviceNamePrefix === 'PROV_', '广播名前缀必须为 PROV_');
requireValue(contract.successCriteria?.level === 'DHCP_GOT_IP', '成功标准必须为 DHCP_GOT_IP');
requireValue(contract.successCriteria?.recommendedAppStatusTimeoutMs === 35000, 'APP 状态超时必须为 35000ms');
requireValue(contract.transport?.advertisingTimeoutSeconds === 300, 'BLE 配网总窗口必须为 300s');
requireValue(contract.lifecycle?.postSuccessBleWindowMs === 15000, '成功后 BLE 查询窗口必须为 15000ms');
requireValue(contract.officialEndpoints?.authoritativeStatusEndpoint === 'prov-ctrl', '权威状态端点必须为 prov-ctrl');
requireValue(contract.officialEndpoints?.capabilities?.includes('wifi_prov'), '固件必须提供 wifi_prov capability');
requireValue(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    contract.transport?.primaryServiceUuid ?? '',
  ),
  'primaryServiceUuid 必须是标准 128-bit UUID',
);

if (process.argv.includes('--production')) {
  const visit = (value, fieldPath) => {
    if (typeof value === 'string' && (value.includes('TBD') || value.includes('PENDING'))) {
      errors.push(`生产契约仍有未冻结字段: ${fieldPath}=${value}`);
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
  requireValue(contract.status === 'PRODUCTION_READY', '生产检查要求 status=PRODUCTION_READY');
  requireValue(!contract.security?.developmentPoP, '生产契约不得包含 developmentPoP');
}

if (errors.length > 0) {
  errors.forEach((message) => console.error(`ERROR: ${message}`));
  process.exit(1);
}

console.log(`OK: BLE provisioning contract ${contract.contractVersion} (${process.argv.includes('--production') ? 'production' : 'first-integration'})`);
