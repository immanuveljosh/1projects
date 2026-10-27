class ApiException implements Exception {
  final String code;
  final String message;
  final int? statusCode;

  const ApiException({
    required this.code,
    required this.message,
    this.statusCode,
  });

  factory ApiException.fromJson(Map<String, dynamic> json, [int? statusCode]) {
    final errorObj = json['error'] as Map<String, dynamic>?;
    if (errorObj != null) {
      return ApiException(
        code: errorObj['code']?.toString() ?? 'UNKNOWN_ERROR',
        message: errorObj['message']?.toString() ?? 'An unexpected error occurred',
        statusCode: statusCode,
      );
    }
    return ApiException(
      code: 'UNKNOWN_ERROR',
      message: json['message']?.toString() ?? 'An unexpected error occurred',
      statusCode: statusCode,
    );
  }

  factory ApiException.network([String? message]) {
    return ApiException(
      code: 'NETWORK_ERROR',
      message: message ?? 'Network connection failed. Please check your internet.',
      statusCode: null,
    );
  }

  @override
  String toString() => 'ApiException(code: $code, message: $message, statusCode: $statusCode)';
}
