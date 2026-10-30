/**
 * OfficeChat Concurrency & Load Testing Harness
 * Configurable active users testing real-world office chat loads:
 * - Simultaneous WebSocket connection hold
 * - Concurrent message broadcasting and fan-out
 * - Message history retrieval latency (p50, p90, p99)
 * - Container resource monitoring (CPU, RAM, DB connections)
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';
import { execSync } from 'child_process';

const BASE_URL = (process.env.OFFICECHAT_URL || 'http://127.0.0.1').trim().replace(/\/$/, '');
const WORKSPACE_ID = '11111111-1111-1111-1111-111111111111';

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const reqHeaders = { ...headers };
    let postData = null;
    if (body && typeof body === 'object') {
      postData = JSON.stringify(body);
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const options = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: reqHeaders,
      timeout: 10000,
    };

    const start = performance.now();
    const req = lib.request(options, (res) => {
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        const duration = performance.now() - start;
        let json = null;
        try { json = JSON.parse(rawData); } catch {}
        resolve({
          status: res.statusCode,
          data: json,
          duration,
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout requesting ${path}`));
    });

    if (postData) req.write(postData);
    req.end();
  });
}

function connectWs(token, workspaceId) {
  return new Promise((resolve, reject) => {
    const wsBase = BASE_URL.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
    const wsUrl = `${wsBase}/api/v1/ws?workspace_id=${workspaceId}&token=${token}`;
    const ws = new WebSocket(wsUrl);

    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket connection timed out'));
    }, 8000);

    ws.onopen = () => {
      clearTimeout(timer);
      resolve(ws);
    };

    ws.onerror = (err) => {
      clearTimeout(timer);
      reject(new Error(`WebSocket error: ${err.message || 'failed'}`));
    };
  });
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return Math.round(sorted[Math.max(0, index)]);
}

function sampleDockerStats() {
  try {
    const raw = execSync('docker stats --no-stream --format "{{.Name}}: CPU={{.CPUPerc}}, MEM={{.MemUsage}}"', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return raw.trim().split('\n').filter(l => l.includes('officechat-'));
  } catch {
    return [];
  }
}

function sampleDbConnections() {
  try {
    const res = execSync(
      `"SELECT count(*) FROM pg_stat_activity WHERE datname='officechat';" | docker exec -i officechat-postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t'`,
      { encoding: 'utf8', shell: 'powershell.exe', stdio: ['pipe', 'pipe', 'ignore'] }
    );
    return parseInt(res.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

async function runBenchmark(concurrencyUsers, messagesPerUser = 5) {
  console.log(`\n======================================================`);
  console.log(`  RUNNING BENCHMARK: ${concurrencyUsers} CONCURRENT USERS`);
  console.log(`  Target: ${concurrencyUsers * messagesPerUser} total messages + history reads`);
  console.log(`======================================================`);

  const initialStats = sampleDockerStats();
  const initialDbConns = sampleDbConnections();
  console.log(`Initial DB Active Connections: ${initialDbConns}`);

  // 1. Setup a dedicated channel for this test tier
  const adminEmail = `load_admin_${Date.now()}@officechat.local`;
  const regAdmin = await request(
    'POST',
    '/api/v1/auth/register',
    {
      email: adminEmail,
      password: 'Password123!',
      full_name: 'Load Test Admin',
      workspace_id: WORKSPACE_ID,
    },
    { 'X-Forwarded-For': '10.0.0.1' }
  );
  if (!regAdmin.data || !regAdmin.data.access_token) {
    console.error('regAdmin failed:', regAdmin.status, regAdmin.data);
    throw new Error(`Admin registration failed: HTTP ${regAdmin.status}`);
  }
  const adminToken = regAdmin.data.access_token;

  const chName = `load-${concurrencyUsers}-${Date.now().toString().slice(-4)}`;
  const chRes = await request(
    'POST',
    `/api/v1/workspaces/${WORKSPACE_ID}/channels`,
    { name: chName, description: 'Load test channel' },
    { 'Authorization': `Bearer ${adminToken}`, 'X-Forwarded-For': '10.0.0.1' }
  );
  const channelId = chRes.data.id;

  // 2. Register and connect simulated concurrent users
  console.log(`Provisioning ${concurrencyUsers} simulated office users...`);
  const users = [];
  const authLatencies = [];
  const wsLatencies = [];

  for (let i = 0; i < concurrencyUsers; i++) {
    const workerIp = `10.0.${Math.floor(i / 200) + 1}.${(i % 200) + 1}`;
    const email = `load_u${i}_${Date.now()}@officechat.local`;
    const t0 = performance.now();
    const reg = await request(
      'POST',
      '/api/v1/auth/register',
      {
        email,
        password: 'Password123!',
        full_name: `Worker ${i + 1}`,
        workspace_id: WORKSPACE_ID,
      },
      { 'X-Forwarded-For': workerIp }
    );
    authLatencies.push(performance.now() - t0);

    if (!reg.data || !reg.data.access_token) {
      console.error(`Registration failed for ${email}: HTTP ${reg.status}`, reg.data);
      throw new Error(`Registration failed: HTTP ${reg.status} ${JSON.stringify(reg.data)}`);
    }

    const token = reg.data.access_token;
    await request(
      'POST',
      `/api/v1/channels/${channelId}/join`,
      {},
      { 'Authorization': `Bearer ${token}`, 'X-Forwarded-For': workerIp }
    );

    const wsStart = performance.now();
    const ws = await connectWs(token, WORKSPACE_ID);
    wsLatencies.push(performance.now() - wsStart);

    let receivedCount = 0;
    ws.onmessage = () => { receivedCount++; };

    users.push({ id: reg.data.user.id, email, token, ws, workerIp, getReceived: () => receivedCount });
  }

  console.log(`All ${concurrencyUsers} WebSocket connections established.`);

  // 3. Concurrent messaging & history loading
  const msgLatencies = [];
  const readLatencies = [];
  let totalErrors = 0;

  console.log(`Executing concurrent message broadcast & read bursts...`);
  const burstStart = performance.now();

  const workerPromises = users.map(async (u, idx) => {
    for (let m = 0; m < messagesPerUser; m++) {
      try {
        const msgRes = await request(
          'POST',
          `/api/v1/channels/${channelId}/messages`,
          { content: `Load message #${m + 1} from Worker ${idx + 1}` },
          { 'Authorization': `Bearer ${u.token}`, 'X-Forwarded-For': u.workerIp }
        );
        if (msgRes.status === 200 || msgRes.status === 201) {
          msgLatencies.push(msgRes.duration);
        } else {
          totalErrors++;
        }

        // Interleave history read
        const readRes = await request(
          'GET',
          `/api/v1/channels/${channelId}/messages?limit=20`,
          null,
          { 'Authorization': `Bearer ${u.token}`, 'X-Forwarded-For': u.workerIp }
        );
        if (readRes.status === 200) {
          readLatencies.push(readRes.duration);
        } else {
          totalErrors++;
        }
      } catch (err) {
        totalErrors++;
      }
    }
  });

  await Promise.all(workerPromises);
  const totalDurationSec = (performance.now() - burstStart) / 1000;

  // Let real-time events finish fan-out
  await new Promise(r => setTimeout(r, 1200));

  const peakStats = sampleDockerStats();
  const peakDbConns = sampleDbConnections();

  // Close WebSockets
  users.forEach(u => u.ws.close());

  // Cleanup DB
  try {
    execSync(
      `"DELETE FROM users WHERE email LIKE 'load_%@officechat.local';" | docker exec -i officechat-postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'`,
      { stdio: 'ignore', shell: 'powershell.exe' }
    );
  } catch {}

  const totalOps = msgLatencies.length + readLatencies.length;
  const throughput = Math.round(totalOps / totalDurationSec);

  const report = {
    concurrencyUsers,
    totalOperations: totalOps,
    totalErrors,
    errorRate: ((totalErrors / (totalOps + totalErrors || 1)) * 100).toFixed(2) + '%',
    durationSec: totalDurationSec.toFixed(2),
    throughputReqSec: throughput,
    authLatency: {
      p50: percentile(authLatencies, 50),
      p90: percentile(authLatencies, 90),
      p99: percentile(authLatencies, 99),
    },
    wsConnectLatency: {
      p50: percentile(wsLatencies, 50),
      p90: percentile(wsLatencies, 90),
      p99: percentile(wsLatencies, 99),
    },
    messageSendLatency: {
      p50: percentile(msgLatencies, 50),
      p90: percentile(msgLatencies, 90),
      p99: percentile(msgLatencies, 99),
    },
    historyReadLatency: {
      p50: percentile(readLatencies, 50),
      p90: percentile(readLatencies, 90),
      p99: percentile(readLatencies, 99),
    },
    dbConnections: {
      initial: initialDbConns,
      peak: peakDbConns,
    },
    containerResourceUsage: peakStats,
  };

  console.log(`\n--- BENCHMARK RESULTS (${concurrencyUsers} USERS) ---`);
  console.log(`Throughput: ${report.throughputReqSec} req/sec across ${report.totalOperations} ops`);
  console.log(`Error Rate: ${report.errorRate} (${totalErrors} errors)`);
  console.log(`Message Send Latency (ms): p50=${report.messageSendLatency.p50}ms, p90=${report.messageSendLatency.p90}ms, p99=${report.messageSendLatency.p99}ms`);
  console.log(`History Read Latency (ms): p50=${report.historyReadLatency.p50}ms, p90=${report.historyReadLatency.p90}ms, p99=${report.historyReadLatency.p99}ms`);
  console.log(`DB Active Connections: ${report.dbConnections.initial} -> ${report.dbConnections.peak}`);
  console.log(`Container Stats:`);
  peakStats.forEach(s => console.log(`   ${s}`));

  return report;
}

async function runAllTiers() {
  const summary = [];
  try {
    summary.push(await runBenchmark(10, 5));
    summary.push(await runBenchmark(30, 5));
    summary.push(await runBenchmark(60, 5));
  } catch (err) {
    console.error('Benchmark execution error:', err);
  }

  console.log('\n======================================================');
  console.log('              FINAL CAPACITY VERDICT                   ');
  console.log('======================================================');
  console.log(JSON.stringify(summary, null, 2));
}

runAllTiers();
