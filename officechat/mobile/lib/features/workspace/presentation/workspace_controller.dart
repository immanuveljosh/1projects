import 'package:dio/dio.dart';
import 'package:equatable/equatable.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/errors/api_exception.dart';
import '../../../data/remote/models/api_models.dart';
import '../data/workspace_repository.dart';

class WorkspaceState extends Equatable {
  final List<WorkspaceModel> workspaces;
  final String? activeWorkspaceId;
  final bool isLoading;
  final String? errorMessage;

  const WorkspaceState({
    this.workspaces = const [],
    this.activeWorkspaceId,
    this.isLoading = false,
    this.errorMessage,
  });

  WorkspaceModel? get activeWorkspace {
    if (activeWorkspaceId == null) {
      return workspaces.isNotEmpty ? workspaces.first : null;
    }
    return workspaces.where((w) => w.id == activeWorkspaceId).firstOrNull ??
        (workspaces.isNotEmpty ? workspaces.first : null);
  }

  WorkspaceState copyWith({
    List<WorkspaceModel>? workspaces,
    String? activeWorkspaceId,
    bool? isLoading,
    String? errorMessage,
  }) {
    return WorkspaceState(
      workspaces: workspaces ?? this.workspaces,
      activeWorkspaceId: activeWorkspaceId ?? this.activeWorkspaceId,
      isLoading: isLoading ?? this.isLoading,
      errorMessage: errorMessage,
    );
  }

  @override
  List<Object?> get props => [workspaces, activeWorkspaceId, isLoading, errorMessage];
}

final workspaceControllerProvider =
    StateNotifierProvider<WorkspaceController, WorkspaceState>((ref) {
  final repo = ref.watch(workspaceRepositoryProvider);
  return WorkspaceController(repo);
});

class WorkspaceController extends StateNotifier<WorkspaceState> {
  final WorkspaceRepository _repository;

  WorkspaceController(this._repository) : super(const WorkspaceState()) {
    loadWorkspaces();
  }

  Future<void> loadWorkspaces() async {
    state = state.copyWith(isLoading: true, errorMessage: null);
    try {
      final activeId = await _repository.getActiveWorkspaceId();
      final list = await _repository.listWorkspaces();

      String? effectiveActiveId = activeId;
      if ((effectiveActiveId == null || !list.any((w) => w.id == effectiveActiveId)) &&
          list.isNotEmpty) {
        effectiveActiveId = list.first.id;
        await _repository.setActiveWorkspaceId(effectiveActiveId);
      }

      state = state.copyWith(
        workspaces: list,
        activeWorkspaceId: effectiveActiveId,
        isLoading: false,
      );
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        errorMessage: _extractMessage(e),
      );
    }
  }

  Future<void> selectWorkspace(String workspaceId) async {
    await _repository.setActiveWorkspaceId(workspaceId);
    state = state.copyWith(activeWorkspaceId: workspaceId);
  }

  Future<WorkspaceModel?> createWorkspace({
    required String name,
    String? slug,
    String? description,
  }) async {
    state = state.copyWith(isLoading: true, errorMessage: null);
    try {
      final ws = await _repository.createWorkspace(
        name: name,
        slug: slug,
        description: description,
      );
      final updatedList = [...state.workspaces, ws];
      state = state.copyWith(
        workspaces: updatedList,
        activeWorkspaceId: ws.id,
        isLoading: false,
      );
      return ws;
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        errorMessage: _extractMessage(e),
      );
      return null;
    }
  }

  Future<WorkspaceModel?> joinWorkspace(String code) async {
    state = state.copyWith(isLoading: true, errorMessage: null);
    try {
      final ws = await _repository.joinWorkspace(code);
      final existingIndex = state.workspaces.indexWhere((w) => w.id == ws.id);
      List<WorkspaceModel> updatedList;
      if (existingIndex >= 0) {
        updatedList = List.from(state.workspaces);
        updatedList[existingIndex] = ws;
      } else {
        updatedList = [...state.workspaces, ws];
      }

      state = state.copyWith(
        workspaces: updatedList,
        activeWorkspaceId: ws.id,
        isLoading: false,
      );
      return ws;
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        errorMessage: _extractMessage(e),
      );
      return null;
    }
  }

  String _extractMessage(dynamic error) {
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
      if (error.response?.statusCode == 404) {
        return 'Invite code invalid or expired.';
      }
      if (error.response?.statusCode == 400) {
        return 'Invalid workspace request.';
      }
    }
    if (error is ApiException) {
      return error.message;
    }
    return error.toString();
  }
}
