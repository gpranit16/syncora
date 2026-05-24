import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Zap, Eye, EyeOff } from 'lucide-react';
import { registerApi } from '../api/auth';
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
    if (!name || !email || !password) {
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
      const { data } = await registerApi({ name, email, password });
      if (data.success) {
        // Auto-login after registration
        const loginRes = await import('../api/auth').then(m => m.loginApi({ email, password }));
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
      <div className="auth-ambient" />
      <div className="auth-container">
        <div className="auth-brand">
          <div className="auth-logo">
            <Zap size={28} />
          </div>
          <h1>NexusHub</h1>
          <p className="auth-tagline">Join your team's command center</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <h2>Create Account</h2>
          {error && <div className="auth-error">{error}</div>}

          <div className="form-group">
            <label htmlFor="register-name">Full Name</label>
            <input
              id="register-name"
              className="input"
              type="text"
              placeholder="Jane Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          </div>

          <div className="form-group">
            <label htmlFor="register-email">Email</label>
            <input
              id="register-email"
              className="input"
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label htmlFor="register-password">Password</label>
            <div className="password-wrapper">
              <input
                id="register-password"
                className="input"
                type={showPass ? 'text' : 'password'}
                placeholder="Minimum 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPass(!showPass)}
                tabIndex={-1}
              >
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-lg btn-primary auth-submit"
            disabled={loading}
          >
            {loading ? 'Creating account...' : 'Create Account'}
          </button>

          <p className="auth-switch">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
};

export default RegisterPage;
