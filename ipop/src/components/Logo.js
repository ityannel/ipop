import React from 'react';
import { View } from 'react-native';
import Svg, { Text as SvgText, Defs, LinearGradient, Stop } from 'react-native-svg';
import { FONT, COLORS } from '../constants/theme';

export default function Logo({ width = 200, height = 80 }) {
  return (
    <View style={{ width, height }}>
      <Svg width="100%" height="100%" viewBox="0 0 200 80">
        <Defs>
          <LinearGradient id="logoGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={COLORS.green} />
            <Stop offset="100%" stopColor={COLORS.accent} />
          </LinearGradient>
        </Defs>
        <SvgText
          x="100"
          y="60"
          fontSize="72"
          fontFamily={FONT.en}
          fill="url(#logoGrad)"
          textAnchor="middle"
          fontWeight="bold"
        >
          ipop
        </SvgText>
      </Svg>
    </View>
  );
}
