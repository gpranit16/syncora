import React, { useState, useRef, useEffect } from 'react';
import { X, Camera, Lock, User as UserIcon, Shield, Check, Eye, EyeOff, Trash2, Upload, CheckCircle2, AlertCircle, Calendar, ExternalLink, Loader2, Sparkles } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { updateProfile, changePassword, uploadAvatar } from '../../api/user';
import { getAvatarUrl, AVATAR_PRESETS } from '../../utils/avatar';
import {
  getCalendarStatus,
  getGoogleCalendarAuthUrl,
  updateCalendarSettings,
  disconnectGoogleCalendar,
  type CalendarIntegrationStatus,
} from '../../api/calendar';
import './UserProfileModal.css';

const GoogleGIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
  </svg>
);

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'profile' | 'password' | 'integrations';
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'profile',
}) => {
  const { user, updateUser } = useAuth();
  const [activeTab, setActiveTab] = useState<'profile' | 'password' | 'integrations'>(initialTab);

  // Sync initial tab when changed or modal opened
  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  // Google Calendar Integration State
  const [calendarStatus, setCalendarStatus] = useState<CalendarIntegrationStatus | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarActionLoading, setCalendarActionLoading] = useState(false);
  const [calendarError, setCalendarError] = useState('');
  const [calendarSuccess, setCalendarSuccess] = useState('');

  // Profile Form State
  const [name, setName] = useState(user?.name || '');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user?.avatar_url || null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(getAvatarUrl(user?.avatar_url));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');

  // Password Form State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPass, setShowCurrentPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  // Keep form fields synced with user data
  useEffect(() => {
    if (isOpen && user) {
      setName(user.name || '');
      setAvatarUrl(user.avatar_url || null);
      setAvatarPreview(getAvatarUrl(user.avatar_url));
    }
  }, [isOpen, user]);

  const fetchCalendarStatus = async () => {
    setCalendarLoading(true);
    setCalendarError('');
    try {
      const status = await getCalendarStatus();
      setCalendarStatus(status);
    } catch {
      setCalendarError('Failed to load Google Calendar status');
    } finally {
      setCalendarLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && activeTab === 'integrations') {
      fetchCalendarStatus();
    }
  }, [isOpen, activeTab]);

  if (!isOpen) return null;

  const handleConnectCalendar = async () => {
    setCalendarActionLoading(true);
    setCalendarError('');
    try {
      const { authUrl } = await getGoogleCalendarAuthUrl();
      if (authUrl) {
        window.location.href = authUrl;
      }
    } catch (err: any) {
      setCalendarError(err?.response?.data?.message || 'Failed to start Google Calendar connection');
      setCalendarActionLoading(false);
    }
  };

  const handleDisconnectCalendar = async () => {
    if (!window.confirm('Disconnect Google Calendar from your Syncora account? Scheduled tasks and meetings will no longer sync.')) {
      return;
    }
    setCalendarActionLoading(true);
    setCalendarError('');
    try {
      await disconnectGoogleCalendar();
      setCalendarStatus({
        connected: false,
        email: null,
        sync_tasks: false,
        sync_meetings: false,
      });
      setCalendarSuccess('Google Calendar disconnected successfully');
      setTimeout(() => setCalendarSuccess(''), 3000);
    } catch {
      setCalendarError('Failed to disconnect Google Calendar');
    } finally {
      setCalendarActionLoading(false);
    }
  };

  const handleToggleSync = async (field: 'sync_tasks' | 'sync_meetings', currentValue: boolean) => {
    if (!calendarStatus) return;
    const nextValue = !currentValue;
    setCalendarStatus({ ...calendarStatus, [field]: nextValue });
    try {
      await updateCalendarSettings({ [field]: nextValue });
    } catch {
      setCalendarStatus({ ...calendarStatus, [field]: currentValue });
      setCalendarError('Failed to update sync setting');
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setAvatarFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatarPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSelectPreset = (url: string) => {
    setAvatarFile(null);
    setAvatarUrl(url);
    setAvatarPreview(url);
  };

  const handleRemoveAvatar = () => {
    setAvatarFile(null);
    setAvatarUrl('');
    setAvatarPreview(null);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setProfileError('Name cannot be empty');
      return;
    }

    setProfileLoading(true);
    setProfileError('');
    setProfileSuccess('');

    try {
      let finalAvatarUrl = avatarUrl;

      // If user uploaded a new local file, upload it first
      if (avatarFile) {
        const uploadRes = await uploadAvatar(avatarFile);
        if (uploadRes.data.success) {
          finalAvatarUrl = uploadRes.data.avatar_url;
        }
      }

      // Update profile with name and final avatar URL
      const res = await updateProfile({
        name: name.trim(),
        avatar_url: finalAvatarUrl === '' ? null : finalAvatarUrl,
      });

      if (res.data.success) {
        updateUser({
          name: res.data.user.name,
          avatar_url: res.data.user.avatar_url,
        });
        setProfileSuccess('Profile and Display Picture updated successfully!');
        setTimeout(() => {
          setProfileSuccess('');
        }, 3000);
      }
    } catch (err: any) {
      setProfileError(err.response?.data?.message || 'Failed to update profile');
    } finally {
      setProfileLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (!currentPassword || !newPassword) {
      setPasswordError('Please fill in all password fields');
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters long');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirm password do not match');
      return;
    }

    setPasswordLoading(true);

    try {
      const res = await changePassword({
        currentPassword,
        newPassword,
      });

      if (res.data.success) {
        setPasswordSuccess('Password changed successfully!');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setTimeout(() => {
          setPasswordSuccess('');
        }, 3000);
      }
    } catch (err: any) {
      setPasswordError(err.response?.data?.message || 'Failed to change password');
    } finally {
      setPasswordLoading(false);
    }
  };

  const getInitials = (n: string) => n.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase() || '?';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal user-profile-modal" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-header">
          <div className="profile-modal-title-group">
            <div className="profile-modal-icon-badge">
              <UserIcon size={18} />
            </div>
            <div>
              <h3>Account & Profile</h3>
              <p className="profile-modal-subtitle">Manage your personal info, display picture, and security</p>
            </div>
          </div>
          <button className="btn-icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        {/* Modal Tabs */}
        <div className="profile-modal-tabs">
          <button
            type="button"
            className={`profile-tab-btn ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            <UserIcon size={14} />
            <span>Profile & DP</span>
          </button>
          <button
            type="button"
            className={`profile-tab-btn ${activeTab === 'password' ? 'active' : ''}`}
            onClick={() => setActiveTab('password')}
          >
            <Lock size={14} />
            <span>Password & Security</span>
          </button>
          <button
            type="button"
            className={`profile-tab-btn ${activeTab === 'integrations' ? 'active' : ''}`}
            onClick={() => setActiveTab('integrations')}
          >
            <Calendar size={14} />
            <span>Google Calendar</span>
          </button>
        </div>

        {/* Tab 1: Profile & DP */}
        {activeTab === 'profile' && (
          <form onSubmit={handleSaveProfile} className="profile-tab-content">
            {/* Avatar Section */}
            <div className="avatar-edit-section">
              <div className="avatar-preview-wrapper" onClick={() => fileInputRef.current?.click()}>
                {avatarPreview ? (
                  <img src={avatarPreview} alt={user?.name} className="avatar-preview-img" />
                ) : (
                  <div className="avatar-preview-fallback">
                    {user ? getInitials(name || user.name) : '?'}
                  </div>
                )}
                <div className="avatar-hover-overlay" title="Upload new photo">
                  <Camera size={20} />
                  <span>Change</span>
                </div>
              </div>

              <div className="avatar-controls">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  accept="image/png, image/jpeg, image/webp, image/gif"
                  style={{ display: 'none' }}
                />
                <div className="avatar-button-group">
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost avatar-action-btn"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload size={13} />
                    <span>Upload Photo</span>
                  </button>
                  {avatarPreview && (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost avatar-action-btn delete"
                      onClick={handleRemoveAvatar}
                    >
                      <Trash2 size={13} />
                      <span>Remove</span>
                    </button>
                  )}
                </div>
                <span className="avatar-hint">Supported: JPG, PNG, WEBP (Max 5MB)</span>
              </div>
            </div>

            {/* Avatar Presets Grid */}
            <div className="presets-section">
              <div className="presets-label">
                <UserIcon size={13} />
                <span>Preset Avatars</span>
              </div>
              <div className="presets-grid">
                {AVATAR_PRESETS.map((presetUrl, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className={`preset-item ${avatarPreview === presetUrl ? 'selected' : ''}`}
                    onClick={() => handleSelectPreset(presetUrl)}
                  >
                    <img src={presetUrl} alt={`Avatar preset ${idx + 1}`} />
                    {avatarPreview === presetUrl && (
                      <div className="preset-selected-check">
                        <Check size={11} />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Name Input */}
            <div className="form-group" style={{ marginTop: 16 }}>
              <label>Display Name</label>
              <input
                type="text"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your full name"
                required
              />
            </div>

            {/* Email Field (Read Only) */}
            <div className="form-group" style={{ marginTop: 12 }}>
              <label>Email Address</label>
              <div className="email-readonly-box">
                <span>{user?.email}</span>
                <span className="email-status-pill">
                  <Check size={11} /> Verified
                </span>
              </div>
            </div>

            {/* Alerts */}
            {profileError && (
              <div className="profile-alert error">
                <AlertCircle size={15} />
                <span>{profileError}</span>
              </div>
            )}
            {profileSuccess && (
              <div className="profile-alert success">
                <CheckCircle2 size={15} color="#10b981" />
                <span>{profileSuccess}</span>
              </div>
            )}

            {/* Actions */}
            <div className="profile-modal-footer">
              <button type="button" className="btn btn-md btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-md btn-primary"
                disabled={profileLoading}
              >
                {profileLoading ? 'Saving...' : 'Save Profile Changes'}
              </button>
            </div>
          </form>
        )}

        {/* Tab 2: Password & Security */}
        {activeTab === 'password' && (
          <form onSubmit={handleChangePassword} className="profile-tab-content">
            <div className="password-instruction-box">
              <Shield size={16} className="security-icon" />
              <span>Make sure your password is at least 6 characters long and secure.</span>
            </div>

            <div className="form-group" style={{ marginTop: 16 }}>
              <label>Current Password</label>
              <div className="password-input-wrap">
                <input
                  type={showCurrentPass ? 'text' : 'password'}
                  className="input"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  required
                />
                <button
                  type="button"
                  className="pass-toggle-btn"
                  onClick={() => setShowCurrentPass(!showCurrentPass)}
                >
                  {showCurrentPass ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <div className="form-group" style={{ marginTop: 12 }}>
              <label>New Password</label>
              <div className="password-input-wrap">
                <input
                  type={showNewPass ? 'text' : 'password'}
                  className="input"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  required
                />
                <button
                  type="button"
                  className="pass-toggle-btn"
                  onClick={() => setShowNewPass(!showNewPass)}
                >
                  {showNewPass ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <div className="form-group" style={{ marginTop: 12 }}>
              <label>Confirm New Password</label>
              <div className="password-input-wrap">
                <input
                  type={showNewPass ? 'text' : 'password'}
                  className="input"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  required
                />
              </div>
            </div>

            {/* Alerts */}
            {passwordError && (
              <div className="profile-alert error">
                <AlertCircle size={15} />
                <span>{passwordError}</span>
              </div>
            )}
            {passwordSuccess && (
              <div className="profile-alert success">
                <CheckCircle2 size={15} color="#10b981" />
                <span>{passwordSuccess}</span>
              </div>
            )}

            {/* Actions */}
            <div className="profile-modal-footer">
              <button type="button" className="btn btn-md btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-md btn-primary"
                disabled={passwordLoading}
              >
                {passwordLoading ? 'Updating...' : 'Update Password'}
              </button>
            </div>
          </form>
        )}

        {/* Tab 3: Google Calendar Integration */}
        {activeTab === 'integrations' && (
          <div className="calendar-integration-container">
            {calendarError && (
              <div className="profile-alert error">
                <AlertCircle size={15} />
                <span>{calendarError}</span>
              </div>
            )}
            {calendarSuccess && (
              <div className="profile-alert success">
                <CheckCircle2 size={15} color="#10b981" />
                <span>{calendarSuccess}</span>
              </div>
            )}

            {calendarLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 0', gap: 10 }}>
                <Loader2 size={20} className="spin-icon" style={{ color: 'var(--accent-primary)' }} />
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Loading integration details...</span>
              </div>
            ) : (
              <div className="calendar-card">
                <div className="calendar-card-header">
                  <div className="calendar-brand">
                    <div className="calendar-brand-icon">
                      <GoogleGIcon size={22} />
                    </div>
                    <div>
                      <h4 className="calendar-brand-title">Google Calendar</h4>
                      <p className="calendar-brand-desc">Syncora Workspace Integration</p>
                    </div>
                  </div>

                  <div>
                    {calendarStatus?.connected ? (
                      <span className="calendar-status-badge connected">
                        <span className="calendar-pulse" />
                        Connected
                      </span>
                    ) : (
                      <span className="calendar-status-badge disconnected">
                        Not Connected
                      </span>
                    )}
                  </div>
                </div>

                {!calendarStatus?.connected ? (
                  <>
                    <div className="calendar-feature-list">
                      <div className="calendar-feature-item">
                        <Sparkles size={16} className="feature-icon" style={{ color: '#c084fc' }} />
                        <span><strong>Automated Task Deadlines:</strong> When you or your AI schedule tasks with due dates, they appear right inside your Google Calendar.</span>
                      </div>
                      <div className="calendar-feature-item">
                        <Calendar size={16} className="feature-icon" style={{ color: '#38bdf8' }} />
                        <span><strong>Scheduled Meetings:</strong> Instant & scheduled meetings get synced with direct 1-click video call join links.</span>
                      </div>
                      <div className="calendar-feature-item">
                        <CheckCircle2 size={16} className="feature-icon" style={{ color: '#10b981' }} />
                        <span><strong>Automatic Updates:</strong> Editing dates or deleting tasks in Syncora updates your Google Calendar in real time.</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="calendar-btn-connect"
                      onClick={handleConnectCalendar}
                      disabled={calendarActionLoading}
                    >
                      {calendarActionLoading ? (
                        <>
                          <Loader2 size={18} className="spin-icon" />
                          <span>Connecting...</span>
                        </>
                      ) : (
                        <>
                          <GoogleGIcon size={18} />
                          <span>Connect Google Calendar</span>
                        </>
                      )}
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{ background: 'rgba(16, 185, 129, 0.06)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <GoogleGIcon size={18} />
                        <span style={{ fontSize: '0.85rem', color: '#fff', fontWeight: 500 }}>
                          {calendarStatus.email || 'Connected Google Account'}
                        </span>
                      </div>
                      <a
                        href="https://calendar.google.com"
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontSize: '0.75rem', color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}
                      >
                        Open Calendar <ExternalLink size={12} />
                      </a>
                    </div>

                    <div className="calendar-settings-group">
                      <div className="calendar-toggle-row">
                        <div className="calendar-toggle-info">
                          <span className="calendar-toggle-title">Sync Task Deadlines</span>
                          <span className="calendar-toggle-desc">Automatically add tasks with due dates to your calendar</span>
                        </div>
                        <label className="calendar-switch">
                          <input
                            type="checkbox"
                            checked={Boolean(calendarStatus.sync_tasks)}
                            onChange={() => handleToggleSync('sync_tasks', Boolean(calendarStatus.sync_tasks))}
                          />
                          <span className="calendar-slider" />
                        </label>
                      </div>

                      <div className="calendar-toggle-row">
                        <div className="calendar-toggle-info">
                          <span className="calendar-toggle-title">Sync Meetings</span>
                          <span className="calendar-toggle-desc">Add scheduled voice & video calls with join links</span>
                        </div>
                        <label className="calendar-switch">
                          <input
                            type="checkbox"
                            checked={Boolean(calendarStatus.sync_meetings)}
                            onChange={() => handleToggleSync('sync_meetings', Boolean(calendarStatus.sync_meetings))}
                          />
                          <span className="calendar-slider" />
                        </label>
                      </div>
                    </div>

                    <div className="profile-modal-footer" style={{ borderTop: 'none', paddingTop: 0, marginTop: 8 }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost delete"
                        onClick={handleDisconnectCalendar}
                        disabled={calendarActionLoading}
                        style={{ color: '#ef4444' }}
                      >
                        {calendarActionLoading ? 'Disconnecting...' : 'Disconnect Calendar'}
                      </button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
                        Done
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default UserProfileModal;
