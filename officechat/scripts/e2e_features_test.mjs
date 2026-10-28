/**
 * End-to-End Core Features Verification Test
 * Tests:
 * 1. Authentication & Token Lifecycle
 * 2. Channel Creation
 * 3. Real-time WebSocket Messaging between 2 users
 * 4. Threaded Replies
 * 5. Emoji Reactions
 * 6. Poll Creation & Voting
 * 7. Task Creation & Status Updates
 * 8. File Upload & Authenticated Token Download
 * 9. Global Full-Text Search
 * 10. Password Change API
 * 11. Profile & Presence Update
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';

const BASE_URL = process.env.OFFICECHAT_URL || 'http://127.0.0.1';
const WORKSPACE_ID = '11111111-1111-1111-1111-111111111111';

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const reqHeaders = { ...headers };
    let postData = null;
    if (body && typeof body === 'object' && !(body instanceof Buffer)) {
      postData = JSON.stringify(body);
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    } else if (body instanceof Buffer) {
      postData = body;
      reqHeaders['Content-Length'] = body.length;
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

    const req = lib.request(options, (res) => {
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(rawData);
        } catch {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: json || rawData,
          raw: rawData,
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
      reject(new Error(`WebSocket error: ${err.message || 'connection failed'}`));
    };
  });
}

async function run() {
  console.log(`Starting E2E Core Chat Features Suite against: ${BASE_URL}\n`);
  let passed = 0;
  let total = 0;

  function assert(desc, condition, details = '') {
    total++;
    if (condition) {
      passed++;
      console.log(`  [PASS] ${desc}`);
    } else {
      console.error(`  [FAIL] ${desc} - ${details}`);
    }
  }

  const userA = {
    email: `e2e_alice_${Date.now()}@officechat.local`,
    password: 'Password123!',
    full_name: 'Alice E2E Tester',
    workspace_id: WORKSPACE_ID,
  };

  const userB = {
    email: `e2e_bob_${Date.now()}@officechat.local`,
    password: 'Password123!',
    full_name: 'Bob E2E Tester',
    workspace_id: WORKSPACE_ID,
  };

  try {
    // 1. Register User A and User B
    const regARes = await request('POST', '/api/v1/auth/register', userA);
    assert('User A Registration', regARes.status === 201 || regARes.status === 200, JSON.stringify(regARes.data));
    const tokenA = regARes.data.access_token;
    const userAId = regARes.data.user.id;

    const regBRes = await request('POST', '/api/v1/auth/register', userB);
    assert('User B Registration', regBRes.status === 201 || regBRes.status === 200, JSON.stringify(regBRes.data));
    const tokenB = regBRes.data.access_token;
    const userBId = regBRes.data.user.id;

    // 2. Channel Creation
    const channelName = `e2e-ch-${Date.now().toString().slice(-6)}`;
    const chRes = await request(
      'POST',
      `/api/v1/workspaces/${WORKSPACE_ID}/channels`,
      { name: channelName, description: 'E2E Test Channel', is_private: false },
      { 'Authorization': `Bearer ${tokenA}` }
    );
    assert('Channel Creation', chRes.status === 201 || chRes.status === 200, JSON.stringify(chRes.data));
    const channelId = chRes.data.id;

    // 3. User B joins the channel
    const joinRes = await request(
      'POST',
      `/api/v1/channels/${channelId}/join`,
      {},
      { 'Authorization': `Bearer ${tokenB}` }
    );
    assert('User B Join Channel', joinRes.status === 200, JSON.stringify(joinRes.data));

    // 4. WebSocket connection for User B to receive messages
    const wsB = await connectWs(tokenB, WORKSPACE_ID);
    assert('User B WebSocket Connected', !!wsB);

    let receivedMsg = null;
    wsB.onmessage = (event) => {
      try {
        const evt = JSON.parse(event.data);
        if (evt.type === 'message.new') {
          receivedMsg = evt.payload;
        }
      } catch {}
    };

    // 5. User A sends message in the channel
    const msgRes = await request(
      'POST',
      `/api/v1/channels/${channelId}/messages`,
      { content: 'Hello from Alice E2E test!' },
      { 'Authorization': `Bearer ${tokenA}` }
    );
    assert('User A Send Channel Message', msgRes.status === 201 || msgRes.status === 200, JSON.stringify(msgRes.data));
    const messageId = msgRes.data.id;

    // Wait a brief moment for WS frame delivery
    await new Promise(r => setTimeout(r, 600));
    assert('Real-time WS Delivery to User B', receivedMsg !== null && receivedMsg.content === 'Hello from Alice E2E test!');

    // 6. Thread reply by User B
    const replyRes = await request(
      'POST',
      `/api/v1/channels/${channelId}/messages`,
      { content: 'Replying in thread from Bob!', parent_id: messageId },
      { 'Authorization': `Bearer ${tokenB}` }
    );
    assert('Thread Reply Creation', replyRes.status === 201 || replyRes.status === 200, JSON.stringify(replyRes.data));

    // 7. Add Reaction
    const reactRes = await request(
      'POST',
      `/api/v1/messages/${messageId}/reactions`,
      { emoji: '🚀' },
      { 'Authorization': `Bearer ${tokenB}` }
    );
    assert('Reaction Addition', reactRes.status === 200 || reactRes.status === 201, JSON.stringify(reactRes.data));

    // 8. Create Poll
    const pollRes = await request(
      'POST',
      '/api/v1/polls',
      {
        question: 'What is our sprint goal?',
        options: ['Deliver pilot', 'Refactor backend', 'Write more docs'],
        channel_id: channelId,
        message_id: messageId,
      },
      { 'Authorization': `Bearer ${tokenA}` }
    );
    assert('Poll Creation', pollRes.status === 200 || pollRes.status === 201, JSON.stringify(pollRes.data));
    const pollId = pollRes.data.id;
    const optionId = pollRes.data.options[0]?.id;

    // 9. Vote on Poll
    if (pollId && optionId) {
      const voteRes = await request(
        'POST',
        `/api/v1/polls/${pollId}/vote`,
        { option_id: optionId },
        { 'Authorization': `Bearer ${tokenB}` }
      );
      assert('Poll Voting', voteRes.status === 200, JSON.stringify(voteRes.data));
    }

    // 10. Create Task
    const taskRes = await request(
      'POST',
      '/api/v1/tasks',
      {
        workspace_id: WORKSPACE_ID,
        title: 'Review production tunnel stability',
        description: 'Verify Quick Tunnel retry logic',
        assigned_to: userBId,
        status: 'todo',
      },
      { 'Authorization': `Bearer ${tokenA}` }
    );
    assert('Task Creation', taskRes.status === 200 || taskRes.status === 201, JSON.stringify(taskRes.data));
    const taskId = taskRes.data.id;

    // Complete Task
    if (taskId) {
      const compRes = await request(
        'POST',
        `/api/v1/tasks/${taskId}/complete`,
        {},
        { 'Authorization': `Bearer ${tokenB}` }
      );
      assert('Task Completion', compRes.status === 200, JSON.stringify(compRes.data));
    }

    // 11. File Upload (multipart/form-data)
    const boundary = '----WebKitFormBoundaryE2ETest' + Date.now();
    const fileContent = 'OfficeChat E2E sample file contents';
    const postBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test-document.txt"\r\nContent-Type: text/plain\r\n\r\n`),
      Buffer.from(fileContent),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const uploadRes = await request(
      'POST',
      `/api/v1/workspaces/${WORKSPACE_ID}/files/upload`,
      postBody,
      {
        'Authorization': `Bearer ${tokenA}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      }
    );
    assert('File Upload to Storage', uploadRes.status === 200 || uploadRes.status === 201, JSON.stringify(uploadRes.data));
    const uploadedKey = uploadRes.data?.attachment?.file_key;

    // 12. Authenticated Download via ?token= query parameter
    if (uploadedKey) {
      const dlRes = await request(
        'GET',
        `/api/v1/files/${encodeURIComponent(uploadedKey)}?token=${encodeURIComponent(tokenB)}`
      );
      assert('Authenticated File Download via Query Token', dlRes.status === 200 && dlRes.raw === fileContent);
    }

    // 13. Global Full-Text Search
    const searchRes = await request(
      'GET',
      `/api/v1/workspaces/${WORKSPACE_ID}/search?q=Alice`,
      null,
      { 'Authorization': `Bearer ${tokenB}` }
    );
    assert(
      'Global Workspace Search (Messages & Files)',
      searchRes.status === 200 && Array.isArray(searchRes.data?.messages) && searchRes.data.messages.length > 0,
      JSON.stringify(searchRes.data)
    );

    // 14. Password Change API
    const changePwRes = await request(
      'POST',
      '/api/v1/auth/change-password',
      {
        current_password: userA.password,
        new_password: 'NewStrongPassword456!',
      },
      { 'Authorization': `Bearer ${tokenA}` }
    );
    assert('Password Change API', changePwRes.status === 200, JSON.stringify(changePwRes.data));

    // Verify login with new password
    const loginNewRes = await request('POST', '/api/v1/auth/login', {
      email: userA.email,
      password: 'NewStrongPassword456!',
    });
    assert('Login with New Password', loginNewRes.status === 200, JSON.stringify(loginNewRes.data));

    // 15. Update Profile & Presence
    const profileRes = await request(
      'PATCH',
      '/api/v1/auth/me',
      {
        display_name: 'Alice In Tech',
        custom_status: 'Building cool features 🚀',
      },
      { 'Authorization': `Bearer ${loginNewRes.data.access_token}` }
    );
    assert('Profile & Custom Status Update', profileRes.status === 200, JSON.stringify(profileRes.data));

    // Cleanup WS
    if (wsB) wsB.close();

  } catch (err) {
    console.error('Test execution error:', err);
  } finally {
    // 16. Cleanup synthetic test accounts
    try {
      const { execSync } = await import('child_process');
      execSync(`docker exec -e PGPASSWORD=officechat_secure_pass_2026 officechat-postgres psql -U officechat -d officechat -c "DELETE FROM users WHERE email LIKE 'e2e_%@officechat.local';"`);
      console.log('  [PASS] Test Data Cleanup: Removed synthetic E2E accounts');
      total++;
      passed++;
    } catch (e) {
      console.warn('Cleanup warning:', e.message);
    }

    console.log(`\n--- Results: ${passed} / ${total} Checks Passed (${Math.round((passed / total) * 100)}%) ---`);
    if (passed === total) {
      process.exit(0);
    } else {
      process.exit(1);
    }
  }
}

run();
