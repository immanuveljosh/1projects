import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/storage/secure_storage_service.dart';
import '../../../data/remote/api_client.dart';
import '../../../data/remote/models/api_models.dart';

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  final storage = ref.watch(secureStorageProvider);
  return AuthRepository(apiClient: apiClient, storage: storage);
});

class AuthRepository {
  final ApiClient _apiClient;
  final SecureStorageService _storage;

  AuthRepository({
    required ApiClient apiClient,
    required SecureStorageService storage,
  })  : _apiClient = apiClient,
        _storage = storage;

  Future<AuthResponse> login({
    required String email,
    required String password,
  }) async {
    final response = await _apiClient.login(
      email: email,
      password: password,
    );

    await _persistSession(response);
    return response;
  }

  Future<AuthResponse> register({
    required String email,
    required String password,
    required String fullName,
  }) async {
    final response = await _apiClient.register(
      email: email,
      password: password,
      fullName: fullName,
    );

    await _persistSession(response);
    return response;
  }

  Future<UserResponse?> restoreSession() async {
    final token = await _storage.getAccessToken();
    if (token == null || token.isEmpty) {
      return null;
    }

    try {
      final user = await _apiClient.getMe();
      await _storage.saveUserId(user.id);
      await _storage.saveUserRole(user.role);
      await _storage.setMustChangePassword(user.mustChangePassword);
      return user;
    } catch (_) {
      // If restoring profile fails (e.g. revoked token), clear auth and return null
      await _storage.clearAuth();
      return null;
    }
  }

  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    await _apiClient.changePassword(
      currentPassword: currentPassword,
      newPassword: newPassword,
    );
    await _storage.setMustChangePassword(false);
  }

  Future<void> logout() async {
    try {
      final refreshToken = await _storage.getRefreshToken();
      if (refreshToken != null && refreshToken.isNotEmpty) {
        await _apiClient.logout(refreshToken);
      }
    } catch (_) {
      // Ignore network errors on logout
    } finally {
      await _storage.clearAuth();
    }
  }

  Future<void> _persistSession(AuthResponse response) async {
    await _storage.saveAuthTokens(
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
    );
    await _storage.saveUserId(response.user.id);
    await _storage.saveUserRole(response.user.role);
    await _storage.setMustChangePassword(response.user.mustChangePassword);
  }
}
