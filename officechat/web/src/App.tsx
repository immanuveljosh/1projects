import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Hash,
  Lock,
  Search,
  Pin,
  PinOff,
  CheckSquare,
  Users,
  Smile,
  Send,
  Paperclip,
  Camera,
  Plus,
  Settings,
  ChevronDown,
  BarChart2,
  MessageSquare,
  X,
  LogIn,
  Check,
  CheckCheck,
  Sun,
  Moon,
  Copy,
  Menu,
  Bell,
  BellOff,
  Volume2,
  VolumeX,
  Mail,
  Download,
  User as UserIcon,
  Palette,
  HardDrive,
  Archive,
  Trash2,
  Forward,
  Edit3,
  CornerUpLeft,
  Shield
} from 'lucide-react';

import {
  chatApi,
  buildWebSocketUrl,
  discoverLatestTunnelUrl,
  resolveApiUrl,
  setActiveServerBaseUrl,
  subscribeTunnelState,
  type TunnelConnectionState,
  type TunnelConfigPayload,
  type BackendUser,
  type BackendMessage,
  type BackendAttachment,
  type BackendChannel,
  type BackendDMGroup,
  type BackendWorkspaceMember,
  type BackendTask,
  type BackendPollSummary,
  type WSIncomingEvent,
} from './features/chat/chatApi';

const AdminConsole = React.lazy(() => import('./features/admin/AdminConsole'));

const DEFAULT_AVATAR = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80';
const DEFAULT_WORKSPACE_ID = '11111111-1111-1111-1111-111111111111';

/* --- Domain Interfaces --- */
interface User {
  id: string;
  name: string;
  handle: string;
  email?: string;
  team?: string;
  role: string;
  status: 'online' | 'away' | 'dnd' | 'offline';
  customStatus?: string;
  avatar: string;
}

interface Reaction {
  emoji: string;
  count: number;
  users: string[];
}

interface PollOption {
  id: string;
  text: string;
  votes: number;
  voterAvatars?: string[];
}

interface Poll {
  id: string;
  question: string;
  options: PollOption[];
  totalVotes: number;
  userVoted?: string;
  deadline?: string;
}

interface Attachment {
  id: string;
  name: string;
  size: string;
  type: string;
  url?: string;
  file?: File;
}

interface Message {
  id: string;
  sender: User;
  content: string;
  timestamp: string;
  rawDate: string; // "Today", "Yesterday"
  reactions: Reaction[];
  isPinned?: boolean;
  replyCount?: number;
  replies?: { id: string; sender: User; content: string; timestamp: string }[];
  poll?: Poll;
  attachment?: Attachment;
  attachments?: Attachment[];
  codeSnippet?: { language: string; code: string };
  status?: 'sent' | 'delivered' | 'read'; // single tick sent, double tick delivered, blue double tick read
  replyTo?: { id: string; senderName: string; content: string };
  isEdited?: boolean;
}

interface Conversation {
  id: string;
  kind?: 'channel' | 'dm';
  targetUserId?: string;
  name: string;
  topic?: string;
  memberCount?: number;
  isGroup: boolean;
  isPrivate?: boolean;
  avatar: string;
  lastMessage: string;
  timestamp: string;
  unreadCount: number;
  isPinned: boolean;
  isMuted: boolean;
  isArchived: boolean;
  status?: 'online' | 'away' | 'dnd' | 'offline';
  role?: string;
}

interface Task {
  id: string;
  title: string;
  status: 'todo' | 'in_progress' | 'done';
  assignedTo: string;
  dueDate: string;
  channel: string;
}

interface Toast {
  id: string;
  message: string;
  type?: 'success' | 'info' | 'warning' | 'error';
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(isoString?: string): string {
  if (!isoString) return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return 'Just now';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function normalizeStatus(st?: string): User['status'] {
  if (st === 'online' || st === 'away' || st === 'dnd' || st === 'offline') return st;
  return 'online';
}

function normalizeRole(role?: string, wsRole?: string): string {
  if (wsRole) return wsRole;
  if (!role) return 'Member';
  const r = role.toLowerCase();
  if (r === 'owner') return 'Owner';
  if (r === 'admin') return 'Admin';
  if (r === 'guest') return 'Guest';
  return 'Member';
}

function mapBackendUser(u?: BackendUser, wsRole?: string): User {
  if (!u) {
    return {
      id: 'unknown',
      name: 'Team Member',
      handle: '@member',
      role: wsRole || 'Member',
      status: 'online',
      avatar: DEFAULT_AVATAR,
    };
  }
  const fullName = u.full_name || u.display_name || u.email.split('@')[0] || 'User';
  const display = u.display_name || fullName.split(' ')[0] || 'user';
  return {
    id: u.id,
    name: fullName,
    handle: '@' + display.toLowerCase().replace(/\s+/g, ''),
    email: u.email,
    team: u.department || 'Engineering',
    role: normalizeRole(u.role, wsRole),
    status: normalizeStatus(u.status),
    customStatus: u.custom_status || 'Active',
    avatar: u.avatar_url || DEFAULT_AVATAR,
  };
}

function mapBackendPoll(p: BackendPollSummary): Poll {
  return {
    id: p.id,
    question: p.question,
    options: (p.options || []).map(o => ({
      id: o.id,
      text: o.option_text,
      votes: o.vote_count || 0,
      voterAvatars: [],
    })),
    totalVotes: p.total_votes || 0,
    userVoted: p.user_voted_id || undefined,
    deadline: p.is_closed ? 'Closed' : 'Active Poll',
  };
}

function mapBackendMessage(m: BackendMessage, currentUserId: string): Message {
  const token = typeof window !== 'undefined' ? localStorage.getItem('officechat_access_token') || '' : '';
  const mappedAttachments: Attachment[] = (m.attachments || []).map(att => {
    let resolvedUrl = att.file_url;
    if (resolvedUrl) {
      resolvedUrl = resolveApiUrl(resolvedUrl);
      if (token) {
        const sep = resolvedUrl.includes('?') ? '&' : '?';
        resolvedUrl = `${resolvedUrl}${sep}token=${encodeURIComponent(token)}`;
      }
    }
    return {
      id: att.id,
      name: att.file_name,
      size: formatBytes(att.file_size),
      type: att.content_type || 'application/octet-stream',
      url: resolvedUrl,
    };
  });

  const mappedReactions: Reaction[] = (m.reactions || []).map(r => {
    const users = [...(r.user_ids || [])];
    if (r.has_reacted && currentUserId && !users.includes(currentUserId)) {
      users.push(currentUserId);
    }
    return {
      emoji: r.emoji,
      count: r.count,
      users,
    };
  });

  return {
    id: m.id,
    sender: mapBackendUser(m.sender),
    content: m.content,
    timestamp: formatTime(m.created_at),
    rawDate: 'Today',
    reactions: mappedReactions,
    isPinned: Boolean(m.is_pinned),
    replyCount: m.reply_count || 0,
    isEdited: Boolean(m.edited_at),
    status: 'delivered',
    attachment: mappedAttachments[0],
    attachments: mappedAttachments.length > 0 ? mappedAttachments : undefined,
    poll: m.poll ? mapBackendPoll(m.poll) : undefined,
  };
}

function mapBackendTask(t: BackendTask): Task {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    assignedTo: t.assignee?.full_name || t.creator?.full_name || 'Unassigned',
    dueDate: t.due_date ? new Date(t.due_date).toLocaleDateString() : 'Active',
    channel: '#workspace',
  };
}

export default function App() {
  /* --- Global States --- */
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [activeWorkspace, setActiveWorkspace] = useState('Acme Corporation');
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(DEFAULT_WORKSPACE_ID);
  const [activeChannel, setActiveChannel] = useState('general');
  const [activeTab, setActiveTab] = useState<'chat' | 'tasks'>('chat');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [activeThreadMessage, setActiveThreadMessage] = useState<Message | null>(null);
  const [threadReplyInput, setThreadReplyInput] = useState('');

  /* Conversation Search & Filter States */
  const [conversationFilter, setConversationFilter] = useState<'all' | 'pinned' | 'groups' | 'archived'>('all');
  const [conversationSearch, setConversationSearch] = useState('');
  const [activeConversationId, setActiveConversationId] = useState('');

  /* Advanced Composer States */
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null);

  /* Backend Connection & Loading/Error States */
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => Boolean(localStorage.getItem('officechat_access_token')));
  const [wsConnected, setWsConnected] = useState(false);
  const [tunnelState, setTunnelState] = useState<TunnelConnectionState | null>(null);
  const [wsReconnectNonce, setWsReconnectNonce] = useState(0);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  /* Subscribe to Cloudflare Quick Tunnel Discovery & Auto-Update State */
  useEffect(() => {
    const unsubscribe = subscribeTunnelState(state => {
      setTunnelState(state);
    });
    // Initial check for current tunnel URL
    discoverLatestTunnelUrl().catch(() => {});
    return unsubscribe;
  }, []);

  /* Conversations Data (Populated strictly from Backend Channels, DMs & Members) */
  const [conversations, setConversations] = useState<Conversation[]>([]);

  /* Modal States */
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showPollModal, setShowPollModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showCreateChannelModal, setShowCreateChannelModal] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelDesc, setNewChannelDesc] = useState('');
  const [newChannelIsPrivate, setNewChannelIsPrivate] = useState(false);
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);

  /* Password Change State */
  const [currentPasswordInput, setCurrentPasswordInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordChangeStatus, setPasswordChangeStatus] = useState<{ text: string; success: boolean } | null>(null);

  /* Global Search State in Command Palette */
  const [searchResults, setSearchResults] = useState<{
    messages: BackendMessage[];
    attachments: BackendAttachment[];
  }>({ messages: [], attachments: [] });
  const [isSearching, setIsSearching] = useState(false);

  /* Action Toasts - visibly hidden per user request */
  const addToast = useCallback((_message?: string, _type?: Toast['type']) => {
    // Visibly hidden so action logs do not pop up on screen
  }, []);

  /* Theme Sync */
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  /* Keyboard shortcut listener (Ctrl+K / Cmd+K) */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette(prev => !prev);
      }
      if (e.key === 'Escape') {
        setShowCommandPalette(false);
        setActiveThreadMessage(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  /* Admin Console State & Guard */
  const [showAdminConsole, setShowAdminConsole] = useState(() => {
    return typeof window !== 'undefined' && window.location.pathname.startsWith('/admin');
  });

  /* Current Authenticated User (Strict 4-tier roles: Owner, Admin, Member, Guest) */
  const [currentUser, setCurrentUser] = useState<User>({
    id: '',
    name: 'Sign In Required',
    handle: '@guest',
    email: '',
    team: 'Workspace',
    role: 'Member',
    status: 'offline',
    customStatus: 'Not signed in',
    avatar: DEFAULT_AVATAR,
  });

  /* Admin Console direct URL guard */
  useEffect(() => {
    if (window.location.pathname.startsWith('/admin') && currentUser.id) {
      const role = (currentUser.role || '').toLowerCase();
      if (role !== 'owner' && role !== 'admin') {
        const timer = setTimeout(() => {
          setShowAdminConsole(false);
          addToast('Access denied: Admin Console requires Owner or Admin role', 'warning');
          window.history.replaceState({}, '', '/');
        }, 0);
        return () => clearTimeout(timer);
      }
    }
  }, [currentUser.id, currentUser.role, addToast]);

  const [customStatusInput, setCustomStatusInput] = useState('');

  /* Settings Area States */
  const [settingsTab, setSettingsTab] = useState<'account' | 'notifications' | 'theme' | 'backup'>('account');
  const [accountName, setAccountName] = useState('');
  const [accountEmail, setAccountEmail] = useState('');
  const [accountTeam, setAccountTeam] = useState('Engineering');
  const [accountRole, setAccountRole] = useState('Member');
  const [isDndActive, setIsDndActive] = useState(false);
  const [isMuteActive, setIsMuteActive] = useState(false);
  const [backupEmail, setBackupEmail] = useState('');

  /* Auth form inputs */
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authFullName, setAuthFullName] = useState('');
  const [authMessage, setAuthMessage] = useState('');

  /* Composer states */
  const [messageInput, setMessageInput] = useState('');
  const [composerAttachments, setComposerAttachments] = useState<Attachment[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /* Hidden native file inputs for real attachments */
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  /* Reaction popover & image preview lightbox states */
  const [activeEmojiPickerMsgId, setActiveEmojiPickerMsgId] = useState<string | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  /* Poll creation form inputs */
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['Option 1', 'Option 2']);

  /* Task creation form input */
  const [newTaskTitle, setNewTaskTitle] = useState('');

  /* Live Messages & Tasks State (Populated strictly from Backend APIs & WebSocket) */
  const [messages, setMessages] = useState<Message[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeConversationIdRef = useRef(activeConversationId);
  const currentUserIdRef = useRef(currentUser.id);
  const wsRef = useRef<WebSocket | null>(null);
  const lastTypingSentRef = useRef<number>(0);
  const typingTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const memberDirectoryRef = useRef<Record<string, string>>({});

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
    setTypingUsers({});
  }, [activeConversationId]);

  useEffect(() => {
    currentUserIdRef.current = currentUser.id;
  }, [currentUser.id]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  /* Build Unified Conversations List from Backend Channels, DMs & Members */
  const buildConversationsList = useCallback(
    (
      backendChannels: BackendChannel[],
      backendDMs: BackendDMGroup[],
      backendMembers: BackendWorkspaceMember[],
      meId: string
    ): Conversation[] => {
      const channelItems: Conversation[] = backendChannels.map(ch => ({
        id: ch.id,
        kind: 'channel',
        name: ch.name,
        topic: ch.topic || ch.description || `Channel #${ch.name}`,
        memberCount: ch.member_count || backendMembers.length || 1,
        isGroup: true,
        isPrivate: Boolean(ch.is_private),
        avatar: '',
        lastMessage: ch.topic || ch.description || `#${ch.name}`,
        timestamp: formatTime(ch.updated_at || ch.created_at),
        unreadCount: ch.unread_count || 0,
        isPinned: ch.name === 'general',
        isMuted: false,
        isArchived: Boolean(ch.is_archived),
      }));

      const dmPartnerIds = new Set<string>();
      const dmItems: Conversation[] = backendDMs.map(dm => {
        const otherMembers = (dm.members || []).filter(m => m.id !== meId);
        const primaryPartner = otherMembers[0] || (dm.members && dm.members[0]);
        if (!dm.is_group && primaryPartner) {
          dmPartnerIds.add(primaryPartner.id);
        }
        const dmName = dm.is_group
          ? dm.name || otherMembers.map(m => m.full_name || m.display_name).join(', ') || 'Group DM'
          : primaryPartner?.full_name || primaryPartner?.display_name || primaryPartner?.email || 'Direct Message';

        return {
          id: dm.id,
          kind: 'dm',
          targetUserId: primaryPartner?.id,
          name: dmName,
          isGroup: Boolean(dm.is_group),
          isPrivate: true,
          avatar: primaryPartner?.avatar_url || DEFAULT_AVATAR,
          lastMessage: 'Direct Message',
          timestamp: formatTime(dm.updated_at || dm.created_at),
          unreadCount: dm.unread_count || 0,
          isPinned: false,
          isMuted: false,
          isArchived: false,
          status: normalizeStatus(primaryPartner?.status),
          role: primaryPartner?.department || normalizeRole(primaryPartner?.role),
        };
      });

      // Include other active workspace members so 1:1 DMs can be started with a single click
      const memberDmPlaceholders: Conversation[] = backendMembers
        .filter(m => m.user && m.user_id !== meId && !dmPartnerIds.has(m.user_id) && m.user.account_state !== 'deactivated')
        .map(m => {
          const u = m.user!;
          return {
            id: `dm_user_${u.id}`,
            kind: 'dm',
            targetUserId: u.id,
            name: u.full_name || u.display_name || u.email,
            isGroup: false,
            isPrivate: true,
            avatar: u.avatar_url || DEFAULT_AVATAR,
            lastMessage: `Start a direct message with ${u.display_name || u.full_name}`,
            timestamp: '',
            unreadCount: 0,
            isPinned: false,
            isMuted: false,
            isArchived: false,
            status: normalizeStatus(u.status),
            role: m.role || u.department || 'Member',
          };
        });

      return [...channelItems, ...dmItems, ...memberDmPlaceholders];
    },
    []
  );

  /* Load Workspace, Channels, DMs, Members, Presence & Tasks from Backend */
  const loadWorkspaceBootstrap = useCallback(async () => {
    try {
      const me = await chatApi.getMe();
      setIsAuthenticated(true);
      setShowAuthModal(false);

      const workspaces = await chatApi.listWorkspaces();
      const ws = workspaces[0];
      const wsId = ws?.id || DEFAULT_WORKSPACE_ID;
      if (ws?.name) setActiveWorkspace(ws.name);
      setActiveWorkspaceId(wsId);

      const [channelsRes, dmsRes, membersRes, tasksRes, presenceRes] = await Promise.all([
        chatApi.listChannels(wsId).catch(() => [] as BackendChannel[]),
        chatApi.listDMs(wsId).catch(() => [] as BackendDMGroup[]),
        chatApi.listWorkspaceMembers(wsId).catch(() => [] as BackendWorkspaceMember[]),
        chatApi.listTasks(wsId).catch(() => [] as BackendTask[]),
        chatApi.getPresence(wsId).catch(() => []),
      ]);

      // Apply live presence statuses to members
      const presenceMap = new Map(presenceRes.map(p => [p.user_id, p]));
      const enrichedMembers = membersRes.map(m => {
        if (m.user && presenceMap.has(m.user_id)) {
          const pr = presenceMap.get(m.user_id)!;
          return {
            ...m,
            user: {
              ...m.user,
              status: pr.status || m.user.status,
              custom_status: pr.custom_status || m.user.custom_status,
            },
          };
        }
        return m;
      });

      const myMembership = enrichedMembers.find(m => m.user_id === me.id);
      const mappedMe = mapBackendUser(me, myMembership?.role);
      const dir: Record<string, string> = { [me.id]: mappedMe.name };
      enrichedMembers.forEach(m => {
        if (m.user) {
          dir[m.user_id] = m.user.full_name || m.user.display_name || m.user.email;
        }
      });
      memberDirectoryRef.current = dir;
      setCurrentUser(mappedMe);
      setAccountName(mappedMe.name);
      setAccountEmail(mappedMe.email || me.email);
      setAccountTeam(mappedMe.team || 'Engineering');
      setAccountRole(mappedMe.role);
      setBackupEmail(mappedMe.email || me.email);
      setCustomStatusInput(mappedMe.customStatus || '');
      setIsDndActive(mappedMe.status === 'dnd');

      const convList = buildConversationsList(channelsRes, dmsRes, enrichedMembers, me.id);
      setConversations(convList);
      setTasks(tasksRes.map(mapBackendTask));

      setActiveConversationId(prevId => {
        if (prevId && convList.some(c => c.id === prevId)) {
          return prevId;
        }
        const generalCh = convList.find(c => c.kind === 'channel' && c.name === 'general') || convList[0];
        if (generalCh) {
          setActiveChannel(generalCh.name);
          return generalCh.id;
        }
        return '';
      });
    } catch {
      setIsAuthenticated(false);
      setShowAuthModal(true);
    }
  }, [buildConversationsList]);

  useEffect(() => {
    loadWorkspaceBootstrap();
  }, [loadWorkspaceBootstrap]);

  /* Load Messages for Active Conversation (Channel or DM) */
  const loadConversationHistory = useCallback(
    async (convId: string, kind?: 'channel' | 'dm') => {
      if (!convId || convId.startsWith('dm_user_') || !isAuthenticated) return;
      setIsLoadingMessages(true);
      setChatError(null);

      try {
        const resolvedKind =
          kind || conversations.find(c => c.id === convId)?.kind || 'channel';

        const res =
          resolvedKind === 'dm'
            ? await chatApi.listDMMessages(convId, '', 50, activeWorkspaceId)
            : await chatApi.listChannelMessages(convId, '', 50, activeWorkspaceId);

        const chronological = [...(res.messages || [])].reverse();
        const uiMessages = chronological.map(m => mapBackendMessage(m, currentUserIdRef.current));
        setMessages(uiMessages);

        if (uiMessages.length > 0) {
          const latest = uiMessages[uiMessages.length - 1];
          setConversations(prev =>
            prev.map(c =>
              c.id === convId
                ? {
                    ...c,
                    lastMessage: latest.content || (latest.attachment ? `📎 ${latest.attachment.name}` : c.lastMessage),
                    timestamp: latest.timestamp,
                    unreadCount: 0,
                  }
                : c
            )
          );
        }

        // Mark conversation read on backend
        if (resolvedKind === 'dm') {
          chatApi.markDMRead(convId, activeWorkspaceId).catch(() => {});
        } else {
          chatApi.markChannelRead(convId, activeWorkspaceId).catch(() => {});
        }
      } catch (err) {
        setChatError(err instanceof Error ? err.message : 'Failed to load conversation history');
        setMessages([]);
      } finally {
        setIsLoadingMessages(false);
      }
    },
    [activeWorkspaceId, conversations, isAuthenticated]
  );

  useEffect(() => {
    if (activeConversationId && !activeConversationId.startsWith('dm_user_') && isAuthenticated) {
      const conv = conversations.find(c => c.id === activeConversationId);
      loadConversationHistory(activeConversationId, conv?.kind);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId, isAuthenticated]);

  /* Select a Conversation (automatically creates/opens 1:1 DM if clicking a workspace member) */
  const handleSelectConversation = useCallback(
    async (conv: Conversation) => {
      setActiveTab('chat');
      setIsMobileMenuOpen(false);
      setChatError(null);

      if (conv.id.startsWith('dm_user_') && conv.targetUserId) {
        try {
          const dmGroup = await chatApi.getOrCreateDM(activeWorkspaceId, [conv.targetUserId]);
          const realConv: Conversation = {
            ...conv,
            id: dmGroup.id,
            kind: 'dm',
            unreadCount: 0,
          };
          setConversations(prev =>
            prev.map(item => (item.id === conv.id || item.id === dmGroup.id ? realConv : item))
          );
          setActiveConversationId(dmGroup.id);
          setActiveChannel(realConv.name);
          await loadConversationHistory(dmGroup.id, 'dm');
        } catch (err) {
          setChatError(err instanceof Error ? err.message : 'Could not start direct message');
        }
        return;
      }

      setActiveConversationId(conv.id);
      setActiveChannel(conv.name);
      setConversations(prev => prev.map(item => (item.id === conv.id ? { ...item, unreadCount: 0 } : item)));
    },
    [activeWorkspaceId, loadConversationHistory]
  );

  /* Live WebSocket Connection (/api/v1/ws) with Automatic Reconnect & History Sync */
  useEffect(() => {
    if (!isAuthenticated || !activeWorkspaceId) return;

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let isUnmounted = false;
    let hadPriorConnection = false;

    const connectWs = () => {
      if (isUnmounted) return;
      const wsUrl = buildWebSocketUrl(activeWorkspaceId);
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isUnmounted) return;
        setWsConnected(true);
        if (hadPriorConnection && activeConversationIdRef.current) {
          // Refresh history and sidebar state after reconnecting
          loadWorkspaceBootstrap();
          loadConversationHistory(activeConversationIdRef.current);
        }
        hadPriorConnection = true;
      };

      ws.onmessage = event => {
        if (isUnmounted) return;
        try {
          const packet = JSON.parse(event.data) as WSIncomingEvent;
          const { type, payload } = packet;

          if (type === 'message.new' && payload) {
            const bMsg = payload as BackendMessage;
            const uiMsg = mapBackendMessage(bMsg, currentUserIdRef.current);
            const targetConvId = bMsg.channel_id || bMsg.dm_group_id || '';

            // Clear any active typing indicator for the sender of this message
            if (bMsg.sender_id && typingTimersRef.current[bMsg.sender_id]) {
              clearTimeout(typingTimersRef.current[bMsg.sender_id]);
              delete typingTimersRef.current[bMsg.sender_id];
            }
            if (bMsg.sender_id) {
              setTypingUsers(prev => {
                if (!prev[bMsg.sender_id]) return prev;
                const next = { ...prev };
                delete next[bMsg.sender_id];
                return next;
              });
            }

            // If this is a thread reply (parent_id set)
            if (bMsg.parent_id) {
              const replyObj = {
                id: uiMsg.id,
                sender: uiMsg.sender,
                content: uiMsg.content,
                timestamp: uiMsg.timestamp,
              };
              setMessages(prev =>
                prev.map(m => {
                  if (m.id !== bMsg.parent_id) return m;
                  const existingReplies = m.replies || [];
                  if (existingReplies.some(r => r.id === replyObj.id)) return m;
                  const nextReplies = [...existingReplies, replyObj];
                  return {
                    ...m,
                    replyCount: Math.max((m.replyCount || 0) + 1, nextReplies.length),
                    replies: nextReplies,
                  };
                })
              );
              setActiveThreadMessage(prev => {
                if (!prev || prev.id !== bMsg.parent_id) return prev;
                const existingReplies = prev.replies || [];
                if (existingReplies.some(r => r.id === replyObj.id)) return prev;
                const nextReplies = [...existingReplies, replyObj];
                return {
                  ...prev,
                  replyCount: Math.max((prev.replyCount || 0) + 1, nextReplies.length),
                  replies: nextReplies,
                };
              });
              return;
            }

            if (targetConvId === activeConversationIdRef.current) {
              // Deduplicate by message ID so sender does not see duplicate bubble
              setMessages(prev => (prev.some(m => m.id === uiMsg.id) ? prev : [...prev, uiMsg]));
              if (bMsg.dm_group_id) {
                chatApi.markDMRead(targetConvId, activeWorkspaceId).catch(() => {});
              } else if (bMsg.channel_id) {
                chatApi.markChannelRead(targetConvId, activeWorkspaceId).catch(() => {});
              }
            }

            // Update conversation preview and unread count
            setConversations(prev => {
              const exists = prev.some(c => c.id === targetConvId);
              if (!exists && bMsg.dm_group_id) {
                // New DM initiated by another user — refresh workspace DMs
                loadWorkspaceBootstrap();
                return prev;
              }
              return prev.map(c => {
                if (c.id !== targetConvId) return c;
                const isCurrent = targetConvId === activeConversationIdRef.current;
                const isFromMe = bMsg.sender_id === currentUserIdRef.current;
                return {
                  ...c,
                  lastMessage: uiMsg.content || (uiMsg.attachment ? `📎 ${uiMsg.attachment.name}` : c.lastMessage),
                  timestamp: uiMsg.timestamp,
                  unreadCount: isCurrent || isFromMe ? 0 : c.unreadCount + 1,
                };
              });
            });
          } else if (type === 'message.updated' && payload) {
            const bMsg = payload as BackendMessage;
            setMessages(prev =>
              prev.map(m =>
                m.id === bMsg.id
                  ? { ...m, content: bMsg.content, isEdited: true }
                  : m
              )
            );
          } else if (type === 'message.deleted' && payload) {
            const del = payload as { id: string };
            setMessages(prev => prev.filter(m => m.id !== del.id));
          } else if ((type === 'reaction.added' || type === 'reaction.removed') && payload) {
            const rEvt = payload as { message_id: string; user_id: string; emoji: string };
            setMessages(prev =>
              prev.map(m => {
                if (m.id !== rEvt.message_id) return m;
                const existingList = m.reactions || [];
                const found = existingList.find(r => r.emoji === rEvt.emoji);
                if (type === 'reaction.added') {
                  if (found) {
                    if (found.users.includes(rEvt.user_id)) return m;
                    return {
                      ...m,
                      reactions: existingList.map(r =>
                        r.emoji === rEvt.emoji
                          ? { ...r, count: r.count + 1, users: [...r.users, rEvt.user_id] }
                          : r
                      ),
                    };
                  }
                  return {
                    ...m,
                    reactions: [...existingList, { emoji: rEvt.emoji, count: 1, users: [rEvt.user_id] }],
                  };
                } else {
                  if (!found) return m;
                  const nextUsers = found.users.filter(u => u !== rEvt.user_id);
                  const nextCount = Math.max(0, found.count - 1);
                  if (nextCount === 0) {
                    return {
                      ...m,
                      reactions: existingList.filter(r => r.emoji !== rEvt.emoji),
                    };
                  }
                  return {
                    ...m,
                    reactions: existingList.map(r =>
                      r.emoji === rEvt.emoji ? { ...r, count: nextCount, users: nextUsers } : r
                    ),
                  };
                }
              })
            );
          } else if ((type === 'poll.created' || type === 'poll.voted' || type === 'poll.closed') && payload) {
            const pollSummary = payload as BackendPollSummary;
            const uiPoll = mapBackendPoll(pollSummary);
            setMessages(prev =>
              prev.map(m => (m.poll?.id === uiPoll.id ? { ...m, poll: uiPoll } : m))
            );
          } else if (type === 'task.created' && payload) {
            const bTask = payload as BackendTask;
            const uiTask = mapBackendTask(bTask);
            setTasks(prev => (prev.some(t => t.id === uiTask.id) ? prev : [uiTask, ...prev]));
          } else if (type === 'task.updated' && payload) {
            const bTask = payload as BackendTask;
            const uiTask = mapBackendTask(bTask);
            setTasks(prev => prev.map(t => (t.id === uiTask.id ? uiTask : t)));
          } else if (
            type === 'channel.created' ||
            type === 'channel.updated' ||
            type === 'channel.members_updated'
          ) {
            loadWorkspaceBootstrap();
          } else if (type === 'presence.updated' && payload) {
            const p = payload as { user_id: string; status: 'online' | 'away' | 'dnd' | 'offline' };
            if (p.user_id) {
              setConversations(prev =>
                prev.map(c =>
                  c.targetUserId === p.user_id || c.id === p.user_id
                    ? { ...c, status: p.status }
                    : c
                )
              );
            }
          } else if ((type === 'typing.start' || type === 'typing.stop') && payload) {
            const tEvt = payload as { user_id: string; channel_id?: string; dm_group_id?: string };
            if (!tEvt.user_id || tEvt.user_id === currentUserIdRef.current) return;
            const targetConvId = tEvt.channel_id || tEvt.dm_group_id || '';
            if (targetConvId !== activeConversationIdRef.current) return;

            if (type === 'typing.start') {
              const displayName = memberDirectoryRef.current[tEvt.user_id] || 'Team Member';
              setTypingUsers(prev => ({ ...prev, [tEvt.user_id]: displayName }));
              if (typingTimersRef.current[tEvt.user_id]) {
                clearTimeout(typingTimersRef.current[tEvt.user_id]);
              }
              typingTimersRef.current[tEvt.user_id] = setTimeout(() => {
                setTypingUsers(prev => {
                  if (!prev[tEvt.user_id]) return prev;
                  const next = { ...prev };
                  delete next[tEvt.user_id];
                  return next;
                });
                delete typingTimersRef.current[tEvt.user_id];
              }, 4500);
            } else {
              if (typingTimersRef.current[tEvt.user_id]) {
                clearTimeout(typingTimersRef.current[tEvt.user_id]);
                delete typingTimersRef.current[tEvt.user_id];
              }
              setTypingUsers(prev => {
                if (!prev[tEvt.user_id]) return prev;
                const next = { ...prev };
                delete next[tEvt.user_id];
                return next;
              });
            }
          } else if (type === 'tunnel.url_updated' && payload) {
            const tPayload = payload as TunnelConfigPayload;
            if (tPayload.server_url) {
              const newHost = tPayload.server_url.replace(/^https?:\/\//, '');
              setActiveServerBaseUrl(tPayload.server_url);
              if (newHost && !wsUrl.includes(newHost)) {
                ws?.close();
              }
            }
          } else if (type === 'session.revoked') {
            localStorage.removeItem('officechat_access_token');
            localStorage.removeItem('officechat_refresh_token');
            setIsAuthenticated(false);
            setShowAuthModal(true);
          }
        } catch {
          // ignore malformed WS frames
        }
      };

      ws.onclose = () => {
        if (isUnmounted) return;
        setWsConnected(false);
        reconnectTimer = setTimeout(async () => {
          if (isUnmounted) return;
          // Query permanent tunnel configuration endpoint before reconnecting in case Quick Tunnel URL rotated
          await discoverLatestTunnelUrl({ forceExternal: true }).catch(() => {});
          // Also verify/refresh access token via /api/v1/auth/me so expired 15m tokens don't 401 on WS handshake
          await chatApi.getMe().catch(() => {});
          if (!isUnmounted) {
            connectWs();
          }
        }, 2500);
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connectWs();

    return () => {
      isUnmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [isAuthenticated, activeWorkspaceId, wsReconnectNonce, loadWorkspaceBootstrap, loadConversationHistory]);

  /* Auto-grow composer textarea & emit throttled WebSocket typing indicators */
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setMessageInput(val);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }

    if (
      wsRef.current &&
      wsRef.current.readyState === WebSocket.OPEN &&
      activeConversationId &&
      !activeConversationId.startsWith('dm_user_')
    ) {
      const activeConv = conversations.find(c => c.id === activeConversationId);
      const isDm = activeConv?.kind === 'dm';
      if (val.trim().length > 0) {
        const now = Date.now();
        if (now - lastTypingSentRef.current >= 1400) {
          lastTypingSentRef.current = now;
          wsRef.current.send(
            JSON.stringify({
              type: 'typing.start',
              channel_id: isDm ? undefined : activeConversationId,
              dm_group_id: isDm ? activeConversationId : undefined,
            })
          );
        }
      } else if (lastTypingSentRef.current > 0) {
        lastTypingSentRef.current = 0;
        wsRef.current.send(
          JSON.stringify({
            type: 'typing.stop',
            channel_id: isDm ? undefined : activeConversationId,
            dm_group_id: isDm ? activeConversationId : undefined,
          })
        );
      }
    }
  };

  /* Open Thread Panel & Load Historical Thread Replies via GET /api/v1/messages/{id}/thread */
  const openThreadForMessage = useCallback(
    async (msg: Message) => {
      setActiveThreadMessage(msg);
      try {
        const res = await chatApi.listThreadMessages(msg.id, activeWorkspaceId);
        const mappedReplies = (res.messages || []).map(r => ({
          id: r.id,
          sender: mapBackendUser(r.sender),
          content: r.content,
          timestamp: formatTime(r.created_at),
        }));
        setActiveThreadMessage(prev =>
          prev && prev.id === msg.id
            ? { ...prev, replies: mappedReplies, replyCount: mappedReplies.length }
            : prev
        );
        setMessages(prev =>
          prev.map(m =>
            m.id === msg.id ? { ...m, replies: mappedReplies, replyCount: mappedReplies.length } : m
          )
        );
      } catch (err) {
        setChatError(err instanceof Error ? err.message : 'Failed to load thread replies');
      }
    },
    [activeWorkspaceId]
  );

  /* Send or Edit Message via Real Backend API */
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!messageInput.trim() && composerAttachments.length === 0) || isSendingMessage) return;

    if (!isAuthenticated || !activeConversationId) {
      setShowAuthModal(true);
      return;
    }

    if (
      lastTypingSentRef.current > 0 &&
      wsRef.current &&
      wsRef.current.readyState === WebSocket.OPEN &&
      !activeConversationId.startsWith('dm_user_')
    ) {
      const activeConv = conversations.find(c => c.id === activeConversationId);
      const isDm = activeConv?.kind === 'dm';
      lastTypingSentRef.current = 0;
      wsRef.current.send(
        JSON.stringify({
          type: 'typing.stop',
          channel_id: isDm ? undefined : activeConversationId,
          dm_group_id: isDm ? activeConversationId : undefined,
        })
      );
    }

    const trimmedContent = messageInput.trim();

    /* Handle Editing Existing Message via PATCH /api/v1/messages/{id} */
    if (editingMessage) {
      setIsSendingMessage(true);
      setChatError(null);
      try {
        const updated = await chatApi.updateMessage(editingMessage.id, trimmedContent, activeWorkspaceId);
        setMessages(prev =>
          prev.map(m =>
            m.id === editingMessage.id
              ? { ...m, content: updated.content, isEdited: true }
              : m
          )
        );
        setEditingMessage(null);
        setMessageInput('');
        setComposerAttachments([]);
        addToast('Message edited successfully', 'success');
      } catch (err) {
        setChatError(err instanceof Error ? err.message : 'Failed to edit message');
      } finally {
        setIsSendingMessage(false);
      }
      return;
    }

    const activeConv = conversations.find(c => c.id === activeConversationId);
    const pendingAttachments = [...composerAttachments];
    const replyTarget = replyingTo;

    setIsSendingMessage(true);
    setChatError(null);
    setMessageInput('');
    setComposerAttachments([]);
    setShowEmojiPicker(false);
    setShowAttachmentMenu(false);
    setReplyingTo(null);

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      // 1. Upload any attached files via POST /api/v1/workspaces/{id}/files/upload
      const uploadedIds: string[] = [];
      for (const att of pendingAttachments) {
        if (att.file) {
          const uploaded = await chatApi.uploadFile(activeWorkspaceId, att.file);
          uploadedIds.push(uploaded.id);
        }
      }

      const contentToSend =
        trimmedContent ||
        (pendingAttachments.length > 0 ? `📎 ${pendingAttachments.map(a => a.name).join(', ')}` : '');

      // 2. Ensure real DM group if conversation is a member placeholder
      let targetConvId = activeConversationId;
      let targetKind = activeConv?.kind || 'channel';
      if (activeConv?.id.startsWith('dm_user_') && activeConv.targetUserId) {
        const dmGroup = await chatApi.getOrCreateDM(activeWorkspaceId, [activeConv.targetUserId]);
        targetConvId = dmGroup.id;
        targetKind = 'dm';
        setActiveConversationId(dmGroup.id);
        setConversations(prev =>
          prev.map(c => (c.id === activeConv.id ? { ...c, id: dmGroup.id, kind: 'dm' } : c))
        );
      }

      // 3. Send message to backend
      const createdMsg =
        targetKind === 'dm'
          ? await chatApi.sendDMMessage(
              targetConvId,
              {
                content: contentToSend,
                parent_id: undefined,
                attachment_ids: uploadedIds.length > 0 ? uploadedIds : undefined,
              },
              activeWorkspaceId
            )
          : await chatApi.sendChannelMessage(
              targetConvId,
              {
                content: contentToSend,
                parent_id: undefined,
                attachment_ids: uploadedIds.length > 0 ? uploadedIds : undefined,
              },
              activeWorkspaceId
            );

      const uiMsg = mapBackendMessage(createdMsg, currentUser.id);
      if (replyTarget) {
        uiMsg.replyTo = {
          id: replyTarget.id,
          senderName: replyTarget.sender.name,
          content: replyTarget.content.slice(0, 80),
        };
      }

      // Deduplicate against WebSocket message.new broadcast
      setMessages(prev => (prev.some(m => m.id === uiMsg.id) ? prev : [...prev, uiMsg]));

      const lastMsgSnippet =
        uiMsg.content ||
        (uiMsg.attachments && uiMsg.attachments.length > 0
          ? `📎 ${uiMsg.attachments[0].name}`
          : 'Sent an attachment');

      setConversations(prev =>
        prev.map(c =>
          c.id === targetConvId
            ? { ...c, lastMessage: lastMsgSnippet, timestamp: uiMsg.timestamp }
            : c
        )
      );
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Failed to send message');
      setMessageInput(trimmedContent);
      setComposerAttachments(pendingAttachments);
    } finally {
      setIsSendingMessage(false);
    }
  };

  /* Toggle Pin Conversation */
  const handleTogglePin = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConversations(prev =>
      prev.map(c => {
        if (c.id === id) {
          const next = !c.isPinned;
          addToast(`${c.name} ${next ? 'pinned to top' : 'unpinned'}`, 'info');
          return { ...c, isPinned: next };
        }
        return c;
      })
    );
  };

  /* Toggle Mute Conversation */
  const handleToggleMute = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConversations(prev =>
      prev.map(c => {
        if (c.id === id) {
          const next = !c.isMuted;
          addToast(`${c.name} ${next ? 'notifications muted' : 'notifications unmuted'}`, 'info');
          return { ...c, isMuted: next };
        }
        return c;
      })
    );
  };

  /* Toggle Archive Conversation */
  const handleToggleArchive = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConversations(prev =>
      prev.map(c => {
        if (c.id === id) {
          const next = !c.isArchived;
          addToast(`${c.name} ${next ? 'moved to archive' : 'restored from archive'}`, 'info');
          return { ...c, isArchived: next };
        }
        return c;
      })
    );
  };

  /* Leave / Remove Conversation */
  const handleDeleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const conv = conversations.find(c => c.id === id);
    if (conv?.kind === 'channel' && !id.startsWith('dm_user_')) {
      try {
        await chatApi.leaveChannel(id, activeWorkspaceId);
      } catch {
        // ignore if already left
      }
    }
    setConversations(prev => prev.filter(c => c.id !== id));
    addToast('Chat removed from workspace', 'warning');
  };

  /* Delete Message via DELETE /api/v1/messages/{id} */
  const handleDeleteMessage = async (msgId: string) => {
    try {
      await chatApi.deleteMessage(msgId, activeWorkspaceId);
      setMessages(prev => prev.filter(m => m.id !== msgId));
      addToast('Message deleted', 'info');
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'You can only delete your own messages');
    }
  };

  /* Forward Message via Real Backend API */
  const handleForwardMessage = useCallback(
    async (targetConv: Conversation) => {
      if (!forwardingMessage) return;
      const forwardedContent = `↪️ Forwarded: ${forwardingMessage.content}`;
      try {
        let targetId = targetConv.id;
        let kind = targetConv.kind || (targetConv.isGroup ? 'channel' : 'dm');
        if (targetId.startsWith('dm_user_') && targetConv.targetUserId) {
          const dm = await chatApi.getOrCreateDM(activeWorkspaceId, [targetConv.targetUserId]);
          targetId = dm.id;
          kind = 'dm';
        }
        const created =
          kind === 'dm'
            ? await chatApi.sendDMMessage(targetId, { content: forwardedContent }, activeWorkspaceId)
            : await chatApi.sendChannelMessage(targetId, { content: forwardedContent }, activeWorkspaceId);

        const uiMsg = mapBackendMessage(created, currentUser.id);
        setConversations(prev =>
          prev.map(c =>
            c.id === targetConv.id || c.id === targetId
              ? { ...c, id: targetId, lastMessage: forwardedContent, timestamp: uiMsg.timestamp }
              : c
          )
        );
        if (targetId === activeConversationId) {
          setMessages(prev => (prev.some(m => m.id === uiMsg.id) ? prev : [...prev, uiMsg]));
        }
        setForwardingMessage(null);
        addToast(`Message forwarded to ${targetConv.name}`, 'success');
      } catch (err) {
        setChatError(err instanceof Error ? err.message : 'Failed to forward message');
      }
    },
    [forwardingMessage, activeWorkspaceId, currentUser.id, activeConversationId, addToast]
  );

  /* Send thread reply via POST /api/v1/channels/{id}/messages or /dms/{id}/messages with parent_id */
  const handleSendThreadReply = async () => {
    if (!threadReplyInput.trim() || !activeThreadMessage || !activeConversationId) return;
    const content = threadReplyInput.trim();
    setThreadReplyInput('');

    try {
      const activeConv = conversations.find(c => c.id === activeConversationId);
      const created =
        activeConv?.kind === 'dm'
          ? await chatApi.sendDMMessage(
              activeConversationId,
              { content, parent_id: activeThreadMessage.id },
              activeWorkspaceId
            )
          : await chatApi.sendChannelMessage(
              activeConversationId,
              { content, parent_id: activeThreadMessage.id },
              activeWorkspaceId
            );

      const newReply = {
        id: created.id,
        sender: mapBackendUser(created.sender),
        content: created.content,
        timestamp: formatTime(created.created_at),
      };

      setMessages(prev =>
        prev.map(m => {
          if (m.id !== activeThreadMessage.id) return m;
          const existing = m.replies || [];
          if (existing.some(r => r.id === newReply.id)) return m;
          const nextReplies = [...existing, newReply];
          return {
            ...m,
            replyCount: Math.max((m.replyCount || 0) + 1, nextReplies.length),
            replies: nextReplies,
          };
        })
      );

      setActiveThreadMessage(prev => {
        if (!prev) return null;
        const existing = prev.replies || [];
        if (existing.some(r => r.id === newReply.id)) return prev;
        const nextReplies = [...existing, newReply];
        return {
          ...prev,
          replyCount: Math.max((prev.replyCount || 0) + 1, nextReplies.length),
          replies: nextReplies,
        };
      });

      addToast('Reply added to thread', 'info');
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Failed to send thread reply');
      setThreadReplyInput(content);
    }
  };

  /* Real File Selection Handler */
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newAttachments: Attachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isImg = file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name);
      const formattedSize = formatBytes(file.size);
      const fileUrl = URL.createObjectURL(file);

      newAttachments.push({
        id: 'att_' + Date.now() + '_' + i,
        name: file.name,
        size: formattedSize,
        type: file.type || (isImg ? 'image/png' : 'application/octet-stream'),
        url: fileUrl,
        file: file,
      });
    }

    setComposerAttachments(prev => [...prev, ...newAttachments]);
    addToast(`Attached ${newAttachments.length} file(s)`, 'success');
    e.target.value = '';
  };

  /* Download attachment helper */
  const handleDownloadAttachment = (att: Attachment) => {
    const targetUrl = att.url || (att.file ? URL.createObjectURL(att.file) : undefined);
    if (targetUrl) {
      const a = document.createElement('a');
      a.href = targetUrl;
      a.download = att.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      if (att.file && !att.url) URL.revokeObjectURL(targetUrl);
    }
  };

  /* Reaction toggle via POST/DELETE /api/v1/messages/{id}/reactions */
  const handleToggleReaction = async (msgId: string, emoji: string) => {
    const targetMsg = messages.find(m => m.id === msgId);
    if (!targetMsg) return;

    const existing = (targetMsg.reactions || []).find(r => r.emoji === emoji);
    const hasReacted = Boolean(
      existing && (existing.users.includes(currentUser.id) || existing.users.includes(currentUser.name))
    );

    try {
      if (hasReacted) {
        await chatApi.removeReaction(msgId, emoji, activeWorkspaceId);
        setMessages(prev =>
          prev.map(m => {
            if (m.id !== msgId) return m;
            return {
              ...m,
              reactions: (m.reactions || [])
                .map(r =>
                  r.emoji === emoji
                    ? {
                        ...r,
                        count: Math.max(0, r.count - 1),
                        users: r.users.filter(u => u !== currentUser.id && u !== currentUser.name),
                      }
                    : r
                )
                .filter(r => r.count > 0),
            };
          })
        );
      } else {
        await chatApi.addReaction(msgId, emoji, activeWorkspaceId);
        setMessages(prev =>
          prev.map(m => {
            if (m.id !== msgId) return m;
            const list = m.reactions || [];
            const found = list.find(r => r.emoji === emoji);
            if (found) {
              if (found.users.includes(currentUser.id)) return m;
              return {
                ...m,
                reactions: list.map(r =>
                  r.emoji === emoji
                    ? { ...r, count: r.count + 1, users: [...r.users, currentUser.id] }
                    : r
                ),
              };
            }
            return {
              ...m,
              reactions: [...list, { emoji, count: 1, users: [currentUser.id] }],
            };
          })
        );
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Failed to update reaction');
    }
  };

  /* Vote on poll via POST /api/v1/polls/{id}/vote */
  const handleVotePoll = async (msgId: string, optionId: string) => {
    const targetMsg = messages.find(m => m.id === msgId);
    if (!targetMsg?.poll) return;

    try {
      const updatedPoll = await chatApi.votePoll(targetMsg.poll.id, optionId, activeWorkspaceId);
      const uiPoll = mapBackendPoll(updatedPoll);
      setMessages(prev => prev.map(m => (m.id === msgId ? { ...m, poll: uiPoll } : m)));
      addToast('Vote recorded successfully', 'success');
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Failed to cast poll vote');
    }
  };

  /* Create Task from message via POST /api/v1/tasks */
  const handleCreateTaskFromMsg = async (msg: Message) => {
    const title = msg.content.slice(0, 80) + (msg.content.length > 80 ? '...' : '');
    try {
      const created = await chatApi.createTask({
        workspace_id: activeWorkspaceId,
        title,
        message_id: msg.id,
        assigned_to: currentUser.id || undefined,
      });
      const uiTask = mapBackendTask(created);
      setTasks(prev => (prev.some(t => t.id === uiTask.id) ? prev : [uiTask, ...prev]));
      addToast('Task created from message', 'success');
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Failed to create task from message');
    }
  };

  /* Create standalone Task via POST /api/v1/tasks */
  const handleCreateStandaloneTask = async () => {
    if (!newTaskTitle.trim()) return;
    try {
      const created = await chatApi.createTask({
        workspace_id: activeWorkspaceId,
        title: newTaskTitle.trim(),
        assigned_to: currentUser.id || undefined,
      });
      const uiTask = mapBackendTask(created);
      setTasks(prev => (prev.some(t => t.id === uiTask.id) ? prev : [uiTask, ...prev]));
      setNewTaskTitle('');
      setShowTaskModal(false);
      addToast('Task created and added to board', 'success');
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Failed to create task');
    }
  };

  /* Update Task Status via PATCH /api/v1/tasks/{id} or POST /api/v1/tasks/{id}/complete */
  const handleUpdateTaskStatus = async (taskId: string, nextStatus: 'todo' | 'in_progress' | 'done') => {
    try {
      const updated =
        nextStatus === 'done'
          ? await chatApi.completeTask(taskId, activeWorkspaceId)
          : await chatApi.updateTask(taskId, { status: nextStatus }, activeWorkspaceId);
      const uiTask = mapBackendTask(updated);
      setTasks(prev => prev.map(t => (t.id === taskId ? uiTask : t)));
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Failed to update task status');
    }
  };

  /* Create new Poll via POST /api/v1/channels/{id}/messages + POST /api/v1/polls */
  const handleCreatePoll = async () => {
    if (!pollQuestion.trim() || !activeConversationId) return;
    const filteredOptions = pollOptions.map(o => o.trim()).filter(o => o !== '');
    if (filteredOptions.length < 2) return;

    const activeConv = conversations.find(c => c.id === activeConversationId);
    const isDm = activeConv?.kind === 'dm';

    try {
      // 1. Create the host message in the channel or DM
      const hostMsg = isDm
        ? await chatApi.sendDMMessage(
            activeConversationId,
            { content: `📊 Team Poll: **${pollQuestion.trim()}**` },
            activeWorkspaceId
          )
        : await chatApi.sendChannelMessage(
            activeConversationId,
            { content: `📊 Team Poll: **${pollQuestion.trim()}**` },
            activeWorkspaceId
          );

      // 2. Create the poll linked to hostMsg.id
      const createdPoll = await chatApi.createPoll(
        {
          question: pollQuestion.trim(),
          options: filteredOptions,
          channel_id: isDm ? undefined : activeConversationId,
          dm_group_id: isDm ? activeConversationId : undefined,
          message_id: hostMsg.id,
        },
        activeWorkspaceId
      );

      const uiMsg = mapBackendMessage(hostMsg, currentUser.id);
      uiMsg.poll = mapBackendPoll(createdPoll);

      setMessages(prev => {
        const exists = prev.some(m => m.id === uiMsg.id);
        if (exists) {
          return prev.map(m => (m.id === uiMsg.id ? uiMsg : m));
        }
        return [...prev, uiMsg];
      });

      setShowPollModal(false);
      setPollQuestion('');
      setPollOptions(['Option 1', 'Option 2']);
      addToast('New poll posted to channel', 'success');
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Failed to create poll');
    }
  };

  /* Copy Code Snippet */
  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    addToast('Code snippet copied to clipboard', 'info');
  };

  /* Manual Retry for Tunnel Discovery & Reconnection */
  const handleRetryTunnelConnection = async () => {
    setChatError(null);
    const newUrl = await discoverLatestTunnelUrl({ forceExternal: true }).catch(() => null);
    setWsReconnectNonce(prev => prev + 1);
    if (isAuthenticated) {
      await loadWorkspaceBootstrap();
      if (activeConversationIdRef.current) {
        await loadConversationHistory(activeConversationIdRef.current);
      }
    }
    return newUrl;
  };

  /* Auth submission (connected to Go REST backend with automatic tunnel discovery retry) */
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthMessage('Connecting to OfficeChat API...');

    const endpoint = authMode === 'login' ? '/api/v1/auth/login' : '/api/v1/auth/register';
    const payload =
      authMode === 'login'
        ? { email: authEmail, password: authPassword }
        : {
            email: authEmail,
            password: authPassword,
            full_name: authFullName,
            display_name: authFullName.split(' ')[0] || authFullName,
          };

    try {
      let res: Response;
      try {
        res = await fetch(resolveApiUrl(endpoint), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
        if (res.status === 502 || res.status === 503 || res.status === 530) {
          throw new Error(`Tunnel status ${res.status}`);
        }
      } catch {
        setAuthMessage('Tunnel URL changed — discovering latest OfficeChat server URL...');
        await discoverLatestTunnelUrl({ forceExternal: true });
        res = await fetch(resolveApiUrl(endpoint), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
      }
      const data = await res.json();
      if (!res.ok) {
        setAuthMessage(data.error?.message || 'Authentication failed');
      } else {
        setAuthMessage('Authenticated successfully!');
        if (data.access_token) {
          localStorage.setItem('officechat_access_token', data.access_token);
        }
        if (data.refresh_token) {
          localStorage.setItem('officechat_refresh_token', data.refresh_token);
        }
        setIsAuthenticated(true);
        setShowAuthModal(false);
        setAuthPassword('');
        await loadWorkspaceBootstrap();
      }
    } catch {
      setAuthMessage('Error: Could not connect to the OfficeChat server. Click Retry after starting the tunnel.');
    }
  };

  /* Open Settings Modal with tab sync */
  const openSettingsModal = (tab: 'account' | 'notifications' | 'theme' | 'backup' = 'account') => {
    setSettingsTab(tab);
    setAccountName(currentUser.name);
    setAccountEmail(currentUser.email || '');
    setAccountTeam(currentUser.team || 'Engineering');
    setAccountRole(currentUser.role);
    setCustomStatusInput(currentUser.customStatus || '');
    setIsDndActive(currentUser.status === 'dnd');
    setShowStatusModal(true);
  };

  /* Save Settings Changes via PATCH /api/v1/auth/me */
  const handleSaveSettings = async () => {
    const updatedStatus: User['status'] = isDndActive
      ? 'dnd'
      : currentUser.status === 'dnd'
      ? 'online'
      : currentUser.status;
    try {
      const updatedUser = await chatApi.updateProfile({
        full_name: accountName,
        status: updatedStatus,
        custom_status: customStatusInput,
      });
      setCurrentUser(prev => ({
        ...prev,
        name: updatedUser.full_name || accountName,
        email: updatedUser.email || accountEmail,
        team: accountTeam,
        role: accountRole,
        customStatus: updatedUser.custom_status || customStatusInput,
        status: normalizeStatus(updatedUser.status || updatedStatus),
      }));
      setShowStatusModal(false);
      addToast('Account preferences and settings saved', 'success');
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Failed to save profile settings');
    }
  };

  /* Send Chat Backup to Email */
  const handleSendChatBackup = () => {
    if (!backupEmail || !backupEmail.includes('@')) {
      addToast('Please enter a valid backup email address', 'warning');
      return;
    }
    addToast(`Chat archive & database backup dispatched to ${backupEmail}`, 'success');
  };

  /* Direct Download JSON Backup for Developers */
  const handleDownloadBackup = () => {
    const backupPayload = {
      exportedAt: new Date().toISOString(),
      workspace: activeWorkspace,
      user: {
        name: currentUser.name,
        email: accountEmail,
        team: accountTeam,
        role: accountRole,
      },
      settings: {
        theme,
        dnd: isDndActive,
        mute: isMuteActive,
      },
      channel: activeChannel,
      totalMessages: messages.length,
      messages: messages.map(m => ({
        id: m.id,
        sender: m.sender.name,
        role: m.sender.role,
        content: m.content,
        timestamp: m.timestamp,
        reactions: m.reactions,
        poll: m.poll,
      })),
      tasks: tasks,
    };

    const blob = new Blob([JSON.stringify(backupPayload, null, 2)], { type: 'application/json' });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `officechat-backup-${activeChannel}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);
    addToast('Downloaded chat backup JSON archive', 'success');
  };

  /* Change authenticated user password */
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPasswordInput || !newPasswordInput) {
      setPasswordChangeStatus({ text: 'Please enter both current and new password', success: false });
      return;
    }
    if (newPasswordInput.length < 8) {
      setPasswordChangeStatus({ text: 'New password must be at least 8 characters long', success: false });
      return;
    }
    if (newPasswordInput !== confirmPasswordInput) {
      setPasswordChangeStatus({ text: 'New password and confirmation do not match', success: false });
      return;
    }
    setIsChangingPassword(true);
    setPasswordChangeStatus(null);
    try {
      const res = await chatApi.changePassword(currentPasswordInput, newPasswordInput);
      setPasswordChangeStatus({ text: res.message || 'Password updated successfully!', success: true });
      setCurrentPasswordInput('');
      setNewPasswordInput('');
      setConfirmPasswordInput('');
      addToast('Password updated successfully', 'success');
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Failed to update password';
      setPasswordChangeStatus({ text: errMsg, success: false });
      addToast(errMsg, 'error');
    } finally {
      setIsChangingPassword(false);
    }
  };

  /* Create new Channel */
  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newChannelName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (!cleanName) {
      addToast('Please enter a valid channel name', 'warning');
      return;
    }
    if (!activeWorkspaceId) {
      addToast('No active workspace selected', 'error');
      return;
    }
    setIsCreatingChannel(true);
    try {
      const created = await chatApi.createChannel(activeWorkspaceId, {
        name: cleanName,
        description: newChannelDesc.trim() || undefined,
        is_private: newChannelIsPrivate,
      });
      addToast(`Channel #${created.name} created!`, 'success');
      setShowCreateChannelModal(false);
      setNewChannelName('');
      setNewChannelDesc('');
      setNewChannelIsPrivate(false);
      await loadWorkspaceBootstrap();
      setActiveConversationId(created.id);
      setActiveChannel(created.name);
      setActiveTab('chat');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create channel';
      addToast(msg, 'error');
    } finally {
      setIsCreatingChannel(false);
    }
  };

  /* Debounced backend search for Command Palette */
  useEffect(() => {
    if (!showCommandPalette || !activeWorkspaceId || searchQuery.trim().length < 2) {
      setSearchResults({ messages: [], attachments: [] });
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const handler = setTimeout(async () => {
      try {
        const results = await chatApi.searchWorkspace(activeWorkspaceId, searchQuery.trim());
        setSearchResults(results);
      } catch {
        setSearchResults({ messages: [], attachments: [] });
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(handler);
  }, [searchQuery, showCommandPalette, activeWorkspaceId]);

  /* Format content with mentions and markdown bold */
  const renderMessageContent = (text: string) => {
    const parts = text.split(/(@\w+)/g);
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        return (
          <span key={i} className="mention-chip">
            {part}
          </span>
        );
      }
      if (part.includes('**')) {
        const subParts = part.split('**');
        return (
          <span key={i}>
            {subParts.map((sub, j) =>
              j % 2 === 1 ? (
                <strong key={j} style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                  {sub}
                </strong>
              ) : (
                sub
              )
            )}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  const channels = conversations
    .filter(c => c.kind === 'channel' && !c.isArchived)
    .map(c => ({ id: c.id, name: c.name, isPrivate: Boolean(c.isPrivate), unread: c.unreadCount }));



  const getStatusColor = (status: User['status']) => {
    switch (status) {
      case 'online': return 'var(--status-online)';
      case 'away': return 'var(--status-away)';
      case 'dnd': return 'var(--status-dnd)';
      default: return 'var(--status-offline)';
    }
  };

  return (
    <div className="app-shell">
      {/* ====================================================================
          1. CHANNELS & DMs SIDEBAR (Surface Level 2)
          ==================================================================== */}
      <aside
        className={`sidebar-responsive ${isMobileMenuOpen ? 'open' : ''}`}
      >
        {/* Workspace Title & Settings Header */}
        <div
          style={{
            height: '52px',
            padding: '0 var(--space-3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '6px',
            borderBottom: '1px solid var(--border-subtle)',
            flexShrink: 0
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeWorkspace}</span>
              <ChevronDown size={14} color="var(--text-muted)" style={{ flexShrink: 0 }} />
            </div>
            <div style={{ fontSize: 'var(--text-2xs)', color: wsConnected ? 'var(--success)' : 'var(--warning)', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 500, whiteSpace: 'nowrap' }}>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: wsConnected ? 'var(--success)' : 'var(--warning)', flexShrink: 0 }} />
              <span>{wsConnected ? 'Live REST & WS' : 'Connecting...'}</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            {/* Prominent Admin Console entry in top workspace header */}
            {(currentUser.role.toLowerCase() === 'owner' || currentUser.role.toLowerCase() === 'admin') && (
              <button
                id="btn-admin-console-header"
                onClick={() => { setShowAdminConsole(true); setIsMobileMenuOpen(false); }}
                title="Admin Console (Owner/Admin)"
                data-tooltip="Admin Console"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 7px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--primary-subtle)',
                  border: '1px solid var(--primary-border)',
                  color: 'var(--primary)',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all var(--transition-fast)'
                }}
              >
                <Shield size={12} />
                <span>Admin</span>
              </button>
            )}
            <button
              onClick={() => { setShowCreateChannelModal(true); setIsMobileMenuOpen(false); }}
              data-tooltip="Create Channel"
              title="Create Channel"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
                padding: '4px 7px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--surface-hover)',
                border: '1px solid var(--border-default)',
                color: 'var(--text-primary)',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all var(--transition-fast)'
              }}
            >
              <Plus size={13} />
              <span>Channel</span>
            </button>
            <button
              onClick={() => { openSettingsModal('account'); setIsMobileMenuOpen(false); }}
              data-tooltip="Workspace Settings"
              style={{ padding: '4px', borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)' }}
            >
              <Settings size={15} />
            </button>
            <button
              type="button"
              className="mobile-only-btn"
              onClick={() => setIsMobileMenuOpen(false)}
              title="Close Menu"
              style={{ padding: '4px', borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)' }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* View Switch: Messages vs Tasks */}
        <div style={{ padding: 'var(--space-2) var(--space-3)' }}>
          <div
            style={{
              display: 'flex',
              gap: '2px',
              background: 'var(--surface-input)',
              padding: '3px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)'
            }}
          >
            <button
              onClick={() => { setActiveTab('chat'); setIsMobileMenuOpen(false); }}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                padding: '6px var(--space-2)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--text-xs)',
                fontWeight: 600,
                background: activeTab === 'chat' ? 'var(--surface-level-2)' : 'transparent',
                color: activeTab === 'chat' ? 'var(--text-primary)' : 'var(--text-muted)',
                boxShadow: activeTab === 'chat' ? '0 1px 4px rgba(0,0,0,0.2)' : 'none',
                border: activeTab === 'chat' ? '1px solid var(--border-default)' : '1px solid transparent',
                cursor: 'pointer',
                transition: 'all var(--transition-fast)'
              }}
            >
              <MessageSquare size={13} color={activeTab === 'chat' ? 'var(--primary)' : 'inherit'} />
              Chat
            </button>
            <button
              onClick={() => { setActiveTab('tasks'); setIsMobileMenuOpen(false); }}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                padding: '6px var(--space-2)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--text-xs)',
                fontWeight: 600,
                background: activeTab === 'tasks' ? 'var(--surface-level-2)' : 'transparent',
                color: activeTab === 'tasks' ? 'var(--text-primary)' : 'var(--text-muted)',
                boxShadow: activeTab === 'tasks' ? '0 1px 4px rgba(0,0,0,0.2)' : 'none',
                border: activeTab === 'tasks' ? '1px solid var(--border-default)' : '1px solid transparent',
                cursor: 'pointer',
                transition: 'all var(--transition-fast)'
              }}
            >
              <CheckSquare size={13} color={activeTab === 'tasks' ? 'var(--primary)' : 'inherit'} />
              Tasks
              {tasks.filter(t => t.status !== 'done').length > 0 && (
                <span
                  style={{
                    background: activeTab === 'tasks' ? 'var(--primary)' : 'var(--surface-active)',
                    color: '#fff',
                    fontSize: '10px',
                    fontWeight: 700,
                    padding: '1px 6px',
                    borderRadius: '10px',
                    lineHeight: 1.2
                  }}
                >
                  {tasks.filter(t => t.status !== 'done').length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Search Conversations Filter Bar */}
        <div style={{ padding: '0 var(--space-2) var(--space-2) var(--space-2)' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'var(--surface-input)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              padding: '6px 10px'
            }}
          >
            <Search size={14} color="var(--text-muted)" />
            <input
              type="text"
              placeholder="Search conversations..."
              value={conversationSearch}
              onChange={e => setConversationSearch(e.target.value)}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--text-primary)',
                fontSize: 'var(--text-xs)'
              }}
            />
            {conversationSearch && (
              <button
                type="button"
                onClick={() => setConversationSearch('')}
                style={{ color: 'var(--text-muted)', cursor: 'pointer', padding: '1px' }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Filter Tabs: All, Pinned, Groups, Archived */}
        <div
          style={{
            display: 'flex',
            gap: '5px',
            padding: '0 var(--space-2) var(--space-2) var(--space-2)',
            overflowX: 'auto',
            scrollbarWidth: 'none'
          }}
        >
          {(['all', 'pinned', 'groups', 'archived'] as const).map(tabKey => {
            const isTabActive = conversationFilter === tabKey;
            const count = conversations.filter(c => {
              if (tabKey === 'pinned') return c.isPinned && !c.isArchived;
              if (tabKey === 'groups') return c.isGroup && !c.isArchived;
              if (tabKey === 'archived') return c.isArchived;
              return !c.isArchived;
            }).length;

            return (
              <button
                key={tabKey}
                type="button"
                onClick={() => setConversationFilter(tabKey)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '4px 9px',
                  borderRadius: 'var(--radius-full)',
                  fontSize: '11px',
                  fontWeight: 600,
                  textTransform: 'capitalize',
                  whiteSpace: 'nowrap',
                  background: isTabActive ? 'var(--primary)' : 'var(--surface-hover)',
                  color: isTabActive ? '#ffffff' : 'var(--text-secondary)',
                  border: isTabActive ? '1px solid var(--primary)' : '1px solid var(--border-subtle)',
                  boxShadow: isTabActive ? '0 2px 8px rgba(99, 102, 241, 0.35)' : 'none',
                  cursor: 'pointer',
                  transition: 'all var(--transition-fast)'
                }}
              >
                {tabKey === 'pinned' && <Pin size={11} />}
                {tabKey === 'groups' && <Users size={11} />}
                {tabKey === 'archived' && <Archive size={11} />}
                <span>{tabKey}</span>
                <span
                  style={{
                    fontSize: '10px',
                    opacity: isTabActive ? 0.95 : 0.7,
                    background: isTabActive ? 'rgba(255, 255, 255, 0.22)' : 'rgba(255, 255, 255, 0.06)',
                    padding: '1px 5px',
                    borderRadius: '8px'
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Filtered Conversations List with Chat Rows & Swipe Actions */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 var(--space-2)', display: 'flex', flexDirection: 'column', gap: '3px' }}>
          {conversations
            .filter(c => {
              if (conversationSearch.trim()) {
                const q = conversationSearch.toLowerCase();
                const matches = c.name.toLowerCase().includes(q) || c.lastMessage.toLowerCase().includes(q);
                if (!matches) return false;
              }
              if (conversationFilter === 'pinned') return c.isPinned && !c.isArchived;
              if (conversationFilter === 'groups') return c.isGroup && !c.isArchived;
              if (conversationFilter === 'archived') return c.isArchived;
              return !c.isArchived;
            })
            .sort((a, b) => {
              if (conversationFilter === 'all') {
                if (a.isPinned && !b.isPinned) return -1;
                if (!a.isPinned && b.isPinned) return 1;
              }
              return 0;
            })
            .map(c => {
              const isActive = (activeConversationId === c.id) || (activeChannel === c.name && activeTab === 'chat');

              return (
                <div
                  key={c.id}
                  className={`chat-row ${isActive ? 'active' : ''}`}
                  onClick={() => handleSelectConversation(c)}
                >
                  {/* Avatar */}
                  <div style={{ position: 'relative', width: '38px', height: '38px', flexShrink: 0 }}>
                    {c.isGroup ? (
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          borderRadius: 'var(--radius-md)',
                          background: isActive ? 'var(--primary)' : 'var(--surface-input)',
                          border: '1px solid var(--border-subtle)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: isActive ? '#fff' : 'var(--primary)',
                          fontWeight: 700
                        }}
                      >
                        {c.isPrivate ? <Lock size={15} /> : <Hash size={16} />}
                      </div>
                    ) : (
                      <>
                        <img
                          src={c.avatar}
                          alt={c.name}
                          style={{ width: '100%', height: '100%', borderRadius: 'var(--radius-full)', objectFit: 'cover' }}
                        />
                        {c.status && (
                          <span
                            style={{
                              position: 'absolute',
                              bottom: '-1px',
                              right: '-1px',
                              width: '9px',
                              height: '9px',
                              borderRadius: 'var(--radius-full)',
                              background: getStatusColor(c.status),
                              border: '2px solid var(--surface-level-2)'
                            }}
                          />
                        )}
                      </>
                    )}
                  </div>

                  {/* Chat Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
                      <span style={{ fontWeight: isActive || c.unreadCount > 0 ? 700 : 500, fontSize: 'var(--text-sm)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.name}
                      </span>
                      <span style={{ fontSize: '10px', color: c.unreadCount > 0 ? 'var(--primary)' : 'var(--text-muted)', fontWeight: c.unreadCount > 0 ? 700 : 400, flexShrink: 0 }}>
                        {c.timestamp}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                      <span style={{ fontSize: 'var(--text-xs)', color: c.unreadCount > 0 ? 'var(--text-primary)' : 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.lastMessage}
                      </span>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
                        {c.isMuted && <VolumeX size={12} color="var(--text-muted)" data-tooltip="Muted" />}
                        {c.isPinned && <Pin size={11} color="var(--primary)" data-tooltip="Pinned" />}
                        {c.unreadCount > 0 && (
                          <span
                            style={{
                              background: 'var(--primary)',
                              color: '#fff',
                              fontSize: '10px',
                              fontWeight: 700,
                              padding: '1px 6px',
                              borderRadius: 'var(--radius-full)',
                              minWidth: '16px',
                              textAlign: 'center'
                            }}
                          >
                            {c.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Swipe / Hover Quick Action Buttons */}
                  <div className="chat-row-actions" onClick={e => e.stopPropagation()}>
                    <button
                      type="button"
                      className="chat-action-btn"
                      onClick={e => handleTogglePin(c.id, e)}
                      data-tooltip={c.isPinned ? 'Unpin' : 'Pin to top'}
                    >
                      {c.isPinned ? <PinOff size={13} color="var(--primary)" /> : <Pin size={13} />}
                    </button>
                    <button
                      type="button"
                      className="chat-action-btn"
                      onClick={e => handleToggleMute(c.id, e)}
                      data-tooltip={c.isMuted ? 'Unmute' : 'Mute'}
                    >
                      {c.isMuted ? <Volume2 size={13} color="var(--warning)" /> : <VolumeX size={13} />}
                    </button>
                    <button
                      type="button"
                      className="chat-action-btn"
                      onClick={e => handleToggleArchive(c.id, e)}
                      data-tooltip={c.isArchived ? 'Unarchive' : 'Archive'}
                    >
                      <Archive size={13} color={c.isArchived ? 'var(--primary)' : 'currentColor'} />
                    </button>
                    <button
                      type="button"
                      className="chat-action-btn delete"
                      onClick={e => handleDeleteConversation(c.id, e)}
                      data-tooltip="Delete chat"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
        </div>

        {/* User Profile Mini Bar (Sidebar Footer) */}
        <div
          style={{
            padding: 'var(--space-2) var(--space-3)',
            borderTop: '1px solid var(--border-subtle)',
            background: 'var(--surface-level-2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div
            onClick={() => openSettingsModal('account')}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', flex: 1, minWidth: 0 }}
          >
            <div style={{ position: 'relative', width: '30px', height: '30px', flexShrink: 0 }}>
              <img
                src={currentUser.avatar}
                alt={currentUser.name}
                style={{ width: '100%', height: '100%', borderRadius: 'var(--radius-full)', objectFit: 'cover' }}
              />
              <span
                style={{
                  position: 'absolute',
                  bottom: '-1px',
                  right: '-1px',
                  width: '8px',
                  height: '8px',
                  borderRadius: 'var(--radius-full)',
                  background: getStatusColor(currentUser.status),
                  border: '1.5px solid var(--surface-level-2)'
                }}
              />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {currentUser.name}
              </div>
              <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {currentUser.customStatus || currentUser.role}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {/* Admin Console entry: Shield icon renders ONLY if role is 'owner' or 'admin' */}
            {(currentUser.role.toLowerCase() === 'owner' || currentUser.role.toLowerCase() === 'admin') && (
              <button
                id="btn-admin-console-sidebar"
                onClick={() => setShowAdminConsole(true)}
                data-tooltip="Admin Console (Owner/Admin)"
                title="Admin Console"
                style={{
                  padding: '4px',
                  color: 'var(--primary)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--primary-subtle)',
                  border: '1px solid var(--primary-border)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all var(--transition-fast)'
                }}
              >
                <Shield size={14} />
              </button>
            )}

            <button
              onClick={() => setShowAuthModal(true)}
              data-tooltip="User Account & Auth"
              style={{ padding: 'var(--space-1)', color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)', background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              <LogIn size={15} />
            </button>
            <button
              onClick={() => openSettingsModal('account')}
              data-tooltip="Settings & Preferences"
              style={{ padding: 'var(--space-1)', color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)', background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              <Settings size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Drawer Overlay Backdrop */}
      {isMobileMenuOpen && (
        <div
          onClick={() => setIsMobileMenuOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(4px)',
            zIndex: 40
          }}
        />
      )}

      {/* ====================================================================
          3. MAIN CENTER WORKSPACE AREA (Surface Level 1)
          ==================================================================== */}
      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface-level-1)', overflow: 'hidden' }}>
        {/* Top Header Bar (Surface Level 2) */}
        <header className="chat-header">
          {/* Left: Mobile Toggle & Channel Info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0, flex: 1 }}>
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(prev => !prev)}
              data-tooltip="Toggle Sidebar"
              title="Open Menu"
              style={{
                padding: '6px',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                background: 'var(--surface-hover)',
                border: '1px solid var(--border-subtle)',
                flexShrink: 0
              }}
              className="mobile-only-btn"
            >
              <Menu size={18} />
            </button>

            {(() => {
              const activeConv = conversations.find(c => c.name === activeChannel || c.id === activeConversationId);
              if (activeConv && !activeConv.isGroup) {
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                    <div style={{ position: 'relative', width: '28px', height: '28px', flexShrink: 0 }}>
                      <img src={activeConv.avatar} alt={activeConv.name} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                      {activeConv.status && (
                        <span style={{ position: 'absolute', bottom: '-1px', right: '-1px', width: '8px', height: '8px', borderRadius: '50%', background: getStatusColor(activeConv.status), border: '1.5px solid var(--surface-level-2)' }} />
                      )}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeConv.name}</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeConv.role || 'Team Member'} • {activeConv.status || 'Active'}</div>
                    </div>
                  </div>
                );
              }
              return (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 700, fontSize: 'var(--text-md)', color: 'var(--text-primary)', minWidth: 0 }}>
                    <Hash size={17} color="var(--primary)" style={{ flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeChannel}</span>
                  </div>
                  <div className="hide-on-tablet" style={{ width: '1px', height: '16px', background: 'var(--border-subtle)', flexShrink: 0 }} />
                  <div className="hide-on-tablet" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Core architecture discussions & cross-team planning
                  </div>
                </>
              );
            })()}
          </div>

          {/* Right: Search Bar & Unified Secondary Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            {/* Interactive Search Bar with Ctrl+K shortcut badge */}
            <div
              onClick={() => setShowCommandPalette(true)}
              className="header-search-trigger"
              title="Search Workspace (Ctrl+K)"
            >
              <Search size={14} color="var(--text-muted)" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Search messages...
              </span>
              <kbd
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-2xs)',
                  fontWeight: 600,
                  padding: '1px 5px',
                  borderRadius: 'var(--radius-xs)',
                  background: 'var(--surface-hover)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)'
                }}
              >
                Ctrl K
              </kbd>
            </div>

            {/* Unified Secondary Button 1: Poll */}
            <button
              onClick={() => setShowPollModal(true)}
              data-tooltip="Create Poll"
              title="Create Poll"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 9px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--surface-hover)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)',
                fontSize: 'var(--text-xs)',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all var(--transition-fast)'
              }}
            >
              <BarChart2 size={14} color="var(--primary)" />
              <span className="hide-on-mobile">Poll</span>
            </button>

            {/* Unified Secondary Button 2: New Task */}
            <button
              onClick={() => setShowTaskModal(true)}
              data-tooltip="New Task"
              title="New Task"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 9px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--surface-hover)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)',
                fontSize: 'var(--text-xs)',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all var(--transition-fast)'
              }}
            >
              <CheckSquare size={14} color="var(--primary)" />
              <span className="hide-on-mobile">New Task</span>
            </button>

            {/* Live Tunnel / Server Connection Status Pill */}
            <button
              type="button"
              onClick={handleRetryTunnelConnection}
              data-tooltip={
                tunnelState?.activeServerUrl
                  ? `Server: ${tunnelState.activeServerUrl} (Click to verify/reconnect)`
                  : wsConnected
                  ? 'Live WebSocket Connected (Click to verify tunnel)'
                  : 'Reconnecting — Click to discover latest Quick Tunnel URL'
              }
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 8px',
                borderRadius: 'var(--radius-full)',
                background: wsConnected
                  ? 'rgba(16, 185, 129, 0.12)'
                  : tunnelState?.status === 'discovering' || tunnelState?.status === 'reconnecting'
                  ? 'rgba(245, 158, 11, 0.15)'
                  : 'rgba(239, 68, 68, 0.14)',
                border: wsConnected
                  ? '1px solid rgba(16, 185, 129, 0.35)'
                  : tunnelState?.status === 'discovering' || tunnelState?.status === 'reconnecting'
                  ? '1px solid rgba(245, 158, 11, 0.4)'
                  : '1px solid rgba(239, 68, 68, 0.35)',
                color: wsConnected
                  ? 'var(--success)'
                  : tunnelState?.status === 'discovering' || tunnelState?.status === 'reconnecting'
                  ? 'var(--warning)'
                  : 'var(--danger)',
                fontSize: 'var(--text-2xs)',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: wsConnected
                    ? 'var(--success)'
                    : tunnelState?.status === 'discovering' || tunnelState?.status === 'reconnecting'
                    ? 'var(--warning)'
                    : 'var(--danger)'
                }}
              />
              <span className="hide-on-small">
                {wsConnected
                  ? 'Connected'
                  : tunnelState?.status === 'discovering'
                  ? 'Updating Tunnel URL...'
                  : tunnelState?.status === 'reconnecting'
                  ? 'Reconnecting...'
                  : isAuthenticated
                  ? 'Offline • Retry'
                  : 'Sign In'}
              </span>
            </button>

            {/* Member count pill */}
            <div
              className="hide-on-mobile"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '5px 8px',
                borderRadius: 'var(--radius-full)',
                background: 'var(--surface-hover)',
                fontSize: 'var(--text-xs)',
                color: 'var(--text-secondary)',
                fontWeight: 600
              }}
            >
              <Users size={13} />
              <span>{conversations.filter(c => c.kind === 'dm').length + 1}</span>
            </div>

            {/* DND Status Indicator Pill (if active) */}
            {isDndActive && (
              <button
                type="button"
                onClick={() => openSettingsModal('notifications')}
                data-tooltip="DND Active (Click to configure)"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 8px',
                  borderRadius: 'var(--radius-full)',
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: 'var(--danger)',
                  fontSize: 'var(--text-2xs)',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                <BellOff size={12} />
                <span className="hide-on-small">DND</span>
              </button>
            )}

            {/* Muted Status Indicator Pill (if active) */}
            {isMuteActive && (
              <button
                type="button"
                onClick={() => openSettingsModal('notifications')}
                data-tooltip="Sound Muted (Click to configure)"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 8px',
                  borderRadius: 'var(--radius-full)',
                  background: 'rgba(245, 158, 11, 0.15)',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  color: 'var(--warning)',
                  fontSize: 'var(--text-2xs)',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                <VolumeX size={12} />
                <span className="hide-on-small">Muted</span>
              </button>
            )}

            {/* Fast Theme Switcher (Black / White) */}
            <button
              type="button"
              onClick={() => {
                const nextTheme = theme === 'dark' ? 'light' : 'dark';
                setTheme(nextTheme);
                addToast(`Theme switched to ${nextTheme === 'dark' ? 'Black (Dark Mode)' : 'White (Light Mode)'}`, 'info');
              }}
              data-tooltip={`Switch to ${theme === 'dark' ? 'White' : 'Black'} Theme`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '30px',
                height: '30px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--surface-hover)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)',
                cursor: 'pointer'
              }}
            >
              {theme === 'dark' ? <Sun size={14} color="var(--warning)" /> : <Moon size={14} color="var(--primary)" />}
            </button>

            {/* Direct Header Settings Trigger */}
            <button
              type="button"
              onClick={() => openSettingsModal('account')}
              data-tooltip="Workspace Preferences & Settings"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '30px',
                height: '30px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--surface-hover)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)',
                cursor: 'pointer'
              }}
            >
              <Settings size={14} />
            </button>
          </div>
        </header>

        {/* View Switch Content: Chat Feed vs Task Board */}
        {activeTab === 'chat' ? (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
            {/* Center Chat Message Stream */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div className="chat-feed-scroll">
                {/* Tunnel Connection Status & Auto-Discovery Banner */}
                {isAuthenticated && (!wsConnected || tunnelState?.status === 'discovering' || tunnelState?.status === 'reconnecting' || tunnelState?.status === 'error') && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-md)',
                      background:
                        tunnelState?.status === 'error'
                          ? 'rgba(239, 68, 68, 0.12)'
                          : 'rgba(245, 158, 11, 0.14)',
                      border:
                        tunnelState?.status === 'error'
                          ? '1px solid rgba(239, 68, 68, 0.35)'
                          : '1px solid rgba(245, 158, 11, 0.4)',
                      color:
                        tunnelState?.status === 'error'
                          ? 'var(--danger)'
                          : 'var(--warning)',
                      fontSize: 'var(--text-xs)',
                      fontWeight: 600,
                      marginBottom: '8px'
                    }}
                  >
                    <span>
                      {tunnelState?.status === 'discovering'
                        ? 'Cloudflare Quick Tunnel changed — fetching the latest OfficeChat server URL automatically...'
                        : tunnelState?.status === 'reconnecting'
                        ? `Reconnecting to latest tunnel URL (${tunnelState.activeServerUrl || 'same-origin'})...`
                        : tunnelState?.errorMessage
                        ? tunnelState.errorMessage
                        : 'Live connection interrupted — checking for updated Quick Tunnel URL and reconnecting...'}
                    </span>
                    <button
                      type="button"
                      onClick={handleRetryTunnelConnection}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--surface-level-2)',
                        border: '1px solid var(--border-default)',
                        color: 'var(--text-primary)',
                        fontSize: 'var(--text-2xs)',
                        fontWeight: 700,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      Retry Now
                    </button>
                  </div>
                )}

                {/* Error & Loading State Banners */}
                {chatError && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-md)',
                      background: 'rgba(239, 68, 68, 0.12)',
                      border: '1px solid rgba(239, 68, 68, 0.35)',
                      color: 'var(--danger)',
                      fontSize: 'var(--text-xs)',
                      fontWeight: 600,
                      marginBottom: '8px'
                    }}
                  >
                    <span>{chatError}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={handleRetryTunnelConnection}
                        style={{
                          padding: '3px 8px',
                          borderRadius: 'var(--radius-xs)',
                          background: 'var(--surface-level-2)',
                          border: '1px solid rgba(239, 68, 68, 0.35)',
                          color: 'var(--danger)',
                          fontSize: 'var(--text-2xs)',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        Retry
                      </button>
                      <button
                        type="button"
                        onClick={() => setChatError(null)}
                        style={{ color: 'var(--danger)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                )}

                {isLoadingMessages && (
                  <div style={{ textAlign: 'center', padding: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                    Loading conversation history...
                  </div>
                )}

                {/* Date Divider: Today */}
                <div style={{ display: 'flex', alignItems: 'center', margin: 'var(--space-3) 0' }}>
                  <div style={{ flex: 1, height: '1px', background: 'var(--border-subtle)' }} />
                  <span
                    style={{
                      padding: '2px 10px',
                      borderRadius: 'var(--radius-full)',
                      background: 'var(--surface-level-2)',
                      border: '1px solid var(--border-subtle)',
                      fontSize: 'var(--text-2xs)',
                      fontWeight: 600,
                      color: 'var(--text-muted)'
                    }}
                  >
                    Today
                  </span>
                  <div style={{ flex: 1, height: '1px', background: 'var(--border-subtle)' }} />
                </div>

                {/* Render Messages with Sent (Blue Right) vs Received (Gray Left) Bubbles */}
                {messages
                  .filter(m => searchQuery === '' || m.content.toLowerCase().includes(searchQuery.toLowerCase()))
                  .map((msg) => {
                    const isSent = msg.sender.id === currentUser.id || msg.sender.name === currentUser.name;

                    return (
                      <div
                        key={msg.id}
                        className={`message-bubble-wrapper ${isSent ? 'sent' : 'received'} animate-message-enter`}
                        style={{
                          position: 'relative',
                          display: 'flex',
                          alignItems: 'flex-end',
                          gap: '6px',
                          margin: '4px 0'
                        }}
                      >
                        {/* Received message avatar */}
                        {!isSent && (
                          <div style={{ position: 'relative', width: '32px', height: '32px', flexShrink: 0, marginBottom: '2px' }}>
                            <img
                              src={msg.sender.avatar}
                              alt={msg.sender.name}
                              style={{ width: '100%', height: '100%', borderRadius: 'var(--radius-full)', objectFit: 'cover' }}
                            />
                            {msg.sender.status && (
                              <span
                                style={{
                                  position: 'absolute',
                                  bottom: '-1px',
                                  right: '-1px',
                                  width: '8px',
                                  height: '8px',
                                  borderRadius: '50%',
                                  background: getStatusColor(msg.sender.status),
                                  border: '1.5px solid var(--surface-level-1)'
                                }}
                              />
                            )}
                          </div>
                        )}

                        {/* Message Bubble Container */}
                        <div className={`message-bubble ${isSent ? 'bubble-sent' : 'bubble-received'}`}>
                          {/* Floating Hover Action Toolbar */}
                          <div
                            className={`bubble-toolbar ${activeEmojiPickerMsgId === msg.id ? 'active' : ''}`}
                            style={{
                              right: isSent ? 'auto' : '10px',
                              left: isSent ? '10px' : 'auto'
                            }}
                          >
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleReaction(msg.id, '👍');
                              }}
                              data-tooltip="Like"
                              style={{ padding: '2px 5px', fontSize: '13px' }}
                            >
                              👍
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleReaction(msg.id, '❤️');
                              }}
                              data-tooltip="Heart"
                              style={{ padding: '2px 5px', fontSize: '13px' }}
                            >
                              ❤️
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleReaction(msg.id, '🚀');
                              }}
                              data-tooltip="Rocket"
                              style={{ padding: '2px 5px', fontSize: '13px' }}
                            >
                              🚀
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleReaction(msg.id, '🔥');
                              }}
                              data-tooltip="Fire"
                              style={{ padding: '2px 5px', fontSize: '13px' }}
                            >
                              🔥
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveEmojiPickerMsgId(prev => prev === msg.id ? null : msg.id);
                              }}
                              data-tooltip="More Reactions"
                              style={{ padding: '3px 5px', color: 'var(--text-secondary)' }}
                            >
                              <Smile size={13} />
                            </button>
                            <div style={{ width: '1px', height: '12px', background: 'var(--border-subtle)', margin: '0 2px' }} />
                            <button
                              type="button"
                              onClick={() => {
                                setReplyingTo(msg);
                                if (textareaRef.current) textareaRef.current.focus();
                              }}
                              data-tooltip="Reply"
                              style={{ padding: '3px 5px', color: 'var(--text-secondary)' }}
                            >
                              <CornerUpLeft size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => openThreadForMessage(msg)}
                              data-tooltip="Reply in Thread"
                              style={{ padding: '3px 5px', color: 'var(--text-secondary)' }}
                            >
                              <MessageSquare size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setForwardingMessage(msg)}
                              data-tooltip="Forward"
                              style={{ padding: '3px 5px', color: 'var(--text-secondary)' }}
                            >
                              <Forward size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(msg.content);
                                addToast('Copied to clipboard', 'info');
                              }}
                              data-tooltip="Copy"
                              style={{ padding: '3px 5px', color: 'var(--text-secondary)' }}
                            >
                              <Copy size={13} />
                            </button>
                            {isSent && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingMessage(msg);
                                  setMessageInput(msg.content);
                                  if (textareaRef.current) textareaRef.current.focus();
                                }}
                                data-tooltip="Edit Message"
                                style={{ padding: '3px 5px', color: 'var(--text-secondary)' }}
                              >
                                <Edit3 size={13} />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleCreateTaskFromMsg(msg)}
                              data-tooltip="Make Task"
                              style={{ padding: '3px 5px', color: 'var(--text-secondary)' }}
                            >
                              <CheckSquare size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteMessage(msg.id)}
                              data-tooltip="Delete"
                              style={{ padding: '3px 5px', color: 'var(--danger)' }}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>

                          {/* Emoji Reaction Popover */}
                          {activeEmojiPickerMsgId === msg.id && (
                            <div
                              className="emoji-reaction-popover"
                              onClick={e => e.stopPropagation()}
                              style={{
                                right: isSent ? 'auto' : '0',
                                left: isSent ? '0' : 'auto',
                                top: '-38px'
                              }}
                            >
                              {['👍', '❤️', '🚀', '🔥', '🎉', '👏', '😂', '👀', '💯', '✨', '⚡', '💡', '🙌', '😍'].map(emoji => (
                                <button
                                  key={emoji}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleReaction(msg.id, emoji);
                                    setActiveEmojiPickerMsgId(null);
                                  }}
                                  data-tooltip={emoji}
                                >
                                  {emoji}
                                </button>
                              ))}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveEmojiPickerMsgId(null);
                                }}
                                style={{ padding: '2px 4px', color: 'var(--text-muted)' }}
                              >
                                <X size={12} />
                              </button>
                            </div>
                          )}

                          {/* Quoted Replying Header (if message is a reply) */}
                          {msg.replyTo && (
                            <div className="bubble-quote">
                              <div style={{ fontWeight: 700, fontSize: '11px', color: isSent ? '#38bdf8' : 'var(--primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <CornerUpLeft size={11} />
                                <span>{msg.replyTo.senderName}</span>
                              </div>
                              <div style={{ fontSize: '12px', opacity: 0.9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '2px' }}>
                                {msg.replyTo.content}
                              </div>
                            </div>
                          )}

                          {/* Received message author & role header */}
                          {!isSent && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                              <span style={{ fontWeight: 700, fontSize: 'var(--text-xs)', color: 'var(--primary)' }}>
                                {msg.sender.name}
                              </span>
                              <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: 'var(--radius-xs)', background: 'var(--surface-hover)', color: 'var(--text-muted)' }}>
                                {msg.sender.role}
                              </span>
                              {msg.isPinned && (
                                <span style={{ fontSize: '10px', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '2px', fontWeight: 600 }}>
                                  <Pin size={10} /> Pinned
                                </span>
                              )}
                            </div>
                          )}

                          {/* Message Content */}
                          <div style={{ fontSize: 'var(--text-sm)', lineHeight: 1.5, wordBreak: 'break-word' }}>
                            {renderMessageContent(msg.content)}
                          </div>

                          {/* Code Snippet Box (if message contains code) */}
                          {msg.codeSnippet && (
                            <div className="code-block" style={{ position: 'relative', marginTop: '6px' }}>
                              <button
                                onClick={() => handleCopyCode(msg.codeSnippet!.code)}
                                data-tooltip="Copy snippet"
                                style={{
                                  position: 'absolute',
                                  top: '6px',
                                  right: '6px',
                                  padding: '3px 6px',
                                  borderRadius: 'var(--radius-xs)',
                                  background: 'var(--surface-hover)',
                                  border: '1px solid var(--border-subtle)',
                                  color: 'var(--text-secondary)'
                                }}
                              >
                                <Copy size={12} />
                              </button>
                              <pre style={{ margin: 0, fontSize: '12px' }}>
                                <code>{msg.codeSnippet.code}</code>
                              </pre>
                            </div>
                          )}

                          {/* Interactive Poll Card inside bubble */}
                          {msg.poll && (
                            <div
                              className="poll-card"
                              style={{
                                marginTop: 'var(--space-2)',
                                background: isSent ? 'rgba(0, 0, 0, 0.22)' : 'var(--surface-level-3)',
                                border: isSent ? '1px solid rgba(255, 255, 255, 0.15)' : '1px solid var(--border-default)',
                                borderRadius: 'var(--radius-lg)',
                                padding: 'var(--space-3)'
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: 'var(--text-xs)', color: isSent ? '#fff' : 'var(--text-primary)' }}>
                                  <BarChart2 size={14} color={isSent ? '#38bdf8' : 'var(--primary)'} />
                                  <span>{msg.poll.question}</span>
                                </div>
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {msg.poll.options.map(opt => {
                                  const percent = msg.poll!.totalVotes > 0 ? Math.round((opt.votes / msg.poll!.totalVotes) * 100) : 0;
                                  const isSelected = msg.poll!.userVoted === opt.id;

                                  return (
                                    <div
                                      key={opt.id}
                                      onClick={() => handleVotePoll(msg.id, opt.id)}
                                      style={{
                                        position: 'relative',
                                        padding: '7px 10px',
                                        borderRadius: 'var(--radius-sm)',
                                        background: isSelected ? (isSent ? 'rgba(255, 255, 255, 0.22)' : 'var(--primary-subtle)') : (isSent ? 'rgba(0, 0, 0, 0.18)' : 'var(--surface-input)'),
                                        border: isSelected ? '1px solid #38bdf8' : '1px solid var(--border-subtle)',
                                        cursor: 'pointer',
                                        overflow: 'hidden',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                      }}
                                    >
                                      <div
                                        style={{
                                          position: 'absolute',
                                          left: 0,
                                          top: 0,
                                          bottom: 0,
                                          width: `${percent}%`,
                                          background: isSent ? 'rgba(255, 255, 255, 0.15)' : 'rgba(99, 102, 241, 0.18)',
                                          zIndex: 1
                                        }}
                                      />
                                      <div style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-xs)', fontWeight: isSelected ? 700 : 500 }}>
                                        {isSelected && <Check size={12} color={isSent ? '#fff' : 'var(--primary)'} />}
                                        <span>{opt.text}</span>
                                      </div>
                                      <span style={{ position: 'relative', zIndex: 2, fontSize: '11px', fontWeight: 600 }}>
                                        {opt.votes} ({percent}%)
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Attachment Box / Image Preview */}
                          {(() => {
                            const atts = msg.attachments && msg.attachments.length > 0
                              ? msg.attachments
                              : msg.attachment
                              ? [msg.attachment]
                              : [];

                            if (atts.length === 0) return null;

                            return (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                                {atts.map((att) => {
                                  const isImg = att.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(att.name);

                                  if (isImg && att.url) {
                                    return (
                                      <div
                                        key={att.id}
                                        className="attachment-img-card"
                                        style={{
                                          borderRadius: 'var(--radius-md)',
                                          overflow: 'hidden',
                                          border: isSent ? '1px solid rgba(255, 255, 255, 0.2)' : '1px solid var(--border-subtle)',
                                          cursor: 'pointer',
                                          position: 'relative'
                                        }}
                                        onClick={() => setPreviewImageUrl(att.url!)}
                                      >
                                        <img
                                          src={att.url}
                                          alt={att.name}
                                          style={{
                                            width: '100%',
                                            maxHeight: '220px',
                                            objectFit: 'cover',
                                            display: 'block'
                                          }}
                                        />
                                        <div
                                          style={{
                                            padding: '6px 8px',
                                            background: isSent ? 'rgba(0, 0, 0, 0.45)' : 'var(--surface-level-3)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            fontSize: '11px'
                                          }}
                                        >
                                          <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '180px' }}>
                                            {att.name}
                                          </span>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <span style={{ opacity: 0.75 }}>{att.size}</span>
                                            <button
                                              type="button"
                                              onClick={e => {
                                                e.stopPropagation();
                                                handleDownloadAttachment(att);
                                              }}
                                              style={{ background: 'transparent', border: 'none', color: isSent ? '#fff' : 'var(--primary)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                                              data-tooltip="Download image"
                                            >
                                              <Download size={13} />
                                            </button>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  }

                                  return (
                                    <div
                                      key={att.id}
                                      className="attachment-card"
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: '10px',
                                        padding: '8px 12px',
                                        borderRadius: 'var(--radius-md)',
                                        background: isSent ? 'rgba(0, 0, 0, 0.2)' : 'var(--surface-input)',
                                        border: isSent ? '1px solid rgba(255, 255, 255, 0.15)' : '1px solid var(--border-subtle)',
                                        fontSize: 'var(--text-xs)'
                                      }}
                                    >
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                                        <div
                                          style={{
                                            width: '28px',
                                            height: '28px',
                                            borderRadius: 'var(--radius-sm)',
                                            background: isSent ? 'rgba(255, 255, 255, 0.15)' : 'var(--primary-subtle)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            flexShrink: 0
                                          }}
                                        >
                                          <Paperclip size={14} color={isSent ? '#fff' : 'var(--primary)'} />
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                                          <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {att.name}
                                          </span>
                                          <span style={{ opacity: 0.75, fontSize: '10px' }}>{att.size}</span>
                                        </div>
                                      </div>

                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDownloadAttachment(att);
                                        }}
                                        data-tooltip="Download file"
                                        style={{
                                          padding: '5px 8px',
                                          borderRadius: 'var(--radius-sm)',
                                          background: isSent ? 'rgba(255, 255, 255, 0.2)' : 'var(--surface-hover)',
                                          color: isSent ? '#fff' : 'var(--text-primary)',
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: '4px',
                                          fontSize: '11px',
                                          fontWeight: 600,
                                          cursor: 'pointer',
                                          border: 'none'
                                        }}
                                      >
                                        <Download size={12} />
                                        <span>Download</span>
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })()}

                          {/* Reaction Chips Bar */}
                          {msg.reactions && msg.reactions.length > 0 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '6px', flexWrap: 'wrap' }}>
                              {msg.reactions.map((r, idx) => {
                                const hasReacted = r.users.includes(currentUser.id) || r.users.includes(currentUser.name);
                                return (
                                  <button
                                    key={idx}
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleToggleReaction(msg.id, r.emoji);
                                    }}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '3px',
                                      padding: '1px 6px',
                                      borderRadius: 'var(--radius-full)',
                                      background: hasReacted ? 'rgba(255, 255, 255, 0.3)' : (isSent ? 'rgba(0, 0, 0, 0.2)' : 'var(--surface-hover)'),
                                      border: hasReacted ? '1px solid rgba(255, 255, 255, 0.6)' : '1px solid var(--border-subtle)',
                                      fontSize: '11px',
                                      color: isSent ? '#ffffff' : (hasReacted ? 'var(--primary)' : 'var(--text-secondary)'),
                                      fontWeight: 600,
                                      cursor: 'pointer'
                                    }}
                                  >
                                    <span>{r.emoji}</span>
                                    <span>{r.count}</span>
                                  </button>
                                );
                              })}
                              {/* Add Reaction Button Chip */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveEmojiPickerMsgId(prev => prev === msg.id ? null : msg.id);
                                }}
                                data-tooltip="Add reaction"
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '2px',
                                  padding: '1px 5px',
                                  borderRadius: 'var(--radius-full)',
                                  background: isSent ? 'rgba(0, 0, 0, 0.2)' : 'var(--surface-hover)',
                                  border: '1px solid var(--border-subtle)',
                                  fontSize: '11px',
                                  color: isSent ? '#fff' : 'var(--text-secondary)',
                                  cursor: 'pointer'
                                }}
                              >
                                <Smile size={11} />
                                <span style={{ fontSize: '10px', fontWeight: 700 }}>+</span>
                              </button>
                            </div>
                          )}

                          {/* Thread Replies Badge */}
                          {((msg.replies && msg.replies.length > 0) || (msg.replyCount && msg.replyCount > 0)) && (
                            <div style={{ marginTop: '6px' }}>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openThreadForMessage(msg);
                                }}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '5px',
                                  padding: '2px 8px',
                                  borderRadius: 'var(--radius-full)',
                                  background: isSent ? 'rgba(0, 0, 0, 0.22)' : 'var(--primary-subtle)',
                                  border: isSent ? '1px solid rgba(255, 255, 255, 0.25)' : '1px solid var(--primary-border)',
                                  color: isSent ? '#ffffff' : 'var(--primary)',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  cursor: 'pointer'
                                }}
                              >
                                <MessageSquare size={11} />
                                <span>
                                  {Math.max(msg.replies?.length || 0, msg.replyCount || 0)}{' '}
                                  {Math.max(msg.replies?.length || 0, msg.replyCount || 0) === 1 ? 'reply' : 'replies'}
                                </span>
                              </button>
                            </div>
                          )}

                          {/* Bubble Meta Footer: Timestamp & Delivery Status Ticks */}
                          <div className="bubble-meta">
                            <span>{msg.timestamp}</span>
                            {msg.isEdited && <span style={{ opacity: 0.8, fontStyle: 'italic', fontSize: '10px' }}>(edited)</span>}
                            {/* Delivery Status Indicator for Sent Messages */}
                            {isSent && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: '2px' }}>
                                {msg.status === 'read' ? (
                                  <span className="tick-read" data-tooltip="Read by team">
                                    <CheckCheck size={14} />
                                  </span>
                                ) : msg.status === 'delivered' ? (
                                  <span className="tick-delivered" data-tooltip="Delivered">
                                    <CheckCheck size={14} />
                                  </span>
                                ) : (
                                  <span className="tick-sent" data-tooltip="Sent">
                                    <Check size={13} />
                                  </span>
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                <div ref={messagesEndRef} />
              </div>

              {/* ================================================================
                  MESSAGE BOX (COMPOSER)
                  Emoji, Attachment +, Inside: clip, photo shortcut, Send plane
                  States: typing, replying preview, editing preview
                  ================================================================ */}
              <div className="composer-wrapper">
                {/* Live Typing Indicator Bar */}
                {Object.values(typingUsers).length > 0 && (
                  <div
                    style={{
                      fontSize: '11px',
                      color: 'var(--primary)',
                      fontWeight: 600,
                      padding: '2px 6px 6px 6px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <span
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        background: 'var(--primary)',
                        display: 'inline-block'
                      }}
                    />
                    <span>
                      {Object.values(typingUsers).join(', ')}{' '}
                      {Object.values(typingUsers).length === 1 ? 'is typing...' : 'are typing...'}
                    </span>
                  </div>
                )}

                {/* Replying Preview Banner */}
                {replyingTo && (
                  <div className="composer-preview-banner">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                      <CornerUpLeft size={14} color="var(--primary)" />
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        Replying to <strong style={{ color: 'var(--text-primary)' }}>{replyingTo.sender.name}</strong>: "{replyingTo.content.slice(0, 50)}..."
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setReplyingTo(null)}
                      style={{ color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}

                {/* Editing Preview Banner */}
                {editingMessage && (
                  <div className="composer-preview-banner">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                      <Edit3 size={14} color="var(--warning)" />
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        Editing message: "<span style={{ color: 'var(--text-primary)' }}>{editingMessage.content.slice(0, 50)}...</span>"
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingMessage(null);
                        setMessageInput('');
                      }}
                      style={{ color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}

                {/* Hidden Native File Inputs for Real Attachments */}
                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  multiple
                  onChange={handleFileSelect}
                />
                <input
                  type="file"
                  ref={imageInputRef}
                  accept="image/*"
                  style={{ display: 'none' }}
                  multiple
                  onChange={handleFileSelect}
                />
                <input
                  type="file"
                  ref={cameraInputRef}
                  accept="image/*"
                  capture="environment"
                  style={{ display: 'none' }}
                  onChange={handleFileSelect}
                />

                <form
                  onSubmit={handleSendMessage}
                  className="composer-dock"
                  style={{
                    borderRadius: (replyingTo || editingMessage) ? '0 0 var(--radius-xl) var(--radius-xl)' : 'var(--radius-xl)',
                    padding: 'var(--space-2) var(--space-3)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px'
                  }}
                >
                  {/* Attachment Preview Chips */}
                  {composerAttachments.length > 0 && (
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', paddingBottom: '4px' }}>
                      {composerAttachments.map(att => {
                        const isImg = att.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(att.name);
                        return (
                          <div
                            key={att.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              background: 'var(--surface-input)',
                              border: '1px solid var(--border-subtle)',
                              borderRadius: 'var(--radius-sm)',
                              padding: '3px 8px',
                              fontSize: 'var(--text-xs)'
                            }}
                          >
                            {isImg && att.url ? (
                              <img src={att.url} alt={att.name} style={{ width: '22px', height: '22px', borderRadius: '3px', objectFit: 'cover' }} />
                            ) : (
                              <Paperclip size={12} color="var(--primary)" />
                            )}
                            <span style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.name}</span>
                            <span style={{ opacity: 0.75, fontSize: '10px' }}>({att.size})</span>
                            <button
                              type="button"
                              onClick={() => setComposerAttachments(prev => prev.filter(a => a.id !== att.id))}
                              style={{ color: 'var(--text-muted)', marginLeft: '4px', cursor: 'pointer', background: 'transparent', border: 'none', display: 'flex' }}
                            >
                              <X size={12} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* COMPOSER INPUT ROW */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {/* Left Icons: Emoji picker + Attachment + */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '2px', position: 'relative' }}>
                        <button
                          type="button"
                          onClick={() => setShowEmojiPicker(prev => !prev)}
                          data-tooltip="Emoji picker"
                          style={{ padding: '6px', borderRadius: 'var(--radius-sm)', color: showEmojiPicker ? 'var(--primary)' : 'var(--text-secondary)', cursor: 'pointer' }}
                        >
                          <Smile size={18} />
                        </button>

                        {/* Emoji Popover */}
                        {showEmojiPicker && (
                          <div
                            style={{
                              position: 'absolute',
                              bottom: 'calc(100% + 10px)',
                              left: 0,
                              background: 'var(--surface-level-3)',
                              border: '1px solid var(--border-default)',
                              borderRadius: 'var(--radius-md)',
                              padding: '8px 10px',
                              display: 'flex',
                              flexWrap: 'wrap',
                              maxWidth: 'calc(100vw - 32px)',
                              gap: '6px',
                              boxShadow: 'var(--shadow-floating)',
                              zIndex: 100
                            }}
                          >
                            {['😀', '🚀', '🔥', '🎉', '👍', '❤️', '💡', '👀', '✨', '⚡'].map(emoji => (
                              <button
                                key={emoji}
                                type="button"
                                onClick={() => {
                                  setMessageInput(prev => prev + ' ' + emoji + ' ');
                                  setShowEmojiPicker(false);
                                }}
                                style={{ padding: '4px', fontSize: '16px', cursor: 'pointer' }}
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => setShowAttachmentMenu(prev => !prev)}
                          data-tooltip="Attachment options"
                          style={{ padding: '6px', borderRadius: 'var(--radius-sm)', color: showAttachmentMenu ? 'var(--primary)' : 'var(--text-secondary)', cursor: 'pointer' }}
                        >
                          <Plus size={18} />
                        </button>

                        {/* Attachment Options Popover */}
                        {showAttachmentMenu && (
                          <div
                            style={{
                              position: 'absolute',
                              bottom: 'calc(100% + 10px)',
                              left: 0,
                              background: 'var(--surface-level-3)',
                              border: '1px solid var(--border-default)',
                              borderRadius: 'var(--radius-md)',
                              padding: '6px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '2px',
                              boxShadow: 'var(--shadow-floating)',
                              zIndex: 100,
                              width: '210px',
                              maxWidth: 'calc(100vw - 32px)'
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                fileInputRef.current?.click();
                                setShowAttachmentMenu(false);
                              }}
                              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontSize: 'var(--text-xs)', cursor: 'pointer', background: 'transparent', border: 'none' }}
                            >
                              <Paperclip size={14} color="var(--primary)" />
                              <span>Attach Document / File</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                imageInputRef.current?.click();
                                setShowAttachmentMenu(false);
                              }}
                              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontSize: 'var(--text-xs)', cursor: 'pointer', background: 'transparent', border: 'none' }}
                            >
                              <Camera size={14} color="var(--success)" />
                              <span>Attach Photo / Image</span>
                            </button>
                            <div style={{ height: '1px', background: 'var(--border-subtle)', margin: '3px 0' }} />
                            <button
                              type="button"
                              onClick={() => {
                                setShowPollModal(true);
                                setShowAttachmentMenu(false);
                              }}
                              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontSize: 'var(--text-xs)', cursor: 'pointer', background: 'transparent', border: 'none' }}
                            >
                              <BarChart2 size={14} color="var(--warning)" />
                              <span>Create Team Poll</span>
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Inside Controls: Clip & Camera shortcuts */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1px' }}>
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          data-tooltip="Attach file from device"
                          style={{ padding: '5px', color: 'var(--text-muted)', cursor: 'pointer', background: 'transparent', border: 'none' }}
                        >
                          <Paperclip size={16} />
                        </button>

                        <button
                          type="button"
                          onClick={() => imageInputRef.current?.click()}
                          data-tooltip="Attach photo from device"
                          style={{ padding: '5px', color: 'var(--text-muted)', cursor: 'pointer', background: 'transparent', border: 'none' }}
                        >
                          <Camera size={16} />
                        </button>
                      </div>

                      {/* Auto-growing Text Field */}
                      <textarea
                        ref={textareaRef}
                        rows={1}
                        placeholder="Type a message..."
                        value={messageInput}
                        onChange={handleTextareaChange}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendMessage();
                          }
                        }}
                        style={{
                          flex: 1,
                          background: 'transparent',
                          border: 'none',
                          outline: 'none',
                          resize: 'none',
                          fontSize: 'var(--text-sm)',
                          color: 'var(--text-primary)',
                          lineHeight: 1.5,
                          padding: '6px 0',
                          maxHeight: '140px'
                        }}
                      />

                      {/* Right: Send Button */}
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <button
                          type="submit"
                          disabled={isSendingMessage || (!messageInput.trim() && composerAttachments.length === 0)}
                          className={!isSendingMessage && (messageInput.trim() || composerAttachments.length > 0) ? 'send-btn-primary' : 'send-btn-disabled'}
                          data-tooltip={isSendingMessage ? 'Sending...' : 'Send message (Enter)'}
                        >
                          <Send size={15} style={{ transform: 'translateX(1px)', opacity: isSendingMessage ? 0.5 : 1 }} />
                        </button>
                      </div>
                    </div>
                </form>
              </div>
            </div>

            {/* ================================================================
                9. SLIDE-IN THREAD / DETAILS PANEL (Surface Level 2)
                ================================================================ */}
            {activeThreadMessage && (
              <aside
                className="thread-panel animate-slide-panel"
              >
                {/* Thread Header */}
                <div
                  style={{
                    height: '52px',
                    padding: '0 var(--space-4)',
                    borderBottom: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <MessageSquare size={16} color="var(--primary)" />
                    <span>Thread</span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 500 }}>
                      #{activeChannel}
                    </span>
                  </div>
                  <button
                    onClick={() => setActiveThreadMessage(null)}
                    style={{ color: 'var(--text-secondary)', padding: 'var(--space-1)' }}
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Original Message Preview */}
                <div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-level-1)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <img
                      src={activeThreadMessage.sender.avatar}
                      alt={activeThreadMessage.sender.name}
                      style={{ width: '28px', height: '28px', borderRadius: 'var(--radius-full)' }}
                    />
                    <span style={{ fontWeight: 600, fontSize: 'var(--text-xs)', color: 'var(--text-primary)' }}>
                      {activeThreadMessage.sender.name}
                    </span>
                    <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                      {activeThreadMessage.timestamp}
                    </span>
                  </div>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    {activeThreadMessage.content}
                  </div>
                </div>

                {/* Thread Replies List */}
                <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  {activeThreadMessage.replies && activeThreadMessage.replies.length > 0 ? (
                    activeThreadMessage.replies.map(rep => (
                      <div key={rep.id} style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <img
                          src={rep.sender.avatar}
                          alt={rep.sender.name}
                          style={{ width: '26px', height: '26px', borderRadius: 'var(--radius-full)', flexShrink: 0 }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontWeight: 600, fontSize: 'var(--text-xs)', color: 'var(--text-primary)' }}>
                              {rep.sender.name}
                            </span>
                            <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                              {rep.timestamp}
                            </span>
                          </div>
                          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', marginTop: '2px' }}>
                            {rep.content}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ textAlign: 'center', padding: 'var(--space-8) 0', color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
                      No replies yet. Start the conversation!
                    </div>
                  )}
                </div>

                {/* Thread Reply Input Box */}
                <div style={{ padding: 'var(--space-3)', borderTop: '1px solid var(--border-subtle)', background: 'var(--surface-level-2)' }}>
                  <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    <input
                      type="text"
                      placeholder="Reply to thread..."
                      value={threadReplyInput}
                      onChange={e => setThreadReplyInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          handleSendThreadReply();
                        }
                      }}
                      style={{
                        flex: 1,
                        background: 'var(--surface-input)',
                        border: '1px solid var(--border-default)',
                        borderRadius: 'var(--radius-md)',
                        padding: '8px 12px',
                        fontSize: 'var(--text-xs)',
                        color: 'var(--text-primary)',
                        outline: 'none'
                      }}
                    />
                    <button
                      onClick={handleSendThreadReply}
                      disabled={!threadReplyInput.trim()}
                      style={{
                        padding: '8px 14px',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--primary)',
                        color: '#fff',
                        fontWeight: 600,
                        fontSize: 'var(--text-xs)'
                      }}
                    >
                      Reply
                    </button>
                  </div>
                </div>
              </aside>
            )}
          </div>
        ) : (
          /* ====================================================================
             TASKS BOARD VIEW (Surface Level 1 & Level 2 Cards)
             ==================================================================== */
          <div className="tasks-board-wrapper">
            <div className="tasks-board-header">
              <div>
                <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                  Office Tasks Board
                </h2>
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                  Action items and follow-ups converted directly from conversations
                </p>
              </div>
              <button
                onClick={() => setShowTaskModal(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--primary)',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 'var(--text-xs)',
                  boxShadow: 'var(--shadow-sm)'
                }}
              >
                <Plus size={15} />
                Create Task
              </button>
            </div>

            {/* 3 Kanban Columns */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap: 'var(--space-4)' }}>
              {/* Column 1: To Do */}
              <div style={{ background: 'var(--surface-level-2)', borderRadius: 'var(--radius-xl)', padding: 'var(--space-4)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: 'var(--radius-full)', background: 'var(--text-muted)' }} />
                    <span>To Do</span>
                  </div>
                  <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--text-muted)' }}>
                    {tasks.filter(t => t.status === 'todo').length}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {tasks.filter(t => t.status === 'todo').map(task => (
                    <div
                      key={task.id}
                      style={{
                        background: 'var(--surface-level-3)',
                        border: '1px solid var(--border-default)',
                        borderRadius: 'var(--radius-md)',
                        padding: 'var(--space-3)',
                        boxShadow: 'var(--shadow-sm)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px'
                      }}
                    >
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {task.title}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                        <span>{task.channel}</span>
                        <span>Due {task.dueDate}</span>
                      </div>
                      <button
                        onClick={() => handleUpdateTaskStatus(task.id, 'in_progress')}
                        style={{
                          marginTop: '4px',
                          padding: '5px',
                          borderRadius: 'var(--radius-xs)',
                          background: 'var(--surface-hover)',
                          color: 'var(--primary)',
                          fontSize: 'var(--text-xs)',
                          fontWeight: 600
                        }}
                      >
                        Start Progress →
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Column 2: In Progress */}
              <div style={{ background: 'var(--surface-level-2)', borderRadius: 'var(--radius-xl)', padding: 'var(--space-4)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: 'var(--radius-full)', background: 'var(--warning)' }} />
                    <span>In Progress</span>
                  </div>
                  <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--text-muted)' }}>
                    {tasks.filter(t => t.status === 'in_progress').length}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {tasks.filter(t => t.status === 'in_progress').map(task => (
                    <div
                      key={task.id}
                      style={{
                        background: 'var(--surface-level-3)',
                        border: '1px solid var(--border-default)',
                        borderRadius: 'var(--radius-md)',
                        padding: 'var(--space-3)',
                        boxShadow: 'var(--shadow-sm)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px'
                      }}
                    >
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {task.title}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                        <span>{task.channel}</span>
                        <span>Due {task.dueDate}</span>
                      </div>
                      <button
                        onClick={() => handleUpdateTaskStatus(task.id, 'done')}
                        style={{
                          marginTop: '4px',
                          padding: '5px',
                          borderRadius: 'var(--radius-xs)',
                          background: 'rgba(16, 185, 129, 0.12)',
                          color: 'var(--success)',
                          fontSize: 'var(--text-xs)',
                          fontWeight: 600
                        }}
                      >
                        Mark Done ✓
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Column 3: Completed */}
              <div style={{ background: 'var(--surface-level-2)', borderRadius: 'var(--radius-xl)', padding: 'var(--space-4)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: 'var(--radius-full)', background: 'var(--success)' }} />
                    <span>Completed</span>
                  </div>
                  <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--text-muted)' }}>
                    {tasks.filter(t => t.status === 'done').length}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {tasks.filter(t => t.status === 'done').map(task => (
                    <div
                      key={task.id}
                      style={{
                        background: 'var(--surface-level-3)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-md)',
                        padding: 'var(--space-3)',
                        opacity: 0.75
                      }}
                    >
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-muted)', textDecoration: 'line-through' }}>
                        {task.title}
                      </div>
                      <div style={{ marginTop: '4px', fontSize: 'var(--text-2xs)', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Check size={12} /> Finished
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ====================================================================
          COMMAND PALETTE MODAL (Ctrl + K)
          ==================================================================== */}
      {showCommandPalette && (
        <div
          onClick={() => setShowCommandPalette(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            paddingTop: '15vh',
            zIndex: 100
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '540px',
              maxWidth: '90vw',
              background: 'var(--surface-level-3)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-xl)',
              boxShadow: 'var(--shadow-floating)',
              overflow: 'hidden'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border-subtle)' }}>
              <Search size={18} color="var(--primary)" />
              <input
                autoFocus
                type="text"
                placeholder="Type a command or search channels, DMs, tasks..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  fontSize: 'var(--text-base)',
                  color: 'var(--text-primary)',
                  paddingLeft: 'var(--space-3)'
                }}
              />
              <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>ESC to close</span>
            </div>

            <div style={{ padding: 'var(--space-2)', maxHeight: '320px', overflowY: 'auto' }}>
              <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', padding: '6px 10px' }}>
                Quick Actions
              </div>

              {/* Admin Console in Command Palette for Owner/Admin */}
              {(currentUser.role.toLowerCase() === 'owner' || currentUser.role.toLowerCase() === 'admin') && (
                <div
                  id="btn-admin-console-cmd-palette"
                  onClick={() => { setShowAdminConsole(true); setShowCommandPalette(false); }}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer', color: 'var(--primary)', fontSize: 'var(--text-sm)', fontWeight: 600 }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--primary-subtle)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <Shield size={16} color="var(--primary)" />
                  <span>Admin Console (Workspace Administration)</span>
                </div>
              )}

              <div
                onClick={() => { setShowPollModal(true); setShowCommandPalette(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 'var(--text-sm)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <BarChart2 size={16} color="var(--primary)" />
                <span>Create a Team Poll</span>
              </div>

              <div
                onClick={() => { setShowTaskModal(true); setShowCommandPalette(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 'var(--text-sm)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <CheckSquare size={16} color="var(--success)" />
                <span>Create an Action Task</span>
              </div>

              <div
                onClick={() => { openSettingsModal('account'); setShowCommandPalette(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 'var(--text-sm)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <UserIcon size={16} color="var(--primary)" />
                <span>Account Profile & Team Role</span>
              </div>

              <div
                onClick={() => { openSettingsModal('notifications'); setShowCommandPalette(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 'var(--text-sm)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <Bell size={16} color="var(--primary)" />
                <span>Notification Preferences (DND & Mute)</span>
              </div>

              <div
                onClick={() => { openSettingsModal('backup'); setShowCommandPalette(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 'var(--text-sm)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <HardDrive size={16} color="var(--primary)" />
                <span>Chat History Backup & Email Dispatch</span>
              </div>

              <div
                onClick={() => { setTheme(prev => prev === 'dark' ? 'light' : 'dark'); setShowCommandPalette(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 'var(--text-sm)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                {theme === 'dark' ? <Sun size={16} color="var(--warning)" /> : <Moon size={16} color="var(--primary)" />}
                <span>Toggle Light / Dark Theme</span>
              </div>

              {/* Search Results from Backend */}
              {searchQuery.trim().length >= 2 && (
                <>
                  <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', padding: '10px 10px 4px 10px' }}>
                    {isSearching ? 'Searching Workspace...' : `Search Results (${searchResults.messages.length} messages, ${searchResults.attachments.length} files)`}
                  </div>
                  {searchResults.messages.length === 0 && searchResults.attachments.length === 0 && !isSearching && (
                    <div style={{ padding: '8px 12px', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                      No matching messages or files found.
                    </div>
                  )}
                  {searchResults.messages.map(sm => (
                    <div
                      key={sm.id}
                      onClick={() => {
                        const targetId = sm.channel_id || sm.dm_group_id;
                        if (targetId) {
                          setActiveConversationId(targetId);
                          const matchedConv = conversations.find(c => c.id === targetId);
                          if (matchedConv) setActiveChannel(matchedConv.name);
                          setActiveTab('chat');
                        }
                        setShowCommandPalette(false);
                      }}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px',
                        padding: '8px 12px',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        color: 'var(--text-primary)',
                        fontSize: 'var(--text-xs)',
                        borderBottom: '1px solid var(--border-subtle)'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontWeight: 600, color: 'var(--primary)' }}>
                          {sm.sender?.display_name || sm.sender?.full_name || 'Member'}
                        </span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                          {formatTime(sm.created_at)}
                        </span>
                      </div>
                      <div style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {sm.content}
                      </div>
                    </div>
                  ))}
                  {searchResults.attachments.map(att => (
                    <div
                      key={att.id}
                      onClick={() => {
                        handleDownloadAttachment({
                          id: att.id,
                          name: att.file_name,
                          size: formatBytes(att.file_size),
                          type: att.content_type,
                          url: resolveApiUrl(att.file_url)
                        });
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '8px 12px',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        color: 'var(--text-primary)',
                        fontSize: 'var(--text-xs)'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <Paperclip size={14} color="var(--primary)" />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.file_name}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{formatBytes(att.file_size)}</span>
                    </div>
                  ))}
                </>
              )}

              <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', padding: '10px 10px 4px 10px' }}>
                Channels
              </div>

              {channels.map(ch => (
                <div
                  key={ch.id}
                  onClick={() => {
                    setActiveConversationId(ch.id);
                    setActiveChannel(ch.name);
                    setActiveTab('chat');
                    setShowCommandPalette(false);
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <Hash size={15} />
                  <span>#{ch.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          MODAL: WORKSPACE PREFERENCES & SETTINGS PANEL
          ==================================================================== */}
      {showStatusModal && (
        <div
          onClick={() => setShowStatusModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="modal-card-responsive"
            style={{
              background: 'var(--surface-level-3)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-xl)',
              width: '640px',
              maxWidth: '95vw',
              maxHeight: '88dvh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: 'var(--shadow-floating)',
              overflow: 'hidden'
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: 'var(--space-4) var(--space-5)',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'var(--surface-level-2)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Settings size={18} color="var(--primary)" />
                <div>
                  <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                    Preferences & Settings
                  </h3>
                  <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                    Manage account profile, notifications, theme, and chat backups
                  </div>
                </div>
              </div>
              <button onClick={() => setShowStatusModal(false)} style={{ color: 'var(--text-muted)', padding: '4px' }}>
                <X size={18} />
              </button>
            </div>

            {/* Navigation Tabs Bar */}
            <div className="settings-tabs-bar">
              <button
                type="button"
                onClick={() => setSettingsTab('account')}
                style={{
                  padding: '10px var(--space-3)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: settingsTab === 'account' ? 'var(--primary)' : 'var(--text-secondary)',
                  borderBottom: settingsTab === 'account' ? '2px solid var(--primary)' : '2px solid transparent',
                  transition: 'all var(--transition-fast)'
                }}
              >
                <UserIcon size={14} />
                <span>Account & Team</span>
              </button>

              <button
                type="button"
                onClick={() => setSettingsTab('notifications')}
                style={{
                  padding: '10px var(--space-3)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: settingsTab === 'notifications' ? 'var(--primary)' : 'var(--text-secondary)',
                  borderBottom: settingsTab === 'notifications' ? '2px solid var(--primary)' : '2px solid transparent',
                  transition: 'all var(--transition-fast)'
                }}
              >
                <Bell size={14} />
                <span>Notifications</span>
                {isDndActive && (
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--danger)' }} />
                )}
              </button>

              <button
                type="button"
                onClick={() => setSettingsTab('theme')}
                style={{
                  padding: '10px var(--space-3)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: settingsTab === 'theme' ? 'var(--primary)' : 'var(--text-secondary)',
                  borderBottom: settingsTab === 'theme' ? '2px solid var(--primary)' : '2px solid transparent',
                  transition: 'all var(--transition-fast)'
                }}
              >
                <Palette size={14} />
                <span>Theme</span>
              </button>

              <button
                type="button"
                onClick={() => setSettingsTab('backup')}
                style={{
                  padding: '10px var(--space-3)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: settingsTab === 'backup' ? 'var(--primary)' : 'var(--text-secondary)',
                  borderBottom: settingsTab === 'backup' ? '2px solid var(--primary)' : '2px solid transparent',
                  transition: 'all var(--transition-fast)'
                }}
              >
                <HardDrive size={14} />
                <span>Chat Backup</span>
              </button>
            </div>

            {/* Modal Body / Tab Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-5)' }}>
              {/* TAB 1: ACCOUNT & TEAM */}
              {settingsTab === 'account' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  {/* Avatar & Role Header Card */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-4)',
                      padding: 'var(--space-3) var(--space-4)',
                      background: 'var(--surface-level-2)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-lg)'
                    }}
                  >
                    <div style={{ position: 'relative' }}>
                      <img
                        src={currentUser.avatar}
                        alt={accountName}
                        style={{ width: '52px', height: '52px', borderRadius: 'var(--radius-full)', objectFit: 'cover' }}
                      />
                      <span
                        style={{
                          position: 'absolute',
                          bottom: '0px',
                          right: '0px',
                          width: '12px',
                          height: '12px',
                          borderRadius: 'var(--radius-full)',
                          background: getStatusColor(currentUser.status),
                          border: '2px solid var(--surface-level-2)'
                        }}
                      />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 'var(--text-md)', color: 'var(--text-primary)' }}>
                        {accountName || 'Anonymous Developer'}
                      </div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                        {accountEmail} • <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{accountRole}</span>
                      </div>
                    </div>
                  </div>

                  {/* 2-Column Fields Grid */}
                  <div className="responsive-grid-2">
                    <div>
                      <label style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                        Account Name
                      </label>
                      <input
                        type="text"
                        value={accountName}
                        onChange={e => setAccountName(e.target.value)}
                        placeholder="Your full name"
                        style={{
                          width: '100%',
                          marginTop: '4px',
                          padding: '8px 12px',
                          borderRadius: 'var(--radius-md)',
                          background: 'var(--surface-input)',
                          border: '1px solid var(--border-default)',
                          color: 'var(--text-primary)',
                          fontSize: 'var(--text-sm)',
                          outline: 'none'
                        }}
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                        Mail ID (Email)
                      </label>
                      <input
                        type="email"
                        value={accountEmail}
                        onChange={e => setAccountEmail(e.target.value)}
                        placeholder="name@company.com"
                        style={{
                          width: '100%',
                          marginTop: '4px',
                          padding: '8px 12px',
                          borderRadius: 'var(--radius-md)',
                          background: 'var(--surface-input)',
                          border: '1px solid var(--border-default)',
                          color: 'var(--text-primary)',
                          fontSize: 'var(--text-sm)',
                          outline: 'none'
                        }}
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                        Team / Workspace
                      </label>
                      <input
                        type="text"
                        value={accountTeam}
                        onChange={e => setAccountTeam(e.target.value)}
                        placeholder="e.g. Core Architecture / Devs"
                        style={{
                          width: '100%',
                          marginTop: '4px',
                          padding: '8px 12px',
                          borderRadius: 'var(--radius-md)',
                          background: 'var(--surface-input)',
                          border: '1px solid var(--border-default)',
                          color: 'var(--text-primary)',
                          fontSize: 'var(--text-sm)',
                          outline: 'none'
                        }}
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                        Workspace Role (RBAC)
                      </label>
                      <select
                        value={accountRole}
                        onChange={e => setAccountRole(e.target.value)}
                        style={{
                          width: '100%',
                          marginTop: '4px',
                          padding: '8px 12px',
                          borderRadius: 'var(--radius-md)',
                          background: 'var(--surface-input)',
                          border: '1px solid var(--border-default)',
                          color: 'var(--text-primary)',
                          fontSize: 'var(--text-sm)',
                          outline: 'none',
                          cursor: 'pointer'
                        }}
                      >
                        <option value="Owner">Owner (Full Admin Access)</option>
                        <option value="Admin">Admin (Admin Console Access)</option>
                        <option value="Member">Member (Standard User)</option>
                        <option value="Guest">Guest (Limited Access)</option>
                      </select>

                      {(accountRole.toLowerCase() === 'owner' || accountRole.toLowerCase() === 'admin') && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowStatusModal(false);
                            setShowAdminConsole(true);
                          }}
                          style={{
                            marginTop: '10px',
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            padding: '8px 12px',
                            borderRadius: 'var(--radius-md)',
                            background: 'var(--primary-subtle)',
                            border: '1px solid var(--primary-border)',
                            color: 'var(--primary)',
                            fontSize: 'var(--text-xs)',
                            fontWeight: 600,
                            cursor: 'pointer'
                          }}
                        >
                          <Shield size={14} />
                          <span>Open Admin Console</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Presence Selector */}
                  <div>
                    <label style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                      Status Presence
                    </label>
                    <div className="presence-grid-4">
                      {(['online', 'away', 'dnd', 'offline'] as const).map(st => (
                        <button
                          key={st}
                          type="button"
                          onClick={() => {
                            setCurrentUser(prev => ({ ...prev, status: st }));
                            if (st === 'dnd') setIsDndActive(true);
                            else setIsDndActive(false);
                          }}
                          style={{
                            padding: '8px 10px',
                            borderRadius: 'var(--radius-md)',
                            background: currentUser.status === st ? 'var(--surface-active)' : 'var(--surface-input)',
                            border: currentUser.status === st ? '1px solid var(--primary)' : '1px solid var(--border-subtle)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px',
                            fontSize: 'var(--text-xs)',
                            fontWeight: 600,
                            color: 'var(--text-primary)',
                            textTransform: 'capitalize'
                          }}
                        >
                          <span style={{ width: '8px', height: '8px', borderRadius: 'var(--radius-full)', background: getStatusColor(st) }} />
                          {st}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Custom Status Message */}
                  <div>
                    <label style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                      Custom Status Message
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Focus time 🎧, In code review, Reviewing PRs..."
                      value={customStatusInput}
                      onChange={e => setCustomStatusInput(e.target.value)}
                      style={{
                        width: '100%',
                        marginTop: '4px',
                        padding: '8px 12px',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--surface-input)',
                        border: '1px solid var(--border-default)',
                        color: 'var(--text-primary)',
                        fontSize: 'var(--text-sm)',
                        outline: 'none'
                      }}
                    />
                  </div>

                  {/* Security & Password Change */}
                  <div
                    style={{
                      marginTop: 'var(--space-2)',
                      padding: 'var(--space-4)',
                      background: 'var(--surface-level-2)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-lg)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 'var(--space-3)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Lock size={16} color="var(--primary)" />
                      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                        Security & Password
                      </span>
                    </div>

                    {passwordChangeStatus && (
                      <div
                        style={{
                          padding: '8px 12px',
                          borderRadius: 'var(--radius-md)',
                          fontSize: 'var(--text-xs)',
                          background: passwordChangeStatus.success ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                          color: passwordChangeStatus.success ? 'var(--success)' : 'var(--danger)',
                          border: `1px solid ${passwordChangeStatus.success ? 'var(--success)' : 'var(--danger)'}`
                        }}
                      >
                        {passwordChangeStatus.text}
                      </div>
                    )}

                    <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                      <div>
                        <label style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                          Current Password
                        </label>
                        <input
                          type="password"
                          value={currentPasswordInput}
                          onChange={e => setCurrentPasswordInput(e.target.value)}
                          placeholder="••••••••"
                          style={{
                            width: '100%',
                            marginTop: '4px',
                            padding: '8px 12px',
                            borderRadius: 'var(--radius-md)',
                            background: 'var(--surface-input)',
                            border: '1px solid var(--border-default)',
                            color: 'var(--text-primary)',
                            fontSize: 'var(--text-sm)',
                            outline: 'none'
                          }}
                        />
                      </div>

                      <div className="responsive-grid-2">
                        <div>
                          <label style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                            New Password
                          </label>
                          <input
                            type="password"
                            value={newPasswordInput}
                            onChange={e => setNewPasswordInput(e.target.value)}
                            placeholder="Min. 8 characters"
                            style={{
                              width: '100%',
                              marginTop: '4px',
                              padding: '8px 12px',
                              borderRadius: 'var(--radius-md)',
                              background: 'var(--surface-input)',
                              border: '1px solid var(--border-default)',
                              color: 'var(--text-primary)',
                              fontSize: 'var(--text-sm)',
                              outline: 'none'
                            }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                            Confirm New Password
                          </label>
                          <input
                            type="password"
                            value={confirmPasswordInput}
                            onChange={e => setConfirmPasswordInput(e.target.value)}
                            placeholder="Min. 8 characters"
                            style={{
                              width: '100%',
                              marginTop: '4px',
                              padding: '8px 12px',
                              borderRadius: 'var(--radius-md)',
                              background: 'var(--surface-input)',
                              border: '1px solid var(--border-default)',
                              color: 'var(--text-primary)',
                              fontSize: 'var(--text-sm)',
                              outline: 'none'
                            }}
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={isChangingPassword || !currentPasswordInput || !newPasswordInput}
                        style={{
                          marginTop: '4px',
                          alignSelf: 'flex-start',
                          padding: '7px 16px',
                          borderRadius: 'var(--radius-md)',
                          background: 'var(--primary)',
                          color: '#fff',
                          fontSize: 'var(--text-xs)',
                          fontWeight: 600,
                          border: 'none',
                          cursor: isChangingPassword || !currentPasswordInput || !newPasswordInput ? 'not-allowed' : 'pointer',
                          opacity: isChangingPassword || !currentPasswordInput || !newPasswordInput ? 0.6 : 1
                        }}
                      >
                        {isChangingPassword ? 'Updating Password...' : 'Update Password'}
                      </button>
                    </form>
                  </div>
                </div>
              )}

              {/* TAB 2: NOTIFICATIONS (DND & MUTE ON/OFF) */}
              {settingsTab === 'notifications' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  {/* DND Toggle Card */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: 'var(--space-4)',
                      background: 'var(--surface-level-2)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-lg)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                      <div
                        style={{
                          width: '36px',
                          height: '36px',
                          borderRadius: 'var(--radius-md)',
                          background: isDndActive ? 'rgba(239, 68, 68, 0.15)' : 'var(--surface-hover)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: isDndActive ? 'var(--danger)' : 'var(--text-secondary)'
                        }}
                      >
                        <BellOff size={18} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
                          Do Not Disturb (DND)
                        </div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: '2px', maxWidth: '380px' }}>
                          Silence all notification alerts, pause message toasts, and display a red busy badge to team members.
                        </div>
                      </div>
                    </div>

                    {/* Switch Button (ON / OFF) */}
                    <button
                      type="button"
                      onClick={() => {
                        const nextDnd = !isDndActive;
                        setIsDndActive(nextDnd);
                        setCurrentUser(prev => ({ ...prev, status: nextDnd ? 'dnd' : 'online' }));
                        addToast(`Do Not Disturb ${nextDnd ? 'Enabled' : 'Disabled'}`, nextDnd ? 'warning' : 'info');
                      }}
                      style={{
                        position: 'relative',
                        width: '48px',
                        height: '26px',
                        borderRadius: '13px',
                        background: isDndActive ? 'var(--danger)' : 'var(--surface-active)',
                        border: '1px solid var(--border-default)',
                        padding: '2px',
                        cursor: 'pointer',
                        transition: 'background var(--transition-fast)'
                      }}
                    >
                      <div
                        style={{
                          width: '20px',
                          height: '20px',
                          borderRadius: '50%',
                          background: '#fff',
                          transform: isDndActive ? 'translateX(22px)' : 'translateX(0px)',
                          transition: 'transform var(--transition-fast)',
                          boxShadow: 'var(--shadow-sm)'
                        }}
                      />
                    </button>
                  </div>

                  {/* Mute Sounds Toggle Card */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: 'var(--space-4)',
                      background: 'var(--surface-level-2)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-lg)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                      <div
                        style={{
                          width: '36px',
                          height: '36px',
                          borderRadius: 'var(--radius-md)',
                          background: isMuteActive ? 'rgba(245, 158, 11, 0.15)' : 'var(--surface-hover)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: isMuteActive ? 'var(--warning)' : 'var(--text-secondary)'
                        }}
                      >
                        {isMuteActive ? <VolumeX size={18} /> : <Volume2 size={18} />}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
                          Mute Sound & Audio Chimes
                        </div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: '2px', maxWidth: '380px' }}>
                          Mute incoming channel notification sounds, direct message chimes, and typing audio triggers.
                        </div>
                      </div>
                    </div>

                    {/* Switch Button (ON / OFF) */}
                    <button
                      type="button"
                      onClick={() => {
                        const nextMute = !isMuteActive;
                        setIsMuteActive(nextMute);
                        addToast(`Sounds ${nextMute ? 'Muted' : 'Unmuted'}`, 'info');
                      }}
                      style={{
                        position: 'relative',
                        width: '48px',
                        height: '26px',
                        borderRadius: '13px',
                        background: isMuteActive ? 'var(--warning)' : 'var(--surface-active)',
                        border: '1px solid var(--border-default)',
                        padding: '2px',
                        cursor: 'pointer',
                        transition: 'background var(--transition-fast)'
                      }}
                    >
                      <div
                        style={{
                          width: '20px',
                          height: '20px',
                          borderRadius: '50%',
                          background: '#fff',
                          transform: isMuteActive ? 'translateX(22px)' : 'translateX(0px)',
                          transition: 'transform var(--transition-fast)',
                          boxShadow: 'var(--shadow-sm)'
                        }}
                      />
                    </button>
                  </div>

                  {/* Notification Email Summary Checkbox */}
                  <div
                    style={{
                      padding: 'var(--space-3) var(--space-4)',
                      background: 'var(--surface-level-2)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-lg)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px'
                    }}
                  >
                    <input
                      type="checkbox"
                      id="emailDigestCheckbox"
                      defaultChecked
                      style={{ accentColor: 'var(--primary)', cursor: 'pointer' }}
                    />
                    <label htmlFor="emailDigestCheckbox" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                      Send daily activity digest & missed @mentions to <strong>{accountEmail}</strong>
                    </label>
                  </div>
                </div>
              )}

              {/* TAB 3: THEME (BLACK / WHITE) */}
              {settingsTab === 'theme' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  <div>
                    <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                      Workspace Color Theme
                    </h4>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                      Choose between Black (Dark Obsidian) and White (Clean Pearl) theme modes.
                    </p>
                  </div>

                  <div className="responsive-grid-2">
                    {/* Theme Option 1: Black (Dark Mode) */}
                    <div
                      onClick={() => {
                        setTheme('dark');
                        addToast('Theme changed to Black (Dark Mode)', 'info');
                      }}
                      style={{
                        padding: 'var(--space-4)',
                        borderRadius: 'var(--radius-xl)',
                        background: '#0b0d14',
                        border: theme === 'dark' ? '2px solid var(--primary)' : '1px solid rgba(255, 255, 255, 0.12)',
                        cursor: 'pointer',
                        boxShadow: theme === 'dark' ? '0 0 16px var(--primary-glow)' : 'none',
                        transition: 'all var(--transition-fast)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px'
                      }}
                    >
                      {/* Mini Mockup Window */}
                      <div style={{ height: '90px', borderRadius: 'var(--radius-md)', background: '#11141d', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', overflow: 'hidden' }}>
                        <div style={{ width: '28px', background: '#090a0f', borderRight: '1px solid rgba(255,255,255,0.06)' }} />
                        <div style={{ width: '45px', background: '#11141d', borderRight: '1px solid rgba(255,255,255,0.06)', padding: '6px' }}>
                          <div style={{ width: '100%', height: '5px', borderRadius: '2px', background: '#6366f1', marginBottom: '4px' }} />
                          <div style={{ width: '70%', height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.2)' }} />
                        </div>
                        <div style={{ flex: 1, background: '#0b0d14', padding: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <div style={{ width: '50%', height: '5px', borderRadius: '2px', background: 'rgba(255,255,255,0.3)' }} />
                          <div style={{ width: '80%', height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.15)' }} />
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)', color: '#f8fafc' }}>
                            Black (Dark Mode)
                          </div>
                          <div style={{ fontSize: 'var(--text-2xs)', color: '#94a3b8' }}>
                            Deep navy/charcoal for low-light focus
                          </div>
                        </div>
                        {theme === 'dark' && (
                          <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                            <Check size={12} />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Theme Option 2: White (Light Mode) */}
                    <div
                      onClick={() => {
                        setTheme('light');
                        addToast('Theme changed to White (Light Mode)', 'info');
                      }}
                      style={{
                        padding: 'var(--space-4)',
                        borderRadius: 'var(--radius-xl)',
                        background: '#ffffff',
                        border: theme === 'light' ? '2px solid var(--primary)' : '1px solid rgba(0, 0, 0, 0.15)',
                        cursor: 'pointer',
                        boxShadow: theme === 'light' ? '0 0 16px var(--primary-glow)' : 'none',
                        transition: 'all var(--transition-fast)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px'
                      }}
                    >
                      {/* Mini Mockup Window */}
                      <div style={{ height: '90px', borderRadius: 'var(--radius-md)', background: '#f8fafc', border: '1px solid rgba(0,0,0,0.08)', display: 'flex', overflow: 'hidden' }}>
                        <div style={{ width: '28px', background: '#f1f5f9', borderRight: '1px solid rgba(0,0,0,0.06)' }} />
                        <div style={{ width: '45px', background: '#ffffff', borderRight: '1px solid rgba(0,0,0,0.06)', padding: '6px' }}>
                          <div style={{ width: '100%', height: '5px', borderRadius: '2px', background: '#6366f1', marginBottom: '4px' }} />
                          <div style={{ width: '70%', height: '4px', borderRadius: '2px', background: 'rgba(0,0,0,0.2)' }} />
                        </div>
                        <div style={{ flex: 1, background: '#f8fafc', padding: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <div style={{ width: '50%', height: '5px', borderRadius: '2px', background: 'rgba(0,0,0,0.3)' }} />
                          <div style={{ width: '80%', height: '4px', borderRadius: '2px', background: 'rgba(0,0,0,0.15)' }} />
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)', color: '#0f172a' }}>
                            White (Light Mode)
                          </div>
                          <div style={{ fontSize: 'var(--text-2xs)', color: '#64748b' }}>
                            Clean pearl palette with high clarity
                          </div>
                        </div>
                        {theme === 'light' && (
                          <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                            <Check size={12} />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: CHAT BACKUP & EXPORT EMAIL */}
              {settingsTab === 'backup' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  <div>
                    <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                      Chat History & Backup Delivery
                    </h4>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                      Export full encrypted channel transcripts, direct messages, and PostgreSQL dumps directly to your email.
                    </p>
                  </div>

                  {/* Backup Destination Email Input */}
                  <div
                    style={{
                      background: 'var(--surface-level-2)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-lg)',
                      padding: 'var(--space-4)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 'var(--space-2)'
                    }}
                  >
                    <label style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                      Backup Destination Email ID
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--surface-input)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: '6px 12px' }}>
                      <Mail size={16} color="var(--primary)" />
                      <input
                        type="email"
                        value={backupEmail}
                        onChange={e => setBackupEmail(e.target.value)}
                        placeholder="your-backup-email@company.com"
                        style={{
                          flex: 1,
                          background: 'transparent',
                          border: 'none',
                          outline: 'none',
                          color: 'var(--text-primary)',
                          fontSize: 'var(--text-sm)'
                        }}
                      />
                    </div>
                    <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                      Encrypted ZIP archive (AES-256) will be dispatched to this email address.
                    </div>
                  </div>

                  {/* Backup Details Card */}
                  <div
                    style={{
                      background: 'var(--surface-level-2)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-lg)',
                      padding: 'var(--space-4)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px'
                    }}
                  >
                    <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Included in Backup Archive:
                    </div>
                    <ul style={{ listStyle: 'none', paddingLeft: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '6px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                      <li style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Check size={13} color="var(--success)" /> All public & private channel messages (#general, #dev-team, #product)
                      </li>
                      <li style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Check size={13} color="var(--success)" /> Direct message threads with timestamps & author metadata
                      </li>
                      <li style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Check size={13} color="var(--success)" /> Action tasks board items, due dates & assignee logs
                      </li>
                      <li style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Check size={13} color="var(--success)" /> Active team polls, options, and registered vote counts
                      </li>
                    </ul>

                    {/* Action Buttons: Dispatch Backup via Email & Direct Download */}
                    <div style={{ marginTop: 'var(--space-2)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={handleSendChatBackup}
                        disabled={!backupEmail}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '9px 18px',
                          borderRadius: 'var(--radius-md)',
                          background: 'var(--primary)',
                          color: '#fff',
                          fontWeight: 600,
                          fontSize: 'var(--text-xs)',
                          cursor: 'pointer',
                          transition: 'all var(--transition-fast)'
                        }}
                      >
                        <Mail size={14} />
                        <span>Send Chat Backup to Email</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleDownloadBackup}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '9px 16px',
                          borderRadius: 'var(--radius-md)',
                          background: 'var(--surface-input)',
                          border: '1px solid var(--border-default)',
                          color: 'var(--text-primary)',
                          fontWeight: 600,
                          fontSize: 'var(--text-xs)',
                          cursor: 'pointer',
                          transition: 'all var(--transition-fast)'
                        }}
                      >
                        <Download size={14} />
                        <span>Download JSON Archive</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: 'var(--space-3) var(--space-5)',
                borderTop: '1px solid var(--border-subtle)',
                background: 'var(--surface-level-2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: 'var(--space-2)'
              }}
            >
              <button
                type="button"
                onClick={() => setShowStatusModal(false)}
                style={{
                  padding: '7px 16px',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--text-secondary)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 500
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveSettings}
                style={{
                  padding: '7px 18px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--primary)',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 'var(--text-xs)'
                }}
              >
                Save Preferences
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          MODAL: FORWARD MESSAGE DIALOG
          ==================================================================== */}
      {forwardingMessage && (
        <div
          onClick={() => setForwardingMessage(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 110
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--surface-level-3)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-xl)',
              width: '440px',
              maxWidth: '92vw',
              padding: 'var(--space-5)',
              boxShadow: 'var(--shadow-floating)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: 'var(--text-base)', color: 'var(--text-primary)' }}>
                <Forward size={18} color="var(--primary)" />
                <span>Forward Message</span>
              </div>
              <button onClick={() => setForwardingMessage(null)} style={{ color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}>
                <X size={16} />
              </button>
            </div>

            <div style={{ padding: '8px 12px', background: 'var(--surface-input)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', marginBottom: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
              "{forwardingMessage.content.slice(0, 100)}{forwardingMessage.content.length > 100 ? '...' : ''}"
            </div>

            <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>
              Select target conversation:
            </div>

            <div style={{ maxHeight: '240px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {conversations.filter(c => !c.isArchived).map(conv => (
                <div
                  key={conv.id}
                  onClick={() => handleForwardMessage(conv)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--surface-hover)',
                    cursor: 'pointer',
                    transition: 'background var(--transition-fast)'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-active)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'var(--surface-hover)'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {conv.isGroup ? <Hash size={14} color="var(--primary)" /> : <img src={conv.avatar} alt={conv.name} style={{ width: '22px', height: '22px', borderRadius: '50%' }} />}
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>{conv.name}</span>
                  </div>
                  <Forward size={14} color="var(--text-muted)" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          MODAL: CREATE LIVE POLL
          ==================================================================== */}
      {showPollModal && (
        <div
          onClick={() => setShowPollModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="modal-card-responsive"
            style={{
              background: 'var(--surface-level-3)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-xl)',
              width: '440px',
              maxWidth: '94vw',
              padding: 'var(--space-6)',
              boxShadow: 'var(--shadow-floating)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: 'var(--text-lg)', color: 'var(--text-primary)' }}>
                <BarChart2 size={18} color="var(--primary)" />
                <span>Create Team Poll</span>
              </div>
              <button onClick={() => setShowPollModal(false)} style={{ color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div>
                <label style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Question
                </label>
                <input
                  type="text"
                  placeholder="e.g. When should we deploy release v1.4?"
                  value={pollQuestion}
                  onChange={e => setPollQuestion(e.target.value)}
                  style={{
                    width: '100%',
                    marginTop: 'var(--space-1)',
                    padding: '9px 12px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--surface-input)',
                    border: '1px solid var(--border-default)',
                    color: 'var(--text-primary)',
                    fontSize: 'var(--text-sm)',
                    outline: 'none'
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Options
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
                  {pollOptions.map((opt, idx) => (
                    <input
                      key={idx}
                      type="text"
                      placeholder={`Option ${idx + 1}`}
                      value={opt}
                      onChange={e => {
                        const next = [...pollOptions];
                        next[idx] = e.target.value;
                        setPollOptions(next);
                      }}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--surface-input)',
                        border: '1px solid var(--border-default)',
                        color: 'var(--text-primary)',
                        fontSize: 'var(--text-sm)',
                        outline: 'none'
                      }}
                    />
                  ))}
                  <button
                    onClick={() => setPollOptions(prev => [...prev, `Option ${prev.length + 1}`])}
                    style={{
                      alignSelf: 'flex-start',
                      fontSize: 'var(--text-xs)',
                      color: 'var(--primary)',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '4px 0'
                    }}
                  >
                    <Plus size={13} /> Add another option
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                <button
                  onClick={() => setShowPollModal(false)}
                  style={{ padding: '8px 16px', borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreatePoll}
                  disabled={!pollQuestion.trim()}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--primary)',
                    color: '#fff',
                    fontWeight: 600,
                    fontSize: 'var(--text-xs)'
                  }}
                >
                  Post Poll
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          MODAL: CREATE TASK
          ==================================================================== */}
      {showTaskModal && (
        <div
          onClick={() => setShowTaskModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="modal-card-responsive"
            style={{
              background: 'var(--surface-level-3)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-xl)',
              width: '420px',
              maxWidth: '94vw',
              padding: 'var(--space-6)',
              boxShadow: 'var(--shadow-floating)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: 'var(--text-lg)', color: 'var(--text-primary)' }}>
                <CheckSquare size={18} color="var(--success)" />
                <span>Create Office Task</span>
              </div>
              <button onClick={() => setShowTaskModal(false)} style={{ color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div>
                <label style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Task Title
                </label>
                <input
                  type="text"
                  placeholder="What needs to be done?"
                  value={newTaskTitle}
                  onChange={e => setNewTaskTitle(e.target.value)}
                  style={{
                    width: '100%',
                    marginTop: 'var(--space-1)',
                    padding: '9px 12px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--surface-input)',
                    border: '1px solid var(--border-default)',
                    color: 'var(--text-primary)',
                    fontSize: 'var(--text-sm)',
                    outline: 'none'
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                <button
                  onClick={() => setShowTaskModal(false)}
                  style={{ padding: '8px 16px', borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateStandaloneTask}
                  disabled={!newTaskTitle.trim()}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--success)',
                    color: '#fff',
                    fontWeight: 600,
                    fontSize: 'var(--text-xs)'
                  }}
                >
                  Create Task
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          MODAL: CREATE CHANNEL
          ==================================================================== */}
      {showCreateChannelModal && (
        <div
          onClick={() => setShowCreateChannelModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="modal-card-responsive"
            style={{
              width: '460px',
              maxWidth: '94vw',
              background: 'var(--surface-level-3)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-xl)',
              padding: 'var(--space-5)',
              boxShadow: 'var(--shadow-floating)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Hash size={20} color="var(--primary)" />
                <h3 style={{ fontSize: 'var(--text-md)', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  Create a Channel
                </h3>
              </div>
              <button onClick={() => setShowCreateChannelModal(false)} style={{ color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateChannel} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div>
                <label style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Channel Name
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px', background: 'var(--surface-input)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: '8px 12px' }}>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>#</span>
                  <input
                    type="text"
                    required
                    placeholder="e.g. project-updates"
                    value={newChannelName}
                    onChange={e => setNewChannelName(e.target.value)}
                    style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 'var(--text-sm)' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Description (Optional)
                </label>
                <input
                  type="text"
                  placeholder="What is this channel about?"
                  value={newChannelDesc}
                  onChange={e => setNewChannelDesc(e.target.value)}
                  style={{
                    width: '100%',
                    marginTop: '4px',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--surface-input)',
                    border: '1px solid var(--border-default)',
                    color: 'var(--text-primary)',
                    fontSize: 'var(--text-sm)',
                    outline: 'none'
                  }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 0' }}>
                <input
                  type="checkbox"
                  id="chk-private-ch"
                  checked={newChannelIsPrivate}
                  onChange={e => setNewChannelIsPrivate(e.target.checked)}
                  style={{ accentColor: 'var(--primary)', cursor: 'pointer' }}
                />
                <label htmlFor="chk-private-ch" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Lock size={12} />
                  <span>Make channel private (only invited members can view)</span>
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
                <button
                  type="button"
                  onClick={() => setShowCreateChannelModal(false)}
                  style={{ padding: '8px 16px', borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingChannel || !newChannelName.trim()}
                  style={{
                    padding: '8px 18px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--primary)',
                    color: '#fff',
                    fontWeight: 600,
                    fontSize: 'var(--text-xs)',
                    border: 'none',
                    cursor: isCreatingChannel || !newChannelName.trim() ? 'not-allowed' : 'pointer'
                  }}
                >
                  {isCreatingChannel ? 'Creating...' : 'Create Channel'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================
          MODAL: USER AUTH (Go API Backend Connection)
          ==================================================================== */}
      {showAuthModal && (
        <div
          onClick={() => setShowAuthModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="modal-card-responsive"
            style={{
              background: 'var(--surface-level-3)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-xl)',
              width: '390px',
              maxWidth: '94vw',
              padding: 'var(--space-6)',
              boxShadow: 'var(--shadow-floating)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: 'var(--text-lg)', color: 'var(--text-primary)' }}>
                <LogIn size={18} color="var(--primary)" />
                <span>{authMode === 'login' ? 'Sign In to OfficeChat' : 'Create an Account'}</span>
              </div>
              <button onClick={() => setShowAuthModal(false)} style={{ color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {authMode === 'register' && (
                <div>
                  <label style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Jane Doe"
                    value={authFullName}
                    onChange={e => setAuthFullName(e.target.value)}
                    style={{
                      width: '100%',
                      marginTop: 'var(--space-1)',
                      padding: '9px 12px',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--surface-input)',
                      border: '1px solid var(--border-default)',
                      color: 'var(--text-primary)',
                      fontSize: 'var(--text-sm)',
                      outline: 'none'
                    }}
                  />
                </div>
              )}

              <div>
                <label style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  placeholder="admin@officechat.local"
                  value={authEmail}
                  onChange={e => setAuthEmail(e.target.value)}
                  style={{
                    width: '100%',
                    marginTop: 'var(--space-1)',
                    padding: '9px 12px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--surface-input)',
                    border: '1px solid var(--border-default)',
                    color: 'var(--text-primary)',
                    fontSize: 'var(--text-sm)',
                    outline: 'none'
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Password
                </label>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={authPassword}
                  onChange={e => setAuthPassword(e.target.value)}
                  style={{
                    width: '100%',
                    marginTop: 'var(--space-1)',
                    padding: '9px 12px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--surface-input)',
                    border: '1px solid var(--border-default)',
                    color: 'var(--text-primary)',
                    fontSize: 'var(--text-sm)',
                    outline: 'none'
                  }}
                />
              </div>

              {authMessage && (
                <div style={{ fontSize: 'var(--text-xs)', color: authMessage.includes('Success') || authMessage.includes('Authenticated') ? 'var(--success)' : 'var(--warning)' }}>
                  {authMessage}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-2)' }}>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode(authMode === 'login' ? 'register' : 'login');
                    setAuthMessage('');
                  }}
                  style={{ fontSize: 'var(--text-xs)', color: 'var(--primary)', fontWeight: 600 }}
                >
                  {authMode === 'login' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--primary)',
                    color: '#fff',
                    fontWeight: 600,
                    fontSize: 'var(--text-xs)'
                  }}
                >
                  {authMode === 'login' ? 'Sign In' : 'Sign Up'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}



      {/* Lightbox Image Preview Modal */}
      {previewImageUrl && (
        <div
          onClick={() => setPreviewImageUrl(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: '24px',
            backdropFilter: 'blur(6px)'
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'relative',
              maxWidth: '90vw',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center'
            }}
          >
            <button
              onClick={() => setPreviewImageUrl(null)}
              style={{
                position: 'absolute',
                top: '-40px',
                right: '0',
                background: 'var(--surface-level-3)',
                color: '#fff',
                border: '1px solid var(--border-default)',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer'
              }}
            >
              <X size={18} />
            </button>
            <img
              src={previewImageUrl}
              alt="Attachment Preview"
              style={{
                maxWidth: '100%',
                maxHeight: '80vh',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-floating)',
                objectFit: 'contain'
              }}
            />
            <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
              <a
                href={previewImageUrl}
                download="officechat_image.png"
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'var(--primary)',
                  color: '#fff',
                  padding: '6px 14px',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 600,
                  textDecoration: 'none'
                }}
              >
                <Download size={14} /> Download Full Image
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Admin Console dynamically loaded via React.lazy (Shield button in sidebar) */}
      {showAdminConsole && (
        <React.Suspense fallback={
          <div style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--surface-level-1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            color: 'var(--text-secondary)',
            fontSize: 'var(--text-base)',
            fontWeight: 500
          }}>
            Loading Admin Console...
          </div>
        }>
          <AdminConsole
            currentUser={currentUser}
            activeWorkspaceName={activeWorkspace}
            onClose={() => {
              setShowAdminConsole(false);
              if (window.location.pathname.startsWith('/admin')) {
                window.history.replaceState({}, '', '/');
              }
            }}
          />
        </React.Suspense>
      )}
    </div>
  );
}
