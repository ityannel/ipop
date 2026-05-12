import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, Animated, useWindowDimensions,
  ActivityIndicator, PanResponder, SafeAreaView, Pressable
} from 'react-native';
import Svg, { Defs, ClipPath, Path, G, Pattern, Rect, Circle, Text as SvgText } from 'react-native-svg';

// ── SVGアセット
import Katati1    from '../katati1.svg';
import Katati2    from '../katati2.svg';
import Katati3    from '../katati3.svg';
import Katati4    from '../katati4.svg';
import Chara      from '../chara.svg';

import { fetchStats } from '../services/api';
import { auth }       from '../services/firebase';
import { FONT, COLORS } from '../constants/theme';

const C = COLORS;

// ─────────────────────────────────────────
// AdjustableElement: ドラッグ＆リサイズ可能なコンポーネント
// ─────────────────────────────────────────
function AdjustableElement({ 
  id, config, setConfig, isEditMode, isSelected, onSelect, children, 
  style: extraStyle
}) {
  const pan = useRef(new Animated.ValueXY({ x: config.x, y: config.y })).current;
  const isDragging = useRef(false);
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    if (!isDragging.current) {
      pan.setValue({ x: config.x, y: config.y });
    }
  }, [config.x, config.y]);

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => isEditMode,
    onMoveShouldSetPanResponder: (evt, gs) => isEditMode && (Math.abs(gs.dx) > 2 || Math.abs(gs.dy) > 2),
    onPanResponderGrant: () => {
      isDragging.current = true;
      onSelect(id);
      pan.setOffset({ x: configRef.current.x, y: configRef.current.y });
      pan.setValue({ x: 0, y: 0 });
    },
    onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
    onPanResponderRelease: (evt, gs) => {
      isDragging.current = false;
      pan.flattenOffset();
      setConfig(prev => ({
        ...prev,
        [id]: { ...prev[id], x: configRef.current.x + gs.dx, y: configRef.current.y + gs.dy }
      }));
    },
    onPanResponderTerminate: () => {
      isDragging.current = false;
      pan.flattenOffset();
    },
  })).current;

  const startScale = useRef(1);
  const resizePanResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponderCapture: () => isEditMode,
    onMoveShouldSetPanResponderCapture: () => isEditMode,
    onPanResponderGrant: () => {
      isDragging.current = true;
      onSelect(id);
      startScale.current = configRef.current.s;
    },
    onPanResponderMove: (evt, gs) => {
      const newScale = Math.max(0.1, startScale.current * (1 + gs.dx / 150));
      setConfig(prev => ({ ...prev, [id]: { ...prev[id], s: newScale } }));
    },
    onPanResponderRelease: (evt, gs) => {
      isDragging.current = false;
      const finalScale = Math.max(0.1, startScale.current * (1 + gs.dx / 150));
      setConfig(prev => ({ ...prev, [id]: { ...prev[id], s: finalScale } }));
    },
    onPanResponderTerminate: () => { isDragging.current = false; },
  })).current;

  return (
    <Animated.View 
      pointerEvents={isEditMode ? 'auto' : 'box-none'}
      style={[{ position: 'absolute', transform: pan.getTranslateTransform(), zIndex: isSelected ? 100 : 10 }, extraStyle, isEditMode && isSelected && styles.selectedBorder]} 
      {...panResponder.panHandlers}
    >
      <View pointerEvents={isEditMode ? 'none' : 'auto'}>{children}</View>
      {isEditMode && isSelected && (
        <View style={styles.resizeHandle} {...resizePanResponder.panHandlers}>
          <Text style={{ fontSize: 18, color: '#fff', fontWeight: 'bold' }}>⤡</Text>
        </View>
      )}
    </Animated.View>
  );
}

// ─────────────────────────────────────────
// HollowText: 縁取りテキスト (SVG)
// ─────────────────────────────────────────
function HollowText({ children, fontSize, strokeColor, strokeWidth = 2, style, fill = "none" }) {
  const width = fontSize * 0.8 * String(children).length + strokeWidth * 2;
  const height = fontSize * 1.2;
  return (
    <View style={[{ width, height }, style]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`}>
        <SvgText x={width / 2} y={height * 0.8} fontSize={fontSize} fontFamily={FONT.en} fill={fill} stroke={strokeColor} strokeWidth={strokeWidth} textAnchor="middle">
          {children}
        </SvgText>
      </Svg>
    </View>
  );
}

// ─────────────────────────────────────────
// MaskedGraph: 実際の学習状況を反映
// ─────────────────────────────────────────
function MaskedGraph({ stats, size = 160 }) {
  const GRAPH_PATH_D = 'M175.5 85.5C167 134.5 135.761 164.395 87.75 171C40.5 177.5 0 153 0 85.5C0 71.5 39.287 0 87.75 0C186.5 0 175.5 38.2797 175.5 85.5Z';
  
  // サーバーの stats 構造に合わせた計算
  const total    = Math.max(stats?.totalWords ?? 1, 1);
  const mature   = stats?.matureCount ?? 0;
  const learned  = stats?.learnedCount ?? 0; // 定着 + 学習中
  
  const learning = Math.max(learned - mature, 0);
  const unseen   = Math.max(total - learned, 0);

  const getCoord = (deg) => {
    const rad = (deg - 90) * (Math.PI / 180);
    return { x: 88 + 120 * Math.cos(rad), y: 86 + 120 * Math.sin(rad) };
  };

  const createSector = (startDeg, endDeg) => {
    const angle = endDeg - startDeg;
    if (angle >= 360) return "M88,86 m-120,0 a120,120 0 1,0 240,0 a120,120 0 1,0 -240,0";
    if (angle <= 0) return "";
    const p1 = getCoord(startDeg);
    const p2 = getCoord(endDeg);
    const largeArc = angle > 180 ? 1 : 0;
    return `M88,86 L${p1.x},${p1.y} A120,120 0 ${largeArc},1 ${p2.x},${p2.y} Z`;
  };

  const matureDeg   = (mature / total) * 360;
  const learningDeg = (learning / total) * 360;

  return (
    <View style={{ width: size, height: size * (172/176) }}>
      <Svg width="100%" height="100%" viewBox="0 0 176 172">
        <Defs>
          <Pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><Rect width="3" height="8" fill={C.green} /></Pattern>
          <Pattern id="dots" width="10" height="10" patternUnits="userSpaceOnUse"><Circle cx="3" cy="3" r="2.5" fill={C.green} /></Pattern>
          <ClipPath id="graphClip"><Path d={GRAPH_PATH_D} /></ClipPath>
        </Defs>
        <Path d={GRAPH_PATH_D} fill={C.purple} />
        <G clipPath="url(#graphClip)">
          {/* 定着 */}
          <Path d={createSector(0, matureDeg)} fill="url(#hatch)" />
          {/* 学習中 */}
          <Path d={createSector(matureDeg, matureDeg + learningDeg)} fill="url(#dots)" />
          {/* 未学習 */}
          <Path d={createSector(matureDeg + learningDeg, 360)} fill="rgba(112, 255, 112, 0.1)" />
        </G>
      </Svg>
    </View>
  );
}

// ─────────────────────────────────────────
// HomeScreen
// ─────────────────────────────────────────
export default function HomeScreen({ onStartStudy }) {
  const { width: windowWidth } = useWindowDimensions();
  const cardWidth = Math.min(windowWidth, 500) * 0.94; 
  const [stats, setStats] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const op1 = useRef(new Animated.Value(1)).current;
  const op2 = useRef(new Animated.Value(1)).current;
  const op3 = useRef(new Animated.Value(1)).current;

  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [cfg, setConfig] = useState({
    k1:          { x: -4.005, y: 21.4968, s: 1.0 },
    numNew:      { x: 252.3437, y: 117.3829, s: 1.0 },
    numDue:      { x: 280.8281, y: 165.4687, s: 1.0 },
    chara:       { x: 3.8425, y: 149.2968, s: 190 },
    k2:          { x: 193.5, y: 248.6, s: 155 },
    streak:      { x: 193.3701, y: 239.0031, s: 1.0 },
    k3:          { x: 2.21, y: 338, s: 1.0 },
    pct:         { x: 60.5625, y: 360.4468, s: 1.0 },
    graph:       { x: 155.125, y: 390.6281, s: 1.0 },
  });

  useEffect(() => {
    fetchStats().then(d => {
      console.log('STATS_RECEIVED:', d.stats); // 0%問題をデバッグ
      setStats(d.stats);
    }).finally(() => setIsLoading(false));
  }, []);

  const onPressIn = (op) => {
    if (isEditMode) return;
    Animated.timing(op, { toValue: 0.5, duration: 80, useNativeDriver: true }).start();
  };
  const onPressOut = (op, action) => {
    if (isEditMode) return;
    Animated.timing(op, { toValue: 1, duration: 150, useNativeDriver: true }).start(() => action && action());
  };

  if (isLoading) return (
    <View style={styles.loadingRoot}>
      <Text style={styles.loadingLogo}>ipop</Text>
      <View style={styles.loadingChara}><Chara width={160} height={160} /></View>
      <ActivityIndicator color={C.green} size="small" style={{ marginTop: 40 }} />
    </View>
  );

  // 「学習済み」＝ サーバーの learnedCount (定着 + 学習中)
  const masteryRate = stats ? Math.round((stats.learnedCount / Math.max(stats.totalWords, 1)) * 100) : 0;

  return (
    <SafeAreaView style={styles.outer}>
      <ScrollView scrollEnabled={!isEditMode} style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center', paddingBottom: 100 }}>
        <View style={{ width: cardWidth, height: 850 }}>
          
          {/* グループ3: 進捗 (背面) */}
          <Animated.View pointerEvents="box-none" style={[styles.abs, { opacity: op3, zIndex: 10 }]}>
            <AdjustableElement id="k3" config={cfg.k3} setConfig={setConfig} isEditMode={isEditMode} isSelected={selectedId === 'k3'} onSelect={setSelectedId}>
              <Pressable onPressIn={() => onPressIn(op3)} onPressOut={() => onPressOut(op3)} disabled={isEditMode}>
                <Katati3 width={cardWidth * cfg.k3.s} height={cardWidth * cfg.k3.s * (238/345)} />
              </Pressable>
            </AdjustableElement>
            <AdjustableElement id="pct" config={cfg.pct} setConfig={setConfig} isEditMode={isEditMode} isSelected={selectedId === 'pct'} onSelect={setSelectedId}>
              <Pressable onPressIn={() => onPressIn(op3)} onPressOut={() => onPressOut(op3)} disabled={isEditMode}>
                <View style={{ alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                    <Text style={[styles.progressPct, { fontSize: 64 * cfg.pct.s }]}>{masteryRate}</Text>
                    <Text style={[styles.progressPct, { fontSize: 64 * 0.37 * cfg.pct.s, marginLeft: 2 }]}>%</Text>
                  </View>
                  <Text style={[styles.progressLab, { fontSize: 18 * cfg.pct.s, marginTop: -5 * cfg.pct.s }]}>学習済み</Text>
                </View>
              </Pressable>
            </AdjustableElement>
            <AdjustableElement id="graph" config={cfg.graph} setConfig={setConfig} isEditMode={isEditMode} isSelected={selectedId === 'graph'} onSelect={setSelectedId}>
              <Pressable onPressIn={() => onPressIn(op3)} onPressOut={() => onPressOut(op3)} disabled={isEditMode}>
                <MaskedGraph stats={stats} size={cardWidth * 0.54 * cfg.graph.s} />
              </Pressable>
            </AdjustableElement>
          </Animated.View>

          {/* キャラクター */}
          <AdjustableElement id="chara" config={cfg.chara} setConfig={setConfig} isEditMode={isEditMode} isSelected={selectedId === 'chara'} onSelect={setSelectedId}>
            <Chara width={cfg.chara.s} height={cfg.chara.s} />
          </AdjustableElement>

          {/* グループ2: ストリーク */}
          <Animated.View pointerEvents="box-none" style={[styles.abs, { opacity: op2, zIndex: 20 }]}>
            <AdjustableElement id="k2" config={cfg.k2} setConfig={setConfig} isEditMode={isEditMode} isSelected={selectedId === 'k2'} onSelect={setSelectedId}>
              <Pressable onPressIn={() => onPressIn(op2)} onPressOut={() => onPressOut(op2)} disabled={isEditMode}>
                <Katati2 width={cfg.k2.s} height={cfg.k2.s * (147/175)} />
              </Pressable>
            </AdjustableElement>
            <AdjustableElement id="streak" config={cfg.streak} setConfig={setConfig} isEditMode={isEditMode} isSelected={selectedId === 'streak'} onSelect={setSelectedId}>
              <Pressable onPressIn={() => onPressIn(op2)} onPressOut={() => onPressOut(op2)} disabled={isEditMode}>
                <View style={[styles.streakInner, { width: cfg.k2.s, height: cfg.k2.s * (147/175), flexDirection: 'row', alignItems: 'center' }]}>
                  <Text style={{ fontSize: 24 * cfg.streak.s, marginRight: 6 }}>🔥</Text>
                  <View style={{ alignItems: 'center' }}>
                    <Text style={[styles.streakNum, { fontSize: 52 * cfg.streak.s, color: C.green }]}>{stats?.streak ?? 23}</Text>
                    <Text style={[styles.streakLab, { fontSize: 16 * cfg.streak.s, color: C.green }]}>日連続！</Text>
                  </View>
                </View>
              </Pressable>
            </AdjustableElement>
          </Animated.View>

          {/* グループ1: メイン (最前面) */}
          <Animated.View pointerEvents="box-none" style={[styles.abs, { opacity: op1, zIndex: 30 }]}>
            <AdjustableElement id="k1" config={cfg.k1} setConfig={setConfig} isEditMode={isEditMode} isSelected={selectedId === 'k1'} onSelect={setSelectedId}>
              <Pressable onPressIn={() => onPressIn(op1)} onPressOut={() => onPressOut(op1, onStartStudy)} disabled={isEditMode}>
                <Katati1 width={cardWidth * cfg.k1.s} height={cardWidth * cfg.k1.s * (245/369)} />
              </Pressable>
            </AdjustableElement>
            <AdjustableElement id="numNew" config={cfg.numNew} setConfig={setConfig} isEditMode={isEditMode} isSelected={selectedId === 'numNew'} onSelect={setSelectedId}>
              <Pressable onPressIn={() => onPressIn(op1)} onPressOut={() => onPressOut(op1, onStartStudy)} disabled={isEditMode}>
                <HollowText fontSize={52 * cfg.numNew.s} strokeColor={C.bg} strokeWidth={2.2}>{stats?.newCount ?? 5}</HollowText>
              </Pressable>
            </AdjustableElement>
            <AdjustableElement id="numDue" config={cfg.numDue} setConfig={setConfig} isEditMode={isEditMode} isSelected={selectedId === 'numDue'} onSelect={setSelectedId}>
              <Pressable onPressIn={() => onPressIn(op1)} onPressOut={() => onPressOut(op1, onStartStudy)} disabled={isEditMode}>
                <Text style={[styles.pillNumSolid, { fontSize: 52 * cfg.numDue.s }]}>{stats?.dueCount ?? 2}</Text>
              </Pressable>
            </AdjustableElement>
          </Animated.View>

        </View>
      </ScrollView>

      <View style={{ position: 'absolute', bottom: 20, right: 20, zIndex: 200, flexDirection: 'row', gap: 10 }}>
        {isEditMode && (
          <TouchableOpacity style={{ backgroundColor: COLORS.purple, padding: 12, borderRadius: 30 }} onPress={() => console.log('FINAL_CONFIG:', JSON.stringify(cfg, null, 2))}>
            <Text style={{ fontSize: 12, color: '#fff' }}>Config出力</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={{ backgroundColor: isEditMode ? COLORS.green : '#fff', padding: 12, borderRadius: 30 }} onPress={() => { setIsEditMode(!isEditMode); setSelectedId(null); }}>
          <Text style={{ fontSize: 12, color: isEditMode ? '#fff' : '#000' }}>{isEditMode ? '編集終了' : 'UI調整器'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, backgroundColor: C.bg },
  abs: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  loadingRoot: { flex: 1, backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' },
  loadingLogo: { color: C.green, fontSize: 72, fontFamily: FONT.en, marginBottom: 20 },
  loadingChara: { transform: [{ scale: 1.1 }] },
  selectedBorder: { borderWidth: 1, borderColor: COLORS.green, borderStyle: 'dashed' },
  resizeHandle: { position: 'absolute', right: -15, bottom: -15, width: 30, height: 30, backgroundColor: COLORS.green, borderRadius: 15, justifyContent: 'center', alignItems: 'center', zIndex: 200 },
  streakInner: { alignItems: 'center', justifyContent: 'center', paddingTop: 10 },
  streakNum: { color: C.bg, ...FONT.enVar, marginTop: -5 },
  streakLab: { color: C.bg, fontFamily: FONT.jpBd, marginTop: -8 },
  pillNumSolid: { color: C.bg, ...FONT.enVar },
  progressPct: { color: C.dark, ...FONT.enVar },
  progressLab: { color: C.dark, fontFamily: FONT.jpBd },
});
