import { useState } from 'react';

// Notice-only cookie/analytics disclosure. This is a private dashboard shared
// with a small set of partner companies (not a public site), so it informs
// rather than gates: analytics run regardless, and dismissal is remembered
// per-browser so the notice appears only once.
const ACK_KEY = 'gdec_cookie_notice_ack';

const TEAL = '#1a7a8a';
const WHITE = '#ffffff';
const BORDER = '#e2e8f0';
const TEXT2 = '#4a5568';

export default function ConsentBanner() {
  const [acknowledged, setAcknowledged] = useState<boolean>(() => {
    try {
      return localStorage.getItem(ACK_KEY) === '1';
    } catch {
      return false;
    }
  });

  if (acknowledged) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(ACK_KEY, '1');
    } catch {
      // localStorage may be unavailable (private mode); dismiss for this session anyway.
    }
    setAcknowledged(true);
  };

  return (
    <div
      role="region"
      aria-label="Cookie notice"
      style={{
        position: 'fixed',
        left: 16,
        right: 16,
        bottom: 16,
        zIndex: 9999,
        maxWidth: 640,
        margin: '0 auto',
        background: WHITE,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        boxShadow: '0 6px 24px rgba(26,35,50,0.12)',
        padding: '14px 16px',
        display: 'flex',
        gap: 14,
        alignItems: 'center',
        fontFamily: "'Plus Jakarta Sans', sans-serif",
      }}
    >
      <div style={{ fontSize: 12.5, color: TEXT2, lineHeight: 1.5, flex: 1 }}>
        This dashboard uses cookies and product analytics to understand how it's
        used and to improve it. By continuing, you consent to this usage tracking.
      </div>
      <button
        onClick={dismiss}
        style={{
          flexShrink: 0,
          padding: '8px 16px',
          borderRadius: 8,
          border: 'none',
          background: TEAL,
          color: '#fff',
          fontFamily: 'inherit',
          fontSize: 12.5,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Got it
      </button>
    </div>
  );
}
