import { useMemo } from "react";
import { View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { create } from "qrcode";

// QR 코드 (현장 가입 코드 화면). 2026-10-20 저사양 폰 최적화:
// react-native-qrcode-svg 는 쓰지 않는 로고 기능 때문에 react-native-svg/css(css-tree·entities, 약 200KB) 를 번들에 끌어들였다.
// 행렬은 같은 `qrcode` 로 만들고, 검은 칸을 가로줄 Path 하나로 그린다 (react-native-qrcode-svg 와 같은 방식).

export function QrCode({ value, size, color = "#000000", backgroundColor = "#FFFFFF" }: { value: string; size: number; color?: string; backgroundColor?: string }) {
  const path = useMemo(() => {
    const { modules } = create(value, { errorCorrectionLevel: "M" });
    const n = modules.size;
    const cell = size / n;
    let d = "";
    for (let row = 0; row < n; row++) {
      const y = cell * row + cell / 2;
      let drawing = false;
      for (let col = 0; col < n; col++) {
        const dark = modules.data[row * n + col];
        if (dark && !drawing) {
          d += `M${cell * col} ${y} `;
          drawing = true;
        }
        if (drawing && (!dark || col === n - 1)) {
          d += `L${cell * (dark ? col + 1 : col)} ${y} `;
          drawing = false;
        }
      }
    }
    return { d, cell };
  }, [value, size]);

  return (
    <View accessibilityRole="image" accessibilityLabel={value}>
      <Svg width={size} height={size}>
        <Rect width={size} height={size} fill={backgroundColor} />
        <Path d={path.d} stroke={color} strokeWidth={path.cell} />
      </Svg>
    </View>
  );
}
