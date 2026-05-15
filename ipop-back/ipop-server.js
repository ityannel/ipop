require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path')

const app = express();
const port = process.env.PORT || 3001;

// 定数の定義
const grammarSpec = fs.readFileSync(path.join(__dirname, 'i-tya-grammar.txt'), 'utf8');
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

// Firebaseの初期化
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

// 辞書キャッシュ（有効期限：12時間）
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
      "translation_blank": "(example_translationの中で、answerに対応する日本語の単語または句をそのまま抜き出したもの)",
      "blank": "(対象単語を＿＿に置き換えた文)",
      "answer": "(伏せた単語のみ)",
      "explanation": "(意味・語形のポイントを日本語で2〜3文)"
    }
    
    translation_blankはexample_translationの文字列に必ず含まれる部分文字列にしてください。`;

      const result = await epopModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      });
      
      const text = result.response.text();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('AIの応答からJSONが見つかりませんでした: ' + text);
      }
      let parsed;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (e) {
        throw new Error('AIの応答からJSONのパースに失敗しました: ' + jsonMatch[0]);
      }

      return { 
        example:             parsed.example,
        example_reading:     parsed.example_reading,
        example_translation: parsed.example_translation,
        translation_blank:   parsed.translation_blank ?? null,
        blank:               parsed.blank, 
        answer:              parsed.answer, 
        explanation:         parsed.explanation,
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
    // 旧データ形式への互換性維持
    if (d.example) {
      return {
        question: {
          example:             d.example,
          example_reading:     d.example_reading,
          example_translation: d.example_translation,
          translation_blank:   d.translation_blank ?? null,
          blank:               d.blank,
        },
        answer: d.answer,
      };
    }
    // 旧形式の入れ子構造への互換性維持
    if (d.question) {
      return {
        question: {
          ...d.question,
          translation_blank: d.question.translation_blank ?? null,
        },
        answer: d.answer,
      };
    }
  }

  console.log(`[QUESTION] Generating for: ${wordId}`);
  const generated = await generateQuestion(word);

  // 平坦形式による保存
  await ref.set({
    example:             generated.example,
    example_reading:     generated.example_reading,
    example_translation: generated.example_translation,
    translation_blank:   generated.translation_blank ?? null,
    blank:               generated.blank,
    answer:              generated.answer,
    explanation:         generated.explanation,
    wordId,
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    question: {
      example:             generated.example,
      example_reading:     generated.example_reading,
      example_translation: generated.example_translation,
      translation_blank:   generated.translation_blank ?? null,
      blank:               generated.blank,
    },
    answer: generated.answer,
  };
}

// SM-2アルゴリズムの定義
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

// 自動採点設定
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

// 継続日数の更新（日本標準時基準）
function getJSTDate(date = new Date()) {
  // 協定世界時から日本標準時への換算
  const jstNow = new Date(date.getTime() + (9 * 60 * 60 * 1000));
  return jstNow.toISOString().split('T')[0];
}

async function updateStreak(userId) {
  const profileRef = db.collection('epop_profiles').doc(userId);
  const snap = await profileRef.get();
  
  const todayStr = getJSTDate();
  let streak = 0;
  let lastActivityDate = "";
  
  if (snap.exists) {
    const data = snap.data();
    streak = data.streak || 0;
    lastActivityDate = data.lastActivityDate || "";
  }

  if (lastActivityDate === todayStr) return; // 当日更新有無の判定

  const yesterday = new Date(new Date().getTime() - (24 * 60 * 60 * 1000));
  const yesterdayStr = getJSTDate(yesterday);

  if (lastActivityDate === yesterdayStr) {
    streak += 1;
  } else {
    // 非継続時の初期化
    streak = 1;
  }

  await profileRef.set({
    streak,
    lastActivityDate: todayStr,
  }, { merge: true });
}

// ミドルウェアの設定
app.use(express.json());
app.use(cors());

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

// 出題語一覧取得API
app.get('/api/epop/due', verifyAuth, async (req, res) => {
  try {
    await ensureDictCache();
    const userId = req.userId;
    const now = admin.firestore.Timestamp.fromDate(new Date());

    const isExtra = req.query.extra === 'true';

    // 統計用属性の取得
    const profileSnap = await db.collection('epop_profiles').doc(userId).get();
    
    // 目標水準の設定
    const userTargetLevel = profileSnap.exists && profileSnap.data().unlockedLevel ? profileSnap.data().unlockedLevel : 1;

    // 既習語IDの取得
    const allProgressSnap = await db.collection('epop_progress').doc(userId).collection('words').get();
    const learnedIds = new Set(allProgressSnap.docs.map(d => d.id));

    let reviewWords = [];

    // 通常モード：復習対象語の取得
    if (!isExtra) {
      const dueSnap = await db
        .collection('epop_progress')
        .doc(userId)
        .collection('words')
        .where('nextReview', '<=', now)
        .orderBy('nextReview')
        .get();

      const rawReviewWords = dueSnap.docs
        .map(doc => {
          const word = getWordById(doc.id);
          if (!word) return null;
          const progress = doc.data();
          return {
            ...word,
            progress,
            isNew: false,
            next_review: progress.nextReview ? progress.nextReview.toDate().toISOString() : null,
          };
        })
        .filter(Boolean);

      // 保存済み設問の抽出
      const reviewIds = rawReviewWords.map(w => w.id);
      let reviewCachedIds = new Set();
      if (reviewIds.length > 0) {
        const chunkSize = 30;
        for (let i = 0; i < reviewIds.length; i += chunkSize) {
          const chunk = reviewIds.slice(i, i + chunkSize);
          const qSnap = await db.collection('epop_questions')
            .where(admin.firestore.FieldPath.documentId(), 'in', chunk)
            .select()
            .get();
          qSnap.docs.forEach(d => reviewCachedIds.add(d.id));
        }
      }
      reviewWords = rawReviewWords.filter(w => reviewCachedIds.has(w.id));
    }

    // 新規語抽出論理
    const newLimit = isExtra ? 10 : 5;
    
    // 1. 未習かつ目標水準以下の単語抽出
    const availableNewWords = dictCache.words.filter(w => 
      !learnedIds.has(w.id) && (w.level || 1) <= userTargetLevel
    );

    // 2. 保存済み単語への限定
    const availableIds = availableNewWords.map(w => w.id);
    let cachedIds = new Set();
    if (availableIds.length > 0) {
      const chunkSize = 30;
      for (let i = 0; i < availableIds.length; i += chunkSize) {
        const chunk = availableIds.slice(i, i + chunkSize);
        const qSnap = await db.collection('epop_questions')
          .where(admin.firestore.FieldPath.documentId(), 'in', chunk)
          .select()
          .get();
        qSnap.docs.forEach(d => cachedIds.add(d.id));
      }
    }

    const cachedNewWords = availableNewWords.filter(w => cachedIds.has(w.id));

    // 3. 攪拌及び抽出
    const newWords = cachedNewWords
      .sort(() => Math.random() - 0.5)
      .slice(0, newLimit)
      .map(w => ({ ...w, progress: null, isNew: true }));

    res.json({
      success: true,
      review: reviewWords,
      new: newWords,
      total: reviewWords.length + newWords.length,
      userLevel: userTargetLevel, // 画面表示用属性
    });
  } catch (error) {
    console.error('[/api/epop/due]', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 穴埋め問題取得API
app.post('/api/epop/pop', verifyAuth, async (req, res) => {
  const { wordId } = req.body;
  if (!wordId) return res.status(400).json({ error: 'wordIdが必要です' });

  try {
    await ensureDictCache();
    const word = getWordById(wordId);
    if (!word) return res.status(404).json({ error: '単語が見つかりません' });

    const { question, answer } = await getOrGenerateQuestion(wordId);
    const syllableCount = countSyllables(getPrimaryForm(word));

    // 解説情報の補完
    const snap = await db.collection('epop_questions').doc(wordId).get();
    const explanation = snap.exists ? (snap.data().explanation ?? '') : '';

    res.json({
      success: true,
      question: { ...question, explanation },
      answer,
      wordId,
      syllableCount,
    });
  } catch (error) {
    console.error('[/api/epop/pop]', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 問題文再生成API
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
      example:             generated.example,
      example_reading:     generated.example_reading,
      example_translation: generated.example_translation,
      translation_blank:   generated.translation_blank ?? null,
      blank:               generated.blank,
      answer:              generated.answer,
      explanation:         generated.explanation,
      wordId,
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const syllableCount = countSyllables(getPrimaryForm(word));
    res.json({
      success: true,
      question: {
        example:             generated.example,
        example_reading:     generated.example_reading,
        example_translation: generated.example_translation,
        translation_blank:   generated.translation_blank ?? null,
        blank:               generated.blank,
        explanation:         generated.explanation,
      },
      answer: generated.answer,
      wordId,
      syllableCount,
    });
  } catch (error) {
    console.error('[/api/epop/pop/regenerate]', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 回答結果受領及びSRS更新API
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

    await updateStreak(req.userId);

    res.json({ success: true, quality, nextReview: updated.nextReview, interval: updated.interval });
  } catch (error) {
    console.error('[/api/epop/review]', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 学習統計取得API
app.get('/api/epop/stats', verifyAuth, async (req, res) => {
  try {
    await ensureDictCache();
    const userId = req.userId;

    const [progressSnap, profileSnap] = await Promise.all([
      db.collection('epop_progress').doc(userId).collection('words').get(),
      db.collection('epop_profiles').doc(userId).get(),
    ]);

    const totalWords = dictCache.words.length + dictCache.complex.length;
    const learnedIds = new Set(progressSnap.docs.map(d => d.id));
    const learnedCount = progressSnap.size;
    const now = new Date();

    const dueIds = [];
    let matureCount = 0;

    for (const doc of progressSnap.docs) {
      const d = doc.data();
      if (d.nextReview && d.nextReview.toDate() <= now) dueIds.push(doc.id);
      if (d.interval >= 21) matureCount++;
    }

    // 保存済み復習対象数の算出
    let cachedDueCount = 0;
    if (dueIds.length > 0) {
      const chunkSize = 30;
      for (let i = 0; i < dueIds.length; i += chunkSize) {
        const chunk = dueIds.slice(i, i + chunkSize);
        const qSnap = await db.collection('epop_questions')
          .where(admin.firestore.FieldPath.documentId(), 'in', chunk)
          .select().get();
        cachedDueCount += qSnap.size;
      }
    }

    const userTargetLevel = profileSnap.exists && profileSnap.data().unlockedLevel ? profileSnap.data().unlockedLevel : 1;

    // 保存済み新規語数の算出
    const unlearnedIds = dictCache.words
      .filter(w => !learnedIds.has(w.id) && (w.level || 1) <= userTargetLevel)
      .map(w => w.id);

    let cachedNewCount = 0;
    if (unlearnedIds.length > 0) {
      const chunkSize = 30;
      for (let i = 0; i < unlearnedIds.length; i += chunkSize) {
        const chunk = unlearnedIds.slice(i, i + chunkSize);
        const qSnap = await db.collection('epop_questions')
          .where(admin.firestore.FieldPath.documentId(), 'in', chunk)
          .select().get();
        cachedNewCount += qSnap.size;
      }
    }

    // 継続日数の妥当性確認
    const todayStr = getJSTDate();
    const yesterday = new Date(new Date().getTime() - (24 * 60 * 60 * 1000));
    const yesterdayStr = getJSTDate(yesterday);
    
    let currentStreak = profileSnap.exists ? (profileSnap.data().streak || 0) : 0;
    const lastDate = profileSnap.exists ? (profileSnap.data().lastActivityDate || "") : "";
    
    // 非継続時の継続日数設定
    if (lastDate !== todayStr && lastDate !== yesterdayStr) {
      currentStreak = 0;
    }

    res.json({
      success: true,
      stats: {
        totalWords,
        learnedCount,
        matureCount,
        dueCount: cachedDueCount,
        newCount: Math.min(cachedNewCount, 5),
        userLevel: profileSnap.exists ? (profileSnap.data().level || 1) : null,
        placementDone: profileSnap.exists ? !!profileSnap.data().placementDone : false,
        streak: currentStreak,
        lastActivityDate: lastDate || null,
      },
    });
  } catch (error) {
    console.error('[/api/epop/stats]', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 問題データ移行API
app.post('/api/epop/migrate-questions', verifyAuth, async (req, res) => {
  try {
    const snap = await db.collection('epop_questions').get();
    let migrated = 0;
    let skipped  = 0;
    const batch  = db.batch();

    for (const doc of snap.docs) {
      const d = doc.data();

      // 移行済みデータの除外判定
      if (d.example) { skipped++; continue; }

      // 旧形式の判定
      const q = d.question;
      if (!q) { skipped++; continue; }

      batch.set(doc.ref, {
        example:             q.example             ?? '',
        example_reading:     q.example_reading     ?? '',
        example_translation: q.example_translation ?? '',
        translation_blank:   q.translation_blank   ?? null,
        blank:               q.blank               ?? '',
        answer:              d.answer              ?? '',
        explanation:         q.explanation         ?? '',
        wordId:              d.wordId,
        generatedAt:         d.generatedAt,
        migratedAt:          admin.firestore.FieldValue.serverTimestamp(),
      });
      migrated++;
    }

    await batch.commit();
    console.log(`[MIGRATE] migrated=${migrated}, skipped=${skipped}`);
    res.json({ success: true, migrated, skipped });
  } catch (error) {
    console.error('[/api/epop/migrate-questions]', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 判定テストAPI
app.get('/api/epop/placement', verifyAuth, async (req, res) => {
  try {
    await ensureDictCache();
    const profileSnap = await db.collection('epop_profiles').doc(req.userId).get();
    
    if (profileSnap.exists && profileSnap.data().placementDone) {
      return res.json({ success: true, alreadyDone: true, level: profileSnap.data().unlockedLevel || 1 });
    }

    // 難易度別無作為抽出
    const placementWords = [];
    for (let lv = 1; lv <= 3; lv++) {
      const lvWords = dictCache.words.filter(w => (w.level || 1) === lv);
      const shuffled = lvWords.sort(() => Math.random() - 0.5).slice(0, 3);
      placementWords.push(...shuffled);
    }

    res.json({ success: true, alreadyDone: false, words: placementWords });
  } catch (error) {
    console.error('[/api/epop/placement]', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/epop/placement/finish', verifyAuth, async (req, res) => {
  const { results } = req.body;
  if (!results) return res.status(400).json({ error: 'resultsが必要です' });

  try {
    // 初期水準の判定
    const correctCount = results.filter(r => r.isCorrect).length;
    let level = 1;
    if (correctCount >= 7) level = 3;
    else if (correctCount >= 4) level = 2;

    await db.collection('epop_profiles').doc(req.userId).set({
      placementDone: true,
      unlockedLevel: level,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    res.json({ success: true, level });
  } catch (error) {
    console.error('[/api/epop/placement/finish]', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/epop/cache-all', verifyAuth, async (req, res) => {
  try {
    await ensureDictCache();
    const allWords = [...dictCache.words, ...dictCache.complex];
    
    let generated = 0;
    let skipped = 0;
    let failed = 0;

    for (const word of allWords) {
      try {
        const snap = await db.collection('epop_questions').doc(word.id).get();
        if (snap.exists) { skipped++; continue; }

        await getOrGenerateQuestion(word.id);
        generated++;
        console.log(`[CACHE-ALL] generated: ${word.id} (${generated}/${allWords.length})`);

        // API制限回避のための待機
        await new Promise(r => setTimeout(r, 1000));
      } catch (e) {
        console.error(`[CACHE-ALL] failed: ${word.id}`, e.message);
        failed++;
      }
    }

    res.json({ success: true, generated, skipped, failed, total: allWords.length });
  } catch (error) {
    console.error('[/api/epop/cache-all]', error.message);
    res.status(500).json({ error: error.message });
  }
});

// サーバーの起動
app.listen(port, '0.0.0.0', () => {
  console.log(`ipop server running on port ${port}`);
});

app.get('/api/health', async (req, res) => {
  await ensureDictCache();
  res.json({ ok: true, words: dictCache.words.length, complex: dictCache.complex.length });
});