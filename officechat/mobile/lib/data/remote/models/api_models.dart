import 'package:equatable/equatable.dart';

class UserResponse extends Equatable {
  final String id;
  final String email;
  final String fullName;
  final String displayName;
  final String avatarUrl;
  final String role;
  final String department;
  final String accountState;
  final bool mustChangePassword;
  final String status;
  final String customStatus;
  final DateTime createdAt;

  const UserResponse({
    required this.id,
    required this.email,
    required this.fullName,
    required this.displayName,
    required this.avatarUrl,
    required this.role,
    this.department = '',
    this.accountState = 'active',
    this.mustChangePassword = false,
    this.status = 'offline',
    this.customStatus = '',
    required this.createdAt,
  });

  factory UserResponse.fromJson(Map<String, dynamic> json) {
    return UserResponse(
      id: json['id']?.toString() ?? '',
      email: json['email']?.toString() ?? '',
      fullName: json['full_name']?.toString() ?? '',
      displayName: json['display_name']?.toString() ?? '',
      avatarUrl: json['avatar_url']?.toString() ?? '',
      role: json['role']?.toString() ?? 'user',
      department: json['department']?.toString() ?? '',
      accountState: json['account_state']?.toString() ?? 'active',
      mustChangePassword: json['must_change_password'] == true,
      status: json['status']?.toString() ?? 'offline',
      customStatus: json['custom_status']?.toString() ?? '',
      createdAt: json['created_at'] != null
          ? DateTime.tryParse(json['created_at'].toString()) ?? DateTime.now()
          : DateTime.now(),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'email': email,
        'full_name': fullName,
        'display_name': displayName,
        'avatar_url': avatarUrl,
        'role': role,
        'department': department,
        'account_state': accountState,
        'must_change_password': mustChangePassword,
        'status': status,
        'custom_status': customStatus,
        'created_at': createdAt.toIso8601String(),
      };

  UserResponse copyWith({
    String? id,
    String? email,
    String? fullName,
    String? displayName,
    String? avatarUrl,
    String? role,
    String? department,
    String? accountState,
    bool? mustChangePassword,
    String? status,
    String? customStatus,
    DateTime? createdAt,
  }) {
    return UserResponse(
      id: id ?? this.id,
      email: email ?? this.email,
      fullName: fullName ?? this.fullName,
      displayName: displayName ?? this.displayName,
      avatarUrl: avatarUrl ?? this.avatarUrl,
      role: role ?? this.role,
      department: department ?? this.department,
      accountState: accountState ?? this.accountState,
      mustChangePassword: mustChangePassword ?? this.mustChangePassword,
      status: status ?? this.status,
      customStatus: customStatus ?? this.customStatus,
      createdAt: createdAt ?? this.createdAt,
    );
  }

  @override
  List<Object?> get props => [id, email, fullName, role, accountState, mustChangePassword, status];
}

class AuthResponse extends Equatable {
  final UserResponse user;
  final String accessToken;
  final String refreshToken;
  final int expiresIn;

  const AuthResponse({
    required this.user,
    required this.accessToken,
    required this.refreshToken,
    required this.expiresIn,
  });

  factory AuthResponse.fromJson(Map<String, dynamic> json) {
    return AuthResponse(
      user: UserResponse.fromJson(json['user'] as Map<String, dynamic>? ?? {}),
      accessToken: json['access_token']?.toString() ?? '',
      refreshToken: json['refresh_token']?.toString() ?? '',
      expiresIn: json['expires_in'] is int ? json['expires_in'] as int : 900,
    );
  }

  @override
  List<Object?> get props => [user, accessToken, refreshToken, expiresIn];
}

class WorkspaceModel extends Equatable {
  final String id;
  final String name;
  final String slug;
  final String description;
  final String logoUrl;
  final String ownerId;
  final DateTime createdAt;

  const WorkspaceModel({
    required this.id,
    required this.name,
    required this.slug,
    this.description = '',
    this.logoUrl = '',
    required this.ownerId,
    required this.createdAt,
  });

  factory WorkspaceModel.fromJson(Map<String, dynamic> json) {
    return WorkspaceModel(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      slug: json['slug']?.toString() ?? '',
      description: json['description']?.toString() ?? '',
      logoUrl: json['logo_url']?.toString() ?? '',
      ownerId: json['owner_id']?.toString() ?? '',
      createdAt: json['created_at'] != null
          ? DateTime.tryParse(json['created_at'].toString()) ?? DateTime.now()
          : DateTime.now(),
    );
  }

  @override
  List<Object?> get props => [id, name, slug, ownerId];
}

class WorkspaceMemberModel extends Equatable {
  final String id;
  final String workspaceId;
  final String userId;
  final String role;
  final DateTime joinedAt;
  final UserResponse? user;

  const WorkspaceMemberModel({
    required this.id,
    required this.workspaceId,
    required this.userId,
    required this.role,
    required this.joinedAt,
    this.user,
  });

  factory WorkspaceMemberModel.fromJson(Map<String, dynamic> json) {
    return WorkspaceMemberModel(
      id: json['id']?.toString() ?? '',
      workspaceId: json['workspace_id']?.toString() ?? '',
      userId: json['user_id']?.toString() ?? '',
      role: json['role']?.toString() ?? 'Member',
      joinedAt: json['joined_at'] != null
          ? DateTime.tryParse(json['joined_at'].toString()) ?? DateTime.now()
          : DateTime.now(),
      user: json['user'] != null && json['user'] is Map<String, dynamic>
          ? UserResponse.fromJson(json['user'] as Map<String, dynamic>)
          : null,
    );
  }

  @override
  List<Object?> get props => [id, workspaceId, userId, role];
}

class WorkspaceInviteModel extends Equatable {
  final String id;
  final String workspaceId;
  final String code;
  final String email;
  final String role;
  final int maxUses;
  final int usesCount;
  final DateTime expiresAt;
  final String createdBy;

  const WorkspaceInviteModel({
    required this.id,
    required this.workspaceId,
    required this.code,
    this.email = '',
    required this.role,
    required this.maxUses,
    required this.usesCount,
    required this.expiresAt,
    required this.createdBy,
  });

  factory WorkspaceInviteModel.fromJson(Map<String, dynamic> json) {
    return WorkspaceInviteModel(
      id: json['id']?.toString() ?? '',
      workspaceId: json['workspace_id']?.toString() ?? '',
      code: json['code']?.toString() ?? '',
      email: json['email']?.toString() ?? '',
      role: json['role']?.toString() ?? 'Member',
      maxUses: (json['max_uses'] as num?)?.toInt() ?? 1,
      usesCount: (json['uses_count'] as num?)?.toInt() ?? 0,
      expiresAt: json['expires_at'] != null
          ? DateTime.tryParse(json['expires_at'].toString()) ?? DateTime.now()
          : DateTime.now(),
      createdBy: json['created_by']?.toString() ?? '',
    );
  }

  @override
  List<Object?> get props => [id, workspaceId, code, role, maxUses, usesCount];
}

class ChannelModel extends Equatable {
  final String id;
  final String workspaceId;
  final String name;
  final String description;
  final String topic;
  final bool isPrivate;
  final bool isArchived;
  final bool isAnnouncement;
  final int memberCount;
  final bool isMember;
  final int unreadCount;

  const ChannelModel({
    required this.id,
    required this.workspaceId,
    required this.name,
    this.description = '',
    this.topic = '',
    this.isPrivate = false,
    this.isArchived = false,
    this.isAnnouncement = false,
    this.memberCount = 0,
    this.isMember = false,
    this.unreadCount = 0,
  });

  factory ChannelModel.fromJson(Map<String, dynamic> json) {
    return ChannelModel(
      id: json['id']?.toString() ?? '',
      workspaceId: json['workspace_id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      description: json['description']?.toString() ?? '',
      topic: json['topic']?.toString() ?? '',
      isPrivate: json['is_private'] == true,
      isArchived: json['is_archived'] == true,
      isAnnouncement: json['is_announcement'] == true,
      memberCount: (json['member_count'] as num?)?.toInt() ?? 0,
      isMember: json['is_member'] == true,
      unreadCount: (json['unread_count'] as num?)?.toInt() ?? 0,
    );
  }

  @override
  List<Object?> get props => [id, workspaceId, name, isPrivate, isMember, unreadCount];
}

class ReactionSummaryModel extends Equatable {
  final String emoji;
  final int count;
  final bool hasReacted;

  const ReactionSummaryModel({
    required this.emoji,
    required this.count,
    required this.hasReacted,
  });

  factory ReactionSummaryModel.fromJson(Map<String, dynamic> json) {
    return ReactionSummaryModel(
      emoji: json['emoji']?.toString() ?? '',
      count: (json['count'] as num?)?.toInt() ?? 0,
      hasReacted: json['has_reacted'] == true,
    );
  }

  @override
  List<Object?> get props => [emoji, count, hasReacted];
}

class AttachmentModel extends Equatable {
  final String id;
  final String? messageId;
  final String workspaceId;
  final String fileName;
  final int fileSize;
  final String contentType;
  final String fileKey;
  final String fileUrl;

  const AttachmentModel({
    required this.id,
    this.messageId,
    required this.workspaceId,
    required this.fileName,
    required this.fileSize,
    required this.contentType,
    required this.fileKey,
    required this.fileUrl,
  });

  factory AttachmentModel.fromJson(Map<String, dynamic> json) {
    return AttachmentModel(
      id: json['id']?.toString() ?? '',
      messageId: json['message_id']?.toString(),
      workspaceId: json['workspace_id']?.toString() ?? '',
      fileName: json['file_name']?.toString() ?? '',
      fileSize: (json['file_size'] as num?)?.toInt() ?? 0,
      contentType: json['content_type']?.toString() ?? '',
      fileKey: json['file_key']?.toString() ?? '',
      fileUrl: json['file_url']?.toString() ?? '',
    );
  }

  @override
  List<Object?> get props => [id, workspaceId, fileName, fileUrl];
}

class MessageModel extends Equatable {
  final String id;
  final String workspaceId;
  final String? channelId;
  final String? dmGroupId;
  final String senderId;
  final String? parentId;
  final String content;
  final bool isPinned;
  final DateTime? editedAt;
  final DateTime createdAt;
  final UserResponse? sender;
  final List<ReactionSummaryModel> reactions;
  final List<AttachmentModel> attachments;
  final int replyCount;

  const MessageModel({
    required this.id,
    required this.workspaceId,
    this.channelId,
    this.dmGroupId,
    required this.senderId,
    this.parentId,
    required this.content,
    this.isPinned = false,
    this.editedAt,
    required this.createdAt,
    this.sender,
    this.reactions = const [],
    this.attachments = const [],
    this.replyCount = 0,
  });

  factory MessageModel.fromJson(Map<String, dynamic> json) {
    return MessageModel(
      id: json['id']?.toString() ?? '',
      workspaceId: json['workspace_id']?.toString() ?? '',
      channelId: json['channel_id']?.toString(),
      dmGroupId: json['dm_group_id']?.toString(),
      senderId: json['sender_id']?.toString() ?? '',
      parentId: json['parent_id']?.toString(),
      content: json['content']?.toString() ?? '',
      isPinned: json['is_pinned'] == true,
      editedAt: json['edited_at'] != null ? DateTime.tryParse(json['edited_at'].toString()) : null,
      createdAt: json['created_at'] != null
          ? DateTime.tryParse(json['created_at'].toString()) ?? DateTime.now()
          : DateTime.now(),
      sender: json['sender'] != null && json['sender'] is Map<String, dynamic>
          ? UserResponse.fromJson(json['sender'] as Map<String, dynamic>)
          : null,
      reactions: (json['reactions'] as List<dynamic>?)
              ?.map((e) => ReactionSummaryModel.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      attachments: (json['attachments'] as List<dynamic>?)
              ?.map((e) => AttachmentModel.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      replyCount: (json['reply_count'] as num?)?.toInt() ?? 0,
    );
  }

  @override
  List<Object?> get props => [id, workspaceId, channelId, dmGroupId, content, isPinned, createdAt];
}

class PaginatedMessagesModel {
  final List<MessageModel> messages;
  final String? nextCursor;
  final bool hasMore;

  const PaginatedMessagesModel({
    required this.messages,
    this.nextCursor,
    required this.hasMore,
  });

  factory PaginatedMessagesModel.fromJson(Map<String, dynamic> json) {
    return PaginatedMessagesModel(
      messages: (json['messages'] as List<dynamic>?)
              ?.map((e) => MessageModel.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      nextCursor: json['next_cursor']?.toString(),
      hasMore: json['has_more'] == true,
    );
  }
}

class DirectMessageGroupModel extends Equatable {
  final String id;
  final String workspaceId;
  final bool isGroup;
  final String name;
  final List<UserResponse> members;
  final int unreadCount;
  final DateTime updatedAt;

  const DirectMessageGroupModel({
    required this.id,
    required this.workspaceId,
    required this.isGroup,
    this.name = '',
    this.members = const [],
    this.unreadCount = 0,
    required this.updatedAt,
  });

  factory DirectMessageGroupModel.fromJson(Map<String, dynamic> json) {
    return DirectMessageGroupModel(
      id: json['id']?.toString() ?? '',
      workspaceId: json['workspace_id']?.toString() ?? '',
      isGroup: json['is_group'] == true,
      name: json['name']?.toString() ?? '',
      members: (json['members'] as List<dynamic>?)
              ?.map((e) => UserResponse.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      unreadCount: (json['unread_count'] as num?)?.toInt() ?? 0,
      updatedAt: json['updated_at'] != null
          ? DateTime.tryParse(json['updated_at'].toString()) ?? DateTime.now()
          : DateTime.now(),
    );
  }

  @override
  List<Object?> get props => [id, workspaceId, isGroup, name, unreadCount];
}

class PollOptionModel extends Equatable {
  final String id;
  final String optionText;
  final int orderIndex;
  final int voteCount;

  const PollOptionModel({
    required this.id,
    required this.optionText,
    required this.orderIndex,
    required this.voteCount,
  });

  factory PollOptionModel.fromJson(Map<String, dynamic> json) {
    return PollOptionModel(
      id: json['id']?.toString() ?? '',
      optionText: json['option_text']?.toString() ?? '',
      orderIndex: (json['order_index'] as num?)?.toInt() ?? 0,
      voteCount: (json['vote_count'] as num?)?.toInt() ?? 0,
    );
  }

  @override
  List<Object?> get props => [id, optionText, orderIndex, voteCount];
}

class PollSummaryModel extends Equatable {
  final String id;
  final String question;
  final bool isClosed;
  final String createdBy;
  final int totalVotes;
  final List<PollOptionModel> options;
  final String? userVotedId;
  final UserResponse? creator;

  const PollSummaryModel({
    required this.id,
    required this.question,
    required this.isClosed,
    required this.createdBy,
    required this.totalVotes,
    required this.options,
    this.userVotedId,
    this.creator,
  });

  factory PollSummaryModel.fromJson(Map<String, dynamic> json) {
    return PollSummaryModel(
      id: json['id']?.toString() ?? '',
      question: json['question']?.toString() ?? '',
      isClosed: json['is_closed'] == true,
      createdBy: json['created_by']?.toString() ?? '',
      totalVotes: (json['total_votes'] as num?)?.toInt() ?? 0,
      options: (json['options'] as List<dynamic>?)
              ?.map((e) => PollOptionModel.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      userVotedId: json['user_voted_id']?.toString(),
      creator: json['creator'] != null && json['creator'] is Map<String, dynamic>
          ? UserResponse.fromJson(json['creator'] as Map<String, dynamic>)
          : null,
    );
  }

  @override
  List<Object?> get props => [id, question, isClosed, totalVotes, userVotedId];
}

class TaskModel extends Equatable {
  final String id;
  final String workspaceId;
  final String? messageId;
  final String title;
  final String description;
  final String? assignedTo;
  final String status;
  final DateTime? dueDate;
  final String createdBy;
  final DateTime createdAt;
  final UserResponse? creator;
  final UserResponse? assignee;

  const TaskModel({
    required this.id,
    required this.workspaceId,
    this.messageId,
    required this.title,
    this.description = '',
    this.assignedTo,
    required this.status,
    this.dueDate,
    required this.createdBy,
    required this.createdAt,
    this.creator,
    this.assignee,
  });

  factory TaskModel.fromJson(Map<String, dynamic> json) {
    return TaskModel(
      id: json['id']?.toString() ?? '',
      workspaceId: json['workspace_id']?.toString() ?? '',
      messageId: json['message_id']?.toString(),
      title: json['title']?.toString() ?? '',
      description: json['description']?.toString() ?? '',
      assignedTo: json['assigned_to']?.toString(),
      status: json['status']?.toString() ?? 'todo',
      dueDate: json['due_date'] != null ? DateTime.tryParse(json['due_date'].toString()) : null,
      createdBy: json['created_by']?.toString() ?? '',
      createdAt: json['created_at'] != null
          ? DateTime.tryParse(json['created_at'].toString()) ?? DateTime.now()
          : DateTime.now(),
      creator: json['creator'] != null && json['creator'] is Map<String, dynamic>
          ? UserResponse.fromJson(json['creator'] as Map<String, dynamic>)
          : null,
      assignee: json['assignee'] != null && json['assignee'] is Map<String, dynamic>
          ? UserResponse.fromJson(json['assignee'] as Map<String, dynamic>)
          : null,
    );
  }

  @override
  List<Object?> get props => [id, workspaceId, title, status, assignedTo, dueDate];
}

class NotificationModel extends Equatable {
  final String id;
  final String userId;
  final String workspaceId;
  final String type;
  final String title;
  final String body;
  final Map<String, dynamic> data;
  final bool isRead;
  final DateTime createdAt;

  const NotificationModel({
    required this.id,
    required this.userId,
    required this.workspaceId,
    required this.type,
    required this.title,
    required this.body,
    this.data = const {},
    required this.isRead,
    required this.createdAt,
  });

  factory NotificationModel.fromJson(Map<String, dynamic> json) {
    return NotificationModel(
      id: json['id']?.toString() ?? '',
      userId: json['user_id']?.toString() ?? '',
      workspaceId: json['workspace_id']?.toString() ?? '',
      type: json['type']?.toString() ?? '',
      title: json['title']?.toString() ?? '',
      body: json['body']?.toString() ?? '',
      data: json['data'] is Map<String, dynamic> ? json['data'] as Map<String, dynamic> : {},
      isRead: json['is_read'] == true,
      createdAt: json['created_at'] != null
          ? DateTime.tryParse(json['created_at'].toString()) ?? DateTime.now()
          : DateTime.now(),
    );
  }

  @override
  List<Object?> get props => [id, userId, workspaceId, type, title, isRead];
}

class DeviceTokenModel extends Equatable {
  final String id;
  final String userId;
  final String? workspaceId;
  final String token;
  final String platform;
  final DateTime createdAt;
  final DateTime lastSeenAt;

  const DeviceTokenModel({
    required this.id,
    required this.userId,
    this.workspaceId,
    required this.token,
    required this.platform,
    required this.createdAt,
    required this.lastSeenAt,
  });

  factory DeviceTokenModel.fromJson(Map<String, dynamic> json) {
    return DeviceTokenModel(
      id: json['id']?.toString() ?? '',
      userId: json['user_id']?.toString() ?? '',
      workspaceId: json['workspace_id']?.toString(),
      token: json['token']?.toString() ?? '',
      platform: json['platform']?.toString() ?? 'android',
      createdAt: json['created_at'] != null
          ? DateTime.tryParse(json['created_at'].toString()) ?? DateTime.now()
          : DateTime.now(),
      lastSeenAt: json['last_seen_at'] != null
          ? DateTime.tryParse(json['last_seen_at'].toString()) ?? DateTime.now()
          : DateTime.now(),
    );
  }

  @override
  List<Object?> get props => [id, userId, token, platform];
}
