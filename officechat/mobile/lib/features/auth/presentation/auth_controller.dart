import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/errors/api_exception.dart';
import '../../../core/network/session_manager.dart';
import '../data/auth_repository.dart';
import '../domain/auth_state.dart';

final authControllerProvider = StateNotifierProvider<AuthController, AuthState>((ref) {
  final repository = ref.watch(authRepositoryProvider);
  final sessionManager = ref.watch(sessionManagerProvider);
  return AuthController(
    repository: repository,
    sessionManager: sessionManager,
  );
});

class AuthController extends StateNotifier<AuthState> {
  final AuthRepository _repository;
  final SessionManager _sessionManager;
  StreamSubscription<String>? _sessionSubscription;

  AuthController({
    required AuthRepository repository,
    required SessionManager sessionManager,
  })  : _repository = repository,
        _sessionManager = sessionManager,
        super(AuthState.initial()) {
    _init();
  }

  void _init() {
    _sessionSubscription = _sessionManager.onSessionTerminated.listen((reason) {
      if (reason.toLowerCase().contains('suspend') || reason.toLowerCase().contains('deactivat')) {
        state = AuthState.suspended(reason);
      } else {
        state = AuthState.unauthenticated(errorMessage: reason);
      }
    });

    checkAuth();
  }

  Future<void> checkAuth() async {
    state = state.copyWith(isLoading: true);
    try {
      final user = await _repository.restoreSession();
      if (user == null) {
        state = AuthState.unauthenticated();
        return;
      }

      if (user.accountState == 'suspended' || user.accountState == 'deactivated') {
        state = AuthState.suspended('Your account has been ${user.accountState}. Please contact your administrator.');
        return;
      }

      if (user.mustChangePassword) {
        state = AuthState.mustChangePassword(user);
        return;
      }

      state = AuthState.authenticated(user);
    } catch (_) {
      state = AuthState.unauthenticated();
    }
  }

  Future<bool> login(String email, String password) async {
    state = state.copyWith(isLoading: true, errorMessage: null);

    try {
      final response = await _repository.login(
        email: email.trim(),
        password: password,
      );

      final user = response.user;
      if (user.accountState == 'suspended' || user.accountState == 'deactivated') {
        state = AuthState.suspended('Your account has been ${user.accountState}. Please contact your administrator.');
        return false;
      }

      if (user.mustChangePassword) {
        state = AuthState.mustChangePassword(user);
        return true;
      }

      state = AuthState.authenticated(user);
      return true;
    } catch (e) {
      final message = _extractErrorMessage(e);
      state = AuthState.unauthenticated(errorMessage: message);
      return false;
    }
  }

  Future<bool> changePassword(String currentPassword, String newPassword) async {
    state = state.copyWith(isLoading: true, errorMessage: null);

    try {
      await _repository.changePassword(
        currentPassword: currentPassword,
        newPassword: newPassword,
      );

      final currentUser = state.user;
      if (currentUser != null) {
        // Updated user with mustChangePassword = false
        final updatedUser = currentUser.copyWith(mustChangePassword: false);
        state = AuthState.authenticated(updatedUser);
      } else {
        await checkAuth();
      }
      return true;
    } catch (e) {
      final message = _extractErrorMessage(e);
      state = state.copyWith(
        isLoading: false,
        errorMessage: message,
      );
      return false;
    }
  }

  Future<void> logout() async {
    state = state.copyWith(isLoading: true);
    await _repository.logout();
    state = AuthState.unauthenticated();
  }

  String _extractErrorMessage(dynamic error) {
    if (error is DioException) {
      if (error.response?.data is Map) {
        final data = error.response!.data as Map;
        if (data['error'] is Map) {
          final errMap = data['error'] as Map;
          return errMap['message']?.toString() ?? 'An unexpected error occurred.';
        }
        if (data['message'] != null) {
          return data['message'].toString();
        }
      }
      if (error.response?.statusCode == 401) {
        return 'Invalid email or password.';
      }
      if (error.type == DioExceptionType.connectionTimeout ||
          error.type == DioExceptionType.receiveTimeout) {
        return 'Connection timed out. Please check your network connection.';
      }
      if (error.type == DioExceptionType.connectionError) {
        return 'Cannot connect to server. Ensure backend is running.';
      }
    }
    if (error is ApiException) {
      return error.message;
    }
    return error.toString();
  }

  @override
  void dispose() {
    _sessionSubscription?.cancel();
    super.dispose();
  }
}
