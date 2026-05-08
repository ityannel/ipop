import { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { fetchStats } from '../services/api';
import { auth } from '../services/firebase';

const LEVEL_LABELS = { 1: '初級', 2: '中級', 3: '上級' };

export default function HomeScreen({ idToken, onStartStudy }) {
  const [stats, setStats] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      const data = await fetchStats();
      setStats(data.stats);
    } catch (e) {
      console.warn('stats error:', e.message);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [idToken]);

  useEffect(() => { loadStats(); }, [loadStats]);

  const onRefresh = () => { setRefreshing(true); loadStats(); };

  const masteryRate = stats
    ? Math.round((stats.matureCount / Math.max(stats.totalWords, 1)) * 100)
    : 0;

  const hasDue = stats && (stats.dueCount > 0 || stats.newCount > 0);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <Text style={styles.logo}>ipop</Text>
        <Text style={styles.loadingText}>読み込み中...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6c47ff" />}
    >
      {/* ロゴ */}
      <View style={styles.logoRow}>
        <Text style={styles.logo}>ipop</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {stats?.userLevel && (
            <View style={styles.levelBadge}>
              <Text style={styles.levelText}>{LEVEL_LABELS[stats.userLevel] || 'Lv' + stats.userLevel}</Text>
            </View>
          )}
          <TouchableOpacity
            style={{ backgroundColor: '#1a1a1a', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#333' }}
            onPress={() => auth.signOut()}
          >
            <Text style={{ color: '#aaa', fontSize: 12, fontWeight: 'bold' }}>ログアウト</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 今日の学習カード */}
      <TouchableOpacity
        style={[styles.studyCard, !hasDue && styles.studyCardDone]}
        onPress={onStartStudy}
        activeOpacity={0.85}
      >
        <View style={styles.studyCardInner}>
          <Text style={styles.studyCardLabel}>
            {hasDue ? '今日のipop' : '今日は完了 ✅'}
          </Text>
          {hasDue ? (
            <View style={styles.dueRow}>
              {stats.dueCount > 0 && (
                <View style={styles.duePill}>
                  <Text style={styles.duePillNum}>{stats.dueCount}</Text>
                  <Text style={styles.duePillLabel}>復習</Text>
                </View>
              )}
              {stats.newCount > 0 && (
                <View style={[styles.duePill, styles.duePillNew]}>
                  <Text style={[styles.duePillNum, styles.duePillNumNew]}>
                    {Math.min(stats.newCount, 5)}
                  </Text>
                  <Text style={[styles.duePillLabel, styles.duePillLabelNew]}>新規</Text>
                </View>
              )}
            </View>
          ) : (
            <Text style={styles.studyCardDoneText}>次の復習は明日以降</Text>
          )}
        </View>
        <Text style={styles.studyCardArrow}>→</Text>
      </TouchableOpacity>

      {/* 統計グリッド */}
      {stats && (
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statNum}>{stats.learnedCount}</Text>
            <Text style={styles.statLabel}>学習済み</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNum}>{stats.matureCount}</Text>
            <Text style={styles.statLabel}>定着済み</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNum}>{masteryRate}%</Text>
            <Text style={styles.statLabel}>習得率</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNum}>{stats.totalWords}</Text>
            <Text style={styles.statLabel}>総単語数</Text>
          </View>
        </View>
      )}

      {/* 習得率バー */}
      {stats && stats.totalWords > 0 && (
        <View style={styles.masterySection}>
          <View style={styles.masteryLabelRow}>
            <Text style={styles.masteryLabel}>全体習得率</Text>
            <Text style={styles.masteryPct}>{masteryRate}%</Text>
          </View>
          <View style={styles.masteryBarBg}>
            <View style={[styles.masteryBarFill, { width: `${masteryRate}%` }]} />
            <View style={[
              styles.masteryBarLearned,
              { width: `${Math.round((stats.learnedCount / stats.totalWords) * 100)}%` }
            ]} />
          </View>
          <View style={styles.masteryLegendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#6c47ff' }]} />
              <Text style={styles.legendText}>定着済み</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#2a2a3a' }]} />
              <Text style={styles.legendText}>学習中</Text>
            </View>
          </View>
        </View>
      )}

      {/* i-tya紹介 */}
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>i-tya語について</Text>
        <Text style={styles.infoText}>
          語末母音で品詞が決まる人工言語です。{'\n'}
          <Text style={styles.infoAccent}>-a</Text> 名詞
          <Text style={styles.infoAccent}>-i</Text> 動詞
          <Text style={styles.infoAccent}>-u</Text> 拡張詞
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 24, paddingTop: 60, paddingBottom: 48 },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { color: '#555', fontSize: 14 },

  logoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 },
  logo: { color: '#fff', fontSize: 32, fontWeight: '800', letterSpacing: -1 },
  levelBadge: {
    backgroundColor: '#1a1a2e', borderRadius: 99, paddingHorizontal: 12, paddingVertical: 5,
    borderWidth: 1, borderColor: '#6c47ff44',
  },
  levelText: { color: '#9b7cff', fontSize: 13, fontWeight: '600' },

  studyCard: {
    backgroundColor: '#6c47ff', borderRadius: 20, padding: 22, marginBottom: 20,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  studyCardDone: { backgroundColor: '#1a1a1a' },
  studyCardInner: { flex: 1 },
  studyCardLabel: { color: '#fff', fontSize: 13, fontWeight: '600', marginBottom: 10, opacity: 0.85 },
  studyCardDoneText: { color: '#555', fontSize: 14 },
  studyCardArrow: { color: '#fff', fontSize: 22, fontWeight: '300', opacity: 0.7 },
  dueRow: { flexDirection: 'row', gap: 10 },
  duePill: {
    backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 8,
    flexDirection: 'row', alignItems: 'baseline', gap: 5,
  },
  duePillNew: { backgroundColor: 'rgba(255,255,255,0.15)' },
  duePillNum: { color: '#fff', fontSize: 22, fontWeight: '800' },
  duePillNumNew: { color: '#fff' },
  duePillLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  duePillLabelNew: { color: 'rgba(255,255,255,0.8)' },

  // 統計グリッド
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  statCard: {
    flex: 1, minWidth: '45%', backgroundColor: '#111', borderRadius: 14,
    padding: 16, borderWidth: 1, borderColor: '#1e1e1e',
  },
  statNum: { color: '#fff', fontSize: 26, fontWeight: '700', marginBottom: 4 },
  statLabel: { color: '#555', fontSize: 12 },

  // 習得率バー
  masterySection: { backgroundColor: '#111', borderRadius: 16, padding: 18, marginBottom: 20, borderWidth: 1, borderColor: '#1e1e1e' },
  masteryLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  masteryLabel: { color: '#888', fontSize: 13 },
  masteryPct: { color: '#fff', fontSize: 13, fontWeight: '600' },
  masteryBarBg: { height: 6, backgroundColor: '#1e1e1e', borderRadius: 3, marginBottom: 10, position: 'relative', overflow: 'hidden' },
  masteryBarLearned: { position: 'absolute', left: 0, top: 0, height: '100%', backgroundColor: '#2a2a3a', borderRadius: 3 },
  masteryBarFill: { position: 'absolute', left: 0, top: 0, height: '100%', backgroundColor: '#6c47ff', borderRadius: 3, zIndex: 1 },
  masteryLegendRow: { flexDirection: 'row', gap: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: '#555', fontSize: 11 },

  // i-tya紹介
  infoCard: { backgroundColor: '#111', borderRadius: 16, padding: 18, borderWidth: 1, borderColor: '#1e1e1e' },
  infoTitle: { color: '#555', fontSize: 11, letterSpacing: 1.5, marginBottom: 10, textTransform: 'uppercase' },
  infoText: { color: '#666', fontSize: 14, lineHeight: 24 },
  infoAccent: { color: '#9b7cff', fontWeight: '600' },
});