import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/data/remote/models/api_models.dart';
import 'package:mobile/features/auth/domain/auth_state.dart';
import 'package:mobile/features/workspace/presentation/workspace_controller.dart';

void main() {
  group('AuthState unit tests', () {
    test('initial auth state is correct', () {
      final state = AuthState.initial();
      expect(state.status, AuthStatus.initial);
      expect(state.user, isNull);
      expect(state.isLoading, isFalse);
    });

    test('authenticated auth state contains user', () {
      final user = UserResponse(
        id: 'usr-1',
        email: 'test@example.com',
        fullName: 'Test User',
        displayName: 'Tester',
        avatarUrl: '',
        role: 'Admin',
        createdAt: DateTime.now(),
      );

      final state = AuthState.authenticated(user);
      expect(state.status, AuthStatus.authenticated);
      expect(state.user, equals(user));
    });

    test('mustChangePassword auth state is tracked', () {
      final user = UserResponse(
        id: 'usr-2',
        email: 'temp@example.com',
        fullName: 'New User',
        displayName: 'Newbie',
        avatarUrl: '',
        role: 'Member',
        mustChangePassword: true,
        createdAt: DateTime.now(),
      );

      final state = AuthState.mustChangePassword(user);
      expect(state.status, AuthStatus.mustChangePassword);
      expect(state.user?.mustChangePassword, isTrue);
    });

    test('suspended auth state retains reason', () {
      final state = AuthState.suspended('Policy violation');
      expect(state.status, AuthStatus.suspended);
      expect(state.suspendedReason, 'Policy violation');
    });
  });

  group('WorkspaceState unit tests', () {
    test('activeWorkspace resolves accurately', () {
      final ws1 = WorkspaceModel(
        id: 'ws-1',
        name: 'Workspace One',
        slug: 'ws-1',
        ownerId: 'usr-1',
        createdAt: DateTime.now(),
      );
      final ws2 = WorkspaceModel(
        id: 'ws-2',
        name: 'Workspace Two',
        slug: 'ws-2',
        ownerId: 'usr-1',
        createdAt: DateTime.now(),
      );

      final stateWithActive = WorkspaceState(
        workspaces: [ws1, ws2],
        activeWorkspaceId: 'ws-2',
      );
      expect(stateWithActive.activeWorkspace?.id, 'ws-2');

      final stateDefault = WorkspaceState(
        workspaces: [ws1, ws2],
        activeWorkspaceId: null,
      );
      expect(stateDefault.activeWorkspace?.id, 'ws-1');
    });
  });
}
