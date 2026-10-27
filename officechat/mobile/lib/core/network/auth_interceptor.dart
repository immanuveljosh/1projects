import 'dart:async';
import 'package:dio/dio.dart';
import '../config/env_config.dart';
import '../storage/secure_storage_service.dart';

typedef OnSessionTerminated = void Function(String reason);

class AuthInterceptor extends QueuedInterceptor {
  final SecureStorageService _storage;
  final Dio _dio;
  final OnSessionTerminated? onSessionTerminated;

  bool _isRefreshing = false;
  final List<Completer<void>> _pendingRequests = [];

  AuthInterceptor({
    required SecureStorageService storage,
    required Dio dio,
    this.onSessionTerminated,
  })  : _storage = storage,
        _dio = dio;

  @override
  void onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    final token = await _storage.getAccessToken();
    final workspaceId = await _storage.getWorkspaceId();

    if (token != null && token.isNotEmpty) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    if (workspaceId != null && workspaceId.isNotEmpty) {
      options.headers['X-Workspace-ID'] = workspaceId;
    }

    options.headers['Accept'] = 'application/json';
    options.headers['Content-Type'] = 'application/json';

    return handler.next(options);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    final statusCode = err.response?.statusCode;
    final data = err.response?.data;

    // 1. Account Suspended / Deactivated handling
    if (statusCode == 403 && data is Map) {
      final errorMap = data['error'];
      final errorCode = (errorMap is Map) ? errorMap['code']?.toString() : null;
      if (errorCode == 'ACCOUNT_SUSPENDED' || errorCode == 'ACCOUNT_DEACTIVATED') {
        await _storage.clearAuth();
        onSessionTerminated?.call('Your account has been suspended or deactivated.');
        return handler.next(err);
      }
    }

    // 2. Token Expired (401) and Refresh Flow
    final isAuthEndpoint = err.requestOptions.path.contains('/auth/login') ||
        err.requestOptions.path.contains('/auth/refresh') ||
        err.requestOptions.path.contains('/auth/register');

    if (statusCode == 401 && !isAuthEndpoint) {
      if (_isRefreshing) {
        final completer = Completer<void>();
        _pendingRequests.add(completer);
        await completer.future;

        // Retry with newly refreshed token
        try {
          final res = await _retry(err.requestOptions);
          return handler.resolve(res);
        } catch (e) {
          if (e is DioException) {
            return handler.next(e);
          }
          return handler.next(err);
        }
      }

      _isRefreshing = true;

      try {
        final refreshToken = await _storage.getRefreshToken();
        if (refreshToken == null || refreshToken.isEmpty) {
          throw Exception('No refresh token available');
        }

        // Call backend token refresh endpoint
        final refreshDio = Dio(BaseOptions(baseUrl: EnvConfig.instance.apiBaseUrl));
        final response = await refreshDio.post(
          '/auth/refresh',
          data: {'refresh_token': refreshToken},
        );

        if (response.statusCode == 200 && response.data != null) {
          final newAccessToken = response.data['access_token']?.toString();
          final newRefreshToken = response.data['refresh_token']?.toString();

          if (newAccessToken != null && newRefreshToken != null) {
            await _storage.saveAuthTokens(
              accessToken: newAccessToken,
              refreshToken: newRefreshToken,
            );

            // Release queued requests
            for (final completer in _pendingRequests) {
              completer.complete();
            }
            _pendingRequests.clear();
            _isRefreshing = false;

            // Retry original failed request
            final retryResponse = await _retry(err.requestOptions);
            return handler.resolve(retryResponse);
          }
        }
        throw Exception('Token refresh response invalid');
      } catch (refreshErr) {
        // Refresh failed (e.g. token revoked, emergency logout)
        for (final completer in _pendingRequests) {
          completer.completeError(refreshErr);
        }
        _pendingRequests.clear();
        _isRefreshing = false;

        await _storage.clearAuth();
        onSessionTerminated?.call('Your session has expired. Please log in again.');
        return handler.next(err);
      }
    }

    return handler.next(err);
  }

  Future<Response<dynamic>> _retry(RequestOptions requestOptions) async {
    final token = await _storage.getAccessToken();
    final workspaceId = await _storage.getWorkspaceId();

    final options = Options(
      method: requestOptions.method,
      headers: {
        ...requestOptions.headers,
        if (token != null) 'Authorization': 'Bearer $token',
        if (workspaceId != null) 'X-Workspace-ID': workspaceId,
      },
    );

    return _dio.request<dynamic>(
      requestOptions.path,
      data: requestOptions.data,
      queryParameters: requestOptions.queryParameters,
      options: options,
    );
  }
}
