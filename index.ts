import * as fs from "node:fs";
import * as path from "node:path";

type AppConfig = {
  apiKey?: string;
  prompt: string;
};

function loadConfig(): AppConfig {
  const p = path.resolve(process.cwd(), "gpts.config.json");
  const raw = fs.readFileSync(p, "utf8");
  const cfg = JSON.parse(raw) as AppConfig;
  if (!cfg?.prompt) throw new Error(`Missing "prompt" in ${p}`);
  if (!cfg?.apiKey) throw new Error(`Missing API key (set GPTS_API_KEY or put "apiKey" in gpts.config.json)`);
  return cfg;
}
const cfg = loadConfig();

const API_KEY =  cfg.apiKey;

const ENDPOINT = "https://api.gptsapi.net/api/v3/openai/gpt-image-2-plus/text-to-image";


function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ====================
function saveImage(buf: Buffer, contentType: string) {
  const outDir = path.resolve(process.cwd(), "images");
  fs.mkdirSync(outDir, { recursive: true });

  const ext =
    contentType.includes("png") ? "png" :
      contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" :
        "bin";

  const outPath = path.join(outDir, `gpt-image-2-plus-${Date.now()}.${ext}`);
  fs.writeFileSync(outPath, buf);
  console.log("saved:", outPath);
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function saveText(outDir: string, filename: string, text: string) {
  ensureDir(outDir);
  const p = path.join(outDir, filename);
  fs.writeFileSync(p, text, "utf8");
}

function saveBin(outDir: string, filename: string, buf: Buffer) {
  ensureDir(outDir);
  const p = path.join(outDir, filename);
  fs.writeFileSync(p, buf);
  console.log("saved:", p);
}

// =========================================================


function tryReadText(p: string) {
  try { return fs.readFileSync(p, "utf8"); } catch { return ""; }
}

function extractResultUrlFromCreateResponse(createResText: string): string | undefined {
  const created: any = (() => {
    try { return JSON.parse(createResText); } catch { return null; }
  })();
  return created?.data?.urls?.get ?? created?.urls?.get;
}

function loadResultUrlFromLogs(logsDir: string): string | undefined {
  // 优先读专门保存的 resultUrl
  const p1 = path.join(logsDir, "02-result-url.txt");
  const t1 = tryReadText(p1).trim();
  if (t1) return t1;

  // 兜底：从创建响应里解析
  const p2 = path.join(logsDir, "01-create-response.txt");
  const t2 = tryReadText(p2);
  const u = extractResultUrlFromCreateResponse(t2);
  return u;
}

async function saveImageFromURL(logsDir: string, resultUrl: string) {
    const r: any = await fetch(resultUrl, { headers: { Authorization: `Bearer ${API_KEY}` } });
    const j = await r.json().catch(() => "");
    const outputs = j?.data?.outputs ?? j?.outputs ?? [];
    //  outputs[0] 直接是图片URL字符串
    const b64: string | undefined = outputs?.[0];
    console.log("base 64 preview ", b64?.slice(0, 30) + "...");

    if (b64 && typeof b64 === "string") {
      const buf = Buffer.from(b64, "base64");
      // 保存 base64 解码后的响应体（二进制）
      saveBin(logsDir, `final-image-from-base64.png`, buf);
      saveImage(buf, "image/png");
      return;
    }
}

// =========================================================
async function main() {
  const args: { runId?: string } = {};
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--runId=")) args.runId = a.slice("--runId=".length);
    else if (!a.startsWith("--") && !args.runId) args.runId = a;
  }
  let resultUrl: string | undefined;
  if (args.runId) {
    // ===== 新增：传入 runId 时复用旧任务，直接从日志找 resultUrl 并继续生成/下载图片 =====
    const runId = args.runId ?? `${Date.now()}`;
    const logsDir = path.resolve(process.cwd(), "http-logs", runId);
    resultUrl = loadResultUrlFromLogs(logsDir);
    if (!resultUrl) throw new Error(`No resultUrl found under: ${logsDir}`);
    console.log("reuse runId:", runId, "resultUrl:", resultUrl);
    // 从url读出图片
    await saveImageFromURL(logsDir, resultUrl);
  } else {
    await generateImage();
  }

}
async function generateImage() {
  const runId = `${Date.now()}`;
  const logsDir = path.resolve(process.cwd(), "http-logs", runId);

  const createReqBody = {
    quality: 'low',
    //prompt: "生成一张哥特女青年的自拍照",
    prompt: cfg.prompt,
    aspect_ratio: "16:9",
    output_format: "png",
  };

  // 保存创建任务请求体
  saveText(logsDir, `00-create-request.json`, JSON.stringify(createReqBody, null, 2));

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(createReqBody)
  });

  // 保存创建任务响应体（先读 text，后续再 JSON.parse）
  const createResText = await res.text().catch(() => "");
  saveText(logsDir, `01-create-response.txt`, createResText);

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}\n${createResText}`);
  }

  const created: any = (() => {
    try { return JSON.parse(createResText); } catch { return null; }
  })();

  // 这里返回的是任务信息（含 result 查询地址），不是图片二进制
  const resultUrl: string | undefined =
    created?.data?.urls?.get ?? created?.urls?.get;

  if (!resultUrl) throw new Error(`Missing result url: ${JSON.stringify(created)}`);

  // 轮询结果
  for (let i = 0; i < 60; i++) {
    const r = await fetch(resultUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${API_KEY}` },
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      saveText(logsDir, `poll-${String(i).padStart(2, "0")}-error.txt`, errText);
      throw new Error(`Result HTTP ${r.status} ${r.statusText}\n${errText}`);
    }

    // result 返回 JSON（包含状态/图片URL/base64 等）
    const jsonText = await r.json().catch(() => "");
    const status: string | undefined = jsonText?.data?.status ;

    if (status === "created" || status === "queued" || status === "processing" || status === "running") {
      console.log(`Status: ${status} , jsonText: ${jsonText}, polling again in 1s...`);
      await sleep(1000);
      continue;
    } else if (status === "succeeded" || status === "success" || status === "completed") {
      saveText(logsDir, `poll-${String(i).padStart(2, "0")}-response.txt`, jsonText);

      //  outputs[0] 直接是图片URL字符串
      const b64: string | undefined = jsonText?.data?.outputs?.[0];
      console.log("base 64 preview ", b64?.slice(0, 30) + "...");
      if (b64 && typeof b64 === "string") {
        const buf = Buffer.from(b64, "base64");
        // 保存 base64 解码后的响应体（二进制）
        saveBin(logsDir, `final-image-from-base64.png`, buf);
        saveImage(buf, "image/png");
        return;
      }
      throw new Error(`Succeeded but no image payload`);

    } else if (status === "failed" || status === "error") {
      saveText(logsDir, `poll-${String(i).padStart(2, "0")}-response.txt`, jsonText);
      throw new Error(`Generation failed`);
    }
  }

  throw new Error("Timed out waiting for result");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

