import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'app.dart';
import 'core/config/env_config.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  EnvConfig.initialize(EnvConfig.prod);

  runApp(
    const ProviderScope(
      child: OfficeChatApp(),
    ),
  );
}
