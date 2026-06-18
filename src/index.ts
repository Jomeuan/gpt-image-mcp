import { text2Image, rerunText2Image } from "./text2image";
import { image2Image, rerunImage2Image } from "./image2image";

async function main() {
    const args: { runId?: string; mode?: "text2image" | "image2image" } = {
        mode: "text2image",
    };

    for (const a of process.argv.slice(2)) {
        if (a.startsWith("--runId=")) {
            args.runId = a.slice("--runId=".length);
        }
        else if (a.startsWith("--mode=")) {
            args.mode = a.slice("--mode=".length) as any;
        }
        else if (!a.startsWith("--") && !args.runId) {
            args.runId = a;
        }
    }

    if (args.runId && args.mode === "image2image") {
        await rerunImage2Image(args.runId);
    } else if (args.runId && args.mode === "text2image") {
        await rerunText2Image(args.runId);
    } else if (args.mode === "image2image") {
        await image2Image();
    } else if (args.mode === "text2image") {
        await text2Image();
    } else {
        console.error('error argv');
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});