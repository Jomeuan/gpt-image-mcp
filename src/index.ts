import { reuseRunId } from "./run-reuse";
import { text2image } from "./text2image";

async function main() {
  const args: { runId?: string } = {};
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--runId=")) args.runId = a.slice("--runId=".length);
    else if (!a.startsWith("--") && !args.runId) args.runId = a;
  }

  if (args.runId) {
    await reuseRunId(args.runId);
    return;
  }

  await text2image();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});