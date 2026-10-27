import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/storage/secure_storage_service.dart';
import '../../../data/remote/api_client.dart';
import '../../../data/remote/models/api_models.dart';

final workspaceRepositoryProvider = Provider<WorkspaceRepository>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  final storage = ref.watch(secureStorageProvider);
  return WorkspaceRepository(apiClient: apiClient, storage: storage);
});

class WorkspaceRepository {
  final ApiClient _apiClient;
  final SecureStorageService _storage;

  WorkspaceRepository({
    required ApiClient apiClient,
    required SecureStorageService storage,
  })  : _apiClient = apiClient,
        _storage = storage;

  Future<List<WorkspaceModel>> listWorkspaces() async {
    return _apiClient.listWorkspaces();
  }

  Future<WorkspaceModel> createWorkspace({
    required String name,
    String? slug,
    String? description,
  }) async {
    final ws = await _apiClient.createWorkspace(
      name: name,
      slug: slug,
      description: description,
    );
    await setActiveWorkspaceId(ws.id);
    return ws;
  }

  Future<WorkspaceModel> joinWorkspace(String code) async {
    final ws = await _apiClient.joinWorkspaceWithInvite(code);
    await setActiveWorkspaceId(ws.id);
    return ws;
  }

  Future<String?> getActiveWorkspaceId() async {
    return _storage.getWorkspaceId();
  }

  Future<void> setActiveWorkspaceId(String workspaceId) async {
    await _storage.saveWorkspaceId(workspaceId);
  }
}
