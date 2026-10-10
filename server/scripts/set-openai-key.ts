// OpenAI API 키를 입력받아 .env 의 OPENAI_API_KEY 에 저장한다. 입력 내용은 화면에 표시하지 않는다.
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import readline from "node:readline";

const ENV_FILE = ".env";

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const output = process.stdout;
    const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
    const writeOriginal = output.write.bind(output);
    let muted = false;
    // 질문 출력 후에는 입력 문자를 화면에 쓰지 않는다.
    (output as { write: typeof output.write }).write = ((chunk: string | Uint8Array, ...rest: never[]) =>
      muted ? true : writeOriginal(chunk, ...rest)) as typeof output.write;
    rl.question(question, (answer) => {
      output.write = writeOriginal;
      output.write("\n");
      rl.close();
      resolve(answer.trim());
    });
    muted = true;
  });
}

async function main() {
  if (!existsSync(ENV_FILE)) {
    copyFileSync(".env.example", ENV_FILE);
    console.log(".env 파일을 .env.example에서 만들었습니다.");
  }

  const key = await promptHidden("OpenAI API 키를 입력하세요 (비우면 삭제): ");
  if (key && !key.startsWith("sk-")) {
    console.warn("경고: 일반적인 OpenAI 키 형식(sk-...)이 아닙니다. 그대로 저장합니다.");
  }

  const lines = readFileSync(ENV_FILE, "utf8").split("\n");
  const index = lines.findIndex((line) => line.startsWith("OPENAI_API_KEY="));
  const entry = `OPENAI_API_KEY=${key}`;
  if (index === -1) lines.push(entry);
  else lines[index] = entry;
  writeFileSync(ENV_FILE, lines.join("\n"));
  // API 키가 들어 있으므로 본인만 읽을 수 있게 한다.
  chmodSync(ENV_FILE, 0o600);

  console.log(key ? "OPENAI_API_KEY를 저장했습니다. 서버를 다시 시작하세요." : "OPENAI_API_KEY를 비웠습니다.");
}

main();
