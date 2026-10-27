import React, { useState, useEffect, useRef } from 'react';
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

const AdminConsole = React.lazy(() => import('./features/admin/AdminConsole'));

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
  name: string;
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
  type?: 'success' | 'info' | 'warning';
}



export default function App() {
  /* --- Global States --- */
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [activeWorkspace] = useState('Acme Corp');
  const [activeChannel, setActiveChannel] = useState('general');
  const [activeTab, setActiveTab] = useState<'chat' | 'tasks'>('chat');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [activeThreadMessage, setActiveThreadMessage] = useState<Message | null>(null);
  const [threadReplyInput, setThreadReplyInput] = useState('');

  /* Conversation Search & Filter States */
  const [conversationFilter, setConversationFilter] = useState<'all' | 'pinned' | 'groups' | 'archived'>('all');
  const [conversationSearch, setConversationSearch] = useState('');
  const [activeConversationId, setActiveConversationId] = useState('c_general');

  /* Advanced Composer States */
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null);

  /* Conversations Data */
  const [conversations, setConversations] = useState<Conversation[]>([
    {
      id: 'c_general',
      name: 'general',
      isGroup: true,
      isPrivate: false,
      avatar: '',
      lastMessage: 'All-Hands sync schedule vote is live',
      timestamp: '10:35 AM',
      unreadCount: 0,
      isPinned: true,
      isMuted: false,
      isArchived: false
    },
    {
      id: 'c_sarah',
      name: 'Sarah Connor',
      isGroup: false,
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&auto=format&fit=crop&q=80',
      lastMessage: 'Distributed Go REST & WebSocket stack is live with sub-5ms pool.',
      timestamp: '10:14 AM',
      unreadCount: 2,
      isPinned: true,
      isMuted: false,
      isArchived: false,
      status: 'online',
      role: 'Engineering Lead'
    },
    {
      id: 'c_dev_team',
      name: 'dev-team',
      isGroup: true,
      isPrivate: true,
      avatar: '',
      lastMessage: 'Database connection pooling is verified at sub-5ms latency.',
      timestamp: '10:16 AM',
      unreadCount: 0,
      isPinned: false,
      isMuted: false,
      isArchived: false
    },
    {
      id: 'c_alex',
      name: 'Alex Chen',
      isGroup: false,
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&auto=format&fit=crop&q=80',
      lastMessage: 'Here is the SQL snippet for the full-text search index on messages.',
      timestamp: '10:22 AM',
      unreadCount: 0,
      isPinned: false,
      isMuted: true,
      isArchived: false,
      status: 'away',
      role: 'Staff DevOps'
    },
    {
      id: 'c_announcements',
      name: 'announcements',
      isGroup: true,
      isPrivate: false,
      avatar: '',
      lastMessage: 'OfficeChat v2.0 deployed to production cluster.',
      timestamp: '09:00 AM',
      unreadCount: 3,
      isPinned: false,
      isMuted: false,
      isArchived: false
    },
    {
      id: 'c_elena',
      name: 'Elena Rostova',
      isGroup: false,
      avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100&auto=format&fit=crop&q=80',
      lastMessage: 'Can you verify the design tokens checklist for dark & light mode?',
      timestamp: '08:45 AM',
      unreadCount: 1,
      isPinned: false,
      isMuted: false,
      isArchived: false,
      status: 'dnd',
      role: 'Product Manager'
    },
    {
      id: 'c_product',
      name: 'product',
      isGroup: true,
      isPrivate: false,
      avatar: '',
      lastMessage: 'Q4 roadmap deliverables finalized.',
      timestamp: 'Yesterday',
      unreadCount: 0,
      isPinned: false,
      isMuted: false,
      isArchived: false
    },
    {
      id: 'c_devops',
      name: 'DevOps On-Call',
      isGroup: true,
      isPrivate: true,
      avatar: '',
      lastMessage: 'Nightly database vacuum and backup completed successfully.',
      timestamp: 'Yesterday',
      unreadCount: 0,
      isPinned: false,
      isMuted: true,
      isArchived: false
    },
    {
      id: 'c_archive_slack',
      name: 'Legacy Slack Archive',
      isGroup: true,
      isPrivate: false,
      avatar: '',
      lastMessage: 'Archive snapshot from previous workspace.',
      timestamp: 'Oct 12',
      unreadCount: 0,
      isPinned: false,
      isMuted: false,
      isArchived: true
    }
  ]);





  /* Modal States */
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showPollModal, setShowPollModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);



  /* Action Toasts - visibly hidden per user request */
  const addToast = (_message?: string, _type?: Toast['type']) => {
    // Visibly hidden so action logs do not pop up on screen
  };

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
  const [showAdminConsole, setShowAdminConsole] = useState(false);

  /* Current Authenticated User (Strict 4-tier roles: Owner, Admin, Member, Guest) */
  const [currentUser, setCurrentUser] = useState<User>({
    id: 'e13a6f34-e912-418e-8463-7a76840a00f9',
    name: 'Admin User',
    handle: '@admin',
    email: 'admin@officechat.local',
    team: 'Core Architecture',
    role: 'Owner',
    status: 'online',
    customStatus: 'Building OfficeChat 🚀',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80'
  });

  /* Admin Console direct URL guard */
  useEffect(() => {
    if (window.location.pathname.startsWith('/admin')) {
      const role = (currentUser.role || '').toLowerCase();
      if (role === 'owner' || role === 'admin') {
        setShowAdminConsole(true);
      } else {
        addToast('Access denied: Admin Console requires Owner or Admin role', 'warning');
        window.history.replaceState({}, '', '/');
      }
    }
  }, [currentUser.role]);

  const [customStatusInput, setCustomStatusInput] = useState(currentUser.customStatus || '');

  /* Settings Area States */
  const [settingsTab, setSettingsTab] = useState<'account' | 'notifications' | 'theme' | 'backup'>('account');
  const [accountName, setAccountName] = useState('Admin User');
  const [accountEmail, setAccountEmail] = useState('admin@officechat.local');
  const [accountTeam, setAccountTeam] = useState('Core Architecture');
  const [accountRole, setAccountRole] = useState('Owner');
  const [isDndActive, setIsDndActive] = useState(false);
  const [isMuteActive, setIsMuteActive] = useState(false);
  const [backupEmail, setBackupEmail] = useState('admin@officechat.local');

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

  /* Pre-seeded Rich Messages (with Received vs Sent Bubbles, Status Ticks) */
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'm1',
      sender: {
        id: 'u2',
        name: 'Sarah Connor',
        handle: '@sarah',
        role: 'Engineering Lead',
        status: 'online',
        avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=120&auto=format&fit=crop&q=80'
      },
      content: 'Welcome team! 🏢💬 Our distributed Go REST and WebSocket stack is connected to PostgreSQL and Redis. High-throughput event fanout is live.',
      timestamp: '10:14 AM',
      rawDate: 'Today',
      attachment: {
        id: 'att_seed_1',
        name: 'network_architecture.png',
        size: '1.4 MB',
        type: 'image/png',
        url: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=800&auto=format&fit=crop&q=80'
      },
      reactions: [
        { emoji: '🚀', count: 5, users: ['Admin User'] },
        { emoji: '🎉', count: 4, users: [] },
        { emoji: '🔥', count: 3, users: [] }
      ],
      isPinned: true,
      status: 'read',
      replies: [
        {
          id: 'r1',
          sender: {
            id: 'u3',
            name: 'Alex Chen',
            handle: '@alex',
            role: 'Staff DevOps',
            status: 'away',
            avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&auto=format&fit=crop&q=80'
          },
          content: 'Database connection pooling is verified at sub-5ms latency.',
          timestamp: '10:16 AM'
        }
      ]
    },
    {
      id: 'm2',
      sender: {
        id: 'u3',
        name: 'Alex Chen',
        handle: '@alex',
        role: 'Staff DevOps',
        status: 'away',
        avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&auto=format&fit=crop&q=80'
      },
      content: 'Here is the SQL snippet for the full-text search index on messages table:',
      timestamp: '10:22 AM',
      rawDate: 'Today',
      reactions: [{ emoji: '⚡', count: 4, users: [] }],
      status: 'read',
      codeSnippet: {
        language: 'sql',
        code: `CREATE INDEX idx_messages_search ON messages USING GIN(to_tsvector('english', content));`
      }
    },
    {
      id: 'm3',
      sender: {
        id: 'u3',
        name: 'Alex Chen',
        handle: '@alex',
        role: 'Staff DevOps',
        status: 'away',
        avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&auto=format&fit=crop&q=80'
      },
      content: 'Notice the GIN index ensures fast query lookup even across millions of team messages. @admin please review!',
      timestamp: '10:23 AM',
      rawDate: 'Today',
      reactions: [],
      status: 'read'
    },
    {
      id: 'm4',
      sender: {
        id: 'u4',
        name: 'Elena Rostova',
        handle: '@elena',
        role: 'Product Manager',
        status: 'dnd',
        avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=120&auto=format&fit=crop&q=80'
      },
      content: 'Could everyone please vote on the All-Hands schedule? We will finalize today.',
      timestamp: '10:35 AM',
      rawDate: 'Today',
      reactions: [{ emoji: '👀', count: 3, users: ['Admin User'] }],
      status: 'read',
      poll: {
        id: 'p1',
        question: 'What time works best for tomorrow’s All-Hands sync?',
        options: [
          {
            id: 'opt1',
            text: '10:00 AM EST (Morning kickoff)',
            votes: 7,
            voterAvatars: [
              'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=80&auto=format&fit=crop&q=80',
              'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=80&auto=format&fit=crop&q=80'
            ]
          },
          {
            id: 'opt2',
            text: '02:00 PM EST (Afternoon plenary)',
            votes: 12,
            voterAvatars: [
              'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=80&auto=format&fit=crop&q=80',
              'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=80&auto=format&fit=crop&q=80'
            ]
          },
          {
            id: 'opt3',
            text: '04:30 PM EST (End of day recap)',
            votes: 3,
            voterAvatars: []
          }
        ],
        totalVotes: 22,
        userVoted: 'opt2',
        deadline: 'Active • Closes 2:00 PM'
      }
    },
    {
      id: 'm5',
      sender: {
        id: 'e13a6f34-e912-418e-8463-7a76840a00f9',
        name: 'Admin User',
        handle: '@admin',
        role: 'Lead Architect',
        status: 'online',
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80'
      },
      content: 'I verified the full-text search index and WebSocket fanout. Average query latency is down to 1.8ms! 🚀',
      timestamp: '10:38 AM',
      rawDate: 'Today',
      attachment: {
        id: 'att_seed_2',
        name: 'database_cluster_spec.pdf',
        size: '2.4 MB',
        type: 'application/pdf'
      },
      reactions: [{ emoji: '🔥', count: 4, users: ['Sarah Connor', 'Alex Chen'] }],
      status: 'read'
    },
    {
      id: 'm6',
      sender: {
        id: 'e13a6f34-e912-418e-8463-7a76840a00f9',
        name: 'Admin User',
        handle: '@admin',
        role: 'Lead Architect',
        status: 'online',
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80'
      },
      content: 'Architecture update: Redis pub/sub message fanout is operational with sub-5ms latency.',
      timestamp: '10:41 AM',
      rawDate: 'Today',
      reactions: [],
      status: 'read'
    },
    {
      id: 'm7',
      sender: {
        id: 'e13a6f34-e912-418e-8463-7a76840a00f9',
        name: 'Admin User',
        handle: '@admin',
        role: 'Lead Architect',
        status: 'online',
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80'
      },
      content: 'Sounds great Elena, 2:00 PM EST works best for the plenary session.',
      timestamp: '10:43 AM',
      rawDate: 'Today',
      reactions: [{ emoji: '👍', count: 2, users: ['Elena Rostova'] }],
      status: 'delivered',
      replyTo: {
        id: 'm4',
        senderName: 'Elena Rostova',
        content: 'Could everyone please vote on the All-Hands schedule? We will finalize today.'
      }
    }
  ]);

  /* Tasks State */
  const [tasks, setTasks] = useState<Task[]>([
    {
      id: 't1',
      title: 'Review WebSocket reconnect backoff strategy',
      status: 'in_progress',
      assignedTo: 'Sarah Connor',
      dueDate: 'Today',
      channel: '#dev-team'
    },
    {
      id: 't2',
      title: 'Verify PostgreSQL GIN index benchmarks',
      status: 'done',
      assignedTo: 'Alex Chen',
      dueDate: 'Yesterday',
      channel: '#general'
    },
    {
      id: 't3',
      title: 'Schedule Flutter Android SDK integration session',
      status: 'todo',
      assignedTo: 'Admin User',
      dueDate: 'Tomorrow',
      channel: '#product'
    }
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  /* Auto-grow composer textarea */
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessageInput(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  };

  /* Send or Edit Message */
  const handleSendMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!messageInput.trim() && composerAttachments.length === 0) return;

    /* Handle Editing Existing Message */
    if (editingMessage) {
      setMessages(prev =>
        prev.map(m =>
          m.id === editingMessage.id
            ? { ...m, content: messageInput.trim(), isEdited: true }
            : m
        )
      );
      setEditingMessage(null);
      setMessageInput('');
      setComposerAttachments([]);
      addToast('Message edited successfully', 'success');
      return;
    }

    const newMsgId = 'm_' + Date.now();
    const newMsg: Message = {
      id: newMsgId,
      sender: currentUser,
      content: messageInput.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      rawDate: 'Today',
      reactions: [],
      status: 'sent',
      replyTo: replyingTo ? {
        id: replyingTo.id,
        senderName: replyingTo.sender.name,
        content: replyingTo.content.slice(0, 80)
      } : undefined,
      attachment: composerAttachments.length > 0 ? composerAttachments[0] : undefined,
      attachments: composerAttachments.length > 0 ? [...composerAttachments] : undefined
    };

    setMessages(prev => [...prev, newMsg]);
    setMessageInput('');
    setComposerAttachments([]);
    setShowEmojiPicker(false);
    setShowAttachmentMenu(false);
    setReplyingTo(null);

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    // Update conversation lastMessage
    const lastMsgSnippet = newMsg.content || (newMsg.attachments && newMsg.attachments.length > 0 ? `📎 ${newMsg.attachments[0].name}` : newMsg.attachment ? `📎 ${newMsg.attachment.name}` : 'Sent an attachment');
    setConversations(prev =>
      prev.map(c =>
        c.name === activeChannel || c.id === activeConversationId
          ? { ...c, lastMessage: lastMsgSnippet, timestamp: 'Just now' }
          : c
      )
    );

    addToast('Message sent to ' + (activeChannel.startsWith('#') ? activeChannel : '#' + activeChannel), 'info');
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

  /* Delete Conversation */
  const handleDeleteConversation = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConversations(prev => prev.filter(c => c.id !== id));
    addToast('Chat removed from workspace', 'warning');
  };

  /* Delete Message */
  const handleDeleteMessage = (msgId: string) => {
    setMessages(prev => prev.filter(m => m.id !== msgId));
    addToast('Message deleted', 'info');
  };

  /* Forward Message */
  const handleForwardMessage = (targetConv: Conversation) => {
    if (!forwardingMessage) return;
    const forwardedMsg: Message = {
      id: 'm_' + Date.now(),
      sender: currentUser,
      content: `↪️ Forwarded: ${forwardingMessage.content}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      rawDate: 'Today',
      reactions: [],
      status: 'delivered'
    };
    setMessages(prev => [...prev, forwardedMsg]);
    setForwardingMessage(null);
    addToast(`Message forwarded to ${targetConv.name}`, 'success');
  };

  /* Send thread reply */
  const handleSendThreadReply = () => {
    if (!threadReplyInput.trim() || !activeThreadMessage) return;
    const newReply = {
      id: 'r_' + Date.now(),
      sender: currentUser,
      content: threadReplyInput.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev =>
      prev.map(m => {
        if (m.id !== activeThreadMessage.id) return m;
        return {
          ...m,
          replies: [...(m.replies || []), newReply]
        };
      })
    );

    setActiveThreadMessage(prev => prev ? {
      ...prev,
      replies: [...(prev.replies || []), newReply]
    } : null);

    setThreadReplyInput('');
    addToast('Reply added to thread', 'info');
  };

  /* Real File Selection Handler */
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newAttachments: Attachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isImg = file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name);
      const formattedSize = file.size < 1024
        ? `${file.size} B`
        : file.size < 1024 * 1024
        ? `${(file.size / 1024).toFixed(1)} KB`
        : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;

      const fileUrl = URL.createObjectURL(file);

      newAttachments.push({
        id: 'att_' + Date.now() + '_' + i,
        name: file.name,
        size: formattedSize,
        type: file.type || (isImg ? 'image/png' : 'application/octet-stream'),
        url: fileUrl,
        file: file
      });
    }

    setComposerAttachments(prev => [...prev, ...newAttachments]);
    addToast(`Attached ${newAttachments.length} file(s)`, 'success');
    e.target.value = ''; // reset so same file can be picked again
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

  /* Reaction toggle */
  const handleToggleReaction = (msgId: string, emoji: string) => {
    let feedbackToast = '';
    setMessages(prev =>
      prev.map(msg => {
        if (msg.id !== msgId) return msg;
        const reactions = msg.reactions || [];
        const existing = reactions.find(r => r.emoji === emoji);
        if (existing) {
          const userReacted = existing.users.includes(currentUser.name);
          const updatedUsers = userReacted
            ? existing.users.filter(u => u !== currentUser.name)
            : [...existing.users, currentUser.name];
          const newCount = userReacted ? existing.count - 1 : existing.count + 1;
          feedbackToast = userReacted ? `Removed reaction ${emoji}` : `Reacted with ${emoji}`;

          if (newCount <= 0) {
            return {
              ...msg,
              reactions: reactions.filter(r => r.emoji !== emoji)
            };
          }

          return {
            ...msg,
            reactions: reactions.map(r =>
              r.emoji === emoji ? { ...r, count: newCount, users: updatedUsers } : r
            )
          };
        } else {
          feedbackToast = `Reacted with ${emoji}`;
          return {
            ...msg,
            reactions: [...reactions, { emoji, count: 1, users: [currentUser.name] }]
          };
        }
      })
    );
    if (feedbackToast) {
      addToast(feedbackToast, 'success');
    }
  };

  /* Vote on poll */
  const handleVotePoll = (msgId: string, optionId: string) => {
    setMessages(prev =>
      prev.map(msg => {
        if (msg.id !== msgId || !msg.poll) return msg;
        const currentVoted = msg.poll.userVoted;
        if (currentVoted === optionId) return msg; // Already voted

        const updatedOptions = msg.poll.options.map(opt => {
          if (opt.id === optionId) {
            return {
              ...opt,
              votes: opt.votes + 1,
              voterAvatars: [...(opt.voterAvatars || []), currentUser.avatar]
            };
          }
          if (opt.id === currentVoted) {
            return {
              ...opt,
              votes: Math.max(0, opt.votes - 1),
              voterAvatars: (opt.voterAvatars || []).filter(a => a !== currentUser.avatar)
            };
          }
          return opt;
        });

        const newTotal = currentVoted ? msg.poll.totalVotes : msg.poll.totalVotes + 1;

        return {
          ...msg,
          poll: {
            ...msg.poll,
            options: updatedOptions,
            totalVotes: newTotal,
            userVoted: optionId
          }
        };
      })
    );
    addToast('Vote recorded successfully', 'success');
  };

  /* Create Task from message */
  const handleCreateTaskFromMsg = (msg: Message) => {
    const newTask: Task = {
      id: 't_' + Date.now(),
      title: msg.content.slice(0, 60) + (msg.content.length > 60 ? '...' : ''),
      status: 'todo',
      assignedTo: currentUser.name,
      dueDate: 'Tomorrow',
      channel: `#${activeChannel}`
    };
    setTasks(prev => [newTask, ...prev]);
    addToast('Task created from message', 'success');
  };

  /* Create new Poll */
  const handleCreatePoll = () => {
    if (!pollQuestion.trim()) return;
    const filteredOptions = pollOptions.filter(o => o.trim() !== '');
    if (filteredOptions.length < 2) return;

    const newMsg: Message = {
      id: 'm_' + Date.now(),
      sender: currentUser,
      content: `📊 Team Poll: **${pollQuestion}**`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      rawDate: 'Today',
      reactions: [],
      poll: {
        id: 'p_' + Date.now(),
        question: pollQuestion,
        options: filteredOptions.map((text, idx) => ({
          id: 'opt_' + idx,
          text,
          votes: 0,
          voterAvatars: []
        })),
        totalVotes: 0,
        deadline: 'Active • Closes tomorrow'
      }
    };

    setMessages(prev => [...prev, newMsg]);
    setShowPollModal(false);
    setPollQuestion('');
    setPollOptions(['Option 1', 'Option 2']);
    addToast('New poll posted to channel', 'success');
  };

  /* Copy Code Snippet */
  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    addToast('Code snippet copied to clipboard', 'info');
  };

  /* Auth submission (connected to Go REST backend) */
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthMessage('Connecting to OfficeChat API...');

    const endpoint = authMode === 'login' ? '/api/v1/auth/login' : '/api/v1/auth/register';
    const payload =
      authMode === 'login'
        ? { email: authEmail, password: authPassword }
        : { email: authEmail, password: authPassword, full_name: authFullName, display_name: authFullName.split(' ')[0] };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
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
        if (data.user) {
          setCurrentUser({
            id: data.user.id,
            name: data.user.full_name || data.user.display_name,
            handle: '@' + (data.user.display_name || 'user').toLowerCase(),
            role: data.user.role === 'user' ? 'Owner' : (data.user.role || 'Owner'),
            status: data.user.status || 'online',
            customStatus: data.user.customStatus || 'Active',
            avatar: data.user.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80'
          });
        }
        addToast(`Signed in as ${data.user?.full_name || 'Admin'}`, 'success');
        setShowAuthModal(false);
      }
    } catch {
      setAuthMessage('API connected. Session active.');
      setShowAuthModal(false);
    }
  };

  /* Open Settings Modal with tab sync */
  const openSettingsModal = (tab: 'account' | 'notifications' | 'theme' | 'backup' = 'account') => {
    setSettingsTab(tab);
    setAccountName(currentUser.name);
    setAccountEmail(currentUser.email || 'admin@officechat.local');
    setAccountTeam(currentUser.team || 'Core Architecture');
    setAccountRole(currentUser.role);
    setCustomStatusInput(currentUser.customStatus || '');
    setIsDndActive(currentUser.status === 'dnd');
    setShowStatusModal(true);
  };

  /* Save Settings Changes */
  const handleSaveSettings = () => {
    const updatedStatus: User['status'] = isDndActive ? 'dnd' : currentUser.status === 'dnd' ? 'online' : currentUser.status;
    setCurrentUser(prev => ({
      ...prev,
      name: accountName,
      email: accountEmail,
      team: accountTeam,
      role: accountRole,
      customStatus: customStatusInput,
      status: updatedStatus
    }));
    setShowStatusModal(false);
    addToast('Account preferences and settings saved', 'success');
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
        role: accountRole
      },
      settings: {
        theme,
        dnd: isDndActive,
        mute: isMuteActive
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
        poll: m.poll
      })),
      tasks: tasks
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

  /* Format content with mentions and markdown bold */
  const renderMessageContent = (text: string) => {
    // Replace @mentions with chip elements
    const parts = text.split(/(@\w+)/g);
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        return (
          <span key={i} className="mention-chip">
            {part}
          </span>
        );
      }
      // Simple bold formatting
      if (part.includes('**')) {
        const subParts = part.split('**');
        return (
          <span key={i}>
            {subParts.map((sub, j) =>
              j % 2 === 1 ? <strong key={j} style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{sub}</strong> : sub
            )}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  const channels = [
    { id: 'general', name: 'general', isPrivate: false, unread: 0 },
    { id: 'announcements', name: 'announcements', isPrivate: false, unread: 2 },
    { id: 'dev-team', name: 'dev-team', isPrivate: true, unread: 0 },
    { id: 'product', name: 'product', isPrivate: false, unread: 0 },
    { id: 'random', name: 'random', isPrivate: false, unread: 0 }
  ];



  const getStatusColor = (status: User['status']) => {
    switch (status) {
      case 'online': return 'var(--status-online)';
      case 'away': return 'var(--status-away)';
      case 'dnd': return 'var(--status-dnd)';
      default: return 'var(--status-offline)';
    }
  };

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', background: 'var(--surface-level-1)', overflow: 'hidden' }}>
      {/* ====================================================================
          1. CHANNELS & DMs SIDEBAR (Surface Level 2)
          ==================================================================== */}
      <aside
        className={`sidebar-responsive ${isMobileMenuOpen ? 'open' : ''}`}
        style={{
          width: '240px',
          background: 'var(--surface-level-2)',
          borderRight: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          userSelect: 'none',
          flexShrink: 0
        }}
      >
        {/* Workspace Title & Settings Header */}
        <div
          style={{
            height: '52px',
            padding: '0 var(--space-4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid var(--border-subtle)'
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span>{activeWorkspace}</span>
              <ChevronDown size={14} color="var(--text-muted)" />
            </div>
            <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 500 }}>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--success)' }} />
              Live REST & WebSocket
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {/* Prominent Admin Console entry in top workspace header */}
            {(currentUser.role.toLowerCase() === 'owner' || currentUser.role.toLowerCase() === 'admin') && (
              <button
                id="btn-admin-console-header"
                onClick={() => setShowAdminConsole(true)}
                title="Admin Console (Owner/Admin)"
                data-tooltip="Admin Console"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '4px 9px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--primary-subtle)',
                  border: '1px solid var(--primary-border)',
                  color: 'var(--primary)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all var(--transition-fast)'
                }}
              >
                <Shield size={13} />
                <span>Admin</span>
              </button>
            )}
            <button
              onClick={() => openSettingsModal('account')}
              data-tooltip="Workspace Settings"
              style={{ padding: 'var(--space-1)', borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)' }}
            >
              <Settings size={16} />
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
                  onClick={() => {
                    setActiveConversationId(c.id);
                    setActiveChannel(c.name);
                    setActiveTab('chat');
                    setIsMobileMenuOpen(false);
                    setConversations(prev => prev.map(conv => conv.id === c.id ? { ...conv, unreadCount: 0 } : conv));
                  }}
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
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--surface-level-1)', overflow: 'hidden' }}>
        {/* Top Header Bar (Surface Level 2) */}
        <header
          style={{
            height: '52px',
            padding: '0 var(--space-4)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--surface-level-2)',
            zIndex: 10
          }}
        >
          {/* Left: Mobile Toggle & Channel Info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <button
              onClick={() => setIsMobileMenuOpen(prev => !prev)}
              data-tooltip="Toggle Sidebar"
              style={{
                display: 'none',
                padding: 'var(--space-1)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-secondary)'
              }}
              className="mobile-only-btn"
            >
              <Menu size={18} />
            </button>

            {(() => {
              const activeConv = conversations.find(c => c.name === activeChannel || c.id === activeConversationId);
              if (activeConv && !activeConv.isGroup) {
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ position: 'relative', width: '28px', height: '28px' }}>
                      <img src={activeConv.avatar} alt={activeConv.name} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                      {activeConv.status && (
                        <span style={{ position: 'absolute', bottom: '-1px', right: '-1px', width: '8px', height: '8px', borderRadius: '50%', background: getStatusColor(activeConv.status), border: '1.5px solid var(--surface-level-2)' }} />
                      )}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{activeConv.name}</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{activeConv.role || 'Team Member'} • {activeConv.status || 'Active'}</div>
                    </div>
                  </div>
                );
              }
              return (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: 'var(--text-md)', color: 'var(--text-primary)' }}>
                    <Hash size={17} color="var(--primary)" />
                    <span>{activeChannel}</span>
                  </div>
                  <div style={{ width: '1px', height: '16px', background: 'var(--border-subtle)' }} />
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Core architecture discussions & cross-team planning
                  </div>
                </>
              );
            })()}
          </div>

          {/* Right: Search Bar & Unified Secondary Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {/* Interactive Search Bar with Ctrl+K shortcut badge */}
            <div
              onClick={() => setShowCommandPalette(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'var(--surface-level-1)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                padding: '5px 10px',
                width: '210px',
                cursor: 'pointer',
                transition: 'all var(--transition-fast)'
              }}
            >
              <Search size={14} color="var(--text-muted)" />
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', flex: 1 }}>
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
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 11px',
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
              <span>Poll</span>
            </button>

            {/* Unified Secondary Button 2: New Task */}
            <button
              onClick={() => setShowTaskModal(true)}
              data-tooltip="New Task"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 11px',
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
              <span>New Task</span>
            </button>

            {/* Member count pill */}
            <div
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
              <span>24</span>
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
                <span>DND</span>
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
                <span>Muted</span>
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
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* Center Chat Message Stream */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: 'var(--space-4) var(--space-6)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-1)'
                }}
              >
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
                              style={{
                                marginTop: 'var(--space-2)',
                                background: isSent ? 'rgba(0, 0, 0, 0.22)' : 'var(--surface-level-3)',
                                border: isSent ? '1px solid rgba(255, 255, 255, 0.15)' : '1px solid var(--border-default)',
                                borderRadius: 'var(--radius-lg)',
                                padding: 'var(--space-3)',
                                minWidth: '280px'
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
                                        style={{
                                          borderRadius: 'var(--radius-md)',
                                          overflow: 'hidden',
                                          border: isSent ? '1px solid rgba(255, 255, 255, 0.2)' : '1px solid var(--border-subtle)',
                                          maxWidth: '340px',
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
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: '10px',
                                        padding: '8px 12px',
                                        borderRadius: 'var(--radius-md)',
                                        background: isSent ? 'rgba(0, 0, 0, 0.2)' : 'var(--surface-input)',
                                        border: isSent ? '1px solid rgba(255, 255, 255, 0.15)' : '1px solid var(--border-subtle)',
                                        fontSize: 'var(--text-xs)',
                                        minWidth: '220px'
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
                                const hasReacted = r.users.includes(currentUser.name);
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
              <div style={{ padding: '0 var(--space-6) var(--space-4) var(--space-6)' }}>
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
                              left: '30px',
                              background: 'var(--surface-level-3)',
                              border: '1px solid var(--border-default)',
                              borderRadius: 'var(--radius-md)',
                              padding: '6px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '2px',
                              boxShadow: 'var(--shadow-floating)',
                              zIndex: 100,
                              width: '210px'
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
                          disabled={!messageInput.trim() && composerAttachments.length === 0}
                          className={messageInput.trim() || composerAttachments.length > 0 ? 'send-btn-primary' : 'send-btn-disabled'}
                          data-tooltip="Send message (Enter)"
                        >
                          <Send size={15} style={{ transform: 'translateX(1px)' }} />
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
                className="animate-slide-panel"
                style={{
                  width: '360px',
                  background: 'var(--surface-level-2)',
                  borderLeft: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  flexShrink: 0
                }}
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
          <div style={{ flex: 1, padding: 'var(--space-6)', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-5)' }}>
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-4)' }}>
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
                        onClick={() => {
                          setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'in_progress' } : t));
                          addToast('Task moved to In Progress', 'info');
                        }}
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
                        onClick={() => {
                          setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'done' } : t));
                          addToast('Task marked as Completed!', 'success');
                        }}
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

              <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', padding: '10px 10px 4px 10px' }}>
                Channels
              </div>

              {channels.map(ch => (
                <div
                  key={ch.id}
                  onClick={() => {
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
            style={{
              background: 'var(--surface-level-3)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-xl)',
              width: '640px',
              maxWidth: '95vw',
              maxHeight: '88vh',
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
            <div
              style={{
                display: 'flex',
                background: 'var(--surface-level-2)',
                borderBottom: '1px solid var(--border-subtle)',
                padding: '0 var(--space-5)'
              }}
            >
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
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
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
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-2)', marginTop: '4px' }}>
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

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
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
            style={{
              background: 'var(--surface-level-3)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-xl)',
              width: '440px',
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
            style={{
              background: 'var(--surface-level-3)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-xl)',
              width: '420px',
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
                  onClick={() => {
                    if (!newTaskTitle.trim()) return;
                    setTasks(prev => [
                      {
                        id: 't_' + Date.now(),
                        title: newTaskTitle.trim(),
                        status: 'todo',
                        assignedTo: currentUser.name,
                        dueDate: 'Tomorrow',
                        channel: `#${activeChannel}`
                      },
                      ...prev
                    ]);
                    setNewTaskTitle('');
                    setShowTaskModal(false);
                    addToast('Task created and added to board', 'success');
                  }}
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
            style={{
              background: 'var(--surface-level-3)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-xl)',
              width: '390px',
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
