// ─────────────────────────────────────────────────────────────
// 현장 데이터셋 연결 지점
//
// 방법 1) 정규화 JSON 제공: DATASET_ADAPTER=normalized-json, DATASET_PATH=<파일 경로>
//         형식은 src/engine/dataset/normalizedJsonAdapter.ts 의 normalizedDatasetSchema
// 방법 2) 원본 형식을 그대로 읽는 어댑터를 새로 만들어 아래 ADAPTERS 에 등록
// ─────────────────────────────────────────────────────────────
import path from "node:path";
import { LegacyWorkplaceAdapter } from "../engine/dataset/legacyWorkplaceAdapter";
import { NormalizedJsonAdapter } from "../engine/dataset/normalizedJsonAdapter";
import type { DatasetAdapter } from "../engine/dataset/types";

const ADAPTERS: Record<string, (datasetPath: string) => DatasetAdapter> = {
  "legacy-workplace": (datasetPath) => new LegacyWorkplaceAdapter(datasetPath),
  "normalized-json": (datasetPath) => new NormalizedJsonAdapter(datasetPath),
};

export function createDatasetAdapter(name: string, datasetPath: string): DatasetAdapter {
  const factory = ADAPTERS[name];
  if (!factory) {
    throw new Error(`알 수 없는 DATASET_ADAPTER: ${name}. 사용 가능: ${Object.keys(ADAPTERS).join(", ")}`);
  }
  return factory(path.resolve(datasetPath));
}
