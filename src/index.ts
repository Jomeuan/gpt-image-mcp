import { text2Image, rerunText2Image } from "./text2image";

async function main() {
  const args: { runId?: string } = {};
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--runId=")) args.runId = a.slice("--runId=".length);
    else if (!a.startsWith("--") && !args.runId) args.runId = a;
  }

  if (args.runId) {
    await rerunText2Image(args.runId);
    return;
  } else {
    await text2Image();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});