import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Zap, Eye, EyeOff, AlertCircle, ArrowRight } from 'lucide-react';
import { registerApi, loginApi } from '../api/auth';
import { useAuth } from '../context/AuthContext';
import './Auth.css';

const RegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanName || !cleanEmail || !password) {
      setError('All fields are required');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const { data } = await registerApi({ name: cleanName, email: cleanEmail, password });
      if (data.success) {
        // Auto-login after registration
        const loginRes = await loginApi({ email: cleanEmail, password });
        if (loginRes.data.success && loginRes.data.token && loginRes.data.user) {
          login(loginRes.data.user, loginRes.data.token);
          navigate('/');
        } else {
          navigate('/login');
        }
      } else {
        setError(data.message || 'Registration failed');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Registration failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card-container">
        {/* Brand */}
        <div className="auth-brand">
          <div className="auth-logo-icon">
            <Zap size={20} />
          </div>
          <span className="auth-brand-name">Syncora</span>
        </div>

        {/* Card */}
        <div className="auth-card">
          <div className="auth-header">
            <h1>Create your account</h1>
            <p>Start collaborating with your team in Syncora.</p>
          </div>

          {error && (
            <div className="auth-error-banner">
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="auth-field">
              <label htmlFor="register-name">Full name</label>
              <div className="auth-input-wrapper">
                <input
                  id="register-name"
                  type="text"
                  placeholder="e.g. Alex Morgan"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  required
                />
              </div>
            </div>

            <div className="auth-field">
              <label htmlFor="register-email">Work email</label>
              <div className="auth-input-wrapper">
                <input
                  id="register-email"
                  type="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
            </div>

            <div className="auth-field">
              <label htmlFor="register-password">Password</label>
              <div className="auth-input-wrapper">
                <input
                  id="register-password"
                  type={showPass ? 'text' : 'password'}
                  placeholder="Minimum 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  className="auth-toggle-pass"
                  onClick={() => setShowPass(!showPass)}
                  tabIndex={-1}
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="auth-submit-btn"
              disabled={loading}
            >
              {loading ? (
                <span>Creating account...</span>
              ) : (
                <>
                  <span>Create Account</span>
                  <ArrowRight size={15} />
                </>
              )}
            </button>
          </form>

          <p className="auth-footer-text">
            Already have an account?
            <Link to="/login">Sign in here</Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default RegisterPage;
