import 'dart:io';
import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

part 'app_database.g.dart';

// Tables definitions
class LocalWorkspaces extends Table {
  TextColumn get id => text()();
  TextColumn get name => text()();
  TextColumn get slug => text()();
  TextColumn get description => text().nullable()();
  TextColumn get logoUrl => text().nullable()();
  TextColumn get ownerId => text()();
  DateTimeColumn get createdAt => dateTime()();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {id};
}

class LocalChannels extends Table {
  TextColumn get id => text()();
  TextColumn get workspaceId => text()();
  TextColumn get name => text()();
  TextColumn get topic => text().nullable()();
  TextColumn get description => text().nullable()();
  BoolColumn get isPrivate => boolean().withDefault(const Constant(false))();
  BoolColumn get isArchived => boolean().withDefault(const Constant(false))();
  BoolColumn get isAnnouncement => boolean().withDefault(const Constant(false))();
  IntColumn get memberCount => integer().withDefault(const Constant(0))();
  BoolColumn get isMember => boolean().withDefault(const Constant(true))();
  IntColumn get unreadCount => integer().withDefault(const Constant(0))();

  @override
  Set<Column> get primaryKey => {id};
}

class LocalMessages extends Table {
  TextColumn get id => text()();
  TextColumn get workspaceId => text()();
  TextColumn get channelId => text().nullable()();
  TextColumn get dmGroupId => text().nullable()();
  TextColumn get senderId => text()();
  TextColumn get senderName => text()();
  TextColumn get senderAvatar => text().nullable()();
  TextColumn get content => text()();
  BoolColumn get isPinned => boolean().withDefault(const Constant(false))();
  DateTimeColumn get createdAt => dateTime()();
  IntColumn get replyCount => integer().withDefault(const Constant(0))();
  // Status: 0 = synced, 1 = pending send, 2 = failed
  IntColumn get syncStatus => integer().withDefault(const Constant(0))();

  @override
  Set<Column> get primaryKey => {id};
}

@DriftDatabase(tables: [LocalWorkspaces, LocalChannels, LocalMessages])
class AppDatabase extends _$AppDatabase {
  AppDatabase([QueryExecutor? e]) : super(e ?? _openConnection());

  @override
  int get schemaVersion => 1;

  // Stream queries for reactive UI
  Stream<List<LocalChannel>> watchChannelsForWorkspace(String workspaceId) {
    return (select(localChannels)
          ..where((tbl) => tbl.workspaceId.equals(workspaceId) & tbl.isArchived.equals(false))
          ..orderBy([(tbl) => OrderingTerm.asc(tbl.name)]))
        .watch();
  }

  Stream<List<LocalMessage>> watchMessagesForChannel(String channelId) {
    return (select(localMessages)
          ..where((tbl) => tbl.channelId.equals(channelId))
          ..orderBy([(tbl) => OrderingTerm.desc(tbl.createdAt)]))
        .watch();
  }

  Future<void> upsertChannels(List<LocalChannelsCompanion> channelsList) async {
    await batch((b) {
      b.insertAllOnConflictUpdate(localChannels, channelsList);
    });
  }

  Future<void> upsertMessages(List<LocalMessagesCompanion> messagesList) async {
    await batch((b) {
      b.insertAllOnConflictUpdate(localMessages, messagesList);
    });
  }

  Future<void> clearAll() async {
    await transaction(() async {
      await delete(localMessages).go();
      await delete(localChannels).go();
      await delete(localWorkspaces).go();
    });
  }
}

LazyDatabase _openConnection() {
  return LazyDatabase(() async {
    final dbFolder = await getApplicationDocumentsDirectory();
    final file = File(p.join(dbFolder.path, 'officechat_offline.sqlite'));
    return NativeDatabase.createInBackground(file);
  });
}

final appDatabaseProvider = Provider<AppDatabase>((ref) {
  final db = AppDatabase();
  ref.onDispose(db.close);
  return db;
});
