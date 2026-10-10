import { PlaceholderScreen } from "@/components/PlaceholderScreen";

export default function MembersScreen() {
  return (
    <PlaceholderScreen
      phase="Phase 2"
      title="멤버"
      items={["가입 요청 승인 · 거절", "멤버 언어 확인 · 수정 · 제외", "가입 코드 · QR 발급"]}
    />
  );
}
