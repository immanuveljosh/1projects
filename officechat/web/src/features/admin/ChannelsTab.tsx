import React, { useState, useEffect, useCallback } from 'react';
import {
  Search,
  Plus,
  Hash,
  Lock,
  Megaphone,
  Archive,
  Trash2,
  Edit3,
  Users,
  AlertTriangle,
  RefreshCw,
  ShieldCheck
} from 'lucide-react';
import type {
  AdminChannel,
  AdminChannelDetail
} from './adminApi';
import {
  getAdminChannels,
  getAdminChannel,
  createAdminChannel,
  updateAdminChannel,
  deleteAdminChannel,
  addChannelMembers,
  removeChannelMember
} from './adminApi';

interface ChannelsTabProps {
  onToast: (msg: string, type?: 'success' | 'info' | 'warning' | 'danger') => void;
}

export const ChannelsTab: React.FC<ChannelsTabProps> = ({ onToast }) => {
  const [channels, setChannels] = useState<AdminChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [archivedFilter, setArchivedFilter] = useState<'all' | 'active' | 'archived'>('active');

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingChannel, setEditingChannel] = useState<AdminChannelDetail | null>(null);
  const [deletingChannel, setDeletingChannel] = useState<AdminChannel | null>(null);

  const loadChannels = useCallback(async () => {
    setLoading(true);
    try {
      const isArchived = archivedFilter === 'all' ? undefined : (archivedFilter === 'archived');
      const res = await getAdminChannels({
        search,
        type: typeFilter,
        is_archived: isArchived,
      });
      setChannels(res.channels || []);
    } catch (err) {
      console.error('Failed to load channels:', err);
      // Fallback preview seed
      if (channels.length === 0) {
        setChannels([
          {
            id: 'c_general',
            workspace_id: 'ws_default',
            name: 'general',
            description: 'Company-wide announcements and general workplace chatter',
            topic: 'All-Hands sync agenda vote is live',
            is_private: false,
            is_archived: false,
            is_announcement: false,
            member_count: 42,
            created_by: 'system',
            creator_name: 'Administrator',
            created_at: new Date(Date.now() - 86400000 * 30).toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            id: 'c_announcements',
            workspace_id: 'ws_default',
            name: 'announcements',
            description: 'Official corporate leadership updates',
            topic: 'Quarterly OKRs & Holidays calendar',
            is_private: false,
            is_archived: false,
            is_announcement: true,
            member_count: 42,
            created_by: 'system',
            creator_name: 'Administrator',
            created_at: new Date(Date.now() - 86400000 * 25).toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            id: 'c_dev_team',
            workspace_id: 'ws_default',
            name: 'dev-team',
            description: 'Backend & Frontend engineering discussion',
            topic: 'Sub-5ms PostgreSQL connection pooling',
            is_private: true,
            is_archived: false,
            is_announcement: false,
            member_count: 12,
            created_by: 'u_sarah',
            creator_name: 'Sarah Connor',
            created_at: new Date(Date.now() - 86400000 * 15).toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            id: 'c_legacy_slack',
            workspace_id: 'ws_default',
            name: 'legacy-slack-archive',
            description: 'Archived messages from previous system',
            topic: 'Read-only archive',
            is_private: false,
            is_archived: true,
            is_announcement: false,
            member_count: 8,
            created_by: 'system',
            creator_name: 'Administrator',
            created_at: new Date(Date.now() - 86400000 * 60).toISOString(),
            updated_at: new Date().toISOString(),
          }
        ]);
      }
    } finally {
      setLoading(false);
    }
  }, [search, typeFilter, archivedFilter, channels.length]);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  const handleOpenEdit = async (chan: AdminChannel) => {
    try {
      const detail = await getAdminChannel(chan.id);
      setEditingChannel(detail);
    } catch {
      // Create minimal detail object if offline
      setEditingChannel({
        ...chan,
        members: [
          {
            id: 'cm1',
            user_id: 'u1',
            full_name: 'Administrator',
            display_name: 'admin',
            email: 'admin@officechat.local',
            avatar_url: '',
            role: 'Admin',
            joined_at: new Date().toISOString(),
          }
        ]
      });
    }
  };

  const handleToggleArchive = async (chan: AdminChannel) => {
    try {
      const newArchived = !chan.is_archived;
      await updateAdminChannel(chan.id, { is_archived: newArchived });
      setChannels(prev => prev.map(c => c.id === chan.id ? { ...c, is_archived: newArchived } : c));
      onToast(`Channel #${chan.name} ${newArchived ? 'archived' : 'unarchived'}`, 'info');
    } catch (err: any) {
      onToast(err?.error?.message || 'Failed to update channel archive state', 'danger');
    }
  };

  return (
    <div className="channels-tab-container">
      {/* Toolbar */}
      <div className="admin-toolbar">
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="admin-search-box">
            <Search size={16} className="admin-search-icon" />
            <input
              type="text"
              placeholder="Search channels by name, topic, or description..."
              className="admin-search-input"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <select
            className="admin-select"
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
          >
            <option value="">All Types</option>
            <option value="public">Public</option>
            <option value="private">Private</option>
            <option value="announcement">Announcement Only</option>
          </select>

          <select
            className="admin-select"
            value={archivedFilter}
            onChange={e => setArchivedFilter(e.target.value as any)}
          >
            <option value="active">Active Only</option>
            <option value="archived">Archived Only</option>
            <option value="all">All Channels</option>
          </select>
        </div>

        <button
          className="btn-primary"
          onClick={() => setShowCreateModal(true)}
          id="btn-create-channel"
        >
          <Plus size={16} />
          <span>Create Channel</span>
        </button>
      </div>

      {/* Channels Table */}
      <div className="admin-table-container">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Channel Name</th>
              <th>Type</th>
              <th>Members</th>
              <th>Topic & Description</th>
              <th>Created Date</th>
              <th>Creator</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
                  <RefreshCw size={24} className="spin" style={{ color: 'var(--primary)', margin: '0 auto var(--space-2)' }} />
                  <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>Loading channels...</div>
                </td>
              </tr>
            ) : channels.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
                  <AlertTriangle size={32} style={{ color: 'var(--text-muted)', margin: '0 auto var(--space-2)' }} />
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>No channels found</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>Try clearing your search query or filters.</div>
                </td>
              </tr>
            ) : (
              channels.map(c => {
                const isGeneral = c.name.toLowerCase() === 'general';

                return (
                  <tr key={c.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {c.is_private ? (
                          <Lock size={15} style={{ color: 'var(--warning)', flexShrink: 0 }} />
                        ) : c.is_announcement ? (
                          <Megaphone size={15} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                        ) : (
                          <Hash size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                        )}
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {c.name}
                        </span>
                        {isGeneral && (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            backgroundColor: 'rgba(99, 102, 241, 0.12)',
                            color: 'var(--primary)',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            fontSize: 'var(--text-2xs)',
                            fontWeight: 600
                          }}>
                            <ShieldCheck size={11} />
                            default
                          </span>
                        )}
                        {c.is_archived && (
                          <span style={{
                            backgroundColor: 'rgba(100, 116, 139, 0.2)',
                            color: 'var(--text-muted)',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            fontSize: 'var(--text-2xs)'
                          }}>
                            archived
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span style={{
                        fontSize: 'var(--text-xs)',
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-full)',
                        backgroundColor: c.is_private ? 'rgba(245, 158, 11, 0.12)' : (c.is_announcement ? 'rgba(99, 102, 241, 0.12)' : 'rgba(255, 255, 255, 0.06)'),
                        color: c.is_private ? 'var(--warning)' : (c.is_announcement ? 'var(--primary)' : 'var(--text-secondary)'),
                        fontWeight: 500
                      }}>
                        {c.is_private ? 'Private' : (c.is_announcement ? 'Announcement' : 'Public')}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                        <Users size={13} />
                        <span>{c.member_count}</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ maxWidth: '320px' }}>
                        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                          {c.topic || c.description || '—'}
                        </div>
                        {c.topic && c.description && (
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                            {c.description}
                          </div>
                        )}
                      </div>
                    </td>
                    <td>
                      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
                        {new Date(c.created_at).toLocaleDateString()}
                      </span>
                    </td>
                    <td>
                      <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}>
                        {c.creator_name || 'System'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                        <button
                          className="btn-icon"
                          title="Edit Channel & Manage Members"
                          onClick={() => handleOpenEdit(c)}
                        >
                          <Edit3 size={15} />
                        </button>
                        {!isGeneral && (
                          <>
                            <button
                              className="btn-icon"
                              title={c.is_archived ? 'Unarchive Channel' : 'Archive Channel'}
                              onClick={() => handleToggleArchive(c)}
                            >
                              <Archive size={15} />
                            </button>
                            <button
                              className="btn-icon danger"
                              title="Delete Channel"
                              onClick={() => setDeletingChannel(c)}
                            >
                              <Trash2 size={15} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* --- Modals for Channels Tab --- */}

      {/* 1. Create Channel Modal */}
      {showCreateModal && (
        <CreateChannelDialog
          onClose={() => setShowCreateModal(false)}
          onSuccess={newChan => {
            setShowCreateModal(false);
            setChannels(prev => [newChan, ...prev]);
            onToast(`Channel #${newChan.name} created successfully`, 'success');
          }}
          onError={err => onToast(err, 'danger')}
        />
      )}

      {/* 2. Edit Channel Modal */}
      {editingChannel && (
        <EditChannelDialog
          channel={editingChannel}
          onClose={() => setEditingChannel(null)}
          onSuccess={updated => {
            setChannels(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c));
            setEditingChannel(null);
            onToast(`Channel #${updated.name} updated successfully`, 'success');
          }}
          onError={err => onToast(err, 'danger')}
        />
      )}

      {/* 3. Delete Channel Modal */}
      {deletingChannel && (
        <DeleteChannelDialog
          channel={deletingChannel}
          onClose={() => setDeletingChannel(null)}
          onSuccess={permanent => {
            if (permanent) {
              setChannels(prev => prev.filter(c => c.id !== deletingChannel.id));
            } else {
              setChannels(prev => prev.map(c => c.id === deletingChannel.id ? { ...c, is_archived: true } : c));
            }
            setDeletingChannel(null);
            onToast(`Channel #${deletingChannel.name} ${permanent ? 'permanently deleted' : 'archived'}`, 'warning');
          }}
          onError={err => onToast(err, 'danger')}
        />
      )}
    </div>
  );
};

/* --- Subcomponent Dialogs for Channels --- */

function CreateChannelDialog({
  onClose,
  onSuccess,
  onError
}: {
  onClose: () => void;
  onSuccess: (chan: AdminChannel) => void;
  onError: (err: string) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [topic, setTopic] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [isAnnouncement, setIsAnnouncement] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, '-');
    if (!cleanName) {
      onError('Channel name is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await createAdminChannel({
        name: cleanName,
        description: description.trim() || undefined,
        topic: topic.trim() || undefined,
        is_private: isPrivate,
        is_announcement: isAnnouncement,
      });
      onSuccess(created);
    } catch (err: any) {
      onError(err?.error?.message || 'Failed to create channel');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="admin-modal-backdrop" onClick={onClose}>
      <div className="admin-modal-card" onClick={e => e.stopPropagation()}>
        <div className="admin-modal-header">
          <div style={{ fontWeight: 600, fontSize: 'var(--text-base)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Hash size={18} style={{ color: 'var(--primary)' }} />
            <span>Create New Channel</span>
          </div>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="admin-modal-body">
            <div className="form-group">
              <label className="form-label">Channel Name *</label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: '12px', top: '10px', color: 'var(--text-muted)', fontWeight: 600 }}>#</span>
                <input
                  type="text"
                  className="form-input"
                  style={{ paddingLeft: '28px' }}
                  placeholder="e.g. project-apollo"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Topic</label>
              <input
                type="text"
                className="form-input"
                placeholder="What is this channel focused on?"
                value={topic}
                onChange={e => setTopic(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea
                className="form-input"
                style={{ height: '70px', padding: '8px 12px' }}
                placeholder="Detailed purpose of the channel..."
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </div>

            <div className="form-checkbox-row">
              <div>
                <div className="form-checkbox-label">Make Private</div>
                <div className="form-checkbox-hint">Only invited members can view this channel and its history</div>
              </div>
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={e => setIsPrivate(e.target.checked)}
                style={{ width: '18px', height: '18px' }}
              />
            </div>

            <div className="form-checkbox-row">
              <div>
                <div className="form-checkbox-label">Announcement Only</div>
                <div className="form-checkbox-hint">Only Channel Admins can post messages; others can read and react</div>
              </div>
              <input
                type="checkbox"
                checked={isAnnouncement}
                onChange={e => setIsAnnouncement(e.target.checked)}
                style={{ width: '18px', height: '18px' }}
              />
            </div>
          </div>
          <div className="admin-modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create Channel'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditChannelDialog({
  channel,
  onClose,
  onSuccess,
  onError
}: {
  channel: AdminChannelDetail;
  onClose: () => void;
  onSuccess: (chan: Partial<AdminChannel>) => void;
  onError: (err: string) => void;
}) {
  const [name, setName] = useState(channel.name);
  const [description, setDescription] = useState(channel.description || '');
  const [topic, setTopic] = useState(channel.topic || '');
  const [isPrivate, setIsPrivate] = useState(channel.is_private);
  const [isAnnouncement, setIsAnnouncement] = useState(channel.is_announcement);
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [members, setMembers] = useState(channel.members || []);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isGeneral = channel.name.toLowerCase() === 'general';

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const updated = await updateAdminChannel(channel.id, {
        name: isGeneral ? undefined : name.trim(),
        description: description.trim(),
        topic: topic.trim(),
        is_private: isGeneral ? undefined : isPrivate,
        is_announcement: isAnnouncement,
      });
      onSuccess(updated);
    } catch (err: any) {
      onError(err?.error?.message || 'Failed to update channel');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddMember = async () => {
    if (!newMemberEmail.trim()) return;
    try {
      // In real backend, user_id or email
      await addChannelMembers(channel.id, [newMemberEmail.trim()]);
      setMembers(prev => [
        ...prev,
        {
          id: `cm_${Date.now()}`,
          user_id: `u_${Date.now()}`,
          full_name: newMemberEmail.split('@')[0],
          display_name: newMemberEmail.split('@')[0],
          email: newMemberEmail.trim(),
          avatar_url: '',
          role: 'Member',
          joined_at: new Date().toISOString(),
        }
      ]);
      setNewMemberEmail('');
    } catch (err: any) {
      onError(err?.error?.message || 'Failed to add member');
    }
  };

  const handleRemoveMember = async (userId: string) => {
    try {
      await removeChannelMember(channel.id, userId);
      setMembers(prev => prev.filter(m => m.user_id !== userId));
    } catch (err: any) {
      onError(err?.error?.message || 'Failed to remove member');
    }
  };

  return (
    <div className="admin-modal-backdrop" onClick={onClose}>
      <div className="admin-modal-card" style={{ maxWidth: '580px' }} onClick={e => e.stopPropagation()}>
        <div className="admin-modal-header">
          <div style={{ fontWeight: 600, fontSize: 'var(--text-base)' }}>Edit Channel: #{channel.name}</div>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSave}>
          <div className="admin-modal-body">
            <div className="form-group">
              <label className="form-label">Channel Name</label>
              <input
                type="text"
                className="form-input"
                value={name}
                onChange={e => setName(e.target.value)}
                disabled={isGeneral}
                required
              />
              {isGeneral && (
                <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                  Default #general channel name cannot be changed
                </span>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Topic</label>
              <input
                type="text"
                className="form-input"
                value={topic}
                onChange={e => setTopic(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea
                className="form-input"
                style={{ height: '60px', padding: '8px' }}
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </div>

            {!isGeneral && (
              <div className="form-checkbox-row">
                <div>
                  <div className="form-checkbox-label">Private Channel</div>
                  <div className="form-checkbox-hint">Restrict channel visibility to selected members</div>
                </div>
                <input
                  type="checkbox"
                  checked={isPrivate}
                  onChange={e => setIsPrivate(e.target.checked)}
                  style={{ width: '18px', height: '18px' }}
                />
              </div>
            )}

            <div className="form-checkbox-row">
              <div>
                <div className="form-checkbox-label">Announcement Only</div>
                <div className="form-checkbox-hint">Restrict posting permissions to Channel Admins</div>
              </div>
              <input
                type="checkbox"
                checked={isAnnouncement}
                onChange={e => setIsAnnouncement(e.target.checked)}
                style={{ width: '18px', height: '18px' }}
              />
            </div>

            {/* Manage Channel Members */}
            <div style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--border-subtle)' }}>
              <div style={{ fontWeight: 600, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                Channel Members ({members.length})
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                <input
                  type="email"
                  className="form-input"
                  placeholder="Invite by user email or ID..."
                  value={newMemberEmail}
                  onChange={e => setNewMemberEmail(e.target.value)}
                />
                <button type="button" className="btn-secondary" onClick={handleAddMember}>Add</button>
              </div>

              <div style={{ maxHeight: '120px', overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                {members.map(m => (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: 'var(--text-xs)' }}>
                      <strong>{m.full_name}</strong> <span style={{ color: 'var(--text-muted)' }}>({m.email})</span>
                    </div>
                    <button
                      type="button"
                      className="btn-icon danger"
                      style={{ width: '24px', height: '24px' }}
                      onClick={() => handleRemoveMember(m.user_id)}
                      title="Remove member"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
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

function DeleteChannelDialog({
  channel,
  onClose,
  onSuccess,
  onError
}: {
  channel: AdminChannel;
  onClose: () => void;
  onSuccess: (permanent: boolean) => void;
  onError: (err: string) => void;
}) {
  const [permanent, setPermanent] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (permanent && confirmText !== 'DELETE' && confirmText.toLowerCase() !== channel.name.toLowerCase()) {
      onError("Please type 'DELETE' or the channel name to confirm permanent deletion");
      return;
    }

    setIsSubmitting(true);
    try {
      await deleteAdminChannel(channel.id, {
        permanent,
        confirm_text: confirmText,
      });
      onSuccess(permanent);
    } catch (err: any) {
      onError(err?.error?.message || 'Failed to delete channel');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="admin-modal-backdrop" onClick={onClose}>
      <div className="admin-modal-card" onClick={e => e.stopPropagation()}>
        <div className="admin-modal-header" style={{ borderBottomColor: 'rgba(239, 68, 68, 0.3)' }}>
          <div style={{ fontWeight: 600, fontSize: 'var(--text-base)', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--danger)' }}>
            <Trash2 size={18} />
            <span>Delete Channel: #{channel.name}</span>
          </div>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="admin-modal-body">
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
              By default, channels are safely archived (read-only snapshot preserved).
            </p>

            <div className="form-checkbox-row">
              <div>
                <div className="form-checkbox-label">Permanent Delete</div>
                <div className="form-checkbox-hint">Permanently destroys the channel and all contained messages & files</div>
              </div>
              <input
                type="checkbox"
                checked={permanent}
                onChange={e => setPermanent(e.target.checked)}
                style={{ width: '18px', height: '18px' }}
              />
            </div>

            {permanent && (
              <div className="form-group" style={{ marginTop: 'var(--space-4)' }}>
                <label className="form-label" style={{ color: 'var(--danger)' }}>
                  Type &quot;DELETE&quot; or &quot;{channel.name}&quot; to confirm:
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
            )}
          </div>
          <div className="admin-modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-danger" disabled={isSubmitting}>
              {isSubmitting ? 'Deleting...' : (permanent ? 'Permanently Delete Channel' : 'Archive Channel')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
