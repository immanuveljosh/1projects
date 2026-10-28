import { execSync } from 'node:child_process';

const BASE_URL = 'https://creations-nvidia-reno-released.trycloudflare.com';
const WS_BASE_URL = BASE_URL.replace(/^https:/, 'wss:');
const WORKSPACE_ID = '11111111-1111-1111-1111-111111111111';

const results = [];

function record(name, pass, details) {
  results.push({ name, pass, details });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}: ${details}`);
}

async function run() {
  console.log(`Starting Remote Access Verification against: ${BASE_URL}\n`);

  // 1. Healthz probe
  try {
    const res = await fetch(`${BASE_URL}/healthz`);
    const text = await res.text();
    record('Public Healthz Probe', res.status === 200 && text.trim() === 'ok', `Status ${res.status}, body: "${text.trim()}"`);
  } catch (err) {
    record('Public Healthz Probe', false, err.message);
  }

  // 2. Tunnel config endpoint
  try {
    const res = await fetch(`${BASE_URL}/api/v1/tunnel-config`);
    const data = await res.json();
    const ok = res.status === 200 && data.status === 'online' && data.server_url === BASE_URL;
    record('Public Tunnel Config API', ok, `Status ${res.status}, server_url: ${data.server_url}, ws_url: ${data.ws_url}`);
  } catch (err) {
    record('Public Tunnel Config API', false, err.message);
  }

  // 3. Frontend SPA Root
  try {
    const res = await fetch(`${BASE_URL}/`);
    const html = await res.text();
    const hasRoot = html.includes('id="root"');
    const hasAssets = html.includes('/assets/');
    record('Frontend SPA Delivery', res.status === 200 && hasRoot && hasAssets, `Status ${res.status}, hasRoot=${hasRoot}, hasAssets=${hasAssets}`);
  } catch (err) {
    record('Frontend SPA Delivery', false, err.message);
  }

  // 4. CORS verification
  try {
    const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: 'OPTIONS',
      headers: {
        'Origin': BASE_URL,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type,Authorization'
      }
    });
    const allowOrigin = res.headers.get('access-control-allow-origin');
    const allowCreds = res.headers.get('access-control-allow-credentials');
    const ok = res.status === 200 && allowOrigin === BASE_URL && allowCreds === 'true';
    record('CORS Policy Verification', ok, `Origin=${allowOrigin}, Credentials=${allowCreds}`);
  } catch (err) {
    record('CORS Policy Verification', false, err.message);
  }

  // 5. Unauthenticated Login Rejection
  try {
    const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nonexistent_audit_user@example.com', password: 'WrongPassword123!' })
    });
    record('Auth Rejection (Bad Credentials)', res.status === 401, `Status: ${res.status} (expected 401)`);
  } catch (err) {
    record('Auth Rejection (Bad Credentials)', false, err.message);
  }

  // 6. Valid Authentication & Token Generation
  const testEmail = 'remote_access_audit@officechat.local';
  const testPassword = 'AuditPassword#2026!Secure';
  let token = null;

  try {
    // Try register first in case user doesn't exist
    await fetch(`${BASE_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
        full_name: 'Audit User',
        display_name: 'Auditor'
      })
    }).catch(() => {});

    // Now login
    const loginRes = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword })
    });
    const loginData = await loginRes.json();
    token = loginData.access_token;
    record('Authentication & Token Issuance', loginRes.status === 200 && Boolean(token), `HTTP ${loginRes.status}, token length=${token ? token.length : 0}`);
  } catch (err) {
    record('Authentication & Token Issuance', false, err.message);
  }

  // 7. Authenticated REST API calls
  if (token) {
    try {
      const meRes = await fetch(`${BASE_URL}/api/v1/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const meData = await meRes.json();
      const meOk = meRes.status === 200 && (meData.user?.email === testEmail || meData.email === testEmail);
      record('Authenticated Profile API (/auth/me)', meOk, `HTTP ${meRes.status}, email=${meData.user?.email || meData.email}`);
    } catch (err) {
      record('Authenticated Profile API (/auth/me)', false, err.message);
    }

    try {
      const chanRes = await fetch(`${BASE_URL}/api/v1/workspaces/${WORKSPACE_ID}/channels`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const chanData = await chanRes.json();
      const chanOk = chanRes.status === 200 && Array.isArray(chanData.channels);
      record('Channel Listing API (/channels)', chanOk, `HTTP ${chanRes.status}, channel count=${chanData.channels?.length}`);
    } catch (err) {
      record('Channel Listing API (/channels)', false, err.message);
    }
  }

  // 8. WebSocket unauthenticated rejection
  try {
    const wsUrl = `${WS_BASE_URL}/api/v1/ws?workspace_id=${WORKSPACE_ID}`;
    const unauthResult = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ closed: true, reason: 'timeout' }), 4000);
      try {
        const ws = new WebSocket(wsUrl);
        ws.onopen = () => {
          clearTimeout(timer);
          ws.close();
          resolve({ open: true });
        };
        ws.onerror = (e) => {
          clearTimeout(timer);
          resolve({ error: true });
        };
        ws.onclose = (e) => {
          clearTimeout(timer);
          resolve({ closed: true, code: e.code });
        };
      } catch (e) {
        clearTimeout(timer);
        resolve({ error: true });
      }
    });
    record('WebSocket Auth Enforcement', !unauthResult.open, `Unauthenticated connection was properly rejected/closed`);
  } catch (err) {
    record('WebSocket Auth Enforcement', false, err.message);
  }

  // 9. WebSocket authenticated handshake & connection
  if (token) {
    try {
      const wsUrl = `${WS_BASE_URL}/api/v1/ws?workspace_id=${WORKSPACE_ID}&token=${encodeURIComponent(token)}`;
      const authWsResult = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('WebSocket connection timed out')), 8000);
        const ws = new WebSocket(wsUrl);
        ws.onopen = () => {
          clearTimeout(timer);
          ws.close();
          resolve(true);
        };
        ws.onerror = (err) => {
          clearTimeout(timer);
          reject(new Error(`WebSocket error: ${err.message || 'connection failed'}`));
        };
      });
      record('Authenticated Secure WebSocket (WSS)', authWsResult, `Connected successfully to ${WS_BASE_URL}/api/v1/ws`);
    } catch (err) {
      record('Authenticated Secure WebSocket (WSS)', false, err.message);
    }
  }

  // 10. Clean up test user
  try {
    execSync(
      `"DELETE FROM users WHERE email = '${testEmail}';" | docker exec -i officechat-postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'`,
      { stdio: 'ignore', shell: 'powershell.exe' }
    );
    record('Test Data Cleanup', true, `Removed ${testEmail} from database`);
  } catch (err) {
    record('Test Data Cleanup', false, err.message);
  }

  console.log('\n--- Summary ---');
  const allPassed = results.every(r => r.pass);
  console.log(`Total Checks: ${results.length}, All Passed: ${allPassed}`);
}

run().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});

