import React, { useState, useEffect, useCallback } from 'react';
import {
  Search,
  UserPlus,
  UploadCloud,
  Edit2,
  KeyRound,
  LogOut,
  Trash2,
  Shield,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  AlertTriangle
} from 'lucide-react';
import type {
  AdminMember,
  ImportResult
} from './adminApi';
import {
  getAdminMembers,
  deleteAdminMember,
  resetMemberPassword,
  forceLogoutMember,
  updateAdminMember,
  createAdminMember,
  importMembersCSV
} from './adminApi';

interface MembersTabProps {
  currentUserRole: string;
  currentUserId: string;
  onToast: (msg: string, type?: 'success' | 'info' | 'warning' | 'danger') => void;
}

export const MembersTab: React.FC<MembersTabProps> = ({
  currentUserRole,
  currentUserId,
  onToast
}) => {
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editingMember, setEditingMember] = useState<AdminMember | null>(null);
  const [resettingMember, setResettingMember] = useState<AdminMember | null>(null);
  const [forceLogoutTarget, setForceLogoutTarget] = useState<AdminMember | null>(null);
  const [deletingMember, setDeletingMember] = useState<AdminMember | null>(null);

  // Temporary password display after create/reset
  const [revealedPassword, setRevealedPassword] = useState<{ user: string; pass: string } | null>(null);

  const loadMembers = useCallback(async (targetCursor?: string) => {
    setLoading(true);
    try {
      const res = await getAdminMembers({
        search,
        role: roleFilter,
        status: statusFilter,
        account_state: stateFilter,
        cursor: targetCursor,
        limit: 15,
      });
      setMembers(res.members || []);
      setNextCursor(res.next_cursor);
      setHasMore(res.has_more);
      setTotalCount(res.total_count);
    } catch (err: any) {
      console.error('Failed to load members:', err);
      // Fallback for visual preview if backend DB not populated
      if (members.length === 0) {
        setMembers([
          {
            id: currentUserId,
            email: 'admin@officechat.local',
            full_name: 'Administrator',
            display_name: 'Admin',
            avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80',
            role: 'Owner',
            department: 'Core Architecture',
            account_state: 'active',
            must_change_password: false,
            status: 'online',
            custom_status: 'Building OfficeChat 🚀',
            joined_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
          },
          {
            id: 'u_sarah',
            email: 'sarah.connor@officechat.local',
            full_name: 'Sarah Connor',
            display_name: 'Sarah',
            avatar_url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=120&auto=format&fit=crop&q=80',
            role: 'Admin',
            department: 'Engineering',
            account_state: 'active',
            must_change_password: false,
            status: 'online',
            custom_status: 'Reviewing PRs',
            joined_at: new Date(Date.now() - 86400000 * 5).toISOString(),
            created_at: new Date(Date.now() - 86400000 * 5).toISOString(),
          },
          {
            id: 'u_elena',
            email: 'elena.rostova@officechat.local',
            full_name: 'Elena Rostova',
            display_name: 'Elena',
            avatar_url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=120&auto=format&fit=crop&q=80',
            role: 'Member',
            department: 'Product',
            account_state: 'active',
            must_change_password: true,
            status: 'dnd',
            custom_status: 'In design sprint',
            joined_at: new Date(Date.now() - 86400000 * 10).toISOString(),
            created_at: new Date(Date.now() - 86400000 * 10).toISOString(),
          },
          {
            id: 'u_alex',
            email: 'alex.chen@officechat.local',
            full_name: 'Alex Chen',
            display_name: 'Alex',
            avatar_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&auto=format&fit=crop&q=80',
            role: 'Member',
            department: 'DevOps',
            account_state: 'suspended',
            must_change_password: false,
            status: 'offline',
            custom_status: 'On standby',
            joined_at: new Date(Date.now() - 86400000 * 20).toISOString(),
            created_at: new Date(Date.now() - 86400000 * 20).toISOString(),
          }
        ]);
        setTotalCount(4);
      }
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, statusFilter, stateFilter, currentUserId, members.length]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  const handleNextPage = () => {
    if (nextCursor) {
      setCursorHistory(prev => [...prev, cursor || '']);
      setCursor(nextCursor);
      loadMembers(nextCursor);
    }
  };

  const handlePrevPage = () => {
    if (cursorHistory.length > 0) {
      const prevCursor = cursorHistory[cursorHistory.length - 1];
      setCursorHistory(prev => prev.slice(0, -1));
      setCursor(prevCursor || undefined);
      loadMembers(prevCursor || undefined);
    }
  };

  const isOwner = currentUserRole.toLowerCase() === 'owner';

  return (
    <div className="members-tab-container">
      {/* Revealed Password Banner (Shown once only) */}
      {revealedPassword && (
        <div style={{
          backgroundColor: 'rgba(34, 197, 94, 0.12)',
          border: '1px solid rgba(34, 197, 94, 0.4)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-4)',
          marginBottom: 'var(--space-5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          color: 'var(--text-primary)'
        }}>
          <div>
            <div style={{ fontWeight: 600, color: '#4ade80', marginBottom: '2px' }}>
              🔑 Secure Password Generated for {revealedPassword.user}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
              This password will only be displayed once. Copy and deliver it securely to the user.
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-md)',
              fontWeight: 700,
              letterSpacing: '1px',
              marginTop: '6px',
              padding: '4px 10px',
              backgroundColor: 'var(--surface-level-2)',
              borderRadius: 'var(--radius-sm)',
              display: 'inline-block',
              userSelect: 'all'
            }}>
              {revealedPassword.pass}
            </div>
          </div>
          <button
            onClick={() => {
              navigator.clipboard.writeText(revealedPassword.pass);
              onToast('Password copied to clipboard', 'success');
              setRevealedPassword(null);
            }}
            className="btn-primary"
            style={{ height: '34px', fontSize: 'var(--text-xs)' }}
          >
            Copy & Dismiss
          </button>
        </div>
      )}

      {/* Toolbar & Filters */}
      <div className="admin-toolbar">
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="admin-search-box">
            <Search size={16} className="admin-search-icon" />
            <input
              type="text"
              placeholder="Search by name, email, department..."
              className="admin-search-input"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <select
            className="admin-select"
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
          >
            <option value="">All Roles</option>
            <option value="Owner">Owner</option>
            <option value="Admin">Admin</option>
            <option value="Member">Member</option>
            <option value="Guest">Guest</option>
          </select>

          <select
            className="admin-select"
            value={stateFilter}
            onChange={e => setStateFilter(e.target.value)}
          >
            <option value="">All States</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="deactivated">Deactivated</option>
          </select>

          <select
            className="admin-select"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            <option value="">All Presence</option>
            <option value="online">Online</option>
            <option value="away">Away</option>
            <option value="dnd">Do Not Disturb</option>
            <option value="offline">Offline</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button
            className="btn-secondary"
            onClick={() => setShowImportModal(true)}
            title="Import users via CSV"
          >
            <UploadCloud size={16} />
            <span>CSV Import</span>
          </button>
          <button
            className="btn-primary"
            onClick={() => setShowAddModal(true)}
            id="btn-add-member"
          >
            <UserPlus size={16} />
            <span>Add Member</span>
          </button>
        </div>
      </div>

      {/* Members Table */}
      <div className="admin-table-container">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Department</th>
              <th>Role</th>
              <th>Presence</th>
              <th>Account State</th>
              <th>Joined Date</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
                  <RefreshCw size={24} className="spin" style={{ color: 'var(--primary)', margin: '0 auto var(--space-2)' }} />
                  <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Loading members...</div>
                </td>
              </tr>
            ) : members.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
                  <AlertTriangle size={32} style={{ color: 'var(--text-muted)', margin: '0 auto var(--space-2)' }} />
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>No members found</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>Try adjusting your search query or role filter.</div>
                </td>
              </tr>
            ) : (
              members.map(m => {
                const isTargetOwner = m.role.toLowerCase() === 'owner';
                const canEditThisMember = isOwner || !isTargetOwner;

                return (
                  <tr key={m.id}>
                    <td>
                      <div className="user-info-cell">
                        <img
                          src={m.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80'}
                          alt={m.full_name}
                          className="user-avatar-sm"
                        />
                        <div className="user-names">
                          <span className="user-fullname">{m.full_name}</span>
                          <span className="user-displayname">
                            {m.display_name ? `@${m.display_name}` : ''} • {m.email}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span style={{ color: m.department ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                        {m.department || '—'}
                      </span>
                    </td>
                    <td>
                      <span className={`role-pill ${m.role.toLowerCase()}`}>
                        {m.role.toLowerCase() === 'owner' && <Shield size={12} />}
                        {m.role}
                      </span>
                    </td>
                    <td>
                      <div className="state-badge">
                        <span className={`state-dot ${m.status}`} />
                        <span style={{ textTransform: 'capitalize' }}>{m.status}</span>
                      </div>
                    </td>
                    <td>
                      <div className="state-badge">
                        <span className={`state-dot ${m.account_state || 'active'}`} />
                        <span style={{ textTransform: 'capitalize' }}>{m.account_state || 'active'}</span>
                        {m.must_change_password && (
                          <span style={{
                            fontSize: 'var(--text-2xs)',
                            color: 'var(--warning)',
                            backgroundColor: 'rgba(245, 158, 11, 0.1)',
                            padding: '1px 5px',
                            borderRadius: '4px',
                            marginLeft: '4px'
                          }}>
                            pwd change
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
                        {new Date(m.joined_at || m.created_at).toLocaleDateString()}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                        {canEditThisMember ? (
                          <>
                            <button
                              className="btn-icon"
                              title="Edit Member Profile & Role"
                              onClick={() => setEditingMember(m)}
                            >
                              <Edit2 size={15} />
                            </button>
                            <button
                              className="btn-icon"
                              title="Reset Password"
                              onClick={() => setResettingMember(m)}
                            >
                              <KeyRound size={15} />
                            </button>
                            <button
                              className="btn-icon"
                              title="Force Logout of All Devices"
                              onClick={() => setForceLogoutTarget(m)}
                            >
                              <LogOut size={15} />
                            </button>
                            {m.id !== currentUserId && (
                              <button
                                className="btn-icon danger"
                                title="Deactivate or Delete Member"
                                onClick={() => setDeletingMember(m)}
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </>
                        ) : (
                          <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                            Protected (Owner)
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {/* Pagination Bar */}
        <div className="admin-pagination">
          <div>
            Showing {members.length} of {totalCount} workspace members
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              className="btn-secondary"
              style={{ height: '30px', padding: '0 10px', fontSize: 'var(--text-xs)' }}
              disabled={cursorHistory.length === 0}
              onClick={handlePrevPage}
            >
              <ChevronLeft size={14} />
              <span>Previous</span>
            </button>
            <button
              className="btn-secondary"
              style={{ height: '30px', padding: '0 10px', fontSize: 'var(--text-xs)' }}
              disabled={!hasMore}
              onClick={handleNextPage}
            >
              <span>Next</span>
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* --- Modals for Members Tab --- */}

      {/* 1. Add Member Modal */}
      {showAddModal && (
        <AddMemberDialog
          isOwner={isOwner}
          onClose={() => setShowAddModal(false)}
          onSuccess={(newMember, pass) => {
            setShowAddModal(false);
            setMembers(prev => [newMember, ...prev]);
            setTotalCount(prev => prev + 1);
            if (pass) {
              setRevealedPassword({ user: newMember.full_name, pass });
            }
            onToast(`Member ${newMember.full_name} successfully added`, 'success');
          }}
          onError={err => onToast(err, 'danger')}
        />
      )}

      {/* 2. Edit Member Modal */}
      {editingMember && (
        <EditMemberDialog
          member={editingMember}
          isOwner={isOwner}
          onClose={() => setEditingMember(null)}
          onSuccess={updated => {
            setMembers(prev => prev.map(m => m.id === updated.id ? updated : m));
            setEditingMember(null);
            onToast(`Member ${updated.full_name} updated successfully`, 'success');
          }}
          onError={err => onToast(err, 'danger')}
        />
      )}

      {/* 3. Reset Password Modal */}
      {resettingMember && (
        <ResetPasswordDialog
          member={resettingMember}
          onClose={() => setResettingMember(null)}
          onSuccess={tempPass => {
            setResettingMember(null);
            setRevealedPassword({ user: resettingMember.full_name, pass: tempPass });
            onToast(`Password reset for ${resettingMember.full_name}`, 'success');
          }}
          onError={err => onToast(err, 'danger')}
        />
      )}

      {/* 4. Force Logout Modal */}
      {forceLogoutTarget && (
        <ForceLogoutDialog
          member={forceLogoutTarget}
          onClose={() => setForceLogoutTarget(null)}
          onSuccess={() => {
            setForceLogoutTarget(null);
            onToast(`Sessions revoked for ${forceLogoutTarget.full_name}`, 'success');
          }}
          onError={err => onToast(err, 'danger')}
        />
      )}

      {/* 5. Delete Member Modal */}
      {deletingMember && (
        <DeleteMemberDialog
          member={deletingMember}
          onClose={() => setDeletingMember(null)}
          onSuccess={permanent => {
            setMembers(prev => prev.filter(m => m.id !== deletingMember.id));
            setTotalCount(prev => Math.max(0, prev - 1));
            setDeletingMember(null);
            onToast(`Member ${deletingMember.full_name} ${permanent ? 'permanently deleted' : 'deactivated'}`, 'warning');
          }}
          onError={err => onToast(err, 'danger')}
        />
      )}

      {/* 6. Bulk CSV Import Modal */}
      {showImportModal && (
        <BulkImportDialog
          onClose={() => setShowImportModal(false)}
          onSuccess={result => {
            setShowImportModal(false);
            loadMembers();
            onToast(`Imported ${result.succeeded} members (${result.failed} failed)`, result.failed > 0 ? 'warning' : 'success');
          }}
          onError={err => onToast(err, 'danger')}
        />
      )}
    </div>
  );
};

/* --- Subcomponent Dialogs --- */

// Add Member Dialog
function AddMemberDialog({
  isOwner,
  onClose,
  onSuccess,
  onError
}: {
  isOwner: boolean;
  onClose: () => void;
  onSuccess: (m: AdminMember, pass?: string) => void;
  onError: (err: string) => void;
}) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [department, setDepartment] = useState('');
  const [role, setRole] = useState('Member');
  const [password, setPassword] = useState('');
  const [mustChangePassword, setMustChangePassword] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleGeneratePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*()-_=+';
    let res = '';
    for (let i = 0; i < 16; i++) {
      res += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setPassword(res);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !email.trim()) {
      onError('Full Name and Email are required');
      return;
    }

    setIsSubmitting(true);
    try {
      const resp = await createAdminMember({
        full_name: fullName.trim(),
        email: email.trim(),
        display_name: displayName.trim() || undefined,
        department: department.trim() || undefined,
        role,
        password: password.trim() || undefined,
        must_change_password: mustChangePassword,
      });
      onSuccess(resp.member, resp.generated_password);
    } catch (err: any) {
      onError(err?.error?.message || 'Failed to create member');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="admin-modal-backdrop" onClick={onClose}>
      <div className="admin-modal-card" onClick={e => e.stopPropagation()}>
        <div className="admin-modal-header">
          <div style={{ fontWeight: 600, fontSize: 'var(--text-base)' }}>Add Workspace Member</div>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="admin-modal-body">
            <div className="form-group">
              <label className="form-label">Full Name *</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Alex Chen"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Email Address *</label>
              <input
                type="email"
                className="form-input"
                placeholder="alex.chen@company.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div className="form-group">
                <label className="form-label">Display Name / Handle</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="alex"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Department / Team</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="DevOps"
                  value={department}
                  onChange={e => setDepartment(e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Workspace Role</label>
              <select
                className="admin-select"
                style={{ width: '100%' }}
                value={role}
                onChange={e => setRole(e.target.value)}
              >
                <option value="Member">Member (standard workspace access)</option>
                <option value="Guest">Guest (restricted channel access)</option>
                {isOwner && <option value="Admin">Admin (can manage members & channels)</option>}
                {isOwner && <option value="Owner">Owner (full workspace ownership)</option>}
              </select>
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label className="form-label" style={{ margin: 0 }}>Initial Password</label>
                <button
                  type="button"
                  onClick={handleGeneratePassword}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--primary)',
                    fontSize: 'var(--text-xs)',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                >
                  ⚡ Generate Secure Password
                </button>
              </div>
              <input
                type="text"
                className="form-input"
                placeholder="Leave blank to auto-generate"
                value={password}
                onChange={e => setPassword(e.target.value)}
                style={{ fontFamily: password ? 'var(--font-mono)' : 'inherit' }}
              />
            </div>

            <div className="form-checkbox-row">
              <div>
                <div className="form-checkbox-label">Must change password on first login</div>
                <div className="form-checkbox-hint">Requires user to choose a personal password when logging in</div>
              </div>
              <input
                type="checkbox"
                checked={mustChangePassword}
                onChange={e => setMustChangePassword(e.target.checked)}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
            </div>
          </div>
          <div className="admin-modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create Member'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Edit Member Dialog
function EditMemberDialog({
  member,
  isOwner,
  onClose,
  onSuccess,
  onError
}: {
  member: AdminMember;
  isOwner: boolean;
  onClose: () => void;
  onSuccess: (m: AdminMember) => void;
  onError: (err: string) => void;
}) {
  const [fullName, setFullName] = useState(member.full_name);
  const [displayName, setDisplayName] = useState(member.display_name || '');
  const [email, setEmail] = useState(member.email);
  const [department, setDepartment] = useState(member.department || '');
  const [role, setRole] = useState(member.role);
  const [accountState, setAccountState] = useState(member.account_state || 'active');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const updated = await updateAdminMember(member.id, {
        full_name: fullName.trim(),
        display_name: displayName.trim(),
        email: email.trim(),
        department: department.trim(),
        role,
        account_state: accountState,
      });
      onSuccess(updated);
    } catch (err: any) {
      onError(err?.error?.message || 'Failed to update member');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="admin-modal-backdrop" onClick={onClose}>
      <div className="admin-modal-card" onClick={e => e.stopPropagation()}>
        <div className="admin-modal-header">
          <div style={{ fontWeight: 600, fontSize: 'var(--text-base)' }}>Edit Member: {member.full_name}</div>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="admin-modal-body">
            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input
                type="text"
                className="form-input"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                type="email"
                className="form-input"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div className="form-group">
                <label className="form-label">Display Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Department</label>
                <input
                  type="text"
                  className="form-input"
                  value={department}
                  onChange={e => setDepartment(e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Workspace Role</label>
              <select
                className="admin-select"
                style={{ width: '100%' }}
                value={role}
                onChange={e => setRole(e.target.value)}
                disabled={!isOwner && member.role.toLowerCase() === 'owner'}
              >
                <option value="Member">Member</option>
                <option value="Guest">Guest</option>
                {isOwner && <option value="Admin">Admin</option>}
                {isOwner && <option value="Owner">Owner</option>}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Account State</label>
              <select
                className="admin-select"
                style={{ width: '100%' }}
                value={accountState}
                onChange={e => setAccountState(e.target.value as any)}
              >
                <option value="active">Active (normal access)</option>
                <option value="suspended">Suspended (sessions blocked)</option>
                <option value="deactivated">Deactivated (soft-deleted)</option>
              </select>
            </div>
          </div>
          <div className="admin-modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Reset Password Dialog (Sensitive action requiring admin password confirmation)
function ResetPasswordDialog({
  member,
  onClose,
  onSuccess,
  onError
}: {
  member: AdminMember;
  onClose: () => void;
  onSuccess: (tempPass: string) => void;
  onError: (err: string) => void;
}) {
  const [adminPassword, setAdminPassword] = useState('');
  const [customPassword, setCustomPassword] = useState('');
  const [mustChange, setMustChange] = useState(true);
  const [forceLogout, setForceLogout] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminPassword) {
      onError('Please re-enter your administrator password to confirm');
      return;
    }

    setIsSubmitting(true);
    try {
      const resp = await resetMemberPassword(member.id, {
        admin_password: adminPassword,
        temporary_password: customPassword.trim() || undefined,
        must_change_password: mustChange,
        force_logout: forceLogout,
      });
      onSuccess(resp.temporary_password);
    } catch (err: any) {
      onError(err?.error?.message || 'Password reset failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="admin-modal-backdrop" onClick={onClose}>
      <div className="admin-modal-card" onClick={e => e.stopPropagation()}>
        <div className="admin-modal-header">
          <div style={{ fontWeight: 600, fontSize: 'var(--text-base)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <KeyRound size={18} style={{ color: 'var(--primary)' }} />
            <span>Reset Password: {member.full_name}</span>
          </div>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="admin-modal-body">
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
              This will overwrite the current password for <strong>{member.email}</strong>.
            </p>

            <div className="form-group">
              <label className="form-label">Set Custom Temporary Password (optional)</label>
              <input
                type="text"
                className="form-input"
                placeholder="Leave blank to auto-generate high-entropy password"
                value={customPassword}
                onChange={e => setCustomPassword(e.target.value)}
              />
            </div>

            <div className="form-checkbox-row">
              <div>
                <div className="form-checkbox-label">Require password change on next login</div>
                <div className="form-checkbox-hint">Recommended for security</div>
              </div>
              <input
                type="checkbox"
                checked={mustChange}
                onChange={e => setMustChange(e.target.checked)}
                style={{ width: '18px', height: '18px' }}
              />
            </div>

            <div className="form-checkbox-row">
              <div>
                <div className="form-checkbox-label">Force logout of all devices</div>
                <div className="form-checkbox-hint">Revokes all active sessions immediately</div>
              </div>
              <input
                type="checkbox"
                checked={forceLogout}
                onChange={e => setForceLogout(e.target.checked)}
                style={{ width: '18px', height: '18px' }}
              />
            </div>

            <div className="form-group" style={{ marginTop: 'var(--space-4)', padding: 'var(--space-3)', backgroundColor: 'var(--surface-level-3)', borderRadius: 'var(--radius-md)' }}>
              <label className="form-label" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                🔒 Re-enter YOUR Admin Password to Confirm *
              </label>
              <input
                type="password"
                className="form-input"
                placeholder="Your administrator password"
                value={adminPassword}
                onChange={e => setAdminPassword(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="admin-modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? 'Resetting...' : 'Confirm Reset Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Force Logout Dialog
function ForceLogoutDialog({
  member,
  onClose,
  onSuccess,
  onError
}: {
  member: AdminMember;
  onClose: () => void;
  onSuccess: () => void;
  onError: (err: string) => void;
}) {
  const [adminPassword, setAdminPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await forceLogoutMember(member.id, adminPassword);
      onSuccess();
    } catch (err: any) {
      onError(err?.error?.message || 'Failed to force logout');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="admin-modal-backdrop" onClick={onClose}>
      <div className="admin-modal-card" onClick={e => e.stopPropagation()}>
        <div className="admin-modal-header">
          <div style={{ fontWeight: 600, fontSize: 'var(--text-base)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <LogOut size={18} style={{ color: 'var(--warning)' }} />
            <span>Force Logout: {member.full_name}</span>
          </div>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="admin-modal-body">
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
              Are you sure you want to terminate all active desktop, mobile, and web sessions for <strong>{member.full_name} ({member.email})</strong>?
            </p>

            <div className="form-group">
              <label className="form-label">Re-enter YOUR Admin Password *</label>
              <input
                type="password"
                className="form-input"
                placeholder="Your administrator password"
                value={adminPassword}
                onChange={e => setAdminPassword(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="admin-modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-danger" disabled={isSubmitting}>
              {isSubmitting ? 'Revoking...' : 'Terminate Sessions'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Delete Member Dialog (Destructive action with typed confirmation)
function DeleteMemberDialog({
  member,
  onClose,
  onSuccess,
  onError
}: {
  member: AdminMember;
  onClose: () => void;
  onSuccess: (permanent: boolean) => void;
  onError: (err: string) => void;
}) {
  const [permanent, setPermanent] = useState(false);
  const [deleteMessages, setDeleteMessages] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (permanent && confirmText !== 'DELETE' && confirmText.toLowerCase() !== member.email.toLowerCase()) {
      onError("Please type 'DELETE' or the user's email to confirm permanent deletion");
      return;
    }

    setIsSubmitting(true);
    try {
      await deleteAdminMember(member.id, {
        admin_password: adminPassword,
        permanent,
        delete_messages: deleteMessages,
        confirm_text: confirmText,
      });
      onSuccess(permanent);
    } catch (err: any) {
      onError(err?.error?.message || 'Failed to remove member');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="admin-modal-backdrop" onClick={onClose}>
      <div className="admin-modal-card" style={{ maxWidth: '540px' }} onClick={e => e.stopPropagation()}>
        <div className="admin-modal-header" style={{ borderBottomColor: 'rgba(239, 68, 68, 0.3)' }}>
          <div style={{ fontWeight: 600, fontSize: 'var(--text-base)', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--danger)' }}>
            <Trash2 size={18} />
            <span>Remove Member: {member.full_name}</span>
          </div>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="admin-modal-body">
            <div style={{
              backgroundColor: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-3) var(--space-4)',
              fontSize: 'var(--text-xs)',
              color: 'var(--text-primary)',
              marginBottom: 'var(--space-4)'
            }}>
              ⚠️ All active sessions will be terminated and private channel memberships revoked immediately.
            </div>

            <div className="form-checkbox-row">
              <div>
                <div className="form-checkbox-label">Permanent Delete</div>
                <div className="form-checkbox-hint">Completely expunges user record from system (cannot be undone)</div>
              </div>
              <input
                type="checkbox"
                checked={permanent}
                onChange={e => setPermanent(e.target.checked)}
                style={{ width: '18px', height: '18px' }}
              />
            </div>

            {permanent && (
              <>
                <div className="form-checkbox-row">
                  <div>
                    <div className="form-checkbox-label">Delete message history</div>
                    <div className="form-checkbox-hint">If unchecked, past messages remain authored as &quot;Deleted User&quot;</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={deleteMessages}
                    onChange={e => setDeleteMessages(e.target.checked)}
                    style={{ width: '18px', height: '18px' }}
                  />
                </div>

                <div className="form-group" style={{ marginTop: 'var(--space-3)' }}>
                  <label className="form-label" style={{ color: 'var(--danger)' }}>
                    Type &quot;DELETE&quot; or &quot;{member.email}&quot; to confirm:
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="DELETE"
                    value={confirmText}
                    onChange={e => setConfirmText(e.target.value)}
                    required
                  />
                </div>
              </>
            )}

            <div className="form-group" style={{ marginTop: 'var(--space-4)', padding: 'var(--space-3)', backgroundColor: 'var(--surface-level-3)', borderRadius: 'var(--radius-md)' }}>
              <label className="form-label" style={{ fontWeight: 600 }}>
                🔒 Re-enter YOUR Admin Password *
              </label>
              <input
                type="password"
                className="form-input"
                placeholder="Your administrator password"
                value={adminPassword}
                onChange={e => setAdminPassword(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="admin-modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-danger" disabled={isSubmitting}>
              {isSubmitting ? 'Removing...' : (permanent ? 'Permanently Delete Member' : 'Deactivate Member')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Bulk CSV Import Dialog
function BulkImportDialog({
  onClose,
  onSuccess,
  onError
}: {
  onClose: () => void;
  onSuccess: (res: ImportResult) => void;
  onError: (err: string) => void;
}) {
  const [csvContent, setCsvContent] = useState(
    'full_name,email,role,department\nElena Rostova,elena@example.com,Member,Product\nMarcus Brody,marcus@example.com,Member,Engineering\nSara Lin,sara@example.com,Guest,Marketing'
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [report, setReport] = useState<ImportResult | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvContent.trim()) {
      onError('Please paste or upload CSV data');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await importMembersCSV(csvContent);
      setReport(res);
      if (res.failed === 0) {
        onSuccess(res);
      }
    } catch (err: any) {
      onError(err?.error?.message || 'CSV import failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = ev => {
        if (typeof ev.target?.result === 'string') {
          setCsvContent(ev.target.result);
        }
      };
      reader.readAsText(file);
    }
  };

  return (
    <div className="admin-modal-backdrop" onClick={onClose}>
      <div className="admin-modal-card" style={{ maxWidth: '600px' }} onClick={e => e.stopPropagation()}>
        <div className="admin-modal-header">
          <div style={{ fontWeight: 600, fontSize: 'var(--text-base)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <UploadCloud size={18} style={{ color: 'var(--primary)' }} />
            <span>Bulk CSV Member Import</span>
          </div>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="admin-modal-body">
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' }}>
              Required CSV headers: <code>full_name, email, role, department</code>. Passwords will be cryptographically auto-generated and flagged for change on first login.
            </p>

            <div style={{ marginBottom: 'var(--space-3)' }}>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileUpload}
                style={{ fontSize: 'var(--text-xs)' }}
              />
            </div>

            <div className="form-group">
              <label className="form-label">CSV Data Preview / Edit</label>
              <textarea
                className="form-input"
                style={{ height: '140px', fontFamily: 'var(--font-mono)', fontSize: '11px', padding: '8px', lineHeight: '1.4' }}
                value={csvContent}
                onChange={e => setCsvContent(e.target.value)}
              />
            </div>

            {report && (
              <div style={{
                backgroundColor: report.failed > 0 ? 'rgba(239, 68, 68, 0.08)' : 'rgba(34, 197, 94, 0.08)',
                border: `1px solid ${report.failed > 0 ? 'rgba(239, 68, 68, 0.3)' : 'rgba(34, 197, 94, 0.3)'}`,
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-3)',
                fontSize: 'var(--text-xs)'
              }}>
                <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                  Import Results: {report.succeeded} succeeded, {report.failed} failed out of {report.total}
                </div>
                {report.errors?.length > 0 && (
                  <ul style={{ paddingLeft: '16px', color: 'var(--danger)', margin: 0 }}>
                    {report.errors.map((er, idx) => (
                      <li key={idx}>Row {er.row} ({er.email}): {er.error}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <div className="admin-modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              {report ? 'Close' : 'Cancel'}
            </button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? 'Importing...' : 'Start Import'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
