import { useState } from 'react';
import { login as apiLogin } from './api';
import { useAuth } from './AuthContext';
import gdecLogo from './assets/gdec-logo.png';

// Palette mirrors Dashboard.tsx so the login screen matches the app.
const TEAL   = '#1a7a8a';
const LIGHT  = '#f0f4f8';
const WHITE  = '#ffffff';
const BORDER = '#e2e8f0';
const TEXT1  = '#1a2332';
const TEXT2  = '#4a5568';
const TEXT3  = '#94a3b8';

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiLogin(username, password);
      login(res.data.access_token, res.data.user);
    } catch {
      setError('Invalid username or password.');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    width: '100%', background: WHITE, border: `1px solid ${BORDER}`,
    color: TEXT1, fontFamily: 'inherit', fontSize: 13.5,
    padding: '10px 14px', borderRadius: 9, outline: 'none', boxSizing: 'border-box' as const,
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: LIGHT,
      fontFamily: "'Plus Jakarta Sans', sans-serif"
    }}>
      <div style={{
        width: 400, background: WHITE, border: `1px solid ${BORDER}`,
        borderRadius: 18, padding: 38, boxShadow: '0 4px 24px rgba(26,35,50,0.06)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <img
            src={gdecLogo}
            alt="Great Deals E-Commerce Corp"
            style={{ height: 48, maxWidth: '100%', objectFit: 'contain', display: 'block', margin: '0 auto 14px' }}
          />
          <div style={{ fontSize: 18, fontWeight: 700, color: TEXT1 }}>GDEC Analytics</div>
          <div style={{ fontSize: 11, color: TEXT3, letterSpacing: '.5px', textTransform: 'uppercase', marginTop: 3 }}>
            Account Intelligence
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11.5, color: TEXT2, display: 'block', marginBottom: 6, fontWeight: 500 }}>
              Username
            </label>
            <input
              type="text" value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Enter your username"
              style={inputStyle}
            />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11.5, color: TEXT2, display: 'block', marginBottom: 6, fontWeight: 500 }}>
              Password
            </label>
            <input
              type="password" value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter your password"
              style={inputStyle}
            />
          </div>
          <button
            type="submit" disabled={loading}
            style={{
              width: '100%', padding: 11, borderRadius: 9, border: 'none',
              background: TEAL, color: '#fff', fontFamily: 'inherit', fontSize: 14,
              fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1, marginTop: 6
            }}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
          {error && (
            <div style={{ fontSize: 12, color: '#e85555', textAlign: 'center', marginTop: 10 }}>
              {error}
            </div>
          )}
          <div style={{ fontSize: 10.5, color: TEXT3, textAlign: 'center', marginTop: 16, lineHeight: 1.6 }}>
            Contact your administrator for access credentials.
          </div>
        </form>
      </div>
    </div>
  );
}
