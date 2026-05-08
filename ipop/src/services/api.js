import { auth } from './firebase';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

async function getToken() {
  const user = auth.currentUser;
  if (!user) throw new Error('ログインしていません');
  return user.getIdToken();
}

export async function fetchDueWords(extra = false) {
  const token = await getToken();
  const url = extra ? `${BASE_URL}/api/epop/due?extra=true` : `${BASE_URL}/api/epop/due`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!data.success && data.error) throw new Error(data.error);
  return data;
}

export async function fetchQuestion(wordId) {
  const token = await getToken();
  const res = await fetch(`${BASE_URL}/api/epop/pop`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ wordId }),
  });
  return res.json();
}

export async function submitReview(data) {
  const token = await getToken();
  const res = await fetch(`${BASE_URL}/api/epop/review`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function fetchStats() {
  const token = await getToken();
  const res = await fetch(`${BASE_URL}/api/epop/stats`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

export async function fetchPlacement() {
  const token = await getToken();
  const res = await fetch(`${BASE_URL}/api/epop/placement`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

export async function finishPlacement(results) {
  const token = await getToken();
  const res = await fetch(`${BASE_URL}/api/epop/placement/finish`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ results }),
  });
  return res.json();
}