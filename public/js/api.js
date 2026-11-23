'use strict';
// Session + the one fetch helper every page uses.

const TOKEN_KEY = 'ph_token';

export const state = { token: localStorage.getItem(TOKEN_KEY) || '', user: null, player: null };

const listeners = new Set();
export const onSession = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => { for (const fn of listeners) fn(state); };

export function setSession(token, user) {
  state.token = token || '';
  state.user = user || null;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
  emit();
}

export async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  let res;
  try {
    res = await fetch('/api' + path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new Error('Cannot reach PoolHub. Check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && state.token && !path.startsWith('/auth/')) setSession('', null);
    throw new Error(data.error || 'Something went wrong. Try again.');
  }
  return data;
}

export async function loadSession() {
  if (!state.token) return;
  try {
    const me = await api('/me');
    state.user = me.user;
    state.player = me.player;
    emit();
  } catch {
    setSession('', null);
  }
}
