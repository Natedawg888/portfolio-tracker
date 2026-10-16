import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { ApiError, api } from '../../api/client';
import { showQuietToast } from '../../lib/quietToast';

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const PHOTO_TYPES = 'image/jpeg,image/png,image/webp,image/gif';

const toast = (message: string) => showQuietToast(message, { kind: 'info', ttlMs: 4000 });

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function initialsFor(user: { firstName: string | null; lastName: string | null; displayName: string | null; email: string } | null): string {
  const f = (user?.firstName || '').trim();
  const l = (user?.lastName || '').trim();
  if (f && l) return (f[0] + l[0]).toUpperCase();
  const name = (user?.displayName || '').trim() || [f, l].filter(Boolean).join(' ');
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  return (user?.email || '?').slice(0, 2).toUpperCase();
}

/** Settings → Account → Profile: photo (preview before saving) and first/last name. */
export function AccountProfileCard() {
  const { user, setUser } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  // Photo: a picked file is only previewed until "Save photo".
  const [pending, setPending] = useState<{ file: File; url: string } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // Names are saved exactly as typed (only surrounding spaces are trimmed).
  const savedFirst = user?.firstName ?? '';
  const savedLast = user?.lastName ?? '';
  const [firstName, setFirstName] = useState(savedFirst);
  const [lastName, setLastName] = useState(savedLast);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // Pick up a saved name that changed elsewhere (e.g. after Save).
  const [synced, setSynced] = useState({ first: savedFirst, last: savedLast });
  if (synced.first !== savedFirst || synced.last !== savedLast) {
    setSynced({ first: savedFirst, last: savedLast });
    setFirstName(savedFirst);
    setLastName(savedLast);
  }

  useEffect(() => () => {
    if (pending) URL.revokeObjectURL(pending.url);
  }, [pending]);

  const nameChanged = firstName.trim() !== savedFirst.trim() || lastName.trim() !== savedLast.trim();
  const initials = initialsFor(user);

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPhotoError(null);
    if (!PHOTO_TYPES.split(',').includes(file.type)) {
      setPhotoError('Choose a JPEG, PNG, WebP or GIF image.');
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoError('That image is over 8 MB. Choose a smaller one.');
      return;
    }
    setPending({ file, url: URL.createObjectURL(file) });
  };

  const onSavePhoto = async () => {
    if (!pending) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const res = await api.auth.uploadAvatar(await readFileAsDataUrl(pending.file));
      setUser(res.user);
      setPending(null);
      toast('Photo saved');
    } catch (err) {
      setPhotoError(err instanceof ApiError ? err.message : 'Could not save the photo. Try again.');
    } finally {
      setPhotoBusy(false);
    }
  };

  const onRemovePhoto = async () => {
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const res = await api.auth.removeAvatar();
      setUser(res.user);
      toast('Photo removed');
    } catch (err) {
      setPhotoError(err instanceof ApiError ? err.message : 'Could not remove the photo. Try again.');
    } finally {
      setPhotoBusy(false);
    }
  };

  const onSaveName = async (e: FormEvent) => {
    e.preventDefault();
    if (!nameChanged) return;
    setNameBusy(true);
    setNameError(null);
    try {
      const res = await api.auth.updateProfile({
        firstName: firstName.trim() || null,
        lastName: lastName.trim() || null,
      });
      setUser(res.user);
      toast('Name saved');
    } catch (err) {
      setNameError(err instanceof ApiError ? err.message : 'Could not save your name. Try again.');
    } finally {
      setNameBusy(false);
    }
  };

  const onCancelName = () => {
    setFirstName(savedFirst);
    setLastName(savedLast);
    setNameError(null);
  };

  const shownPhoto = pending?.url ?? user?.avatarUrl ?? null;
  const photoLabel = pending
    ? 'Preview of your new photo, not saved yet'
    : user?.avatarUrl
      ? 'Your profile photo'
      : `No photo. Showing your initials, ${initials}`;

  return (
    <section className="panel account-card" aria-labelledby="account-profile-title">
      <div className="account-card-head">
        <div>
          <h2 id="account-profile-title">Profile</h2>
          <p className="muted small">Your photo and name appear in the profile menu and the account switcher.</p>
        </div>
      </div>

      <div className="account-photo">
        <div className={pending ? 'account-avatar-preview is-pending' : 'account-avatar-preview'} role="img" aria-label={photoLabel}>
          {shownPhoto ? (
            <img src={shownPhoto} alt="" className="account-avatar-img" />
          ) : (
            <span className="account-avatar-fallback" aria-hidden>
              {initials}
            </span>
          )}
        </div>
        <div className="account-photo-body">
          <input
            ref={fileRef}
            type="file"
            accept={PHOTO_TYPES}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={onPick}
          />
          {pending ? (
            <>
              <p className="account-photo-note">Preview. Save to use this photo.</p>
              <div className="account-actions">
                <button type="button" className="btn primary small" disabled={photoBusy} onClick={() => void onSavePhoto()}>
                  {photoBusy ? 'Saving…' : 'Save photo'}
                </button>
                <button type="button" className="btn ghost small" disabled={photoBusy} onClick={() => setPending(null)}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <div className="account-actions">
              <button type="button" className="btn small" disabled={photoBusy} onClick={() => fileRef.current?.click()}>
                Upload photo
              </button>
              {user?.avatarUrl ? (
                <button type="button" className="btn ghost small" disabled={photoBusy} onClick={() => void onRemovePhoto()}>
                  {photoBusy ? 'Removing…' : 'Remove'}
                </button>
              ) : null}
            </div>
          )}
          <p className="muted small">JPEG, PNG, WebP or GIF, up to 8 MB.</p>
          {photoError ? (
            <p className="auth-error" role="alert">
              {photoError}
            </p>
          ) : null}
        </div>
      </div>

      <form className="account-name-form" onSubmit={onSaveName}>
        <div className="account-name-fields">
          <label className="field">
            <span>First name</span>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              maxLength={40}
              disabled={nameBusy}
              autoComplete="given-name"
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>Last name</span>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              maxLength={40}
              disabled={nameBusy}
              autoComplete="family-name"
              spellCheck={false}
            />
          </label>
        </div>
        <p className="muted small">Also the name on your invoices until you save your Business details.</p>
        {nameError ? (
          <p className="auth-error" role="alert">
            {nameError}
          </p>
        ) : null}
        {nameChanged ? (
          <div className="account-actions">
            <button type="submit" className="btn primary small" disabled={nameBusy}>
              {nameBusy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="btn ghost small" disabled={nameBusy} onClick={onCancelName}>
              Cancel
            </button>
          </div>
        ) : null}
      </form>
    </section>
  );
}
