import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    sdk_snapshot_sync: {
      executor: 'constant-vus',
      vus: 50,
      duration: '30s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<200', 'p(99)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.FLAGSHIP_URL || 'http://localhost:3000';
const SDK_KEY = __ENV.FLAGSHIP_SDK_KEY || 'fs_prod_com_9f44c1d8a7e2';

export default function () {
  const res = http.get(`${BASE_URL}/api/v1/sdk/snapshot`, {
    headers: { 'X-FlagShip-SDK-Key': SDK_KEY },
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
    'contains flags array': (r) => r.json('flags') !== undefined,
  });

  sleep(0.2);
}
