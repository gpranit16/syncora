import React, { useState, useRef } from 'react';
import { X, Camera, Lock, User as UserIcon, Shield, Check, Eye, EyeOff, Trash2, Upload, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { updateProfile, changePassword, uploadAvatar } from '../../api/user';
import { getAvatarUrl, AVATAR_PRESETS } from '../../utils/avatar';
import './UserProfileModal.css';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({ isOpen, onClose }) => {
  const { user, updateUser } = useAuth();
  const [activeTab, setActiveTab] = useState<'profile' | 'password'>('profile');

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

  if (!isOpen) return null;

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
      </div>
    </div>
  );
};

export default UserProfileModal;
