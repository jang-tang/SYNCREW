import { readFile } from "node:fs/promises";
import { z } from "zod";
import { LANG_CODES, type Lang } from "../../shared/languages";
import type { Dataset, DatasetAdapter } from "./types";

const langSchema = z.enum(LANG_CODES as [Lang, ...Lang[]]);
const translationsSchema = z.partialRecord(langSchema, z.string().min(1));

/** 새 데이터셋 제공자가 따르면 되는 JSON 형식. */
export const normalizedDatasetSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  lexicon: z.array(
    z.object({
      id: z.string().min(1),
      lang: langSchema,
      canonical: z.string().min(1),
      variants: z.array(z.string()).default([]),
      asrCorrections: z.array(z.string()).default([]),
      translations: translationsSchema.default({}),
      meaning: z.string().optional(),
      standardKo: z.string().min(1).optional(),
      rule: z.string().optional(),
      risk: z.enum(["critical", "high", "normal"]).optional(),
      core: z.boolean().optional(),
      domain: z.string().optional(),
    }),
  ),
  phrases: z
    .array(
      z.object({
        id: z.string().min(1),
        lang: langSchema,
        text: z.string().min(1),
        translations: translationsSchema,
      }),
    )
    .default([]),
});

/** `DATASET_PATH`가 가리키는 정규화 JSON 파일 하나를 읽는다. */
export class NormalizedJsonAdapter implements DatasetAdapter {
  readonly name = "normalized-json";

  constructor(private readonly filePath: string) {}

  async load(): Promise<Dataset> {
    const raw = JSON.parse(await readFile(this.filePath, "utf8"));
    return normalizedDatasetSchema.parse(raw);
  }
}
