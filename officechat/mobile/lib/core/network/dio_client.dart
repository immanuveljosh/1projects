import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../config/env_config.dart';
import '../errors/api_exception.dart';
import '../storage/secure_storage_service.dart';
import 'auth_interceptor.dart';

import 'session_manager.dart';

final dioProvider = Provider<Dio>((ref) {
  final storage = ref.watch(secureStorageProvider);
  final sessionManager = ref.watch(sessionManagerProvider);
  return createDioClient(
    storage,
    onSessionTerminated: (reason) {
      sessionManager.notifyTerminated(reason);
    },
  );
});

Dio createDioClient(
  SecureStorageService storage, {
  OnSessionTerminated? onSessionTerminated,
}) {
  final dio = Dio(
    BaseOptions(
      baseUrl: EnvConfig.instance.apiBaseUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 15),
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    ),
  );

  dio.interceptors.addAll([
    AuthInterceptor(
      storage: storage,
      dio: dio,
      onSessionTerminated: onSessionTerminated,
    ),
    LogInterceptor(
      requestHeader: false,
      responseHeader: false,
      requestBody: true,
      responseBody: true,
      logPrint: (obj) {
        // Safe logging without exposing raw JWT tokens
        final str = obj.toString();
        if (str.contains('Bearer ') || str.contains('refresh_token')) {
          // Token redacted
          return;
        }
      },
    ),
  ]);

  return dio;
}

extension DioExceptionX on DioException {
  ApiException toApiException() {
    if (response?.data is Map<String, dynamic>) {
      return ApiException.fromJson(
        response!.data as Map<String, dynamic>,
        response?.statusCode,
      );
    }
    return ApiException.network(message);
  }
}
