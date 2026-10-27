import { useState } from 'react';
import {
  Shield,
  Users,
  Hash,
  Lock,
  FileText,
  ShieldAlert,
  ArrowLeft,
  CheckCircle,
  AlertTriangle,
  Info
} from 'lucide-react';
import './admin.css';
import { MembersTab } from './MembersTab';
import { ChannelsTab } from './ChannelsTab';
import { SecurityTab } from './SecurityTab';
import { AuditTab } from './AuditTab';

interface AdminConsoleProps {
  currentUser: {
    id: string;
    name: string;
    role: string;
    email?: string;
  };
  activeWorkspaceName?: string;
  onClose: () => void;
}

interface ToastMessage {
  id: string;
  message: string;
  type: 'success' | 'info' | 'warning' | 'danger';
}

export default function AdminConsole({
  currentUser,
  activeWorkspaceName = 'Acme Corp',
  onClose
}: AdminConsoleProps) {
  const [activeTab, setActiveTab] = useState<'members' | 'channels' | 'security' | 'audit'>('members');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = (message: string, type: 'success' | 'info' | 'warning' | 'danger' = 'info') => {
    const id = `t_${Date.now()}_${Math.random()}`;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  // --- Strict Server & Client RBAC Guard ---
  const normalizedRole = (currentUser.role || '').toLowerCase();
  const isAuthorized = normalizedRole === 'owner' || normalizedRole === 'admin';

  if (!isAuthorized) {
    return (
      <div className="admin-console-overlay">
        <div className="admin-access-denied">
          <ShieldAlert size={64} style={{ color: 'var(--danger)', marginBottom: 'var(--space-3)' }} />
          <h2>Access Denied</h2>
          <p>
            The Admin Console is strictly restricted to Workspace Owners and Administrators. Your account role ({currentUser.role || 'Member'}) does not have sufficient authorization.
          </p>
          <button className="btn-primary" onClick={onClose} id="btn-return-chat">
            <ArrowLeft size={16} />
            <span>Return to Chat</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-console-overlay" id="admin-console-root">
      {/* Toast Notification Container */}
      <div style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        pointerEvents: 'none'
      }}>
        {toasts.map(t => {
          const bgColor = t.type === 'success' ? '#15803d' : (t.type === 'danger' ? '#b91c1c' : (t.type === 'warning' ? '#b45309' : '#4338ca'));
          const Icon = t.type === 'success' ? CheckCircle : (t.type === 'danger' || t.type === 'warning' ? AlertTriangle : Info);

          return (
            <div
              key={t.id}
              style={{
                backgroundColor: bgColor,
                color: '#ffffff',
                padding: '10px 16px',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-lg)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: 'var(--text-sm)',
                fontWeight: 500,
                animation: 'fadeIn 180ms ease-out',
                pointerEvents: 'auto'
              }}
            >
              <Icon size={16} />
              <span>{t.message}</span>
            </div>
          );
        })}
      </div>

      {/* Top Header */}
      <header className="admin-header">
        <div className="admin-header-left">
          <div className="admin-badge">
            <Shield size={13} />
            <span>Admin Console</span>
          </div>
          <div>
            <div className="admin-header-title">{activeWorkspaceName}</div>
            <div className="admin-header-subtitle">
              Logged in as {currentUser.name} ({currentUser.role})
            </div>
          </div>
        </div>

        <div className="admin-header-right">
          <button
            className="btn-secondary"
            onClick={onClose}
            title="Return to Main Chat"
            id="btn-admin-close"
          >
            <ArrowLeft size={15} />
            <span>Back to Chat</span>
          </button>
        </div>
      </header>

      {/* Navigation Tabs Bar */}
      <nav className="admin-nav-bar" role="tablist">
        <button
          role="tab"
          aria-selected={activeTab === 'members'}
          className={`admin-nav-item ${activeTab === 'members' ? 'active' : ''}`}
          onClick={() => setActiveTab('members')}
          id="admin-tab-members"
        >
          <Users size={16} />
          <span>Members</span>
        </button>

        <button
          role="tab"
          aria-selected={activeTab === 'channels'}
          className={`admin-nav-item ${activeTab === 'channels' ? 'active' : ''}`}
          onClick={() => setActiveTab('channels')}
          id="admin-tab-channels"
        >
          <Hash size={16} />
          <span>Channels & Groups</span>
        </button>

        <button
          role="tab"
          aria-selected={activeTab === 'security'}
          className={`admin-nav-item ${activeTab === 'security' ? 'active' : ''}`}
          onClick={() => setActiveTab('security')}
          id="admin-tab-security"
        >
          <Lock size={16} />
          <span>Security & Passwords</span>
        </button>

        <button
          role="tab"
          aria-selected={activeTab === 'audit'}
          className={`admin-nav-item ${activeTab === 'audit' ? 'active' : ''}`}
          onClick={() => setActiveTab('audit')}
          id="admin-tab-audit"
        >
          <FileText size={16} />
          <span>Audit Logs</span>
        </button>
      </nav>

      {/* Main Content Area */}
      <main className="admin-content">
        {activeTab === 'members' && (
          <MembersTab
            currentUserRole={currentUser.role}
            currentUserId={currentUser.id}
            onToast={addToast}
          />
        )}
        {activeTab === 'channels' && (
          <ChannelsTab onToast={addToast} />
        )}
        {activeTab === 'security' && (
          <SecurityTab onToast={addToast} />
        )}
        {activeTab === 'audit' && (
          <AuditTab onToast={addToast} />
        )}
      </main>
    </div>
  );
}
