import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CONFIRM_DELETE_PARAM, deleteAccount, getSession, returnPath, signOut, startGitHubSignIn,
  type SessionUser,
} from '../utils/account';

type State = { status: 'loading' } | { status: 'signed-out' } | { status: 'signed-in'; user: SessionUser };

const DELETE_WARNING =
  'Delete your CSS Daily account?\n\nThis removes your account (GitHub name, avatar and email) and signs you out everywhere. Results saved on this device stay on this device.';

export default function AccountMenu() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const confirmAndDelete = useCallback(async () => {
    if (!window.confirm(DELETE_WARNING)) return;
    setBusy(true);
    const outcome = await deleteAccount();
    if (outcome === 'deleted') {
      window.location.replace(returnPath(window.location));
      return;
    }
    setBusy(false);
    if (outcome === 'reauth') {
      // Never deletes on return: the flag only re-opens this confirmation
      if (window.confirm('For your security, please confirm with GitHub first. You\'ll come back here to finish.')) {
        window.location.assign(await startGitHubSignIn(returnPath(window.location, true)));
      }
      return;
    }
    window.alert('Your account could not be deleted. Please try again.');
  }, []);

  useEffect(() => {
    let cancelled = false;
    getSession().then((user) => {
      if (cancelled) return;
      setState(user ? { status: 'signed-in', user } : { status: 'signed-out' });
      // Back from re-authenticating to delete: ask again, never auto-delete
      const params = new URLSearchParams(window.location.search);
      if (params.has(CONFIRM_DELETE_PARAM)) {
        window.history.replaceState(null, '', returnPath(window.location));
        if (user) confirmAndDelete();
      }
    });
    return () => { cancelled = true; };
  }, [confirmAndDelete]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  // Same footprint in every state, so the header never shifts
  const slot = 'flex items-center justify-end min-w-[9.5rem] h-8';

  if (state.status === 'loading') return <div className={slot} aria-hidden="true" />;

  if (state.status === 'signed-out') {
    return (
      <div className={slot}>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              window.location.assign(await startGitHubSignIn(returnPath(window.location)));
            } catch {
              setBusy(false);
            }
          }}
          className="text-sm px-3 py-1.5 rounded-md bg-gray-800 text-gray-200 hover:bg-gray-700 hover:text-white transition disabled:opacity-60"
        >
          Sign in with GitHub
        </button>
      </div>
    );
  }

  const { user } = state;
  return (
    <div className={`${slot} relative`}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${user.name}`}
        onClick={() => setOpen((o) => !o)}
        className="rounded-full ring-1 ring-gray-700 hover:ring-gray-500 transition"
      >
        {user.image ? (
          <img src={user.image} alt="" className="w-8 h-8 rounded-full" referrerPolicy="no-referrer" />
        ) : (
          <span className="w-8 h-8 rounded-full bg-gray-700 text-gray-200 flex items-center justify-center text-sm">
            {user.name.slice(0, 1).toUpperCase()}
          </span>
        )}
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          className="absolute right-0 top-10 z-50 w-56 rounded-lg border border-gray-700 bg-gray-900 shadow-xl py-1 text-sm"
        >
          <div className="px-3 py-2 text-gray-400 border-b border-gray-800 truncate">{user.name}</div>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await signOut();
              window.location.replace(returnPath(window.location));
            }}
            className="w-full text-left px-3 py-2 text-gray-200 hover:bg-gray-800"
          >
            Sign out
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => { setOpen(false); confirmAndDelete(); }}
            className="w-full text-left px-3 py-2 text-red-400 hover:bg-gray-800"
          >
            Delete account
          </button>
        </div>
      )}
    </div>
  );
}
