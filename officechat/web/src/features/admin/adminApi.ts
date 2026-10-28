// API client for OfficeChat Admin Console
import { resolveApiUrl, discoverLatestTunnelUrl } from '../chat/chatApi';

const API_BASE = '/api/v1';

async function getAuthHeader(): Promise<Record<string, string>> {
  const token = localStorage.getItem('officechat_access_token');
  const workspaceId = localStorage.getItem('officechat_workspace_id');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (workspaceId && workspaceId !== 'ws_default_acme') {
    headers['X-Workspace-ID'] = workspaceId;
  }
  return headers;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const authHeaders = await getAuthHeader();
  const headers = {
    ...authHeaders,
    ...(options.headers || {}),
  };

  let res: Response;
  try {
    res = await fetch(resolveApiUrl(`${API_BASE}${endpoint}`), {
      ...options,
      headers,
    });
    if (res.status === 502 || res.status === 503 || res.status === 530) {
      await discoverLatestTunnelUrl({ forceExternal: true });
      res = await fetch(resolveApiUrl(`${API_BASE}${endpoint}`), {
        ...options,
        headers,
      });
    }
  } catch (networkErr) {
    try {
      await discoverLatestTunnelUrl({ forceExternal: true });
      res = await fetch(resolveApiUrl(`${API_BASE}${endpoint}`), {
        ...options,
        headers,
      });
    } catch {
      throw networkErr;
    }
  }

  if (!res.ok) {
    let errData: ApiError;
    try {
      errData = await res.json();
    } catch {
      errData = {
        error: {
          code: `HTTP_${res.status}`,
          message: res.statusText || 'An unexpected error occurred',
        },
      };
    }
    throw errData;
  }

  // Handle CSV or empty responses
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/csv')) {
    return (await res.blob()) as unknown as T;
  }

  if (res.status === 204) {
    return {} as T;
  }

  return await res.json();
}

export interface AdminMember {
  id: string;
  email: string;
  full_name: string;
  display_name: string;
  avatar_url: string;
  role: 'Owner' | 'Admin' | 'Member' | 'Guest' | string;
  department: string;
  account_state: 'active' | 'suspended' | 'deactivated';
  must_change_password: boolean;
  status: 'online' | 'away' | 'dnd' | 'offline';
  custom_status: string;
  joined_at: string;
  created_at: string;
}

export interface AdminMemberListResponse {
  members: AdminMember[];
  next_cursor?: string;
  has_more: boolean;
  total_count: number;
}

export interface CreateMemberRequest {
  email: string;
  full_name: string;
  display_name?: string;
  role?: string;
  department?: string;
  password?: string;
  must_change_password: boolean;
}

export interface CreateMemberResponse {
  member: AdminMember;
  generated_password?: string;
}

export interface UpdateMemberRequest {
  full_name?: string;
  display_name?: string;
  email?: string;
  department?: string;
  role?: string;
  account_state?: string;
}

export interface ResetPasswordRequest {
  admin_password: string;
  temporary_password?: string;
  must_change_password: boolean;
  force_logout: boolean;
}

export interface DeleteMemberRequest {
  admin_password: string;
  permanent: boolean;
  delete_messages: boolean;
  confirm_text?: string;
}

export interface ImportResult {
  total: number;
  succeeded: number;
  failed: number;
  errors: { row: number; email: string; error: string }[];
  created: CreateMemberResponse[];
}

export interface AdminChannel {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  topic: string;
  is_private: boolean;
  is_archived: boolean;
  is_announcement: boolean;
  member_count: number;
  created_by: string;
  creator_name: string;
  created_at: string;
  updated_at: string;
}

export interface AdminChannelMember {
  id: string;
  user_id: string;
  full_name: string;
  display_name: string;
  email: string;
  avatar_url: string;
  role: string;
  joined_at: string;
}

export interface AdminChannelDetail {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  topic: string;
  is_private: boolean;
  is_archived: boolean;
  is_announcement: boolean;
  member_count: number;
  created_by: string;
  creator_name: string;
  created_at: string;
  updated_at: string;
  members: AdminChannelMember[];
}

export interface AdminChannelListResponse {
  channels: AdminChannel[];
  next_cursor?: string;
  has_more: boolean;
  total_count: number;
}

export interface CreateChannelRequest {
  name: string;
  description?: string;
  topic?: string;
  is_private: boolean;
  is_announcement: boolean;
  initial_member_ids?: string[];
}

export interface UpdateChannelRequest {
  name?: string;
  description?: string;
  topic?: string;
  is_private?: boolean;
  is_archived?: boolean;
  is_announcement?: boolean;
}

export interface DeleteChannelRequest {
  confirm_text?: string;
  permanent: boolean;
}

export interface WorkspaceSettings {
  workspace_id: string;
  min_password_length: number;
  require_special_char: boolean;
  require_number: boolean;
  password_expiry_days: number;
  max_login_attempts: number;
  lockout_duration_mins: number;
  enforce_2fa: boolean;
  session_timeout_mins: number;
  retention_days: number;
  allow_guest_invites: boolean;
  updated_at: string;
}

export interface AuditLogItem {
  id: string;
  workspace_id: string;
  actor_id: string;
  actor_name: string;
  actor_email: string;
  action: string;
  target_type: string;
  target_id: string;
  before_state?: Record<string, any>;
  after_state?: Record<string, any>;
  details?: Record<string, any>;
  ip_address: string;
  user_agent: string;
  created_at: string;
  summary: string;
}

export interface AuditLogListResponse {
  logs: AuditLogItem[];
  next_cursor?: string;
  has_more: boolean;
  total_count: number;
}

/* ========================================================================
   API Client Functions
   ======================================================================== */

// Members
export async function getAdminMembers(params: {
  search?: string;
  role?: string;
  status?: string;
  account_state?: string;
  cursor?: string;
  limit?: number;
}): Promise<AdminMemberListResponse> {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.role) query.set('role', params.role);
  if (params.status) query.set('status', params.status);
  if (params.account_state) query.set('account_state', params.account_state);
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));

  return request<AdminMemberListResponse>(`/admin/members?${query.toString()}`);
}

export async function createAdminMember(data: CreateMemberRequest): Promise<CreateMemberResponse> {
  return request<CreateMemberResponse>('/admin/members', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateAdminMember(id: string, data: UpdateMemberRequest): Promise<AdminMember> {
  return request<AdminMember>(`/admin/members/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function resetMemberPassword(id: string, data: ResetPasswordRequest): Promise<{ temporary_password: string }> {
  return request<{ temporary_password: string }>(`/admin/members/${id}/reset-password`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function forceLogoutMember(id: string, adminPassword: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/admin/members/${id}/force-logout`, {
    method: 'POST',
    body: JSON.stringify({ admin_password: adminPassword }),
  });
}

export async function deleteAdminMember(id: string, data: DeleteMemberRequest): Promise<{ message: string }> {
  return request<{ message: string }>(`/admin/members/${id}`, {
    method: 'DELETE',
    body: JSON.stringify(data),
  });
}

export async function importMembersCSV(csvContent: string): Promise<ImportResult> {
  return request<ImportResult>('/admin/members/import', {
    method: 'POST',
    body: JSON.stringify({ csv_content: csvContent }),
  });
}

// Channels
export async function getAdminChannels(params: {
  search?: string;
  type?: string;
  is_archived?: boolean;
  cursor?: string;
  limit?: number;
}): Promise<AdminChannelListResponse> {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.type) query.set('type', params.type);
  if (params.is_archived !== undefined) query.set('is_archived', String(params.is_archived));
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));

  return request<AdminChannelListResponse>(`/admin/channels?${query.toString()}`);
}

export async function getAdminChannel(id: string): Promise<AdminChannelDetail> {
  return request<AdminChannelDetail>(`/admin/channels/${id}`);
}

export async function createAdminChannel(data: CreateChannelRequest): Promise<AdminChannel> {
  return request<AdminChannel>('/admin/channels', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateAdminChannel(id: string, data: UpdateChannelRequest): Promise<AdminChannel> {
  return request<AdminChannel>(`/admin/channels/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteAdminChannel(id: string, data: DeleteChannelRequest): Promise<{ message: string }> {
  return request<{ message: string }>(`/admin/channels/${id}`, {
    method: 'DELETE',
    body: JSON.stringify(data),
  });
}

export async function addChannelMembers(channelId: string, userIds: string[], role: string = 'Member'): Promise<{ message: string }> {
  return request<{ message: string }>(`/admin/channels/${channelId}/members`, {
    method: 'POST',
    body: JSON.stringify({ user_ids: userIds, role }),
  });
}

export async function removeChannelMember(channelId: string, userId: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/admin/channels/${channelId}/members?user_id=${userId}`, {
    method: 'DELETE',
  });
}

// Settings & Security
export async function getWorkspaceSettings(): Promise<WorkspaceSettings> {
  return request<WorkspaceSettings>('/admin/settings');
}

export async function updateWorkspaceSettings(data: Partial<WorkspaceSettings>): Promise<WorkspaceSettings> {
  return request<WorkspaceSettings>('/admin/settings', {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function emergencyLogout(adminPassword: string): Promise<{ message: string }> {
  return request<{ message: string }>('/admin/security/emergency-logout', {
    method: 'POST',
    body: JSON.stringify({ admin_password: adminPassword }),
  });
}

export async function changeOwnPassword(currentPassword: string, newPassword: string): Promise<{ message: string }> {
  return request<{ message: string }>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  });
}

// Audit Logs
export async function getAuditLogs(params: {
  actor_id?: string;
  action?: string;
  target?: string;
  start_date?: string;
  end_date?: string;
  cursor?: string;
  limit?: number;
}): Promise<AuditLogListResponse> {
  const query = new URLSearchParams();
  if (params.actor_id) query.set('actor_id', params.actor_id);
  if (params.action) query.set('action', params.action);
  if (params.target) query.set('target', params.target);
  if (params.start_date) query.set('start_date', params.start_date);
  if (params.end_date) query.set('end_date', params.end_date);
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));

  return request<AuditLogListResponse>(`/admin/audit-logs?${query.toString()}`);
}

export async function exportAuditLogsCSV(params: {
  actor_id?: string;
  action?: string;
  target?: string;
  start_date?: string;
  end_date?: string;
}): Promise<Blob> {
  const query = new URLSearchParams();
  query.set('format', 'csv');
  if (params.actor_id) query.set('actor_id', params.actor_id);
  if (params.action) query.set('action', params.action);
  if (params.target) query.set('target', params.target);
  if (params.start_date) query.set('start_date', params.start_date);
  if (params.end_date) query.set('end_date', params.end_date);

  return request<Blob>(`/admin/audit-logs?${query.toString()}`);
}
