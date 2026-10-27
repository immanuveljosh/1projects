import 'package:equatable/equatable.dart';
import '../../../data/remote/models/api_models.dart';

enum AuthStatus {
  initial,
  unauthenticated,
  authenticated,
  mustChangePassword,
  suspended,
}

class AuthState extends Equatable {
  final AuthStatus status;
  final UserResponse? user;
  final bool isLoading;
  final String? errorMessage;
  final String? suspendedReason;

  const AuthState({
    required this.status,
    this.user,
    this.isLoading = false,
    this.errorMessage,
    this.suspendedReason,
  });

  factory AuthState.initial() => const AuthState(
        status: AuthStatus.initial,
      );

  factory AuthState.unauthenticated({String? errorMessage}) => AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: errorMessage,
      );

  factory AuthState.authenticated(UserResponse user) => AuthState(
        status: AuthStatus.authenticated,
        user: user,
      );

  factory AuthState.mustChangePassword(UserResponse user) => AuthState(
        status: AuthStatus.mustChangePassword,
        user: user,
      );

  factory AuthState.suspended(String reason) => AuthState(
        status: AuthStatus.suspended,
        suspendedReason: reason,
      );

  AuthState copyWith({
    AuthStatus? status,
    UserResponse? user,
    bool? isLoading,
    String? errorMessage,
    String? suspendedReason,
  }) {
    return AuthState(
      status: status ?? this.status,
      user: user ?? this.user,
      isLoading: isLoading ?? this.isLoading,
      errorMessage: errorMessage,
      suspendedReason: suspendedReason ?? this.suspendedReason,
    );
  }

  @override
  List<Object?> get props => [status, user, isLoading, errorMessage, suspendedReason];
}
