// 통합 테스트용 임시 Postgres. 개발 DB와 분리된 포트·디렉터리를 쓰고 테스트 후 삭제한다.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import type { TestProject } from "vitest/node";

const PORT = 54331;

export default async function setup(project: TestProject) {
  const databaseDir = mkdtempSync(path.join(tmpdir(), "syncrew-test-pg-"));
  const pg = new EmbeddedPostgres({
    databaseDir,
    user: "syncrew",
    password: "syncrew",
    port: PORT,
    persistent: false,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => undefined,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("syncrew_test");

  const databaseUrl = `postgresql://syncrew:syncrew@localhost:${PORT}/syncrew_test`;
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "ignore",
  });
  project.provide("databaseUrl", databaseUrl);

  return async () => {
    await pg.stop();
    rmSync(databaseDir, { recursive: true, force: true });
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
