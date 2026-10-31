import { useState } from 'react';
import { ArrowRight, Layers3, ShieldCheck, LockKeyhole, UserRound, CircleAlert } from 'lucide-react';
import type { Employee } from '../types';
import { apiMode, signIn } from '../lib/data';

export default function EmployeeLogin({ onSignedIn, serverError = '' }: { onSignedIn: (employee: Employee) => void; serverError?: string }) {
  const [number, setNumber] = useState('');
  const [adminKey, setAdminKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const admin = apiMode && number === '0000';
  const submit = async () => {
    setBusy(true); setError('');
    try { onSignedIn(await signIn(number, adminKey)); setAdminKey(''); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <main className="login-page"><section className="login-story"><div className="login-brand"><Layers3 size={29}/><span>part<strong>central</strong></span></div><div><span className="eyebrow">YOUR SHIFT. YOUR WORKSPACE.</span><h1>Precision starts<br/>with a clear reference<span>.</span></h1><p>Part requirements, job inspection sheets, and visual guidance. {apiMode ? 'Connected on your local server.' : 'Explore a connected machining workflow, right in your browser.'}</p><div className="login-capabilities"><span><ShieldCheck size={16}/>Revision controlled</span><span><Layers3 size={16}/>Job traceability</span><span><LockKeyhole size={16}/>{apiMode ? 'Local deployment' : 'Browser storage'}</span></div></div><small>PART CENTRAL / MACHINING INSPECTION</small></section><section className="login-form-panel"><form onSubmit={e => { e.preventDefault(); void submit(); }}><div className="login-icon">{admin ? <ShieldCheck size={27}/> : <UserRound size={27}/>}</div><span className="eyebrow">{apiMode ? 'LOCAL WORKSPACE' : 'INTERACTIVE DEMO'}</span><h2>{admin ? 'Administrator sign-in.' : apiMode ? 'Welcome to your shift.' : 'See the workflow in action.'}</h2><p>{admin ? 'Employee 0000 manages parts, revisions, and visual references.' : apiMode ? 'Enter your four-digit employee number to open the inspection workspace.' : 'Use a sample employee number such as 1234 to explore. No account is needed; all parts and dimensions are synthetic.'}</p>{(error || serverError) && <div className="login-error" role="alert"><CircleAlert size={17}/>{error || serverError}</div>}<label>{apiMode ? 'EMPLOYEE NUMBER' : 'DEMO EMPLOYEE NUMBER'}<input autoFocus inputMode="numeric" autoComplete={apiMode ? 'username' : 'off'} pattern="[0-9]{4}" maxLength={4} placeholder="1234" aria-label="Employee number" value={number} disabled={busy} onChange={e => { setNumber(e.target.value.replace(/\D/g, '')); setError(''); }}/></label>{admin && <label>ADMINISTRATOR KEY<input type="password" autoComplete="current-password" aria-label="Administrator key" value={adminKey} disabled={busy} onChange={e => setAdminKey(e.target.value)}/><small>Use the administrator key configured for this local server.</small></label>}<button className="button primary login-submit" type="submit" disabled={busy || number.length !== 4 || (admin && !adminKey)}>{busy ? 'Opening your workspace…' : apiMode ? 'Sign in' : 'Explore demo'}<ArrowRight size={17}/></button><div className="login-hint">{apiMode ? <><span>Operator access</span><strong>Four-digit employee number</strong><span>Administrator account</span><strong>0000 + administrator key</strong></> : <><span>Try a demo identity</span><strong>1234</strong><span>Example library</span><strong>Synthetic parts and dimensions</strong></>}</div><p className="login-local-note"><span className="status-dot"/>{apiMode ? 'Inspection data stays on your local server.' : 'Your demo inspections stay in this browser.'}</p></form></section></main>;
}
