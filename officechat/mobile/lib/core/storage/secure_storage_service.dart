import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

final secureStorageProvider = Provider<SecureStorageService>((ref) {
  return SecureStorageService();
});

class SecureStorageService {
  final FlutterSecureStorage _storage;

  SecureStorageService([FlutterSecureStorage? storage])
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
              iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
            );

  static const _keyAccessToken = 'officechat_access_token';
  static const _keyRefreshToken = 'officechat_refresh_token';
  static const _keyWorkspaceId = 'officechat_workspace_id';
  static const _keyUserId = 'officechat_user_id';
  static const _keyUserRole = 'officechat_user_role';
  static const _keyMustChangePassword = 'officechat_must_change_password';
  static const _keyBiometricEnabled = 'officechat_biometric_enabled';

  Future<void> saveAuthTokens({
    required String accessToken,
    required String refreshToken,
  }) async {
    await Future.wait([
      _storage.write(key: _keyAccessToken, value: accessToken),
      _storage.write(key: _keyRefreshToken, value: refreshToken),
    ]);
  }

  Future<String?> getAccessToken() => _storage.read(key: _keyAccessToken);
  Future<String?> getRefreshToken() => _storage.read(key: _keyRefreshToken);

  Future<void> saveWorkspaceId(String workspaceId) =>
      _storage.write(key: _keyWorkspaceId, value: workspaceId);
  Future<String?> getWorkspaceId() => _storage.read(key: _keyWorkspaceId);

  Future<void> saveUserId(String userId) =>
      _storage.write(key: _keyUserId, value: userId);
  Future<String?> getUserId() => _storage.read(key: _keyUserId);

  Future<void> saveUserRole(String role) =>
      _storage.write(key: _keyUserRole, value: role);
  Future<String?> getUserRole() => _storage.read(key: _keyUserRole);

  Future<void> setMustChangePassword(bool mustChange) =>
      _storage.write(key: _keyMustChangePassword, value: mustChange.toString());
  Future<bool> getMustChangePassword() async {
    final val = await _storage.read(key: _keyMustChangePassword);
    return val == 'true';
  }

  Future<void> setBiometricsEnabled(bool enabled) =>
      _storage.write(key: _keyBiometricEnabled, value: enabled.toString());
  Future<bool> getBiometricsEnabled() async {
    final val = await _storage.read(key: _keyBiometricEnabled);
    return val == 'true';
  }

  Future<void> clearAuth() async {
    await Future.wait([
      _storage.delete(key: _keyAccessToken),
      _storage.delete(key: _keyRefreshToken),
      _storage.delete(key: _keyWorkspaceId),
      _storage.delete(key: _keyUserId),
      _storage.delete(key: _keyUserRole),
      _storage.delete(key: _keyMustChangePassword),
    ]);
  }

  Future<void> wipeAll() => _storage.deleteAll();
}
