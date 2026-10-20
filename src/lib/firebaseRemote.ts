import { initializeApp, getApps, deleteApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, type Auth } from 'firebase/auth';
import { getFirestore, collection, doc, writeBatch, getDocs, query, where, orderBy, limit, startAfter, serverTimestamp, Timestamp, type Firestore, type QueryDocumentSnapshot } from 'firebase/firestore/lite';
import { PosError } from './money';
import { SyncAuthError, SyncNetworkError, type Col, type Remote, type RemoteDoc, type FirebaseConfig } from './sync';

/**
 * Firestore layout:  users/{signed-in user}/{products|sales|movements|settings}/{uid}
 * Every phone signs in to the same account. Each document carries `_ts`, the server's time of the write, which is what pulling asks for.
 * Uses Firestore "lite" (plain requests): the phone's own database is the offline copy, so Firebase's offline cache is not needed.
 */
const friendly = (e: any): Error => {
  const code: string = e?.code ?? '';
  if (/network|unavailable|deadline|offline/i.test(code) || /Failed to fetch|NetworkError|offline/i.test(String(e?.message))) return new SyncNetworkError('offline');
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found' || code === 'auth/invalid-login-credentials')
    return new SyncAuthError('Wrong email or password. If this is the first time, use "Create account".');
  if (code === 'auth/email-already-in-use') return new SyncAuthError('That email already has an account. Use "Sign in" instead.');
  if (code === 'auth/weak-password') return new SyncAuthError('Password must be at least 6 characters.');
  if (code === 'auth/invalid-email') return new SyncAuthError('That email address is not valid.');
  if (code === 'auth/operation-not-allowed') return new SyncAuthError('Email/Password sign-in is not switched on in your Firebase project (Authentication > Sign-in method).');
  if (code === 'auth/too-many-requests') return new SyncAuthError('Too many attempts. Wait a few minutes and try again.');
  if (code === 'permission-denied') return new SyncAuthError('Firebase refused access. Check the Firestore rules in the setup steps, and that you are signed in.');
  if (code === 'auth/api-key-not-valid.-please-pass-a-valid-api-key.' || code === 'auth/invalid-api-key') return new SyncAuthError('The Firebase apiKey in your config is not valid.');
  if (code === 'failed-precondition' || code === 'not-found') return new SyncAuthError('Firestore is not set up in this Firebase project yet (Build > Firestore Database > Create database).');
  return e instanceof Error ? e : new Error(String(e));
};
const wrap = async <T>(fn: () => Promise<T>): Promise<T> => { try { return await fn(); } catch (e) { throw friendly(e); } };

class FirebaseRemote implements Remote {
  constructor(private app: FirebaseApp, private auth: Auth, private fs: Firestore) {}
  async signIn(mode: 'signin' | 'signup', email: string, password: string) {
    await wrap(async () => { await (mode === 'signup' ? createUserWithEmailAndPassword : signInWithEmailAndPassword)(this.auth, email.trim(), password); });
  }
  async signOut() { await signOut(this.auth); }
  private async base(): Promise<string> {
    await this.auth.authStateReady();
    const u = this.auth.currentUser;
    if (!u) throw new SyncAuthError('Cloud sync is signed out. Open Settings > Cloud sync and sign in again.');
    return `users/${u.uid}`;
  }
  push(col: Col, docs: { id: string; data: any }[]) {
    return wrap(async () => {
      const base = await this.base();
      for (let i = 0; i < docs.length; i += 400) {
        const b = writeBatch(this.fs);
        for (const d of docs.slice(i, i + 400)) b.set(doc(this.fs, `${base}/${col}/${d.id}`), { ...d.data, _ts: serverTimestamp() });
        await b.commit();
      }
    });
  }
  pull(col: Col, since: number) {
    return wrap(async () => {
      const base = await this.base(), out: RemoteDoc[] = [];
      let last: QueryDocumentSnapshot | undefined;
      for (;;) {
        const q = query(collection(this.fs, `${base}/${col}`), where('_ts', '>', Timestamp.fromMillis(since)), orderBy('_ts'), ...(last ? [startAfter(last)] : []), limit(300));
        const snap = await getDocs(q);
        for (const d of snap.docs) { const { _ts, ...data } = d.data() as any; out.push({ id: d.id, data, ts: (_ts as Timestamp).toMillis() }); }
        if (snap.docs.length < 300) return out;
        last = snap.docs[snap.docs.length - 1];
      }
    });
  }
  hasData() {
    return wrap(async () => {
      const base = await this.base();
      for (const col of ['products', 'sales', 'movements']) if (!(await getDocs(query(collection(this.fs, `${base}/${col}`), limit(1)))).empty) return true;
      return false;
    });
  }
}

export async function createFirebaseRemote(cfg: FirebaseConfig) {
  if (!cfg.apiKey || !cfg.projectId) throw new PosError('The Firebase config is incomplete.');
  const name = 'provision-pos-' + cfg.projectId;
  let app = getApps().find((a) => a.name === name);
  if (app && app.options.apiKey !== cfg.apiKey) { await deleteApp(app); app = undefined; }     // config was replaced
  app = app ?? initializeApp(cfg, name);
  return new FirebaseRemote(app, getAuth(app), getFirestore(app));
}
