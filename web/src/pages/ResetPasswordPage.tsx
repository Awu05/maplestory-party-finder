import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { friendlyError } from '../api/errors';
import { LoginButton } from '../components/LoginDialog';
import '../components/profile.css';

export function ResetPasswordPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [token] = useState(() => new URLSearchParams(location.hash.slice(1)).get('token') ?? '');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const qc = useQueryClient();
  const validToken = /^[A-Za-z0-9_-]{43}$/.test(token);

  async function reset(e: FormEvent) {
    e.preventDefault();
    if (busy || !validToken) return;
    if (password !== confirmation) { setError('Passwords do not match.'); return; }
    setBusy(true);
    setError('');
    try {
      await api('/api/auth/password/reset', { method: 'POST', json: { token, password } });
      setPassword(''); setConfirmation(''); setDone(true);
      navigate(location.pathname, { replace: true });
      qc.removeQueries({ type: 'inactive' });
      qc.setQueryData(['me'], null);
      await qc.resetQueries({ predicate: (query) => query.queryKey[0] !== 'me' });
    } catch (cause) { setError(cause instanceof ApiError ? friendlyError(cause) : 'Could not reset your password. Please try again.'); }
    finally { setBusy(false); }
  }

  return <section className="reset-password" aria-labelledby="reset-password-title">
    <h1 id="reset-password-title">Reset password</h1>
    {done ? <>
      <p role="status">Your password has been reset. You’ve been signed out on all devices. Log in with your new password.</p>
      <LoginButton />
    </> : !validToken ? <>
      <p role="alert">This reset link is invalid. Open Log in, choose email login, and request a new reset link.</p>
      <LoginButton />
    </> : <form className="login-form" onSubmit={(e) => void reset(e)}>
      <p>Choose a new password of 15–128 characters. This will sign your account out on all devices.</p>
      <label className="profile-dialog__field">New password
        <input type="password" required autoComplete="new-password" minLength={15} maxLength={128} value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <label className="profile-dialog__field">Confirm password
        <input type="password" required autoComplete="new-password" minLength={15} maxLength={128} value={confirmation} disabled={busy} onChange={(e) => setConfirmation(e.target.value)} />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : 'Save new password'}</button>
      <Link to="/">Back to board</Link>
      {error && <LoginButton />}
    </form>}
  </section>;
}
