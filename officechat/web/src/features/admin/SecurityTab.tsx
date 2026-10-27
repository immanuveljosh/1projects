import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  KeyRound,
  Lock,
  AlertOctagon,
  CheckCircle2,
  Save,
  RotateCcw
} from 'lucide-react';
import type { WorkspaceSettings } from './adminApi';
import {
  getWorkspaceSettings,
  updateWorkspaceSettings,
  emergencyLogout,
  changeOwnPassword
} from './adminApi';

interface SecurityTabProps {
  onToast: (msg: string, type?: 'success' | 'info' | 'warning' | 'danger') => void;
}

export const SecurityTab: React.FC<SecurityTabProps> = ({ onToast }) => {
  const [settings, setSettings] = useState<WorkspaceSettings>(() => ({
    workspace_id: 'default',
    min_password_length: 8,
    require_special_char: true,
    require_number: true,
    password_expiry_days: 90,
    max_login_attempts: 5,
    lockout_duration_mins: 15,
    enforce_2fa: false,
    session_timeout_mins: 10080,
    retention_days: 0,
    allow_guest_invites: false,
    updated_at: '',
  }));

  const [isSavingPolicy, setIsSavingPolicy] = useState(false);

  // Change Own Password States
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPass, setIsChangingPass] = useState(false);

  // Emergency Logout State
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);
  const [emergencyAdminPass, setEmergencyAdminPass] = useState('');
  const [isExecutingEmergency, setIsExecutingEmergency] = useState(false);

  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await getWorkspaceSettings();
        if (res && res.workspace_id) {
          setSettings(res);
        }
      } catch (err) {
        console.error('Failed to load workspace settings:', err);
      }
    }
    loadSettings();
  }, []);

  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingPolicy(true);
    try {
      const updated = await updateWorkspaceSettings(settings);
      setSettings(updated);
      onToast('Workspace security & password policy updated successfully', 'success');
    } catch (err: any) {
      onToast(err?.error?.message || 'Failed to save settings', 'danger');
    } finally {
      setIsSavingPolicy(false);
    }
  };

  // Password strength calculation
  const calculatePasswordStrength = (pass: string) => {
    if (!pass) return { score: 0, label: 'None', color: 'transparent', width: '0%' };
    let score = 0;
    if (pass.length >= 8) score += 25;
    if (pass.length >= 12) score += 15;
    if (/[A-Z]/.test(pass) && /[a-z]/.test(pass)) score += 20;
    if (/[0-9]/.test(pass)) score += 20;
    if (/[^A-Za-z0-9]/.test(pass)) score += 20;

    if (score < 40) return { score, label: 'Weak', color: 'var(--danger)', width: `${score}%` };
    if (score < 70) return { score, label: 'Fair', color: 'var(--warning)', width: `${score}%` };
    if (score < 90) return { score, label: 'Strong', color: '#60a5fa', width: `${score}%` };
    return { score: 100, label: 'Excellent', color: 'var(--status-online)', width: '100%' };
  };

  const strength = calculatePasswordStrength(newPassword);

  const handleChangeOwnPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword) {
      onToast('Current password is required', 'warning');
      return;
    }
    if (newPassword !== confirmPassword) {
      onToast('New password and confirmation do not match', 'warning');
      return;
    }
    if (newPassword.length < settings.min_password_length) {
      onToast(`Password must be at least ${settings.min_password_length} characters`, 'warning');
      return;
    }

    setIsChangingPass(true);
    try {
      await changeOwnPassword(currentPassword, newPassword);
      onToast('Password changed successfully! All other sessions have been revoked.', 'success');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      onToast(err?.error?.message || 'Failed to change password', 'danger');
    } finally {
      setIsChangingPass(false);
    }
  };

  const handleExecuteEmergencyLogout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emergencyAdminPass) {
      onToast('Admin password is required to execute emergency logout', 'warning');
      return;
    }

    setIsExecutingEmergency(true);
    try {
      await emergencyLogout(emergencyAdminPass);
      setShowEmergencyModal(false);
      setEmergencyAdminPass('');
      onToast('Emergency Logout executed: All workspace tokens have been revoked.', 'warning');
    } catch (err: any) {
      onToast(err?.error?.message || 'Emergency logout failed', 'danger');
    } finally {
      setIsExecutingEmergency(false);
    }
  };

  return (
    <div className="security-tab-container">
      <div className="security-grid">
        {/* Card 1: Workspace Password Policy */}
        <div className="admin-card">
          <div className="admin-card-header">
            <ShieldAlert size={20} style={{ color: 'var(--primary)' }} />
            <div>
              <div className="admin-card-title">Password & Authentication Policy</div>
              <div className="admin-card-desc">Enforce corporate compliance standards across all accounts</div>
            </div>
          </div>

          <form onSubmit={handleSavePolicy}>
            <div className="form-group">
              <label className="form-label">Minimum Password Length: {settings.min_password_length} chars</label>
              <input
                type="range"
                min="6"
                max="32"
                value={settings.min_password_length}
                onChange={e => setSettings({ ...settings, min_password_length: Number(e.target.value) })}
                style={{ width: '100%', accentColor: 'var(--primary)', cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                <span>6 (Min)</span>
                <span>16 (Recommended)</span>
                <span>32 (Max)</span>
              </div>
            </div>

            <div className="form-checkbox-row">
              <div>
                <div className="form-checkbox-label">Require Special Character</div>
                <div className="form-checkbox-hint">Requires at least one symbol (!@#$%^&*)</div>
              </div>
              <input
                type="checkbox"
                checked={settings.require_special_char}
                onChange={e => setSettings({ ...settings, require_special_char: e.target.checked })}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
            </div>

            <div className="form-checkbox-row">
              <div>
                <div className="form-checkbox-label">Require Numeric Character</div>
                <div className="form-checkbox-hint">Requires at least one digit (0-9)</div>
              </div>
              <input
                type="checkbox"
                checked={settings.require_number}
                onChange={e => setSettings({ ...settings, require_number: e.target.checked })}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
            </div>

            <div className="form-checkbox-row">
              <div>
                <div className="form-checkbox-label">Enforce Two-Factor Authentication (2FA)</div>
                <div className="form-checkbox-hint">Require TOTP authenticator on login</div>
              </div>
              <input
                type="checkbox"
                checked={settings.enforce_2fa}
                onChange={e => setSettings({ ...settings, enforce_2fa: e.target.checked })}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
              <div className="form-group">
                <label className="form-label">Password Expiry (Days)</label>
                <input
                  type="number"
                  className="form-input"
                  min="0"
                  max="365"
                  value={settings.password_expiry_days}
                  onChange={e => setSettings({ ...settings, password_expiry_days: Number(e.target.value) })}
                />
                <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>0 = Never expires</span>
              </div>

              <div className="form-group">
                <label className="form-label">Max Failed Attempts</label>
                <input
                  type="number"
                  className="form-input"
                  min="3"
                  max="20"
                  value={settings.max_login_attempts}
                  onChange={e => setSettings({ ...settings, max_login_attempts: Number(e.target.value) })}
                />
                <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>Lockout trigger</span>
              </div>
            </div>

            <button
              type="submit"
              className="btn-primary"
              style={{ width: '100%', marginTop: 'var(--space-2)' }}
              disabled={isSavingPolicy}
            >
              <Save size={16} />
              <span>{isSavingPolicy ? 'Saving Policy...' : 'Save Password Policy'}</span>
            </button>
          </form>
        </div>

        {/* Card 2: Admin Change Own Password */}
        <div className="admin-card">
          <div className="admin-card-header">
            <KeyRound size={20} style={{ color: 'var(--primary)' }} />
            <div>
              <div className="admin-card-title">Change Administrator Password</div>
              <div className="admin-card-desc">Update your own administrator account credentials</div>
            </div>
          </div>

          <form onSubmit={handleChangeOwnPassword}>
            <div className="form-group">
              <label className="form-label">Current Password *</label>
              <input
                type="password"
                className="form-input"
                placeholder="Enter current password"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">New Password *</label>
              <input
                type="password"
                className="form-input"
                placeholder="Enter new secure password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                required
              />
              {newPassword && (
                <div>
                  <div className="strength-meter-bar">
                    <div
                      className="strength-meter-fill"
                      style={{ width: strength.width, backgroundColor: strength.color }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-2xs)', marginTop: '4px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Password Strength:</span>
                    <span style={{ color: strength.color, fontWeight: 600 }}>{strength.label}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Confirm New Password *</label>
              <input
                type="password"
                className="form-input"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
              />
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: 'var(--text-xs)',
              color: 'var(--text-secondary)',
              marginBottom: 'var(--space-4)'
            }}>
              <CheckCircle2 size={14} style={{ color: 'var(--status-online)' }} />
              <span>Changing your password will revoke all other active sessions</span>
            </div>

            <button
              type="submit"
              className="btn-secondary"
              style={{ width: '100%' }}
              disabled={isChangingPass}
            >
              <Lock size={16} />
              <span>{isChangingPass ? 'Updating...' : 'Change Password & Revoke Other Sessions'}</span>
            </button>
          </form>
        </div>

        {/* Card 3: Emergency Workspace Logout */}
        <div className="admin-card danger-card" style={{ gridColumn: '1 / -1' }}>
          <div className="admin-card-header" style={{ borderBottomColor: 'rgba(239, 68, 68, 0.25)' }}>
            <AlertOctagon size={22} style={{ color: 'var(--danger)' }} />
            <div>
              <div className="admin-card-title" style={{ color: 'var(--danger)' }}>
                Emergency Workspace Logout (Killswitch)
              </div>
              <div className="admin-card-desc">
                Immediately revoke and rotate ALL refresh tokens across every device in the entire workspace
              </div>
            </div>
          </div>

          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: '1.6', marginBottom: 'var(--space-4)' }}>
            Use this action in the event of an active security incident, compromised credentials, or employee offboarding.
            All active Web, Mobile, and Desktop sessions across all users will be invalidated instantly. Users will be required to re-authenticate with their credentials.
          </p>

          <button
            type="button"
            className="btn-danger-outline"
            onClick={() => setShowEmergencyModal(true)}
            id="btn-emergency-logout"
          >
            <RotateCcw size={16} />
            <span>Initiate Emergency Workspace Logout</span>
          </button>
        </div>
      </div>

      {/* Emergency Logout Confirmation Modal */}
      {showEmergencyModal && (
        <div className="admin-modal-backdrop" onClick={() => setShowEmergencyModal(false)}>
          <div className="admin-modal-card" style={{ maxWidth: '500px' }} onClick={e => e.stopPropagation()}>
            <div className="admin-modal-header" style={{ borderBottomColor: 'rgba(239, 68, 68, 0.3)' }}>
              <div style={{ fontWeight: 600, fontSize: 'var(--text-base)', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--danger)' }}>
                <AlertOctagon size={20} />
                <span>Confirm Emergency Workspace Logout</span>
              </div>
              <button className="btn-icon" onClick={() => setShowEmergencyModal(false)}>✕</button>
            </div>
            <form onSubmit={handleExecuteEmergencyLogout}>
              <div className="admin-modal-body">
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
                  This will revoke all session refresh tokens for <strong>all workspace members</strong>.
                </p>

                <div className="form-group">
                  <label className="form-label" style={{ fontWeight: 600 }}>
                    🔒 Re-enter YOUR Admin Password to Authorize *
                  </label>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="Your administrator password"
                    value={emergencyAdminPass}
                    onChange={e => setEmergencyAdminPass(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="admin-modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowEmergencyModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-danger" disabled={isExecutingEmergency}>
                  {isExecutingEmergency ? 'Revoking Workspace Tokens...' : 'Revoke All Workspace Sessions'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
