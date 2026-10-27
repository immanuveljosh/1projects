enum AppFlavor { dev, staging, prod }

class EnvConfig {
  final AppFlavor flavor;
  final String appName;
  final String apiBaseUrl;
  final String wsBaseUrl;

  const EnvConfig({
    required this.flavor,
    required this.appName,
    required this.apiBaseUrl,
    required this.wsBaseUrl,
  });

  static late EnvConfig _instance;
  static EnvConfig get instance => _instance;

  static void initialize(EnvConfig config) {
    _instance = config;
  }

  static const dev = EnvConfig(
    flavor: AppFlavor.dev,
    appName: 'OfficeChat (Dev)',
    apiBaseUrl: String.fromEnvironment('API_URL', defaultValue: 'http://127.0.0.1:8080/api/v1'),
    wsBaseUrl: String.fromEnvironment('WS_URL', defaultValue: 'ws://127.0.0.1:8080/api/v1/ws'),
  );

  static const staging = EnvConfig(
    flavor: AppFlavor.staging,
    appName: 'OfficeChat (Staging)',
    apiBaseUrl: 'https://staging.officechat.com/api/v1',
    wsBaseUrl: 'wss://staging.officechat.com/api/v1/ws',
  );

  static const prod = EnvConfig(
    flavor: AppFlavor.prod,
    appName: 'OfficeChat',
    apiBaseUrl: 'https://api.officechat.com/api/v1',
    wsBaseUrl: 'wss://api.officechat.com/api/v1/ws',
  );
}
