import { useState } from 'react';
import { login as apiLogin } from './api';
import { useAuth } from './AuthContext';

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

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#0a0c10',
      fontFamily: "'Plus Jakarta Sans', sans-serif"
    }}>
      <div style={{
        width: 400, background: '#10131a', border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 18, padding: 38
      }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14,
            background: 'linear-gradient(135deg,#4b8ef0,#9b6ff0)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, fontWeight: 700, color: '#fff', margin: '0 auto 12px'
          }}>G</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#dde1ec' }}>GDEC Analytics</div>
          <div style={{ fontSize: 11, color: '#454e63', letterSpacing: '.5px', textTransform: 'uppercase', marginTop: 3 }}>
            Account Intelligence
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11.5, color: '#7e879e', display: 'block', marginBottom: 6, fontWeight: 500 }}>
              Username
            </label>
            <input
              type="text" value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Enter your username"
              style={{
                width: '100%', background: '#181c26', border: '1px solid rgba(255,255,255,0.12)',
                color: '#dde1ec', fontFamily: 'inherit', fontSize: 13.5,
                padding: '10px 14px', borderRadius: 9, outline: 'none', boxSizing: 'border-box'
              }}
            />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11.5, color: '#7e879e', display: 'block', marginBottom: 6, fontWeight: 500 }}>
              Password
            </label>
            <input
              type="password" value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter your password"
              style={{
                width: '100%', background: '#181c26', border: '1px solid rgba(255,255,255,0.12)',
                color: '#dde1ec', fontFamily: 'inherit', fontSize: 13.5,
                padding: '10px 14px', borderRadius: 9, outline: 'none', boxSizing: 'border-box'
              }}
            />
          </div>
          <button
            type="submit" disabled={loading}
            style={{
              width: '100%', padding: 11, borderRadius: 9, border: 'none',
              background: 'linear-gradient(135deg,#4b8ef0,#7b6af0)',
              color: '#fff', fontFamily: 'inherit', fontSize: 14,
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
          <div style={{ fontSize: 10.5, color: '#454e63', textAlign: 'center', marginTop: 16, lineHeight: 1.6 }}>
            Contact your administrator for access credentials.
          </div>
        </form>
      </div>
    </div>
  );
}