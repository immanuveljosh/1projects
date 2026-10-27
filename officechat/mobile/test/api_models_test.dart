import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/data/remote/models/api_models.dart';

void main() {
  group('Api Models Deserialization & Serialization', () {
    test('UserResponse deserializes and serializes accurately', () {
      final json = {
        'id': 'usr-123',
        'email': 'alice@example.com',
        'full_name': 'Alice Smith',
        'display_name': 'Alice',
        'avatar_url': 'https://example.com/avatar.png',
        'role': 'Owner',
        'department': 'Engineering',
        'account_state': 'active',
        'must_change_password': false,
        'status': 'online',
        'custom_status': 'Coding',
        'created_at': '2026-10-27T10:00:00Z',
      };

      final user = UserResponse.fromJson(json);
      expect(user.id, 'usr-123');
      expect(user.email, 'alice@example.com');
      expect(user.fullName, 'Alice Smith');
      expect(user.role, 'Owner');
      expect(user.accountState, 'active');
      expect(user.mustChangePassword, false);

      final serialized = user.toJson();
      expect(serialized['id'], 'usr-123');
      expect(serialized['email'], 'alice@example.com');
      expect(serialized['role'], 'Owner');
    });

    test('AuthResponse deserializes correctly', () {
      final json = {
        'access_token': 'jwt_access',
        'refresh_token': 'jwt_refresh',
        'expires_in': 900,
        'user': {
          'id': 'usr-456',
          'email': 'bob@example.com',
          'full_name': 'Bob Jones',
          'role': 'Admin',
        },
      };

      final auth = AuthResponse.fromJson(json);
      expect(auth.accessToken, 'jwt_access');
      expect(auth.refreshToken, 'jwt_refresh');
      expect(auth.expiresIn, 900);
      expect(auth.user.fullName, 'Bob Jones');
      expect(auth.user.role, 'Admin');
    });

    test('DeviceTokenModel deserializes correctly', () {
      final json = {
        'id': 'dt-1',
        'user_id': 'usr-123',
        'workspace_id': 'ws-123',
        'token': 'fcm_token_abc',
        'platform': 'android',
        'created_at': '2026-10-27T10:00:00Z',
        'last_seen_at': '2026-10-27T10:00:00Z',
      };

      final token = DeviceTokenModel.fromJson(json);
      expect(token.token, 'fcm_token_abc');
      expect(token.platform, 'android');
      expect(token.userId, 'usr-123');
    });

    test('PollSummaryModel deserializes with options', () {
      final json = {
        'id': 'poll-1',
        'question': 'Best framework?',
        'is_closed': false,
        'created_by': 'usr-123',
        'total_votes': 15,
        'options': [
          {'id': 'opt-1', 'option_text': 'Flutter', 'order_index': 0, 'vote_count': 10},
          {'id': 'opt-2', 'option_text': 'React', 'order_index': 1, 'vote_count': 5},
        ],
      };

      final poll = PollSummaryModel.fromJson(json);
      expect(poll.question, 'Best framework?');
      expect(poll.options.length, 2);
      expect(poll.options[0].optionText, 'Flutter');
      expect(poll.options[0].voteCount, 10);
      expect(poll.totalVotes, 15);
    });

    test('TaskModel deserializes correctly', () {
      final json = {
        'id': 'task-1',
        'workspace_id': 'ws-1',
        'title': 'Implement push notification handlers',
        'description': 'Handle FCM background messages',
        'assigned_to': 'usr-123',
        'status': 'todo',
        'created_by': 'usr-admin',
        'created_at': '2026-10-27T10:00:00Z',
      };

      final task = TaskModel.fromJson(json);
      expect(task.title, 'Implement push notification handlers');
      expect(task.status, 'todo');
      expect(task.assignedTo, 'usr-123');
    });

    test('WorkspaceModel and WorkspaceInviteModel deserialize correctly', () {
      final wsJson = {
        'id': 'ws-100',
        'name': 'Acme Global',
        'slug': 'acme-global',
        'description': 'Main workspace',
        'owner_id': 'usr-123',
      };

      final ws = WorkspaceModel.fromJson(wsJson);
      expect(ws.name, 'Acme Global');
      expect(ws.slug, 'acme-global');

      final inviteJson = {
        'id': 'inv-1',
        'workspace_id': 'ws-100',
        'code': 'inv_xyz789',
        'role': 'Member',
        'max_uses': 5,
        'uses_count': 1,
        'created_by': 'usr-123',
      };

      final invite = WorkspaceInviteModel.fromJson(inviteJson);
      expect(invite.code, 'inv_xyz789');
      expect(invite.maxUses, 5);
      expect(invite.usesCount, 1);
    });
  });
}
