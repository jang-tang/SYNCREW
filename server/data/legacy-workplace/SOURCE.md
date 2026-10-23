# 출처

기존 저장소 데이터셋의 원본 복사본입니다. 내용과 형식을 수정하지 않았습니다.

- 저장소: https://github.com/jecool0523/workplace-translation-mvp
- 커밋: bf43241c3ce5a7495781f329bcf6f94dbe4ba2ac (2026-07-05)
- 원본 경로: `data/workplace-translation-mvp/`
- 상태: 모든 항목이 원어민·현장 검수 전(seed) 데이터입니다.

`LegacyWorkplaceAdapter`가 이 형식을 읽습니다. 데이터셋을 교체하려면
`DATASET_ADAPTER=normalized-json`과 정규화 JSON 파일을 사용하거나 새 어댑터를 추가하세요.

## 보충 데이터 (`supplement/`, 2026-10-23 추가 — 원본 아님)

위 원본 파일은 그대로 두고, 우리가 만든 보충 파일을 `supplement/` 에 둔다. `LegacyWorkplaceAdapter` 가 함께 읽는다 (없으면 건너뜀).

- `kosha_slang.json`: 안전보건공단 「산업현장 및 법률 용어 유의어 사전」(공공데이터포털 15161288, 이용 제한 없음)의 건설 은어 210개 → 표준 한국어. `server/scripts/build-kosha-slang.ts` 로 다시 만든다. 데스라·아나방은 원본 seed 대신 이 파일 기준
- `moel_safety_signs_2025.json`: 고용노동부·국토교통부 다국어 안전표지(2025-10-10) 검증 문장 19개 ko·vi·zh·uz (이용 확인받음)

상세: `docs/field-terms.md` 7절
