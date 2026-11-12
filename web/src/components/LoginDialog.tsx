import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { browserSupportsWebAuthn, startRegistration, startAuthentication } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import type { MeDTO } from '@pf/shared';
import { api, ApiError } from '../api/client';
import { friendlyError } from '../api/errors';
import './profile.css';

export function LoginButton({ onOpen }: { onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!open && restoreFocus.current) {
      restoreFocus.current = false;
      trigger.current?.focus();
    }
  }, [open]);
  return <>
    <button ref={trigger} type="button" className="btn btn--primary" aria-haspopup="dialog" onClick={() => { onOpen?.(); setOpen(true); }}>Log in</button>
    {open && <LoginDialog onClose={() => { restoreFocus.current = true; setOpen(false); }} />}
  </>;
}

function LoginDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [step, setStep] = useState<'choose' | 'create' | 'email' | 'forgot'>('choose');
  const [discordUsername, setDiscordUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const supported = browserSupportsWebAuthn() && window.isSecureContext;
  // Email + password accounts are a server setting (PASSWORD_AUTH_ENABLED). Until the answer arrives,
  // or if it can't be loaded, they stay hidden.
  const authConfig = useQuery({ queryKey: ['auth-config'], queryFn: () => api<{ passwordAuth: boolean }>('/api/auth/config'), staleTime: 300_000 });
  const passwordAuth = authConfig.data?.passwordAuth === true;
  const [picked, setMethod] = useState<'passkey' | 'password'>(() => supported ? 'passkey' : 'password');
  const method = passwordAuth ? picked : 'passkey';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);
  useEffect(() => { ref.current?.querySelector<HTMLElement>('input, a, button')?.focus(); }, [step]);

  function complete(user: MeDTO) {
    onClose();
    qc.removeQueries({ type: 'inactive' });
    qc.setQueryData(['me'], user);
    navigate('/me/characters');
    void qc.resetQueries({ predicate: (query) => query.queryKey[0] !== 'me' });
  }

  function showError(cause: unknown) {
    setError(cause instanceof ApiError ? friendlyError(cause)
      : (cause as { name?: unknown } | null)?.name === 'NotAllowedError' ? 'The passkey prompt was cancelled or timed out. Please try again.'
      : 'Could not complete sign-in. Please try again or log in with Discord.');
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    if (busy || (method === 'passkey' && !supported)) return;
    if (method === 'password' && password !== confirmation) { setError('Passwords do not match.'); return; }
    setBusy(true);
    setError('');
    try {
      if (method === 'password') {
        complete(await api<MeDTO>('/api/auth/password/register', { method: 'POST', json: { discordUsername: discordUsername.trim(), displayName: displayName.trim(), email: email.trim(), password } }));
        return;
      }
      const optionsJSON = await api<PublicKeyCredentialCreationOptionsJSON>('/api/auth/passkeys/register/options', { method: 'POST', json: { discordUsername: discordUsername.trim(), displayName: displayName.trim() } });
      const response = await startRegistration({ optionsJSON });
      complete(await api<MeDTO>('/api/auth/passkeys/register/verify', { method: 'POST', json: response }));
    } catch (cause) { showError(cause); }
    finally { setBusy(false); }
  }

  async function signIn() {
    if (busy || !supported) return;
    setBusy(true);
    setError('');
    try {
      const optionsJSON = await api<PublicKeyCredentialRequestOptionsJSON>('/api/auth/passkeys/login/options', { method: 'POST' });
      const response = await startAuthentication({ optionsJSON });
      complete(await api<MeDTO>('/api/auth/passkeys/login/verify', { method: 'POST', json: response }));
    } catch (cause) { showError(cause); }
    finally { setBusy(false); }
  }

  async function emailSignIn(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try { complete(await api<MeDTO>('/api/auth/password/login', { method: 'POST', json: { email: email.trim(), password } })); }
    catch (cause) { showError(cause); }
    finally { setBusy(false); }
  }

  async function requestReset(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api('/api/auth/password/forgot', { method: 'POST', json: { email: email.trim() } });
      setResetSent(true);
    } catch (cause) { showError(cause); }
    finally { setBusy(false); }
  }

  function back() { setError(''); setPassword(''); setConfirmation(''); setStep('choose'); }

  const passwordFields = <>
    <label className="profile-dialog__field">Email
      <input type="email" required autoComplete="username" maxLength={254} value={email} disabled={busy} onChange={(e) => setEmail(e.target.value)} />
    </label>
    <label className="profile-dialog__field">Password
      <input type="password" required autoComplete={step === 'create' ? 'new-password' : 'current-password'} minLength={step === 'create' ? 15 : 1} maxLength={128} value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} />
    </label>
    {step === 'create' && <>
      <label className="profile-dialog__field">Confirm password
        <input type="password" required autoComplete="new-password" minLength={15} maxLength={128} value={confirmation} disabled={busy} onChange={(e) => setConfirmation(e.target.value)} />
      </label>
      <p className="profile-dialog__muted">Use 15–128 characters. Use an email you can access for password recovery.</p>
    </>}
  </>;

  return <dialog ref={ref} className="profile-dialog" aria-modal="true" aria-labelledby={headingId}
    onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}
    onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <div className="profile-dialog__content">
      <h2 id={headingId}>{step === 'create' ? 'Create account' : step === 'email' ? 'Log in with email' : step === 'forgot' ? 'Reset password' : 'Log in'}</h2>
      {step === 'choose' ? <>
        <a className="btn btn--primary" href="/api/auth/discord" aria-disabled={busy || undefined} onClick={(e) => { if (busy) e.preventDefault(); }}>Log in with Discord</a>
        <p className="profile-dialog__muted">Discord shares your user ID, username and avatar. We do not request your email or messages.</p>
        <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => { setError(''); setStep('create'); }}>Create account</button>
        <p className="profile-dialog__muted">Already created an account?</p>
        {passwordAuth && <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => { setError(''); setStep('email'); }}>Log in with email</button>}
        <button type="button" className="btn btn--secondary" disabled={busy || !supported} onClick={() => void signIn()}>{busy ? 'Signing in…' : 'Sign in with a passkey'}</button>
      </> : step === 'forgot' ? <form className="login-form" onSubmit={(e) => void requestReset(e)}>
        {resetSent ? <p role="status">If an account uses that email, a reset link will arrive shortly. Check your spam folder too.</p> : <>
          <p className="profile-dialog__muted">Enter your account email and we’ll send a link to set a new password.</p>
          <label className="profile-dialog__field">Email
            <input type="email" required autoComplete="email" maxLength={254} value={email} disabled={busy} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
        </>}
        <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => { setError(''); setStep('email'); }}>Back to email login</button>
      </form> : step === 'email' ? <form className="login-form" onSubmit={(e) => void emailSignIn(e)}>
        {passwordFields}
        <div className="actions">
          <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Signing in…' : 'Log in'}</button>
          <button type="button" className="btn btn--secondary" disabled={busy} onClick={back}>Back</button>
        </div>
        <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => { setError(''); setPassword(''); setResetSent(false); setStep('forgot'); }}>Forgot password?</button>
      </form> : <form className="login-form" onSubmit={(e) => void create(e)}>
        <label className="profile-dialog__field">Discord username
          <input required autoComplete="off" maxLength={50} value={discordUsername} disabled={busy} onChange={(e) => setDiscordUsername(e.target.value)} />
        </label>
        <label className="profile-dialog__field">Display name
          <input required autoComplete="nickname" maxLength={50} value={displayName} disabled={busy} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <p className="profile-dialog__muted">Your Discord username (2 to 32 letters, numbers, dots or underscores) is contact information only; this does not connect to Discord.</p>
        {passwordAuth && <fieldset className="login-method" disabled={busy}>
          <legend>Sign-in method</legend>
          <label><input type="radio" name="sign-in-method" checked={method === 'passkey'} disabled={!supported} onChange={() => { setMethod('passkey'); setPassword(''); setConfirmation(''); setError(''); }} /> Passkey</label>
          <label><input type="radio" name="sign-in-method" checked={method === 'password'} onChange={() => { setMethod('password'); setError(''); }} /> Email and password</label>
        </fieldset>}
        {method === 'password' ? passwordFields : <p className="profile-dialog__muted">Next, save a passkey using your browser or password manager. Keep it to sign in again; there is no email or password recovery.</p>}
        <div className="actions">
          <button type="submit" className="btn btn--primary" disabled={busy || (method === 'passkey' && !supported)}>{busy ? 'Creating account…' : 'Create account'}</button>
          <button type="button" className="btn btn--secondary" disabled={busy} onClick={back}>Back</button>
        </div>
      </form>}
      {!supported && <p className="profile-dialog__muted">Passkeys require a supported browser and HTTPS (or localhost). {passwordAuth ? 'You can use email and password or Discord instead.' : 'You can log in with Discord instead.'}</p>}
      {error && <p role="alert">{error}</p>}
      <button type="button" className="btn btn--secondary" disabled={busy} onClick={onClose}>Cancel</button>
    </div>
  </dialog>;
}
