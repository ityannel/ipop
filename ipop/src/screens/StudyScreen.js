import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  Animated, SafeAreaView, Platform,
  Alert, BackHandler, Vibration, ActivityIndicator
} from 'react-native';
import { fetchDueWords, fetchQuestion, submitReview, migrateQuestions } from '../services/api';
import { FONT, COLORS } from '../constants/theme';
import Chara from '../chara.svg';

// i-tya言語で使用するキーのみ（母音3・子音8・半母音2）
// 行1: h k l m n
// 行2: p s t w y
// 行3: a i u ⌫
const KB_ROWS = [
  ['h', 'k', 'l', 'm', 'n'],
  ['p', 's', 't', 'w', 'y'],
  ['a', 'i', 'u', '⌫'],
];

// Fisher-Yates シャッフル（偏りなし）
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// example文字列とblankからparts配列を生成（修正版）
function buildParts(example, blank) {
  const idx = example.indexOf(blank);
  if (idx === -1) return [example];
  const parts = [];
  if (idx > 0) parts.push(example.slice(0, idx));
  parts.push(null); // blank
  const after = example.slice(idx + blank.length);
  if (after.length > 0) parts.push(after);
  return parts;
}

export default function StudyScreen({ onFinish }) {
  const [words, setWords]               = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [question, setQuestion]         = useState(null);
  const [typed, setTyped]               = useState('');
  const [isCorrect, setIsCorrect]       = useState(false);
  const [isLoading, setIsLoading]       = useState(true);
  const [isDone, setIsDone]             = useState(false);
  const [hintLevel, setHintLevel]       = useState(0);
  const [error, setError]               = useState(null); // [UX] エラー状態を管理

  const [originalTotal, setOriginalTotal] = useState(10);
  const [clearedCount, setClearedCount]   = useState(0);
  const [flawlessCount, setFlawlessCount] = useState(0);
  const [isReview, setIsReview]           = useState(false);

  // [REFACTOR] sessionStartTime は描画に不要なので useRef に変更
  const sessionStartRef = useRef(Date.now());

  const startTimeRef  = useRef(0);
  const firstSeenRef  = useRef({});
  // [BUG] 自動進行タイマー — アンマウント時にクリーンアップ必須
  const autoNextTimer = useRef(null);
  // [BUG] loadWords の二重実行を防ぐフラグ
  const isLoadingRef  = useRef(false);

  // wordsRef: nextQuestion のクロージャが古い words を参照しないよう同期
  const wordsRef        = useRef([]);
  const currentIndexRef = useRef(0);

  const hintLevelRef = useRef(0);

  // アニメーション値（useRef で保持 — 再生成しない）
  const progressAnim   = useRef(new Animated.Value(0)).current;
  const redFlashAnim   = useRef(new Animated.Value(0)).current;
  const checkScaleAnim = useRef(new Animated.Value(0)).current;
  const checkRotAnim   = useRef(new Animated.Value(-15)).current;
  const cardSlideAnim  = useRef(new Animated.Value(60)).current;  // 横スライド用（X方向）
  const cardOpacAnim   = useRef(new Animated.Value(0)).current;
  const explainAnim    = useRef(new Animated.Value(0)).current;
  const kbSlideAnim    = useRef(new Animated.Value(0)).current;

  // ────────────────────────────────────────────
  // [BUG] アンマウント時に autoNextTimer をクリーンアップ
  // ────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (autoNextTimer.current) {
        clearTimeout(autoNextTimer.current);
      }
    };
  }, []);

  // ────────────────────────────────────────────
  // Android バックボタン
  // ────────────────────────────────────────────
  const handleExit = useCallback(() => {
    Alert.alert(
      '確認',
      '本当に戻りますか？\n（現在のセッションの進捗は失われます）',
      [
        { text: 'キャンセル', style: 'cancel' },
        { text: 'はい', style: 'destructive', onPress: () => { if (onFinish) onFinish(); } },
      ]
    );
    return true;
  }, [onFinish]);

  useEffect(() => {
    const h = BackHandler.addEventListener('hardwareBackPress', handleExit);
    return () => h.remove();
  }, [handleExit]);

  // ────────────────────────────────────────────
  // 初回ロード
  // ────────────────────────────────────────────
  useEffect(() => { loadWords(); }, []);

  async function loadWords() {
    // [BUG] 二重実行ガード
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;

    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchDueWords();
      const reviewWords = data.review || [];
      const newWords    = (data.new || []).slice(0, 5);
      const all         = shuffle([...reviewWords, ...newWords]);

      setOriginalTotal(all.length || 1);
      setClearedCount(0);
      setFlawlessCount(0);
      progressAnim.setValue(0);
      kbSlideAnim.setValue(0);
      setCurrentIndex(0);
      currentIndexRef.current = 0;

      // isNew はAPIが返す値をそのまま使う（自前計算で上書きしない）
      const initializedWords = all.map(w => ({ ...w, isRetry: false }));
      setWords(initializedWords);
      wordsRef.current = initializedWords;
      firstSeenRef.current = {};

      if (initializedWords.length > 0) {
        sessionStartRef.current = Date.now();
        await loadQuestion(initializedWords[0]);
      } else {
        setIsDone(true);
      }
    } catch (e) {
      console.error(e);
      // [UX] Alert ではなくインライン表示でリトライできるように
      setError('単語の取得に失敗しました');
    } finally {
      setIsLoading(false);
      isLoadingRef.current = false;
    }
  }

  // ────────────────────────────────────────────
  // 問題ロード
  // ────────────────────────────────────────────
  async function loadQuestion(word) {
    // APIレスポンス待ちの間に旧入力が見えないよう、先頭で即リセット
    setTyped('');
    setIsCorrect(false);
    setIsReview(false);
    setError(null);
    try {
      const data = await fetchQuestion(word.id);
      console.log('[DEBUG] fetchQuestion raw:', JSON.stringify(data, null, 2));
      const raw  = data.question ?? data;

      const answer = data.answer ?? raw.blank ?? '';
      // [BUG] buildParts を fileトップの修正済み関数に統一
      const parts  = buildParts(raw.example ?? '', answer);

      setQuestion({
        ja:          raw.example_translation ?? '',
        jaBlank:     raw.translation_blank ?? raw.ja_blank ?? raw.keyword_ja ?? null,
        answer,
        parts,
        explanation: raw.explanation ?? '',
      });
      setTyped('');
      setIsCorrect(false);
      setHintLevel(0);
      hintLevelRef.current = 0;
      setIsReview(false);

      const now = Date.now();
      startTimeRef.current = now;
      if (!firstSeenRef.current[word.id]) firstSeenRef.current[word.id] = now;

      // カード入場アニメーション（右からスライドイン）
      kbSlideAnim.setValue(0);
      cardSlideAnim.setValue(60);   // 右から
      cardOpacAnim.setValue(0);
      checkScaleAnim.setValue(0);
      checkRotAnim.setValue(-15);
      explainAnim.setValue(0);

      Animated.parallel([
        Animated.timing(cardSlideAnim, { toValue: 0, duration: 280, useNativeDriver: false }),
        Animated.timing(cardOpacAnim,  { toValue: 1, duration: 280, useNativeDriver: false }),
      ]).start();
    } catch (e) {
      console.error(e);
      // [UX] Alert ではなくインライン表示でリトライできるように
      setError('問題データの取得に失敗しました');
    }
  }

  // ────────────────────────────────────────────
  // 文字入力の長さが回答と同じになったら自動判定
  // ────────────────────────────────────────────
  useEffect(() => {
    if (!question || isCorrect) return;
    if (typed.length >= question.answer.length) {
      if (typed.toLowerCase() === question.answer.toLowerCase()) {
        handleCorrect();
      } else {
        // 不正解: 赤フラッシュ
        Animated.sequence([
          Animated.timing(redFlashAnim, { toValue: 1, duration: 80,  useNativeDriver: false }),
          Animated.timing(redFlashAnim, { toValue: 0, duration: 300, useNativeDriver: false }),
        ]).start();
      }
    }
  }, [typed, question, isCorrect]);

  // ────────────────────────────────────────────
  // 正解処理
  // ────────────────────────────────────────────
  function handleCorrect() {
    setIsCorrect(true);

    const timeTaken  = Date.now() - startTimeRef.current;
    const word       = wordsRef.current[currentIndexRef.current];
    const isFlawless = hintLevelRef.current === 0 && timeTaken <= 10000;

    if (!word.isRetry) {
      submitReview({ wordId: word.id, isCorrect: isFlawless }).catch(e => console.error(e));
    }

    if (isFlawless) {
      // アニメーションと state 更新を分離（updater 内の副作用を除去）
      const nextCleared = clearedCount + 1;
      setClearedCount(nextCleared);
      setFlawlessCount(prev => prev + 1);
      Animated.timing(progressAnim, {
        toValue: nextCleared / originalTotal,
        duration: 600,
        useNativeDriver: false,
      }).start();
    } else {
      setIsReview(true);
      setWords(prev => {
        const next = [...prev, { ...word, isRetry: true }];
        wordsRef.current = next;
        return next;
      });
    }

    // ✓アニメーション
    Animated.parallel([
      Animated.spring(checkScaleAnim, { toValue: 1, friction: 5, tension: 200, useNativeDriver: false }),
      Animated.timing(checkRotAnim,   { toValue: -8, duration: 350, useNativeDriver: false }),
    ]).start();

    // キーボードをスライドアウト → 解説をフェードイン
    Animated.timing(kbSlideAnim, { toValue: 300, duration: 320, useNativeDriver: false }).start(() => {
      Animated.timing(explainAnim, { toValue: 1, duration: 280, useNativeDriver: false }).start();
    });

    // 通常正解は1.4秒後に自動進行（レビュー扱い時は手動）
    if (isFlawless) {
      autoNextTimer.current = setTimeout(() => nextQuestion(), 1400);
    }
  }

  // ────────────────────────────────────────────
  // ヒント処理
  // hintLevel 0: 通常
  // hintLevel 1: 日本語の該当箇所を黄色くする
  // hintLevel 2: 1文字目だけ入力
  // hintLevel 3: 答え全部入力（→ 自動正解判定）
  // ────────────────────────────────────────────
  function handleHint() {
    if (!question || isCorrect) return;

    const target = question.answer;

    if (hintLevel === 0) {
      // 段階1: 日本語ハイライトのみ（入力は変えない）
      setHintLevel(1);
      hintLevelRef.current = 1;
    } else if (hintLevel === 1) {
      // 段階2: 1文字目を入力
      const first = target[0];
      const isFirstOfSentence = question.parts[0] === null;
      setTyped(isFirstOfSentence ? first.toUpperCase() : first);
      setHintLevel(2);
      hintLevelRef.current = 2;
    } else {
      // 段階3: 答え全部を入力（useEffectの自動判定に任せる）
      setTyped(target);
      setHintLevel(3);
      hintLevelRef.current = 3;
    }
  }

  // ────────────────────────────────────────────
  // キー入力
  // [PERF] typed を依存から外すため setTyped(prev => ...) を徹底
  // ────────────────────────────────────────────
  const pressKey = useCallback((key) => {
    if (isCorrect) return;
    if (key === '⌫') {
      setTyped(prev => prev.slice(0, -1));
    } else if (key === 'OK') {
      if (!question) return;
      // typed state を直接読まず、ref で最新値を参照することを避けるため
      // ここでは typed を直接使う（pressKey は typed に依存しないが OK 判定は必要）
      setTyped(prev => {
        if (!prev) return prev;
        // 副作用は updater 外で行う必要があるため、setTimeout で defer
        setTimeout(() => {
          if (prev.toLowerCase() === question.answer.toLowerCase()) {
            handleCorrect();
          } else {
            Animated.sequence([
              Animated.timing(redFlashAnim, { toValue: 1, duration: 80,  useNativeDriver: false }),
              Animated.timing(redFlashAnim, { toValue: 0, duration: 300, useNativeDriver: false }),
            ]).start();
          }
        }, 0);
        return prev;
      });
    } else {
      setTyped(prev => prev + key);
    }
  }, [isCorrect, question]);

  // ────────────────────────────────────────────
  // 次の問題へ
  // [BUG] wordsRef / currentIndexRef で最新値を参照
  // ────────────────────────────────────────────
  const nextQuestion = useCallback(async () => {
    if (autoNextTimer.current) {
      clearTimeout(autoNextTimer.current);
      autoNextTimer.current = null;
    }
    // question を先に null にしてカードを非表示→入力が一瞬見える問題を防ぐ
    setQuestion(null);
    setTyped('');
    setIsCorrect(false);
    setHintLevel(0);
    hintLevelRef.current = 0;

    const next = currentIndexRef.current + 1;
    if (next >= wordsRef.current.length) {
      setIsDone(true);
      return;
    }
    setCurrentIndex(next);
    currentIndexRef.current = next;
    await loadQuestion(wordsRef.current[next]);
  }, []);

  // [UX] カードをタップして自動進行タイマーをキャンセル
  const cancelAutoNext = useCallback(() => {
    if (autoNextTimer.current) {
      clearTimeout(autoNextTimer.current);
      autoNextTimer.current = null;
    }
  }, []);

  function restart() {
    setIsDone(false);
    setCurrentIndex(0);
    currentIndexRef.current = 0;
    setTyped('');
    setIsCorrect(false);
    loadWords();
  }

  // セッション内で最初に見てからの経過（isRetry用）
  function getElapsedLabel(wordId) {
    const firstSeen = firstSeenRef.current[wordId];
    if (!firstSeen) return 'さっき';
    const diffMins = Math.floor((Date.now() - firstSeen) / 60000);
    if (diffMins === 0) return 'さっき';
    return `${diffMins}分前`;
  }

  // SRS次回復習までの時間（review単語用）
  function getNextReviewLabel(word) {
    const ts = word.next_review ?? word.due_at ?? word.next_due ?? null;
    if (!ts) return '復習';
    const diffMs   = new Date(ts).getTime() - Date.now();
    const diffMins = Math.round(diffMs / 60000);
    if (diffMins <= 0)  return 'もうすぐ復習';
    if (diffMins < 60)  return `${diffMins}分後に復習`;
    const diffHours = Math.round(diffMins / 60);
    if (diffHours < 24) return `${diffHours}時間後に復習`;
    const diffDays  = Math.round(diffHours / 24);
    return `${diffDays}日後に復習`;
  }
  // ────────────────────────────────────────────
  // あと何文字バッジ
  // ────────────────────────────────────────────
  function getCloseHint() {
    if (!question || !typed || isCorrect) return null;
    const ans = question.answer.toLowerCase();
    const typ = typed.toLowerCase();
    if (typ === ans) return null;

    if (ans.startsWith(typ) && typed.length >= Math.max(1, ans.length - 2)) {
      const remaining = ans.length - typed.length;
      if (remaining > 0 && remaining <= 3) return `あと${remaining}文字`;
    }

    if (typed.length === ans.length) {
      let diff = 0;
      for (let i = 0; i < ans.length; i++) {
        if (typ[i] !== ans[i]) diff++;
      }
      if (diff <= 2) return `あと${diff}文字直して`;
    }

    return null;
  }

  // ────────────────────────────────────────────
  // ローディング
  // ────────────────────────────────────────────
  if (isLoading) {
    return (
      <View style={s.center}>
        <Text style={s.logoLoading}>ipop</Text>
        <View style={{ transform: [{ scale: 0.8 }] }}>
          <Chara width={160} height={160} />
        </View>
        <ActivityIndicator color={COLORS.green} size="small" style={{ marginTop: 30, opacity: 0.5 }} />
      </View>
    );
  }

  // ────────────────────────────────────────────
  // [UX] エラー画面（リトライボタン付き）
  // ────────────────────────────────────────────
  if (error) {
    return (
      <View style={s.outer}>
        <SafeAreaView style={s.container}>
          <View style={s.center}>
            <Text style={s.errorText}>{error}</Text>
            <TouchableOpacity
              style={[s.nextBtn, { marginTop: 20, paddingHorizontal: 32 }]}
              onPress={loadWords}
            >
              <Text style={s.nextBtnText}>再試行</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.nextBtn, { backgroundColor: '#1e1e2e', marginTop: 12, paddingHorizontal: 32 }]}
              onPress={() => { if (onFinish) onFinish(); }}
            >
              <Text style={s.nextBtnText}>ホームに戻る</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ────────────────────────────────────────────
  // 完了画面
  // ────────────────────────────────────────────
  if (isDone) {
    const elapsed  = Math.round((Date.now() - sessionStartRef.current) / 1000);
    const mins     = Math.floor(elapsed / 60);
    const secs     = elapsed % 60;
    const accuracy = originalTotal > 0
      ? Math.round((flawlessCount / originalTotal) * 100)
      : 0;

    return (
      <View style={s.outer}>
        <SafeAreaView style={s.container}>
          <View style={s.center}>
            <Text style={{ fontSize: 56, marginBottom: 20 }}>🎉</Text>
            <Text style={s.doneTitle}>学習完了！</Text>
            <Text style={s.doneSub}>セッションをクリアしました</Text>

            <View style={s.doneStats}>
              <View style={s.doneStat}>
                <Text style={s.doneStatNum}>{flawlessCount}<Text style={s.doneStatUnit}> / {originalTotal}</Text></Text>
                <Text style={s.doneStatLabel}>完璧正解</Text>
              </View>
              <View style={[s.doneStat, s.doneStatBorder]}>
                <Text style={s.doneStatNum}>{accuracy}<Text style={s.doneStatUnit}>%</Text></Text>
                <Text style={s.doneStatLabel}>正答率</Text>
              </View>
              <View style={s.doneStat}>
                <Text style={s.doneStatNum}>
                  {mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : `${secs}`}
                  <Text style={s.doneStatUnit}>{mins > 0 ? '' : '秒'}</Text>
                </Text>
                <Text style={s.doneStatLabel}>所要時間</Text>
              </View>
            </View>

            <TouchableOpacity style={s.nextBtn} onPress={restart}>
              <Text style={s.nextBtnText}>もう一度</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.nextBtn, { backgroundColor: '#1e1e2e', marginTop: 12 }]}
              onPress={() => { if (onFinish) onFinish(); }}
            >
              <Text style={s.nextBtnText}>ホームに戻る</Text>
            </TouchableOpacity>

            {/* ⚠️ 一時ボタン — マイグレーション後に削除 */}
            <TouchableOpacity
              style={[s.nextBtn, { backgroundColor: '#333', marginTop: 24 }]}
              onPress={async () => {
                try {
                  const result = await migrateQuestions();
                  Alert.alert('マイグレーション完了', `変換: ${result.migrated}件\nスキップ: ${result.skipped}件`);
                } catch (e) {
                  Alert.alert('エラー', e.message);
                }
              }}
            >
              <Text style={[s.nextBtnText, { fontSize: 13, color: '#aaa' }]}>🔧 DBマイグレーション（一時）</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ────────────────────────────────────────────
  // メイン画面
  // ────────────────────────────────────────────
  const word       = words[currentIndex];
  const closeHint  = getCloseHint();

  // バッジ表示ロジック
  // isRetry: このセッションで一度間違えて再出題 → 「○分前」
  // isNew:   初出題 → 「新規」
  // それ以外: SRS復習単語 → 「○分後に復習」
  const badgeLabel = word.isRetry
    ? getElapsedLabel(word.id)
    : word.isNew
    ? '新規'
    : getNextReviewLabel(word);

  const badgeStyle = word.isRetry
    ? s.timeBadgeRetry
    : word.isNew
    ? s.timeBadgeNew
    : s.timeBadgeReview;

  return (
    <View style={s.outer}>
      <SafeAreaView style={s.container}>
        {/* 赤フラッシュ */}
        <Animated.View
          pointerEvents="none"
          style={[s.redFlash, { opacity: redFlashAnim }]}
        />

        {/* ヘッダー（閉じるボタン + ステータスバーを同一行に） */}
        <View style={s.header}>
          <TouchableOpacity onPress={handleExit} style={s.closeBtn}>
            <Text style={s.closeBtnText}>×</Text>
          </TouchableOpacity>
          <View style={s.headerProgress}>
            <View style={s.progressBg}>
              <Animated.View
                style={[
                  s.progressFill,
                  { width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
                ]}
              />
            </View>
            <Text style={s.progressText}>{clearedCount} / {originalTotal}</Text>
          </View>
        </View>

        {/* コンテンツ */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.scrollContent}
          keyboardShouldPersistTaps="always"
          scrollEnabled={isCorrect}
        >
          {/* 問題カード */}
          {question && (
            // [UX] タップで自動進行タイマーをキャンセル
            <TouchableOpacity activeOpacity={1} onPress={cancelAutoNext}>
              <Animated.View
                style={[
                  s.card,
                  isCorrect && !isReview && s.cardCorrect,
                  isCorrect && isReview  && s.cardReview,
                  {
                    opacity: cardOpacAnim,
                    transform: [{ translateX: cardSlideAnim }],
                  },
                ]}
              >
                {/* 正解チェック（カード右上インライン） */}
                <Animated.View
                  style={[
                    s.checkBadge,
                    isReview && s.checkBadgeReview,
                    {
                      opacity: checkScaleAnim,
                      transform: [
                        { scale: checkScaleAnim },
                        { rotate: checkRotAnim.interpolate({ inputRange: [-15, -8], outputRange: ['-15deg', '-8deg'] }) },
                      ],
                    },
                  ]}
                >
                  <Text style={s.checkBadgeText}>✓</Text>
                </Animated.View>

                {/* メタ行: レベルバッジ + 新規/復習バッジ */}
                <View style={s.metaRow}>
                  <View style={s.lvBadge}>
                    <Text style={s.lvText}>{word.syllableCount ?? word.level ?? '—'} 音節</Text>
                  </View>
                  <View style={[s.timeBadge, badgeStyle, { marginLeft: 8 }]}>
                    <Text style={s.timeText}>{badgeLabel}</Text>
                  </View>
                </View>

                {/* 日本語訳（hintLevel>=1で該当箇所を黄色ハイライト） */}
                {hintLevel >= 1 && !isCorrect && question.jaBlank && question.ja.includes(question.jaBlank) ? (() => {
                  const idx = question.ja.indexOf(question.jaBlank);
                  return (
                    <Text style={s.jaText}>
                      {idx > 0 && <Text>{question.ja.slice(0, idx)}</Text>}
                      <Text style={s.jaTextHighlight}>{question.jaBlank}</Text>
                      <Text>{question.ja.slice(idx + question.jaBlank.length)}</Text>
                    </Text>
                  );
                })() : (
                  <Text style={s.jaText}>{question.ja}</Text>
                )}

                {/* 穴埋め文（ヒントはブランクボックス内に統合） */}
                <View style={s.sentenceWrap}>
                  {(question.parts ?? []).map((part, i) =>
                    part === null ? (
                      <View
                        key={i}
                        style={[
                          s.blankBox,
                          typed.length > 0 && !isCorrect && s.blankBoxTyping,
                          isCorrect && !isReview && s.blankBoxCorrect,
                          isCorrect && isReview  && s.blankBoxReview,
                          // ヒント2回目以降のみボックスをハイライト（1回目は日本語のみ）
                          hintLevel > 1 && !isCorrect && s.blankBoxHint,
                        ]}
                      >
                        {hintLevel > 0 && !isCorrect ? (
                          // ヒントモード: 入力済み文字 + 残りドット
                          <Text style={s.blankText} numberOfLines={1}>
                            <Text style={s.hintTyped}>{typed}</Text>
                            <Text style={s.hintRemain}>
                              {question.answer.slice(typed.length).replace(/./g, '·')}
                            </Text>
                          </Text>
                        ) : (
                          <Text
                            style={[
                              s.blankText,
                              typed.length === 0 && s.blankTextEmpty,
                              isCorrect && !isReview && s.blankTextCorrect,
                              isCorrect && isReview  && s.blankTextReview,
                            ]}
                            numberOfLines={1}
                          >
                            {typed || ' '}
                          </Text>
                        )}
                      </View>
                    ) : (
                      <Text key={i} style={s.enWord}>{part}</Text>
                    )
                  )}
                </View>

                {/* 「あと〇文字」バッジ */}
                {closeHint && (
                  <View style={s.closeHintBadge}>
                    <Text style={s.closeHintText}>{closeHint}</Text>
                  </View>
                )}

              </Animated.View>
            </TouchableOpacity>
          )}

          {/* 解説カード（正解後にフェードイン） */}
          <Animated.View
            style={[
              s.explainCard,
              {
                opacity: explainAnim,
                transform: [{ translateY: explainAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
              },
            ]}
          >
            <Text style={s.explainText}>{question?.explanation}</Text>

            {/* レビュー時は手動で次へ */}
            {isCorrect && isReview && (
              <TouchableOpacity style={s.nextBtn} onPress={nextQuestion}>
                <Text style={s.nextBtnText}>次の問題 →</Text>
              </TouchableOpacity>
            )}
          </Animated.View>
        </ScrollView>

        {/* カスタムキーボード（正解後 or 問題未ロード時はスライドアウト） */}
        <Animated.View
          style={[
            s.kbArea,
            { transform: [{ translateY: kbSlideAnim }] },
          ]}
          pointerEvents={isCorrect || !question ? 'none' : 'auto'}
        >
          {/* ヒントボタン行 */}
          <View style={s.kbActions}>
            <TouchableOpacity style={s.kbAction} onPress={handleHint}>
              <Text style={s.kbActionIcon}>💡</Text>
              <Text style={s.kbActionLabel}>
                {hintLevel === 0 ? 'ヒント' : hintLevel === 1 ? '1文字目' : hintLevel === 2 ? '答えを見る' : 'ヒント'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* キー行 */}
          {KB_ROWS.map((row, ri) => (
            <View key={ri} style={s.kbRow}>
              {row.map(k => (
                <KeyButton
                  key={k}
                  label={k}
                  onPress={() => pressKey(k)}
                  isDel={k === '⌫'}
                />
              ))}
            </View>
          ))}

          {/* OK行（スペースなし） */}
          <View style={[s.kbRow, { marginBottom: 4 }]}>
            <KeyButton label="✓ OK" onPress={() => pressKey('OK')} isOK />
          </View>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

// ────────────────────────────────────────────
// キーボタンコンポーネント（React.memo でラップ — 不要な再レンダリング防止）
// ────────────────────────────────────────────
// [PERF] React.memo: typed が変わるたびにキーボード全体が再レンダリングされていたのを防ぐ
const KeyButton = React.memo(function KeyButton({ label, onPress, isDel = false, isOK = false }) {
  const scale     = useRef(new Animated.Value(1)).current;
  const brightness = useRef(new Animated.Value(0)).current; // 0=通常 1=押下ハイライト

  function onIn() {
    // Android のみ短いバイブ（iOS の Vibration はデフォルト400msで長すぎる）
    if (Platform.OS === 'android') {
      Vibration.vibrate(8);
    }
    // useNativeDriver を parallel 内で混在させると crash するため false に統一
    Animated.parallel([
      Animated.spring(scale, { toValue: 0.84, useNativeDriver: false, speed: 60 }),
      Animated.timing(brightness, { toValue: 1, duration: 60, useNativeDriver: false }),
    ]).start();
  }
  function onOut() {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: false, speed: 60 }),
      Animated.timing(brightness, { toValue: 0, duration: 180, useNativeDriver: false }),
    ]).start();
    onPress();
  }

  // 通常色 / 押下色 を interpolate で切り替え
  const bgColor = brightness.interpolate({
    inputRange: [0, 1],
    outputRange: isOK
      ? ['rgba(58,127,255,0.95)', 'rgba(100,170,255,1)']
      : isDel
      ? ['rgba(50,48,78,0.9)', 'rgba(90,86,130,1)']
      : ['rgba(60,58,88,0.9)', 'rgba(108,103,160,1)'],
  });

  return (
    <Animated.View
      style={[
        s.key,
        isDel && s.keyDel,
        isOK  && s.keyOK,
        { backgroundColor: bgColor, transform: [{ scale }] },
      ]}
    >
      <TouchableOpacity
        onPressIn={onIn}
        onPressOut={onOut}
        activeOpacity={1}
        style={s.keyInner}
      >
        <Text
          style={[
            s.keyText,
            isOK  && s.keyOKText,
            isDel && s.keyDelText,
          ]}
        >
          {label}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
});

// ────────────────────────────────────────────
// スタイル
// ────────────────────────────────────────────
const s = StyleSheet.create({
  outer: { flex: 1, backgroundColor: '#000', alignItems: 'center' },
  container: { flex: 1, backgroundColor: '#0a0818', width: '100%', maxWidth: 500 },
  root: {
    flex: 1,
    backgroundColor: '#0a0818',
  },
  center: {
    flex: 1,
    backgroundColor: '#0a0818',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  logoLoading: {
    color: COLORS.green,
    fontSize: 48,
    fontFamily: FONT.en,
    marginBottom: 10,
  },
  loadingRoot: {
    flex: 1,
    backgroundColor: '#0a0818',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingLogo: {
    color: COLORS.green,
    fontSize: 72,
    fontFamily: FONT.en,
    marginBottom: 20,
  },
  loadingChara: {
    transform: [{ scale: 1.1 }],
  },
  loadingText: { color: '#555', fontSize: 15, fontFamily: FONT.jp },

  // [UX] エラーテキスト
  errorText: { color: '#ff6b6b', fontSize: 15, textAlign: 'center', marginBottom: 8, fontFamily: FONT.jp },

  // ── ヘッダー（閉じるボタン + プログレスを同一行）
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 12,
  },
  headerProgress: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: { color: '#fff', fontSize: 20, fontWeight: 'bold', lineHeight: 24 },

  // ── フラッシュ
  redFlash: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(255,40,40,0.18)',
    zIndex: 50,
    pointerEvents: 'none',
  },

  // ── スクロール
  scrollContent: { padding: 16, paddingTop: 4, paddingBottom: 12 },

  // ── プログレス
  progressText: { color: '#555', fontSize: 12, minWidth: 36, textAlign: 'right', fontFamily: FONT.en },
  progressBg: {
    flex: 1,
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: { height: 6, backgroundColor: '#6c47ff', borderRadius: 3 },

  // ── カード
  card: {
    backgroundColor: 'rgba(28,26,44,0.95)',
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    marginBottom: 12,
    overflow: 'visible',
  },
  cardCorrect: { borderColor: 'rgba(76,175,80,0.35)' },
  cardReview:  { borderColor: 'rgba(255,152,0,0.35)' },

  // 正解チェックバッジ（カード右上）
  checkBadge: {
    position: 'absolute',
    top: 10,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(76,175,80,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  checkBadgeReview: { backgroundColor: 'rgba(255,152,0,0.2)' },
  checkBadgeText: { fontSize: 18, color: '#4caf50', fontFamily: FONT.en },

  // 新規/復習バッジ（カード右上・絶対配置）
  timeBadgeAbsolute: {
    position: 'absolute',
    top: 48,
    right: 12,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    zIndex: 10,
  },

  // メタ行
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginBottom: 14,
  },
  lvBadge: {
    backgroundColor: 'rgba(108,71,255,0.25)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  lvText: { color: '#9b7cff', fontSize: 12, fontFamily: FONT.en },
  timeBadge: {
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  timeBadgeNew:    { backgroundColor: 'rgba(42,184,184,0.25)' },
  timeBadgeReview: { backgroundColor: 'rgba(108,122,137,0.25)' },
  timeBadgeRetry:  { backgroundColor: 'rgba(217,83,79,0.25)' },
  timeText: { color: '#ccc', fontSize: 10, fontFamily: FONT.en },

  // 日本語文
  jaText: { color: '#e0e0e0', fontSize: 18, lineHeight: 30, marginBottom: 8, fontFamily: FONT.jp },
  // ヒント1回目: 明るい白・太字で光らせる（下線なし）
  jaTextHighlight: { color: '#fff', fontSize: 19, fontFamily: FONT.jpEb },

  // ヒントテキスト
  hintNote:   { color: '#aaa', fontSize: 13, marginBottom: 12 },
  hintAnswer: { color: '#ffcc00' },
  hintDot:    { color: 'rgba(255,204,0,0.4)' },

  // 穴埋め文 — 単語単位で折り返す（単語の中では折り返さない）
  sentenceWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginBottom: 8,
    rowGap: 8,
  },
  // 単語テキスト: 折り返し禁止・大きめフォント
  enWord: {
    color: '#c8c8c8',
    fontSize: 24,
    lineHeight: 46,
    flexShrink: 0,
    flexWrap: 'nowrap',
    fontFamily: FONT.en,
  },
  // 入力欄: alignSelf:'flex-start' で内容幅に追従して自動伸張
  blankBox: {
    height: 46,
    minWidth: 72,
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.12)',
    marginHorizontal: 4,
    paddingHorizontal: 14,
    paddingVertical: 2,
    flexShrink: 0,
    justifyContent: 'center',
  },
  blankBoxTyping:  { borderColor: 'rgba(108,71,255,0.85)', backgroundColor: 'rgba(108,71,255,0.12)' },
  blankBoxCorrect: { borderColor: 'rgba(76,175,80,0.6)',   backgroundColor: 'rgba(76,175,80,0.1)' },
  blankBoxReview:  { borderColor: 'rgba(255,152,0,0.6)',   backgroundColor: 'rgba(255,152,0,0.1)' },
  blankBoxHint:    { borderColor: 'rgba(255,204,0,0.5)',   backgroundColor: 'rgba(255,204,0,0.07)' },
  blankText:        { color: '#fff', fontSize: 22, letterSpacing: 0.5, textAlign: 'center', fontFamily: FONT.en },
  blankTextEmpty:   { color: 'transparent' },
  blankTextCorrect: { color: '#4caf50' },
  blankTextReview:  { color: '#ff9800' },
  hintTyped:        { color: '#fff' },
  hintRemain:       { color: 'rgba(255,204,0,0.4)' },

  // 「あと〇文字」バッジ
  closeHintBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(108,71,255,0.3)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 6,
  },
  closeHintText: { color: '#c4b2ff', fontSize: 12 },

  // 次回出題ヒント
  nextReviewHint: {
    textAlign: 'right',
    color: 'rgba(255,255,255,0.15)',
    fontSize: 11,
    marginTop: 8,
  },

  // ── 解説カード
  explainCard: {
    backgroundColor: 'rgba(8,20,8,0.9)',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(76,175,80,0.15)',
    marginBottom: 10,
    gap: 10,
  },
  reviewWarning: { color: '#ff9800', fontSize: 13 },
  explainText:   { color: '#999', fontSize: 14, lineHeight: 22 },

  // ── 次へボタン
  nextBtn: {
    backgroundColor: '#6c47ff',
    borderRadius: 14,
    padding: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  nextBtnText: { color: '#fff', fontSize: 17 },

  // ── 完了画面
  doneTitle: { color: '#fff', fontSize: 22, marginBottom: 6, fontFamily: FONT.jpBd },
  doneSub:   { color: '#555', fontSize: 14, marginBottom: 28, fontFamily: FONT.jp },
  doneStats: {
    flexDirection: 'row',
    backgroundColor: '#111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1e1e2e',
    marginBottom: 28,
    width: '100%',
  },
  doneStat: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 16,
  },
  doneStatBorder: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#1e1e2e',
  },
  doneStatNum:   { color: '#fff', fontSize: 24, fontFamily: FONT.en },
  doneStatUnit:  { color: '#555', fontSize: 14, fontFamily: FONT.en },
  doneStatLabel: { color: '#555', fontSize: 12, marginTop: 4, fontFamily: FONT.jp },

  // ── キーボードエリア
  kbArea: {
    backgroundColor: 'rgba(14,12,26,0.98)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 44 : 24,
    paddingHorizontal: 8,
  },
  kbActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingBottom: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    marginBottom: 8,
    marginHorizontal: 4,
  },
  kbAction:      { alignItems: 'center', paddingHorizontal: 20 },
  kbActionIcon:  { fontSize: 16, marginBottom: 2 },
  kbActionLabel: { color: '#777', fontSize: 12 },
  kbRow: {
    flexDirection: 'row',
    paddingHorizontal: 10,  // 全行共通の左右margin
    gap: 7,
    marginBottom: 7,
  },

  // キー — flex:1 で均等割り、maxWidth なし（行ごとに自動調整）
  key: {
    flex: 1,
    height: 46,
    backgroundColor: 'rgba(60,58,88,0.9)',
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    // 影なし（borderBottomWidth を廃止）
    overflow: 'hidden',
  },
  keyInner: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyDel: {
    flex: 1.4,
  },
  keyOK: {
    flex: 1,
    borderColor: 'rgba(100,160,255,0.2)',
  },
  keyText: {
    color: '#e0e0e0',
    fontSize: 17,
    letterSpacing: 0.3,
    ...FONT.enVar,
  },
  keyOKText: {
    fontSize: 13,
    color: '#fff',
  },
  keyDelText: {
    fontSize: 15,
    color: '#aaa',
  },
});
