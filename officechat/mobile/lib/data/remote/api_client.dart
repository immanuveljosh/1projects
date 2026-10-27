import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/network/dio_client.dart';
import 'models/api_models.dart';

final apiClientProvider = Provider<ApiClient>((ref) {
  final dio = ref.watch(dioProvider);
  return ApiClient(dio);
});

class ApiClient {
  final Dio _dio;

  ApiClient(this._dio);

  // ---------------------------------------------------------
  // Auth & Profile
  // ---------------------------------------------------------

  Future<AuthResponse> login({
    required String email,
    required String password,
  }) async {
    final res = await _dio.post('/auth/login', data: {
      'email': email,
      'password': password,
    });
    return AuthResponse.fromJson(res.data as Map<String, dynamic>);
  }

  Future<AuthResponse> register({
    required String email,
    required String password,
    required String fullName,
  }) async {
    final res = await _dio.post('/auth/register', data: {
      'email': email,
      'password': password,
      'full_name': fullName,
    });
    return AuthResponse.fromJson(res.data as Map<String, dynamic>);
  }

  Future<AuthResponse> refreshToken(String refreshToken) async {
    final res = await _dio.post('/auth/refresh', data: {
      'refresh_token': refreshToken,
    });
    return AuthResponse.fromJson(res.data as Map<String, dynamic>);
  }

  Future<void> logout(String refreshToken) async {
    await _dio.post('/auth/logout', data: {
      'refresh_token': refreshToken,
    });
  }

  Future<UserResponse> getMe() async {
    final res = await _dio.get('/auth/me');
    return UserResponse.fromJson(res.data as Map<String, dynamic>);
  }

  Future<UserResponse> updateProfile({
    String? fullName,
    String? displayName,
    String? avatarUrl,
    String? status,
    String? customStatus,
  }) async {
    final data = <String, dynamic>{};
    if (fullName != null) data['full_name'] = fullName;
    if (displayName != null) data['display_name'] = displayName;
    if (avatarUrl != null) data['avatar_url'] = avatarUrl;
    if (status != null) data['status'] = status;
    if (customStatus != null) data['custom_status'] = customStatus;

    final res = await _dio.patch('/auth/me', data: data);
    return UserResponse.fromJson(res.data as Map<String, dynamic>);
  }

  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    await _dio.post('/auth/change-password', data: {
      'current_password': currentPassword,
      'new_password': newPassword,
    });
  }

  // ---------------------------------------------------------
  // Notifications & Device Push Tokens (Gap 1)
  // ---------------------------------------------------------

  Future<DeviceTokenModel> registerDeviceToken({
    required String token,
    required String platform,
  }) async {
    final res = await _dio.post('/notifications/device-token', data: {
      'token': token,
      'platform': platform,
    });
    return DeviceTokenModel.fromJson(res.data as Map<String, dynamic>);
  }

  Future<void> deleteDeviceToken(String token) async {
    await _dio.delete(
      '/notifications/device-token',
      queryParameters: {'token': token},
    );
  }

  Future<List<NotificationModel>> listNotifications({int limit = 50}) async {
    final res = await _dio.get('/notifications', queryParameters: {'limit': limit});
    final rawList = res.data['notifications'] as List<dynamic>? ?? [];
    return rawList.map((e) => NotificationModel.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<void> markNotificationRead(String id) async {
    await _dio.patch('/notifications/$id/read');
  }

  Future<void> markAllNotificationsRead() async {
    await _dio.post('/notifications/read-all');
  }

  // ---------------------------------------------------------
  // Workspaces
  // ---------------------------------------------------------

  Future<List<WorkspaceModel>> listWorkspaces() async {
    final res = await _dio.get('/workspaces');
    final rawList = res.data['workspaces'] as List<dynamic>? ?? [];
    return rawList.map((e) => WorkspaceModel.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<WorkspaceModel> createWorkspace({
    required String name,
    String? slug,
    String? description,
  }) async {
    final res = await _dio.post('/workspaces', data: {
      'name': name,
      if (slug != null) 'slug': slug,
      if (description != null) 'description': description,
    });
    return WorkspaceModel.fromJson(res.data as Map<String, dynamic>);
  }

  Future<WorkspaceModel> getWorkspace(String workspaceId) async {
    final res = await _dio.get('/workspaces/$workspaceId');
    return WorkspaceModel.fromJson(res.data as Map<String, dynamic>);
  }

  Future<List<WorkspaceMemberModel>> listWorkspaceMembers(String workspaceId) async {
    final res = await _dio.get('/workspaces/$workspaceId/members');
    final rawList = res.data['members'] as List<dynamic>? ?? [];
    return rawList.map((e) => WorkspaceMemberModel.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<WorkspaceInviteModel> createWorkspaceInvite({
    required String workspaceId,
    String? email,
    String role = 'Member',
    int maxUses = 1,
  }) async {
    final res = await _dio.post('/workspaces/$workspaceId/invites', data: {
      if (email != null) 'email': email,
      'role': role,
      'max_uses': maxUses,
    });
    return WorkspaceInviteModel.fromJson(res.data as Map<String, dynamic>);
  }

  Future<WorkspaceModel> joinWorkspaceWithInvite(String code) async {
    final res = await _dio.post('/workspaces/join/$code');
    return WorkspaceModel.fromJson(res.data as Map<String, dynamic>);
  }

  Future<Map<String, String>> getPresence(String workspaceId) async {
    final res = await _dio.get('/workspaces/$workspaceId/presence');
    final rawList = res.data['presence'] as List<dynamic>? ?? [];
    final presenceMap = <String, String>{};
    for (final item in rawList) {
      if (item is Map) {
        final userId = item['user_id']?.toString();
        final status = item['status']?.toString();
        if (userId != null && status != null) {
          presenceMap[userId] = status;
        }
      }
    }
    return presenceMap;
  }

  // ---------------------------------------------------------
  // Channels
  // ---------------------------------------------------------

  Future<List<ChannelModel>> listChannels(String workspaceId) async {
    final res = await _dio.get('/workspaces/$workspaceId/channels');
    final rawList = res.data['channels'] as List<dynamic>? ?? [];
    return rawList.map((e) => ChannelModel.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<ChannelModel> createChannel({
    required String workspaceId,
    required String name,
    String description = '',
    String topic = '',
    bool isPrivate = false,
    bool isAnnouncement = false,
  }) async {
    final res = await _dio.post('/workspaces/$workspaceId/channels', data: {
      'name': name,
      'description': description,
      'topic': topic,
      'is_private': isPrivate,
      'is_announcement': isAnnouncement,
    });
    return ChannelModel.fromJson(res.data as Map<String, dynamic>);
  }

  Future<ChannelModel> getChannel(String channelId) async {
    final res = await _dio.get('/channels/$channelId');
    return ChannelModel.fromJson(res.data as Map<String, dynamic>);
  }

  Future<void> joinChannel(String channelId) async {
    await _dio.post('/channels/$channelId/join');
  }

  Future<void> leaveChannel(String channelId) async {
    await _dio.post('/channels/$channelId/leave');
  }

  // ---------------------------------------------------------
  // Channel Messages
  // ---------------------------------------------------------

  Future<PaginatedMessagesModel> listChannelMessages(
    String channelId, {
    String? cursor,
    int limit = 30,
  }) async {
    final queryParams = <String, dynamic>{'limit': limit};
    if (cursor != null && cursor.isNotEmpty) {
      queryParams['cursor'] = cursor;
    }
    final res = await _dio.get(
      '/channels/$channelId/messages',
      queryParameters: queryParams,
    );
    return PaginatedMessagesModel.fromJson(res.data as Map<String, dynamic>);
  }

  Future<MessageModel> sendChannelMessage({
    required String channelId,
    required String content,
    String? parentId,
    List<String>? attachmentIds,
  }) async {
    final res = await _dio.post('/channels/$channelId/messages', data: {
      'content': content,
      if (parentId != null) 'parent_id': parentId,
      if (attachmentIds != null) 'attachment_ids': attachmentIds,
    });
    return MessageModel.fromJson(res.data as Map<String, dynamic>);
  }

  Future<MessageModel> updateMessage({
    required String messageId,
    required String content,
  }) async {
    final res = await _dio.patch('/messages/$messageId', data: {
      'content': content,
    });
    return MessageModel.fromJson(res.data as Map<String, dynamic>);
  }

  Future<void> deleteMessage(String messageId) async {
    await _dio.delete('/messages/$messageId');
  }

  // ---------------------------------------------------------
  // Direct Messages
  // ---------------------------------------------------------

  Future<List<DirectMessageGroupModel>> listDMs(String workspaceId) async {
    final res = await _dio.get('/workspaces/$workspaceId/dms');
    final rawList = res.data['dms'] as List<dynamic>? ?? [];
    return rawList.map((e) => DirectMessageGroupModel.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<DirectMessageGroupModel> createDM({
    required String workspaceId,
    required List<String> targetUserIds,
    String? name,
  }) async {
    final res = await _dio.post('/workspaces/$workspaceId/dms', data: {
      'target_user_ids': targetUserIds,
      if (name != null) 'name': name,
    });
    return DirectMessageGroupModel.fromJson(res.data as Map<String, dynamic>);
  }

  Future<PaginatedMessagesModel> listDMMessages(
    String dmGroupId, {
    String? cursor,
    int limit = 30,
  }) async {
    final queryParams = <String, dynamic>{'limit': limit};
    if (cursor != null && cursor.isNotEmpty) {
      queryParams['cursor'] = cursor;
    }
    final res = await _dio.get(
      '/dms/$dmGroupId/messages',
      queryParameters: queryParams,
    );
    return PaginatedMessagesModel.fromJson(res.data as Map<String, dynamic>);
  }

  Future<MessageModel> sendDMMessage({
    required String dmGroupId,
    required String content,
    List<String>? attachmentIds,
  }) async {
    final res = await _dio.post('/dms/$dmGroupId/messages', data: {
      'content': content,
      if (attachmentIds != null) 'attachment_ids': attachmentIds,
    });
    return MessageModel.fromJson(res.data as Map<String, dynamic>);
  }

  // ---------------------------------------------------------
  // Reactions, Pins & Read States
  // ---------------------------------------------------------

  Future<void> addReaction({
    required String messageId,
    required String emoji,
  }) async {
    await _dio.post('/messages/$messageId/reactions', data: {'emoji': emoji});
  }

  Future<void> removeReaction({
    required String messageId,
    required String emoji,
  }) async {
    await _dio.delete(
      '/messages/$messageId/reactions',
      queryParameters: {'emoji': emoji},
    );
  }

  Future<void> pinMessage(String messageId) async {
    await _dio.post('/messages/$messageId/pin');
  }

  Future<void> unpinMessage(String messageId) async {
    await _dio.delete('/messages/$messageId/pin');
  }

  Future<List<MessageModel>> listChannelPins(String channelId) async {
    final res = await _dio.get('/channels/$channelId/pins');
    final rawList = res.data['pins'] as List<dynamic>? ?? [];
    return rawList.map((e) => MessageModel.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<List<MessageModel>> listDMPins(String dmGroupId) async {
    final res = await _dio.get('/dms/$dmGroupId/pins');
    final rawList = res.data['pins'] as List<dynamic>? ?? [];
    return rawList.map((e) => MessageModel.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<void> markChannelRead(String channelId) async {
    await _dio.post('/channels/$channelId/read');
  }

  Future<void> markDMRead(String dmGroupId) async {
    await _dio.post('/dms/$dmGroupId/read');
  }

  // ---------------------------------------------------------
  // Files & Search
  // ---------------------------------------------------------

  Future<AttachmentModel> uploadFile({
    required String workspaceId,
    required List<int> bytes,
    required String fileName,
  }) async {
    final formData = FormData.fromMap({
      'file': MultipartFile.fromBytes(bytes, filename: fileName),
    });
    final res = await _dio.post(
      '/workspaces/$workspaceId/files/upload',
      data: formData,
    );
    final attData = res.data['attachment'] as Map<String, dynamic>;
    return AttachmentModel.fromJson(attData);
  }

  Future<Map<String, dynamic>> search({
    required String workspaceId,
    required String query,
  }) async {
    final res = await _dio.get(
      '/workspaces/$workspaceId/search',
      queryParameters: {'q': query},
    );
    final rawMessages = res.data['messages'] as List<dynamic>? ?? [];
    final rawAttachments = res.data['attachments'] as List<dynamic>? ?? [];

    return {
      'messages': rawMessages.map((e) => MessageModel.fromJson(e as Map<String, dynamic>)).toList(),
      'attachments': rawAttachments.map((e) => AttachmentModel.fromJson(e as Map<String, dynamic>)).toList(),
    };
  }

  // ---------------------------------------------------------
  // Polls (Gap 3)
  // ---------------------------------------------------------

  Future<PollSummaryModel> createPoll({
    required String question,
    required List<String> options,
    String? channelId,
    String? dmGroupId,
    String? messageId,
  }) async {
    final res = await _dio.post('/polls', data: {
      'question': question,
      'options': options,
      if (channelId != null) 'channel_id': channelId,
      if (dmGroupId != null) 'dm_group_id': dmGroupId,
      if (messageId != null) 'message_id': messageId,
    });
    return PollSummaryModel.fromJson(res.data as Map<String, dynamic>);
  }

  Future<PollSummaryModel> getPoll(String pollId) async {
    final res = await _dio.get('/polls/$pollId');
    return PollSummaryModel.fromJson(res.data as Map<String, dynamic>);
  }

  Future<PollSummaryModel> votePoll({
    required String pollId,
    required String optionId,
  }) async {
    final res = await _dio.post('/polls/$pollId/vote', data: {
      'option_id': optionId,
    });
    return PollSummaryModel.fromJson(res.data as Map<String, dynamic>);
  }

  Future<PollSummaryModel> closePoll(String pollId) async {
    final res = await _dio.post('/polls/$pollId/close');
    return PollSummaryModel.fromJson(res.data as Map<String, dynamic>);
  }

  // ---------------------------------------------------------
  // Tasks (Gap 3)
  // ---------------------------------------------------------

  Future<TaskModel> createTask({
    required String workspaceId,
    required String title,
    String? description,
    String? messageId,
    String? assignedTo,
    DateTime? dueDate,
  }) async {
    final res = await _dio.post('/tasks', data: {
      'workspace_id': workspaceId,
      'title': title,
      if (description != null) 'description': description,
      if (messageId != null) 'message_id': messageId,
      if (assignedTo != null) 'assigned_to': assignedTo,
      if (dueDate != null) 'due_date': dueDate.toIso8601String(),
    });
    return TaskModel.fromJson(res.data as Map<String, dynamic>);
  }

  Future<List<TaskModel>> listTasks(
    String workspaceId, {
    String? status,
    String? assignedTo,
  }) async {
    final queryParams = <String, dynamic>{};
    if (status != null) queryParams['status'] = status;
    if (assignedTo != null) queryParams['assigned_to'] = assignedTo;

    final res = await _dio.get(
      '/workspaces/$workspaceId/tasks',
      queryParameters: queryParams,
    );
    final rawList = res.data['tasks'] as List<dynamic>? ?? [];
    return rawList.map((e) => TaskModel.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<TaskModel> updateTask({
    required String taskId,
    String? title,
    String? description,
    String? assignedTo,
    String? status,
    DateTime? dueDate,
  }) async {
    final data = <String, dynamic>{};
    if (title != null) data['title'] = title;
    if (description != null) data['description'] = description;
    if (assignedTo != null) data['assigned_to'] = assignedTo;
    if (status != null) data['status'] = status;
    if (dueDate != null) data['due_date'] = dueDate.toIso8601String();

    final res = await _dio.patch('/tasks/$taskId', data: data);
    return TaskModel.fromJson(res.data as Map<String, dynamic>);
  }

  Future<TaskModel> completeTask(String taskId) async {
    final res = await _dio.post('/tasks/$taskId/complete');
    return TaskModel.fromJson(res.data as Map<String, dynamic>);
  }
}
