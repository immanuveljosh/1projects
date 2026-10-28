/* ==========================================================================
   OfficeChat — Main Chat Real Backend API & WebSocket Client
   Strictly typed against existing Go REST endpoints under /api/v1
   ========================================================================== */

export interface BackendUser {
  id: string;
  email: string;
  full_name: string;
  display_name: string;
  avatar_url: string;
  role: string;
  department: string;
  account_state: string;
  must_change_password: boolean;
  status: 'online' | 'away' | 'dnd' | 'offline' | string;
  custom_status: string;
  created_at: string;
}

export interface BackendWorkspace {
  id: string;
  name: string;
  slug: string;
  description: string;
  logo_url: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface BackendWorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: 'Owner' | 'Admin' | 'Member' | 'Guest' | string;
  joined_at: string;
  updated_at: string;
  user?: BackendUser;
}

export interface BackendChannel {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  topic: string;
  is_private: boolean;
  is_archived: boolean;
  is_announcement: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  member_count?: number;
  is_member?: boolean;
  unread_count?: number;
}

export interface BackendDMGroup {
  id: string;
  workspace_id: string;
  is_group: boolean;
  name?: string;
  created_at: string;
  updated_at: string;
  members?: BackendUser[];
  unread_count?: number;
}

export interface BackendReactionSummary {
  emoji: string;
  count: number;
  user_ids: string[];
  has_reacted: boolean;
}

export interface BackendAttachment {
  id: string;
  message_id?: string;
  workspace_id: string;
  file_name: string;
  file_size: number;
  content_type: string;
  file_key: string;
  file_url: string;
  virus_scan_status: string;
  uploaded_by: string;
  created_at: string;
}

export interface BackendPollOption {
  id: string;
  option_text: string;
  order_index: number;
  vote_count: number;
}

export interface BackendPollSummary {
  id: string;
  question: string;
  is_closed: boolean;
  created_by: string;
  total_votes: number;
  options: BackendPollOption[];
  user_voted_id?: string;
  creator?: BackendUser;
}

export interface BackendMessage {
  id: string;
  workspace_id: string;
  channel_id?: string;
  dm_group_id?: string;
  sender_id: string;
  thread_id?: string;
  parent_id?: string;
  content: string;
  is_pinned: boolean;
  edited_at?: string;
  deleted_at?: string;
  created_at: string;
  updated_at: string;
  sender?: BackendUser;
  reactions?: BackendReactionSummary[];
  attachments?: BackendAttachment[];
  poll?: BackendPollSummary;
  reply_count?: number;
  last_reply_at?: string;
}

export interface PaginatedMessagesResponse {
  messages: BackendMessage[];
  next_cursor?: string;
  has_more: boolean;
}

export interface BackendTask {
  id: string;
  workspace_id: string;
  message_id?: string;
  title: string;
  description: string;
  assigned_to?: string;
  status: 'todo' | 'in_progress' | 'done';
  due_date?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  assignee?: BackendUser;
  creator?: BackendUser;
}

export interface BackendPresence {
  user_id: string;
  status: 'online' | 'away' | 'dnd' | 'offline';
  custom_status: string;
  status_updated_at?: string;
}

export interface BackendNotification {
  id: string;
  user_id: string;
  workspace_id: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  is_read: boolean;
  read_at?: string;
  created_at: string;
}

export interface WSIncomingEvent {
  type: string;
  workspace_id?: string;
  user_id?: string;
  payload: unknown;
  timestamp: string;
}

export interface TunnelConfigPayload {
  server_url: string;
  ws_url: string;
  discovery_url?: string;
  status: string;
  updated_at: string;
}

export interface TunnelConnectionState {
  status: 'connected' | 'discovering' | 'reconnecting' | 'error';
  activeServerUrl: string;
  latestTunnelUrl: string;
  discoveryEndpoint: string;
  retryAttempt: number;
  errorMessage: string | null;
  lastUpdatedAt: string | null;
}

export const PERMANENT_TUNNEL_DISCOVERY_URL =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_TUNNEL_CONFIG_URL ||
  'https://ntfy.sh/officechat-nithra-tunnel-8b4e91f2a3c7/json?poll=1&since=12h';

let activeServerBaseUrl = '';
let latestKnownTunnelUrl =
  (typeof window !== 'undefined' && localStorage.getItem('officechat_known_tunnel_url')) || '';

const tunnelListeners = new Set<(state: TunnelConnectionState) => void>();
let currentTunnelState: TunnelConnectionState = {
  status: 'connected',
  activeServerUrl: typeof window !== 'undefined' ? window.location.origin : '',
  latestTunnelUrl: latestKnownTunnelUrl,
  discoveryEndpoint: PERMANENT_TUNNEL_DISCOVERY_URL,
  retryAttempt: 0,
  errorMessage: null,
  lastUpdatedAt: null,
};

function notifyTunnelListeners(patch: Partial<TunnelConnectionState>) {
  currentTunnelState = { ...currentTunnelState, ...patch };
  tunnelListeners.forEach(listener => listener(currentTunnelState));
}

export function subscribeTunnelState(listener: (state: TunnelConnectionState) => void): () => void {
  tunnelListeners.add(listener);
  listener(currentTunnelState);
  return () => {
    tunnelListeners.delete(listener);
  };
}

export function getActiveServerBaseUrl(): string {
  return activeServerBaseUrl.replace(/\/$/, '');
}

export function setActiveServerBaseUrl(url: string) {
  const cleaned = url.trim().replace(/\/$/, '');
  activeServerBaseUrl = cleaned;
  if (cleaned) {
    latestKnownTunnelUrl = cleaned;
    try {
      localStorage.setItem('officechat_known_tunnel_url', cleaned);
    } catch {
      // ignore storage errors
    }
  }
  notifyTunnelListeners({
    activeServerUrl: cleaned || (typeof window !== 'undefined' ? window.location.origin : ''),
    latestTunnelUrl: latestKnownTunnelUrl,
  });
}

export function resolveApiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  const base = getActiveServerBaseUrl();
  return base ? `${base}${path}` : path;
}

export function getAuthenticatedFileUrl(fileKey: string): string {
  const token = localStorage.getItem('officechat_access_token') || '';
  const basePath = `/api/v1/files/${encodeURIComponent(fileKey)}`;
  const fullUrl = resolveApiUrl(basePath);
  if (!token) return fullUrl;
  const separator = fullUrl.includes('?') ? '&' : '?';
  return `${fullUrl}${separator}token=${encodeURIComponent(token)}`;
}

function parseDiscoveryResponseText(rawText: string): TunnelConfigPayload | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  // 1. Handle NDJSON from ntfy.sh (/json?poll=1&since=12h)
  const lines = trimmed
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]) as Record<string, unknown>;
      // Direct TunnelConfigPayload JSON
      if (typeof parsed.server_url === 'string' && parsed.server_url.startsWith('http')) {
        return parsed as unknown as TunnelConfigPayload;
      }
      // ntfy.sh envelope where parsed.message contains the JSON string
      if (typeof parsed.message === 'string' && parsed.message.includes('server_url')) {
        const inner = JSON.parse(parsed.message) as TunnelConfigPayload;
        if (inner && typeof inner.server_url === 'string' && inner.server_url.startsWith('http')) {
          return inner;
        }
      }
      // GitHub Gist API envelope (files['tunnel-config.json'].content)
      if (parsed.files && typeof parsed.files === 'object') {
        const files = parsed.files as Record<string, { content?: string }>;
        const gistContent = files['tunnel-config.json']?.content;
        if (gistContent) {
          const inner = JSON.parse(gistContent) as TunnelConfigPayload;
          if (inner && typeof inner.server_url === 'string' && inner.server_url.startsWith('http')) {
            return inner;
          }
        }
      }
    } catch {
      // continue checking earlier lines
    }
  }
  return null;
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 4500): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function discoverLatestTunnelUrl(options: { forceExternal?: boolean; retryAttempt?: number } = {}): Promise<{
  serverUrl: string;
  switched: boolean;
}> {
  const attempt = options.retryAttempt ?? currentTunnelState.retryAttempt;
  notifyTunnelListeners({
    status: 'discovering',
    retryAttempt: attempt,
    errorMessage: null,
  });

  // 1. Unless forced to external discovery, check current active server's /api/v1/tunnel-config first
  if (!options.forceExternal) {
    try {
      const localRes = await fetchWithTimeout(resolveApiUrl('/api/v1/tunnel-config'), { cache: 'no-store' }, 3000);
      if (localRes.ok) {
        const cfg = (await localRes.json()) as TunnelConfigPayload;
        if (cfg.server_url) {
          latestKnownTunnelUrl = cfg.server_url;
          try {
            localStorage.setItem('officechat_known_tunnel_url', cfg.server_url);
          } catch {
            // ignore
          }
        }
        notifyTunnelListeners({
          status: 'connected',
          latestTunnelUrl: latestKnownTunnelUrl,
          lastUpdatedAt: cfg.updated_at || new Date().toISOString(),
          retryAttempt: 0,
          errorMessage: null,
        });
        return {
          serverUrl: getActiveServerBaseUrl() || window.location.origin,
          switched: false,
        };
      }
    } catch {
      // Current origin is unreachable; proceed to external permanent discovery endpoint
    }
  }

  // 2. Query the permanent tunnel-independent configuration endpoint
  try {
    const extRes = await fetchWithTimeout(PERMANENT_TUNNEL_DISCOVERY_URL, { cache: 'no-store' }, 6000);
    if (!extRes.ok) {
      throw new Error(`Discovery endpoint returned HTTP ${extRes.status}`);
    }
    const rawText = await extRes.text();
    const discovered = parseDiscoveryResponseText(rawText);
    if (!discovered || !discovered.server_url) {
      throw new Error('No valid Quick Tunnel URL found in discovery configuration');
    }

    const candidateUrl = discovered.server_url.trim().replace(/\/$/, '');

    // Verify the discovered tunnel URL is reachable via CORS-enabled /api/v1/tunnel-config
    const probeRes = await fetchWithTimeout(`${candidateUrl}/api/v1/tunnel-config`, { cache: 'no-store' }, 5000);
    if (!probeRes.ok) {
      throw new Error(`Discovered tunnel ${candidateUrl} returned HTTP ${probeRes.status}`);
    }

    const currentOrigin = typeof window !== 'undefined' ? window.location.origin.replace(/\/$/, '') : '';
    const previousBase = getActiveServerBaseUrl() || currentOrigin;
    const switched = candidateUrl !== previousBase;

    if (candidateUrl === currentOrigin) {
      activeServerBaseUrl = '';
    } else {
      setActiveServerBaseUrl(candidateUrl);
    }

    latestKnownTunnelUrl = candidateUrl;
    try {
      localStorage.setItem('officechat_known_tunnel_url', candidateUrl);
    } catch {
      // ignore
    }

    notifyTunnelListeners({
      status: 'connected',
      activeServerUrl: candidateUrl,
      latestTunnelUrl: candidateUrl,
      lastUpdatedAt: discovered.updated_at || new Date().toISOString(),
      retryAttempt: 0,
      errorMessage: null,
    });

    return { serverUrl: candidateUrl, switched };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unable to reach tunnel configuration endpoint';
    notifyTunnelListeners({
      status: 'error',
      retryAttempt: attempt + 1,
      errorMessage: msg,
    });
    throw err;
  }
}

function getAuthHeaders(workspaceId?: string, includeJsonContentType = true): Record<string, string> {
  const token = localStorage.getItem('officechat_access_token');
  const headers: Record<string, string> = {};
  if (includeJsonContentType) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (workspaceId) {
    headers['X-Workspace-ID'] = workspaceId;
  }
  return headers;
}

async function apiRequest<T>(url: string, options: RequestInit = {}, workspaceId?: string): Promise<T> {
  const isFormData = options.body instanceof FormData;
  const headers = {
    ...getAuthHeaders(workspaceId, !isFormData),
    ...(options.headers as Record<string, string> | undefined),
  };

  let res: Response;
  try {
    res = await fetch(resolveApiUrl(url), {
      ...options,
      headers,
      credentials: 'include',
    });
    // If Cloudflare Quick Tunnel returns 502/503/530 (tunnel rotated or restarted), discover latest URL and retry once
    if (res.status === 502 || res.status === 503 || res.status === 530) {
      await discoverLatestTunnelUrl({ forceExternal: true });
      res = await fetch(resolveApiUrl(url), {
        ...options,
        headers,
        credentials: 'include',
      });
    }
  } catch (networkErr) {
    // Network error (e.g. old Quick Tunnel hostname unreachable) — discover new tunnel URL and retry once
    try {
      await discoverLatestTunnelUrl({ forceExternal: true });
      res = await fetch(resolveApiUrl(url), {
        ...options,
        headers,
        credentials: 'include',
      });
    } catch {
      throw networkErr;
    }
  }

  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      errMsg = errJson.error?.message || errJson.message || errMsg;
    } catch {
      // ignore json parse failure
    }
    throw new Error(errMsg);
  }

  return res.json() as Promise<T>;
}

export const chatApi = {
  // 1. Auth & Profile
  getMe(): Promise<BackendUser> {
    return apiRequest<BackendUser>('/api/v1/auth/me');
  },

  updateProfile(payload: {
    full_name?: string;
    display_name?: string;
    avatar_url?: string;
    status?: string;
    custom_status?: string;
  }): Promise<BackendUser> {
    return apiRequest<BackendUser>('/api/v1/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  logout(): Promise<{ message: string }> {
    const refreshToken = localStorage.getItem('officechat_refresh_token') || '';
    return apiRequest<{ message: string }>('/api/v1/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  },

  changePassword(currentPassword: string, newPassword: string): Promise<{ message: string }> {
    return apiRequest<{ message: string }>('/api/v1/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    });
  },

  // 2. Workspaces & Members
  async listWorkspaces(): Promise<BackendWorkspace[]> {
    const data = await apiRequest<{ workspaces: BackendWorkspace[] }>('/api/v1/workspaces');
    return data.workspaces || [];
  },

  async listWorkspaceMembers(workspaceId: string): Promise<BackendWorkspaceMember[]> {
    const data = await apiRequest<{ members: BackendWorkspaceMember[] }>(
      `/api/v1/workspaces/${workspaceId}/members`,
      {},
      workspaceId
    );
    return data.members || [];
  },

  // 3. Channels
  async listChannels(workspaceId: string): Promise<BackendChannel[]> {
    const data = await apiRequest<{ channels: BackendChannel[] }>(
      `/api/v1/workspaces/${workspaceId}/channels`,
      {},
      workspaceId
    );
    return data.channels || [];
  },

  createChannel(
    workspaceId: string,
    payload: {
      name: string;
      description?: string;
      topic?: string;
      is_private?: boolean;
      is_announcement?: boolean;
    }
  ): Promise<BackendChannel> {
    return apiRequest<BackendChannel>(
      `/api/v1/workspaces/${workspaceId}/channels`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      workspaceId
    );
  },

  joinChannel(channelId: string, workspaceId?: string): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(
      `/api/v1/channels/${channelId}/join`,
      { method: 'POST' },
      workspaceId
    );
  },

  leaveChannel(channelId: string, workspaceId?: string): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(
      `/api/v1/channels/${channelId}/leave`,
      { method: 'POST' },
      workspaceId
    );
  },

  markChannelRead(channelId: string, workspaceId?: string): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(
      `/api/v1/channels/${channelId}/read`,
      { method: 'POST' },
      workspaceId
    );
  },

  // 4. Direct Messages
  async listDMs(workspaceId: string): Promise<BackendDMGroup[]> {
    const data = await apiRequest<{ dms: BackendDMGroup[] }>(
      `/api/v1/workspaces/${workspaceId}/dms`,
      {},
      workspaceId
    );
    return data.dms || [];
  },

  getOrCreateDM(workspaceId: string, targetUserIds: string[], name?: string): Promise<BackendDMGroup> {
    return apiRequest<BackendDMGroup>(
      `/api/v1/workspaces/${workspaceId}/dms`,
      {
        method: 'POST',
        body: JSON.stringify({ target_user_ids: targetUserIds, name }),
      },
      workspaceId
    );
  },

  markDMRead(dmGroupId: string, workspaceId?: string): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(
      `/api/v1/dms/${dmGroupId}/read`,
      { method: 'POST' },
      workspaceId
    );
  },

  // 5. Channel & DM Messages
  listChannelMessages(
    channelId: string,
    cursor = '',
    limit = 50,
    workspaceId?: string
  ): Promise<PaginatedMessagesResponse> {
    const q = new URLSearchParams({ limit: String(limit) });
    if (cursor) q.set('cursor', cursor);
    return apiRequest<PaginatedMessagesResponse>(
      `/api/v1/channels/${channelId}/messages?${q.toString()}`,
      {},
      workspaceId
    );
  },

  sendChannelMessage(
    channelId: string,
    payload: { content: string; parent_id?: string; attachment_ids?: string[] },
    workspaceId?: string
  ): Promise<BackendMessage> {
    return apiRequest<BackendMessage>(
      `/api/v1/channels/${channelId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      workspaceId
    );
  },

  listDMMessages(
    dmGroupId: string,
    cursor = '',
    limit = 50,
    workspaceId?: string
  ): Promise<PaginatedMessagesResponse> {
    const q = new URLSearchParams({ limit: String(limit) });
    if (cursor) q.set('cursor', cursor);
    return apiRequest<PaginatedMessagesResponse>(
      `/api/v1/dms/${dmGroupId}/messages?${q.toString()}`,
      {},
      workspaceId
    );
  },

  sendDMMessage(
    dmGroupId: string,
    payload: { content: string; parent_id?: string; attachment_ids?: string[] },
    workspaceId?: string
  ): Promise<BackendMessage> {
    return apiRequest<BackendMessage>(
      `/api/v1/dms/${dmGroupId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      workspaceId
    );
  },

  updateMessage(messageId: string, content: string, workspaceId?: string): Promise<BackendMessage> {
    return apiRequest<BackendMessage>(
      `/api/v1/messages/${messageId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ content }),
      },
      workspaceId
    );
  },

  deleteMessage(messageId: string, workspaceId?: string): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(
      `/api/v1/messages/${messageId}`,
      { method: 'DELETE' },
      workspaceId
    );
  },

  listThreadMessages(
    messageId: string,
    workspaceId?: string
  ): Promise<{ parent_id: string; messages: BackendMessage[] }> {
    return apiRequest<{ parent_id: string; messages: BackendMessage[] }>(
      `/api/v1/messages/${messageId}/thread`,
      {},
      workspaceId
    );
  },

  // 6. Reactions & Pins
  addReaction(messageId: string, emoji: string, workspaceId?: string): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(
      `/api/v1/messages/${messageId}/reactions`,
      {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      },
      workspaceId
    );
  },

  removeReaction(messageId: string, emoji: string, workspaceId?: string): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(
      `/api/v1/messages/${messageId}/reactions?emoji=${encodeURIComponent(emoji)}`,
      { method: 'DELETE' },
      workspaceId
    );
  },

  pinMessage(messageId: string, workspaceId?: string): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(
      `/api/v1/messages/${messageId}/pin`,
      { method: 'POST' },
      workspaceId
    );
  },

  unpinMessage(messageId: string, workspaceId?: string): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(
      `/api/v1/messages/${messageId}/pin`,
      { method: 'DELETE' },
      workspaceId
    );
  },

  // 7. Files, Search & Presence
  async uploadFile(workspaceId: string, file: File): Promise<BackendAttachment> {
    const formData = new FormData();
    formData.append('file', file);
    const data = await apiRequest<{ attachment: BackendAttachment }>(
      `/api/v1/workspaces/${workspaceId}/files/upload`,
      {
        method: 'POST',
        body: formData,
      },
      workspaceId
    );
    return data.attachment;
  },

  async getPresence(workspaceId: string): Promise<BackendPresence[]> {
    const data = await apiRequest<{ presence: BackendPresence[] }>(
      `/api/v1/workspaces/${workspaceId}/presence`,
      {},
      workspaceId
    );
    return data.presence || [];
  },

  async searchWorkspace(
    workspaceId: string,
    query: string
  ): Promise<{ messages: BackendMessage[]; attachments: BackendAttachment[] }> {
    const data = await apiRequest<{ messages: BackendMessage[]; attachments: BackendAttachment[] }>(
      `/api/v1/workspaces/${workspaceId}/search?q=${encodeURIComponent(query)}`,
      {},
      workspaceId
    );
    return {
      messages: data.messages || [],
      attachments: data.attachments || [],
    };
  },

  // 8. Polls
  createPoll(
    payload: {
      question: string;
      options: string[];
      channel_id?: string;
      dm_group_id?: string;
      message_id?: string;
    },
    workspaceId?: string
  ): Promise<BackendPollSummary> {
    return apiRequest<BackendPollSummary>(
      '/api/v1/polls',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      workspaceId
    );
  },

  votePoll(pollId: string, optionId: string, workspaceId?: string): Promise<BackendPollSummary> {
    return apiRequest<BackendPollSummary>(
      `/api/v1/polls/${pollId}/vote`,
      {
        method: 'POST',
        body: JSON.stringify({ option_id: optionId }),
      },
      workspaceId
    );
  },

  closePoll(pollId: string, workspaceId?: string): Promise<BackendPollSummary> {
    return apiRequest<BackendPollSummary>(
      `/api/v1/polls/${pollId}/close`,
      { method: 'POST' },
      workspaceId
    );
  },

  // 9. Tasks
  async listTasks(workspaceId: string): Promise<BackendTask[]> {
    const data = await apiRequest<{ tasks: BackendTask[] }>(
      `/api/v1/workspaces/${workspaceId}/tasks`,
      {},
      workspaceId
    );
    return data.tasks || [];
  },

  createTask(
    payload: {
      workspace_id: string;
      title: string;
      description?: string;
      message_id?: string;
      assigned_to?: string;
      due_date?: string;
    }
  ): Promise<BackendTask> {
    return apiRequest<BackendTask>(
      '/api/v1/tasks',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      payload.workspace_id
    );
  },

  updateTask(
    taskId: string,
    payload: {
      title?: string;
      description?: string;
      assigned_to?: string;
      status?: 'todo' | 'in_progress' | 'done';
      due_date?: string;
    },
    workspaceId?: string
  ): Promise<BackendTask> {
    return apiRequest<BackendTask>(
      `/api/v1/tasks/${taskId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      },
      workspaceId
    );
  },

  completeTask(taskId: string, workspaceId?: string): Promise<BackendTask> {
    return apiRequest<BackendTask>(
      `/api/v1/tasks/${taskId}/complete`,
      { method: 'POST' },
      workspaceId
    );
  },

  // 10. Notifications
  async listNotifications(workspaceId?: string): Promise<BackendNotification[]> {
    const data = await apiRequest<{ notifications: BackendNotification[] }>(
      '/api/v1/notifications',
      {},
      workspaceId
    );
    return data.notifications || [];
  },
};

export function buildWebSocketUrl(workspaceId: string): string {
  const token = localStorage.getItem('officechat_access_token') || '';
  const params = new URLSearchParams();
  if (workspaceId) params.set('workspace_id', workspaceId);
  if (token) params.set('token', token);

  const activeBase = getActiveServerBaseUrl();
  if (activeBase) {
    const wsBase = activeBase.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
    return `${wsBase}/api/v1/ws?${params.toString()}`;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/v1/ws?${params.toString()}`;
}

