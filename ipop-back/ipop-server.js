require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path')

const app = express();
const port = process.env.PORT || 3001;

// ─────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────
const grammarSpec = fs.readFileSync(path.join(__dirname, 'i-tya-grammer.txt'), 'utf8');
const AI_MODEL = 'gemini-3.1-flash-lite';
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const epopModel = genAI.getGenerativeModel({ 
  model: AI_MODEL,
  systemInstruction: `あなたは人工言語「i-tya」の学習アプリ「ipop」の専属AIです。以下の文法仕様に厳密に従ってください。\n\n${grammarSpec}`
});

const BASE_TIME_MS = {
  1: 5000,
  2: 8000,
  3: 12000,
};

const LEVEL_ORDER = { 1: 1, 2: 2, 3: 3 };

// 初回レベル推定：1問あたりの制限時間(ms)
const PLACEMENT_TIME_LIMIT = 15000;

// ─────────────────────────────────────────────
//  Firebase 初期化
// ─────────────────────────────────────────────
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

// ─────────────────────────────────────────────
//  辞書キャッシュ（12時間TTL）
// ─────────────────────────────────────────────
const CACHE_TTL = 12 * 60 * 60 * 1000;
const dictCache = { words: [], complex: [], loadedAt: 0 };

async function ensureDictCache() {
  if (dictCache.loadedAt > 0 && (Date.now() - dictCache.loadedAt) < CACHE_TTL) return;

  console.log('[CACHE] Fetching dictionary from Firestore...');
  const [wordsSnap, complexSnap] = await Promise.all([
    db.collection('itya_words').get(),
    db.collection('itya_complex').get(),
  ]);
  dictCache.words   = wordsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  dictCache.complex = complexSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  dictCache.loadedAt = Date.now();
  console.log(`[CACHE] Loaded: ${dictCache.words.length} words, ${dictCache.complex.length} complex`);
}

function getWordById(wordId) {
  return dictCache.words.find(w => w.id === wordId)
    || dictCache.complex.find(c => c.id === wordId)
    || null;
}

function countSyllables(word) {
  if (!word) return 1;
  return (word.match(/[aiu]/g) || []).length || 1;
}

function getPrimaryForm(word) {
  return word.word_noun || word.word_verb || word.word_extender || word.combination || '';
}

async function generateQuestion(word) {
  const forms = [
    word.word_noun      ? `名詞形: ${word.word_noun}`       : '',
    word.word_verb      ? `動詞形: ${word.word_verb}`       : '',
    word.word_extender  ? `拡張詞形: ${word.word_extender}` : '',
    word.combination    ? `複合語: ${word.combination}`     : '',
  ].filter(Boolean).join('\n');

  const prompt = `以下の単語を使い、例文と穴埋め問題を作成してください。
    【単語情報】
    概念: ${word.concept_ja || word.meaning || ''}
    ${forms}
    語源・解説: ${word.reason_noun || word.reason || 'なし'}

    必ず以下のJSON形式のまま出力してください。
    {
      "example": "(i-tyaの例文)",
      "example_reading": "(例文のカタカナ読み)",
      "example_translation": "(例文の日本語意訳)",
      "blank": "(対象単語を＿＿に置き換えた文)",
      "answer": "(伏せた単語のみ)",
      "explanation": "(意味・語形のポイントを日本語で2〜3文)"
    }`;

      const result = await epopModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      });
      
      const text = result.response.text();
      const parsed = JSON.parse(text);
      return { 
        example: parsed.example,
        example_reading: parsed.example_reading,
        example_translation: parsed.example_translation,
        blank: parsed.blank, 
        answer: parsed.answer, 
        explanation: parsed.explanation
      };
    }

async function getOrGenerateQuestion(wordId) {
  const word = getWordById(wordId);
  if (!word) throw new Error('単語が見つかりません');

  const ref = db.collection('epop_questions').doc(wordId);
  const snap = await ref.get();

  if (snap.exists) {
    console.log(`[QUESTION] Cache hit: ${wordId}`);
    const d = snap.data();
    return { question: d.question, answer: d.answer };
  }

  console.log(`[QUESTION] Generating for: ${wordId}`);
  const generated = await generateQuestion(word);

  // DBに保存して次回から再利用
  await ref.set({
    question: generated.question,
    answer:   generated.answer,
    wordId,
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return generated;
}

// ─────────────────────────────────────────────
//  SM-2 アルゴリズム
// ─────────────────────────────────────────────
function sm2(card, quality) {
  let { easinessFactor = 2.5, interval = 1, repetitions = 0 } = card;

  if (quality >= 3) {
    if (repetitions === 0)      interval = 1;
    else if (repetitions === 1) interval = 6;
    else                        interval = Math.round(interval * easinessFactor);
    repetitions += 1;
  } else {
    repetitions = 0;
    interval = 1;
  }

  easinessFactor = Math.max(
    1.3,
    easinessFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)
  );

  const nextReview = new Date();
  nextReview.setDate(nextReview.getDate() + interval);

  return { easinessFactor, interval, repetitions, nextReview };
}

// ─────────────────────────────────────────────
//  自動スコアリング
// ─────────────────────────────────────────────
function calcQuality({ isCorrect, wrongCount, hintUsed, answerTimeMs, syllableCount }) {
  if (!isCorrect || wrongCount >= 2) return 0;
  if (wrongCount === 1) return 1;

  const baseTime = BASE_TIME_MS[Math.min(syllableCount, 3)];
  const isSlow   = answerTimeMs > baseTime * 2;
  const isFast   = answerTimeMs < baseTime * 0.6;

  if (hintUsed || isSlow) return 2;
  if (!isFast) return 4;
  return 5;
}

// ─────────────────────────────────────────────
//  Middleware
// ─────────────────────────────────────────────
app.use(express.json());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origin.startsWith('exp://') || origin.startsWith('http://localhost')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200,
}));

async function verifyAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '認証トークンがありません' });
  }
  try {
    const token = authHeader.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    req.userId = decoded.uid;
    next();
  } catch (e) {
    return res.status(401).json({ error: '無効なトークンです' });
  }
}

// ─────────────────────────────────────────────
//  初回レベル推定：出題単語リストを取得
//  GET /api/epop/placement
//  初回のみ20問（各レベルからバランスよく）を返す
// ─────────────────────────────────────────────
app.get('/api/epop/placement', verifyAuth, async (req, res) => {
  try {
    await ensureDictCache();
    const userId = req.userId;

    // 既にplacement完了済みか確認
    const profileRef = db.collection('epop_profiles').doc(userId);
    const profileSnap = await profileRef.get();
    if (profileSnap.exists && profileSnap.data().placementDone) {
      return res.json({ success: true, alreadyDone: true, level: profileSnap.data().level });
    }

    // 各レベルから均等に計20問選ぶ
    const level1 = dictCache.words.filter(w => w.level === 1).slice(0, 8);
    const level2 = dictCache.words.filter(w => w.level === 2).slice(0, 7);
    const level3 = dictCache.words.filter(w => w.level === 3).slice(0, 5);

    const placementWords = [...level1, ...level2, ...level3]
      .sort(() => Math.random() - 0.5); // シャッフル

    res.json({ success: true, alreadyDone: false, words: placementWords });
  } catch (error) {
    console.error('[/api/epop/placement]', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────
//  レベル推定結果を保存
//  POST /api/epop/placement/finish
//  Body: { results: [{ wordId, isCorrect, answerTimeMs }] }
// ─────────────────────────────────────────────
app.post('/api/epop/placement/finish', verifyAuth, async (req, res) => {
  const { results } = req.body;
  if (!results || !Array.isArray(results)) {
    return res.status(400).json({ error: 'resultsが必要です' });
  }

  try {
    await ensureDictCache();
    const userId = req.userId;

    // 正解率でレベルを推定
    let correctByLevel = { 1: { correct: 0, total: 0 }, 2: { correct: 0, total: 0 }, 3: { correct: 0, total: 0 } };
    for (const r of results) {
      const word = getWordById(r.wordId);
      if (!word || !word.level) continue;
      const lv = word.level;
      correctByLevel[lv].total++;
      if (r.isCorrect) correctByLevel[lv].correct++;
    }

    // レベル推定ロジック：
    // lv1正解率 < 60% → 推定lv1
    // lv2正解率 < 60% → 推定lv2
    // それ以上      → 推定lv3
    let estimatedLevel = 1;
    const rate1 = correctByLevel[1].total > 0 ? correctByLevel[1].correct / correctByLevel[1].total : 0;
    const rate2 = correctByLevel[2].total > 0 ? correctByLevel[2].correct / correctByLevel[2].total : 0;
    if (rate1 >= 0.6 && rate2 >= 0.6) estimatedLevel = 3;
    else if (rate1 >= 0.6) estimatedLevel = 2;
    else estimatedLevel = 1;

    // プロファイルに保存
    await db.collection('epop_profiles').doc(userId).set({
      placementDone: true,
      level: estimatedLevel,
      placementResults: results,
      placementAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    res.json({ success: true, level: estimatedLevel });
  } catch (error) {
    console.error('[/api/epop/placement/finish]', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────
//  今日の出題単語リストを取得
//  GET /api/epop/due
// ─────────────────────────────────────────────
app.get('/api/epop/due', verifyAuth, async (req, res) => {
  try {
    await ensureDictCache();
    const userId = req.userId;
    const now = admin.firestore.Timestamp.fromDate(new Date());

    // 追加学習かどうかを判断
    const isExtra = req.query.extra === 'true';

    const profileSnap = await db.collection('epop_profiles').doc(userId).get();
    const userLevel = profileSnap.exists ? (profileSnap.data().level || 1) : 1;

    // 【バグ修正】今日復習する単語だけじゃなく、「全学習済み単語」のIDを取得しろ！
    const allProgressSnap = await db.collection('epop_progress').doc(userId).collection('words').get();
    const learnedIds = new Set(allProgressSnap.docs.map(d => d.id));

    let reviewWords = [];

    // 通常モードの時だけ、今日の復習単語を取ってくる
    if (!isExtra) {
      const dueSnap = await db
        .collection('epop_progress')
        .doc(userId)
        .collection('words')
        .where('nextReview', '<=', now)
        .orderBy('nextReview')
        .limit(20)
        .get();

      reviewWords = dueSnap.docs
        .map(doc => {
          const word = getWordById(doc.id);
          return word ? { ...word, progress: doc.data(), isNew: false } : null;
        })
        .filter(Boolean);
    }

    // 新規単語の取得（追加学習なら10問、通常なら5問）
    const newLimit = isExtra ? 10 : 5;
    const newWords = dictCache.words
      .filter(w => w.id && !learnedIds.has(w.id) && (w.level || 1) <= userLevel)
      .sort((a, b) => (LEVEL_ORDER[a.level] || 99) - (LEVEL_ORDER[b.level] || 99))
      .slice(0, newLimit)
      .map(w => ({ ...w, progress: null, isNew: true }));

    res.json({
      success: true,
      review: reviewWords,
      new: newWords,
      total: reviewWords.length + newWords.length,
      userLevel,
    });
  } catch (error) {
    console.error('[/api/epop/due]', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────
//  穴埋め問題を取得（DBキャッシュ優先）
//  POST /api/epop/pop
//  Body: { wordId: string }
// ─────────────────────────────────────────────
app.post('/api/epop/pop', verifyAuth, async (req, res) => {
  const { wordId } = req.body;
  if (!wordId) return res.status(400).json({ error: 'wordIdが必要です' });

  try {
    await ensureDictCache();
    const word = getWordById(wordId);
    if (!word) return res.status(404).json({ error: '単語が見つかりません' });

    const { question, answer } = await getOrGenerateQuestion(wordId);
    const syllableCount = countSyllables(getPrimaryForm(word));

    res.json({ success: true, question, answer, wordId, syllableCount });
  } catch (error) {
    console.error('[/api/epop/pop]', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────
//  問題文を再生成（キャッシュを上書き）
//  POST /api/epop/pop/regenerate
//  Body: { wordId: string }
// ─────────────────────────────────────────────
app.post('/api/epop/pop/regenerate', verifyAuth, async (req, res) => {
  const { wordId } = req.body;
  if (!wordId) return res.status(400).json({ error: 'wordIdが必要です' });

  try {
    await ensureDictCache();
    const word = getWordById(wordId);
    if (!word) return res.status(404).json({ error: '単語が見つかりません' });

    console.log(`[QUESTION] Force regenerating: ${wordId}`);
    const generated = await generateQuestion(word);

    await db.collection('epop_questions').doc(wordId).set({
      question: generated.question,
      answer:   generated.answer,
      wordId,
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const syllableCount = countSyllables(getPrimaryForm(word));
    res.json({ success: true, question: generated.question, answer: generated.answer, wordId, syllableCount });
  } catch (error) {
    console.error('[/api/epop/pop/regenerate]', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────
//  回答結果を受け取りSRS更新
//  POST /api/epop/review
// ─────────────────────────────────────────────
app.post('/api/epop/review', verifyAuth, async (req, res) => {
  const { wordId, isCorrect, wrongCount = 0, hintUsed = false, answerTimeMs, syllableCount = 2 } = req.body;

  if (!wordId || isCorrect === undefined || answerTimeMs === undefined) {
    return res.status(400).json({ error: 'wordId, isCorrect, answerTimeMsが必要です' });
  }

  try {
    const quality = calcQuality({ isCorrect, wrongCount, hintUsed, answerTimeMs, syllableCount });

    const progressRef = db
      .collection('epop_progress')
      .doc(req.userId)
      .collection('words')
      .doc(wordId);

    const snap = await progressRef.get();
    const updated = sm2(snap.exists ? snap.data() : {}, quality);

    await progressRef.set({
      easinessFactor: updated.easinessFactor,
      interval:       updated.interval,
      repetitions:    updated.repetitions,
      nextReview:     admin.firestore.Timestamp.fromDate(updated.nextReview),
      lastReviewed:   admin.firestore.FieldValue.serverTimestamp(),
      lastQuality:    quality,
    }, { merge: true });

    res.json({ success: true, quality, nextReview: updated.nextReview, interval: updated.interval });
  } catch (error) {
    console.error('[/api/epop/review]', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────
//  ユーザーの学習統計
//  GET /api/epop/stats
// ─────────────────────────────────────────────
app.get('/api/epop/stats', verifyAuth, async (req, res) => {
  try {
    await ensureDictCache();
    const userId = req.userId;

    const [progressSnap, profileSnap] = await Promise.all([
      db.collection('epop_progress').doc(userId).collection('words').get(),
      db.collection('epop_profiles').doc(userId).get(),
    ]);

    const totalWords = dictCache.words.length + dictCache.complex.length;
    const learnedCount = progressSnap.size;
    const now = new Date();

    let dueCount = 0;
    let matureCount = 0;

    for (const doc of progressSnap.docs) {
      const d = doc.data();
      if (d.nextReview && d.nextReview.toDate() <= now) dueCount++;
      if (d.interval >= 21) matureCount++;
    }

    res.json({
      success: true,
      stats: {
        totalWords,
        learnedCount,
        matureCount,
        dueCount,
        newCount: totalWords - learnedCount,
        userLevel: profileSnap.exists ? (profileSnap.data().level || 1) : null,
        placementDone: profileSnap.exists ? !!profileSnap.data().placementDone : false,
      },
    });
  } catch (error) {
    console.error('[/api/epop/stats]', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────
//  Start server
// ─────────────────────────────────────────────
app.listen(port, () => {
  console.log(`ipop server running on port ${port}`);
});

app.get('/api/health', async (req, res) => {
  await ensureDictCache();
  res.json({ ok: true, words: dictCache.words.length, complex: dictCache.complex.length });
});