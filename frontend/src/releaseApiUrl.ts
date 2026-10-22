/**
 * 릴리스 빌드(live 모드)가 서버 주소로 써도 되는 주소인지.
 * 이 주소로 Supabase 로그인 토큰(Authorization 헤더·Socket.IO 인증), 마이크 음성(stream:audio), 서명된 음성 주소가 오가므로
 * 네트워크를 지나는 주소는 https 만 허용한다. http 는 기기 밖으로 나가지 않는 루프백만 허용한다:
 * localhost·127.0.0.1·[::1] (웹 e2e 빌드 `bundle:web:live` 의 http://localhost:8767, Android `adb reverse` 의 http://localhost:4000).
 * Android 에뮬레이터 주소 10.0.2.2 는 허용하지 않는다 — 실제 휴대폰에서는 접속한 네트워크의 평범한 사설 주소다.
 * 개발 빌드(__DEV__)는 이 검사를 하지 않는다 (config.ts).
 */
export function isAllowedReleaseApiUrl(url: string): boolean {
  if (/^https:\/\//.test(url)) return true;
  // 호스트 바로 뒤는 포트·경로·끝만 (사용자 정보 "@"·역슬래시로 실제로는 다른 호스트에 붙는 주소는 거부)
  return /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?(\/[^\\@]*)?$/.test(url);
}
