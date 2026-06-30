import { useState } from 'react';
import { changePassword } from './api';

const TEAL = '#1a7a8a', WHITE = '#ffffff', BORDER = '#e2e8f0';
const TEXT1 = '#1a2332', TEXT2 = '#4a5568', TEXT3 = '#94a3b8';

interface Props {
  onClose: () => void;
  onSignOut: () => void;   // the existing useAuth() logout — reused, not reinvented
}

export default function ChangePasswordModal({ onClose, onSignOut }: Props) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword]         = useState('');
  const [confirm, setConfirm]                 = useState('');
  const [error, setError]                     = useState('');
  const [submitting, setSubmitting]           = useState(false);
  const [success, setSuccess]                 = useState(false);

  const close = () => { if (!submitting) onClose(); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword !== confirm) { setError("Passwords don't match"); return; }
    if (newPassword.length < 8)  { setError('New password must be at least 8 characters'); return; }
    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);   // confirm NOT sent
      setSuccess(true);
      setTimeout(() => onSignOut(), 1500);
    } catch (err: any) {
      if (err?.response?.status === 401) setError('Current password is incorrect');
      else setError('Something went wrong, please try again.');
      setSubmitting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8,
    border: `1px solid ${BORDER}`, fontFamily: 'inherit', fontSize: 13, color: TEXT1,
    outline: 'none', marginTop: 4,
  };
  const labelStyle: React.CSSProperties = { fontSize: 11, color: TEXT3, fontWeight: 600 };

  return (
    <div onClick={close}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12,
          padding: 24, width: 360, maxWidth: '90vw', boxShadow: '0 8px 30px rgba(0,0,0,0.18)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: TEXT1 }}>Change Password</div>
          <button onClick={close} disabled={submitting}
            style={{ border: 'none', background: 'transparent', fontSize: 18, lineHeight: 1,
              color: TEXT3, cursor: submitting ? 'not-allowed' : 'pointer' }}>×</button>
        </div>

        {success ? (
          <div style={{ fontSize: 13, color: TEAL, padding: '12px 0' }}>
            Password changed — please sign in again
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label style={labelStyle}>Current Password
              <input type="password" value={currentPassword} autoFocus
                onChange={e => setCurrentPassword(e.target.value)} style={inputStyle} />
            </label>
            <div style={{ height: 12 }} />
            <label style={labelStyle}>New Password
              <input type="password" value={newPassword}
                onChange={e => setNewPassword(e.target.value)} style={inputStyle} />
            </label>
            <div style={{ height: 12 }} />
            <label style={labelStyle}>Confirm New Password
              <input type="password" value={confirm}
                onChange={e => setConfirm(e.target.value)} style={inputStyle} />
            </label>

            {error && <div style={{ fontSize: 12, color: '#e85555', marginTop: 12 }}>{error}</div>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button type="button" onClick={close} disabled={submitting}
                style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${BORDER}`,
                  background: WHITE, color: TEXT2, fontFamily: 'inherit', fontSize: 12,
                  cursor: submitting ? 'not-allowed' : 'pointer' }}>Cancel</button>
              <button type="submit" disabled={submitting}
                style={{ padding: '8px 16px', borderRadius: 8, border: 'none',
                  background: submitting ? '#e2e8f0' : TEAL, color: submitting ? TEXT3 : WHITE,
                  fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                  cursor: submitting ? 'not-allowed' : 'pointer' }}>
                {submitting ? 'Saving…' : 'Change Password'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
