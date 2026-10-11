// ─────────────────────────────────────────────────────────────
// 단말 노이즈 필터 연결 지점 (docs/architecture.md 5절)
//
// 딥러닝 노이즈 필터를 휴대폰에서 실행하기로 하면, 이 함수가 녹음 파일을 받아
// 필터를 거친 새 파일 경로를 돌려주도록 바꾸면 된다. 기본값은 그대로 반환.
// 서버에서 실행한다면 server/src/plugins/audioPreprocessor.ts 를 사용한다.
// ─────────────────────────────────────────────────────────────
export async function preprocessRecording(fileUri: string): Promise<string> {
  return fileUri;
}
