import { auth } from './firebase';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:3001';
console.log(`[API] Using BASE_URL: ${BASE_URL}`);

// トークン取得（初期化待機を含む）
function getToken() {
  return new Promise((resolve, reject) => {
    if (auth.currentUser) {
      auth.currentUser.getIdToken().then(resolve).catch(reject);
      return;
    }
    const unsubscribe = auth.onAuthStateChanged((user) => {
      unsubscribe();
      if (user) {
        user.getIdToken().then(resolve).catch(reject);
      } else {
        reject(new Error('未認証'));
      }
    });
  });
}

export async function fetchDueWords(extra = false) {
  const token = await getToken();
  const url = extra ? `${BASE_URL}/api/epop/due?extra=true` : `${BASE_URL}/api/epop/due`;
  console.log(`[API] Fetching due words from: ${url}`);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log(`[API] Due words response status: ${res.status}`);
    const data = await res.json();
    if (!data.success && data.error) throw new Error(data.error);
    return data;
  } catch (e) {
    console.error(`[API] fetchDueWords failed for ${url}:`, e);
    throw e;
  }
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
  const url = `${BASE_URL}/api/epop/stats`;
  console.log(`[API] Fetching stats from: ${url}`);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log(`[API] Stats response status: ${res.status}`);
    return res.json();
  } catch (e) {
    console.error(`[API] fetchStats failed for ${url}:`, e);
    throw e;
  }
}

export async function fetchPlacement() {
  const token = await getToken();
  const res = await fetch(`${BASE_URL}/api/epop/placement`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

export async function migrateQuestions() {
  const token = await getToken();
  const res = await fetch(`${BASE_URL}/api/epop/migrate-questions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  return res.json();
}

export async function submitPlacement(results) {
  const token = await getToken();
  const res = await fetch(`${BASE_URL}/api/epop/placement/finish`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ results }),
  });
  return res.json();
}