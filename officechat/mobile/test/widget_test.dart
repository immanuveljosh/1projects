import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/app.dart';
import 'package:mobile/core/config/env_config.dart';

void main() {
  setUp(() {
    EnvConfig.initialize(EnvConfig.dev);
  });

  testWidgets('OfficeChat initial splash screen render smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: OfficeChatApp(),
      ),
    );

    expect(find.text('OfficeChat'), findsOneWidget);
  });
}
