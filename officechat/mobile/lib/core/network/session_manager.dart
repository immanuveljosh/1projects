import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final sessionManagerProvider = Provider<SessionManager>((ref) {
  final manager = SessionManager();
  ref.onDispose(() => manager.dispose());
  return manager;
});

class SessionManager {
  final _controller = StreamController<String>.broadcast();

  Stream<String> get onSessionTerminated => _controller.stream;

  void notifyTerminated(String reason) {
    if (!_controller.isClosed) {
      _controller.add(reason);
    }
  }

  void dispose() {
    _controller.close();
  }
}
