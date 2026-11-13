import { useState, type FormEvent } from 'react';
import { errorText, send } from './api';
import { ErrorNotice, Field, Icon } from './components';

export default function PasswordChange() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setSuccess(false);
    if (newPassword !== confirmation) { setError('A confirmação não corresponde à nova palavra-passe.'); return; }
    setBusy(true);
    try { await send('/password', 'POST', { currentPassword, newPassword }); setCurrentPassword(''); setNewPassword(''); setConfirmation(''); setSuccess(true); }
    catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  return <div className="password-section"><details className="advanced"><summary>Alterar a palavra-passe local</summary><form onSubmit={submit}>{error && <ErrorNotice message={error}/>} {success && <div className="notice" role="status"><Icon name="check"/><span>Palavra-passe alterada. As outras sessões foram terminadas.</span></div>}<Field label="Palavra-passe atual"><input type="password" required maxLength={200} value={currentPassword} autoComplete="current-password" onChange={event => setCurrentPassword(event.target.value)}/></Field><div className="field-grid"><Field label="Nova palavra-passe" hint="Pelo menos 12 caracteres."><input type="password" required minLength={12} maxLength={200} value={newPassword} autoComplete="new-password" onChange={event => setNewPassword(event.target.value)}/></Field><Field label="Confirmar nova palavra-passe"><input type="password" required minLength={12} maxLength={200} value={confirmation} autoComplete="new-password" onChange={event => setConfirmation(event.target.value)}/></Field></div><button className="button primary" disabled={busy}>{busy ? 'A guardar…' : 'Guardar nova palavra-passe'}</button><p className="field-hint">A alteração termina as sessões abertas noutros navegadores.</p></form></details></div>;
}
