import { Redirect } from "expo-router";

// 1:1 통역 통화 화면 → C2 "연결" 방식(2026-10-26)부터는 멤버 화면의 연결 패널에서 한다 (사람을 누르면 바로 연결·전환).
// 음성은 앱 전체의 ConnectionProvider 가 맡는다. 예전 주소(알림·배너·딥링크)로 들어오면 연결 화면으로 보낸다.
export default function CallScreen() {
  return <Redirect href="/site" />;
}
