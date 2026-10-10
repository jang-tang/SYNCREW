// 로컬 개발용 Postgres를 실행한다 (Docker 없이 프로젝트 내부 바이너리 사용).
// DATABASE_URL 의 사용자·비밀번호·포트·DB 이름으로 클러스터를 만들고, Ctrl+C로 종료한다.
import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  console.error("DATABASE_URL이 없습니다. .env.example을 .env로 복사하세요.");
  process.exit(1);
}

const url = new URL(databaseUrl);
const databaseName = url.pathname.replace(/^\//, "");
const databaseDir = path.resolve(".pgdata");

const pg = new EmbeddedPostgres({
  databaseDir,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  port: Number(url.port || 5432),
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

async function main() {
  if (!existsSync(path.join(databaseDir, "PG_VERSION"))) {
    console.log(`Postgres 데이터 디렉터리 생성: ${databaseDir}`);
    await pg.initialise();
  }
  await pg.start();

  const client = pg.getPgClient("postgres", url.hostname);
  await client.connect();
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
  await client.end();
  if (exists.rowCount === 0) {
    await pg.createDatabase(databaseName);
    console.log(`데이터베이스 생성: ${databaseName}`);
  }

  console.log(`Postgres 실행 중: ${url.hostname}:${url.port}/${databaseName} (종료: Ctrl+C)`);
}

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

main().catch(async (error) => {
  console.error("Postgres 실행 실패:", error);
  await pg.stop().catch(() => undefined);
  process.exit(1);
});
