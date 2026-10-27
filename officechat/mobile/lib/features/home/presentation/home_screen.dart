import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../auth/presentation/auth_controller.dart';
import '../../workspace/presentation/workspace_controller.dart';

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  int _currentIndex = 0;

  @override
  Widget build(BuildContext context) {
    final workspaceState = ref.watch(workspaceControllerProvider);
    final authState = ref.watch(authControllerProvider);
    final activeWs = workspaceState.activeWorkspace;
    final wsName = activeWs?.name ?? 'OfficeChat';

    return Scaffold(
      appBar: AppBar(
        title: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: () => context.go('/workspaces'),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Flexible(
                  child: Text(
                    wsName,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                const SizedBox(width: 4),
                const Icon(Icons.keyboard_arrow_down, size: 20),
              ],
            ),
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.workspaces_outlined),
            tooltip: 'Switch Workspace',
            onPressed: () => context.go('/workspaces'),
          ),
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Logout',
            onPressed: () async {
              await ref.read(authControllerProvider.notifier).logout();
              if (!context.mounted) return;
              context.go('/login');
            },
          ),
        ],
      ),
      body: IndexedStack(
        index: _currentIndex,
        children: [
          _buildChannelsTab(),
          _buildPlaceholderTab('Mentions & Activity'),
          _buildPlaceholderTab('Search'),
          _buildProfileTab(authState.user),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _currentIndex,
        onDestinationSelected: (idx) => setState(() => _currentIndex = idx),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.chat_bubble_outline),
            selectedIcon: Icon(Icons.chat_bubble),
            label: 'Home',
          ),
          NavigationDestination(
            icon: Icon(Icons.alternate_email),
            label: 'Activity',
          ),
          NavigationDestination(
            icon: Icon(Icons.search),
            label: 'Search',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person),
            label: 'Profile',
          ),
        ],
      ),
    );
  }

  Widget _buildChannelsTab() {
    return ListView(
      padding: const EdgeInsets.symmetric(vertical: 8),
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Text(
            'CHANNELS',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.bold,
              color: Theme.of(context).colorScheme.onSurface.withOpacity(0.5),
            ),
          ),
        ),
        ListTile(
          leading: const Text('#', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          title: const Text('general'),
          subtitle: const Text('Company-wide announcements and team discussions'),
          trailing: Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.primary,
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Text('3', style: TextStyle(color: Colors.white, fontSize: 11)),
          ),
          onTap: () {},
        ),
        ListTile(
          leading: const Text('#', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          title: const Text('engineering'),
          subtitle: const Text('Architecture, PR reviews, and deployments'),
          onTap: () {},
        ),
        ListTile(
          leading: const Icon(Icons.lock_outline, size: 18),
          title: const Text('leadership'),
          subtitle: const Text('Executive strategy (Private)'),
          onTap: () {},
        ),
        const Divider(),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Text(
            'DIRECT MESSAGES',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.bold,
              color: Theme.of(context).colorScheme.onSurface.withOpacity(0.5),
            ),
          ),
        ),
        ListTile(
          leading: const CircleAvatar(child: Text('SC')),
          title: const Text('Sarah Connor'),
          subtitle: const Text('Online • Engineering Lead'),
          onTap: () {},
        ),
        ListTile(
          leading: const CircleAvatar(child: Text('AC')),
          title: const Text('Alex Chen'),
          subtitle: const Text('Away • Product Manager'),
          onTap: () {},
        ),
      ],
    );
  }

  Widget _buildPlaceholderTab(String title) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.construction, size: 48, color: Theme.of(context).colorScheme.primary),
          const SizedBox(height: 12),
          Text(title, style: Theme.of(context).textTheme.titleMedium),
        ],
      ),
    );
  }

  Widget _buildProfileTab(dynamic user) {
    final theme = Theme.of(context);
    final fullName = user?.fullName ?? 'Workspace User';
    final email = user?.email ?? '';
    final role = user?.role ?? 'Member';
    final initials = fullName.isNotEmpty
        ? fullName.trim().split(' ').map((e) => e.isNotEmpty ? e[0] : '').take(2).join().toUpperCase()
        : 'OC';

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Center(
          child: Column(
            children: [
              CircleAvatar(
                radius: 44,
                backgroundColor: theme.colorScheme.primary,
                foregroundColor: Colors.white,
                child: Text(
                  initials,
                  style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
                ),
              ),
              const SizedBox(height: 14),
              Text(
                fullName,
                style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
              ),
              if (email.isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(
                  email,
                  style: TextStyle(
                    fontSize: 14,
                    color: theme.colorScheme.onSurface.withOpacity(0.6),
                  ),
                ),
              ],
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                decoration: BoxDecoration(
                  color: theme.colorScheme.primary.withOpacity(0.12),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Text(
                  role.toUpperCase(),
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                    color: theme.colorScheme.primary,
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 32),
        Card(
          child: Column(
            children: [
              ListTile(
                leading: const Icon(Icons.shield_outlined),
                title: const Text('Access Level'),
                subtitle: Text('Enterprise Tier: $role (Owner > Admin > Member > Guest)'),
              ),
              const Divider(height: 1),
              ListTile(
                leading: const Icon(Icons.security),
                title: const Text('Security & Password'),
                subtitle: const Text('Update login credentials'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.go('/force-change-password'),
              ),
              const Divider(height: 1),
              ListTile(
                leading: const Icon(Icons.workspaces_outlined),
                title: const Text('Manage Workspaces'),
                subtitle: const Text('View and switch team organizations'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.go('/workspaces'),
              ),
            ],
          ),
        ),
        const SizedBox(height: 24),
        OutlinedButton.icon(
          icon: const Icon(Icons.logout),
          label: const Text('Sign Out'),
          style: OutlinedButton.styleFrom(
            padding: const EdgeInsets.symmetric(vertical: 14),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          ),
          onPressed: () async {
            await ref.read(authControllerProvider.notifier).logout();
            if (!mounted) return;
            context.go('/login');
          },
        ),
      ],
    );
  }
}
