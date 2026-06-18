import * as fs from "node:fs";
import * as path from "node:path";
import { cfg} from "./appconfig";
import pino from "pino";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";

const ENDPOINT = "https://api.gptsapi.net/api/v3/openai/gpt-image-2/text-to-image";

function ensureDir(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
}

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

export async function text2image() {
    const runId = `${Date.now()}`;
    const logsDir = path.resolve(process.cwd(), "http-logs", runId);
    ensureDir(logsDir);

    const logger = pino(
        { level: "info" },
        pino.destination(path.join(logsDir, "run.log"))
    );

    logger.info({ runId,cfg }, "start");

    // 1.1 构造请求体
    const taskReqBody = {
        resolution: "1K",
        prompt: cfg.prompt,
        aspect_ratio: "9:16",
        output_format: "png",
    };

    logger.info({ taskReqBody: taskReqBody }, "create task request");
    // 1.2 发送任务请求
    const taskResponse = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${cfg.apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(taskReqBody),
    });

    // 1.3 等待任务请求
    const taskResponseBody = await taskResponse.json().catch(() => "");
    logger.info({ taskResponseBody }, "task response");

    if (!taskResponse.ok) {
        throw new Error(`HTTP ${taskResponse.status} ${taskResponse.statusText}\n${JSON.stringify(taskResponseBody)}`);
    }

    // 2.2 result的响应
    const resultUrl: string = taskResponseBody!.data!.urls!.get!;

    // 2.3 轮询等待图片生成
    for (let i = 0; i < 60; i++) {
        const resultResponse = await fetch(resultUrl, {
            method: "GET",
            headers: { Authorization: `Bearer ${cfg.apiKey}` },
        });

        if (!resultResponse.ok) {
            logger.error({
                poll: i,
                errorMessage: resultResponse.text()
            }, "result response error");
            throw new Error(`Result HTTP ${resultResponse.status} ${resultResponse.statusText}`);
        }

        const resultJson = await resultResponse.json().catch(() => "");
        const status: string | undefined = resultJson?.data?.status;
        logger.info({
            poll: i,
            status,
            jsonText: JSON.stringify(resultJson)
        }, "result response ");

        // 2.3.1 等到processing 完成，图片的路径出来
        if (status === "processing") {
            console.log(`poll: ${i}, status: ${status}\n jsonText: ${JSON.stringify(resultJson)}`);
            console.log(`polling again in 10s...\n`);
            await sleep(10_000);
            continue;
        } else if (status === "succeeded" || status === "success" || status === "completed") {
            const imgUrl: string = resultJson?.data?.outputs?.[0];
            const imagePath = path.join(logsDir, `image_${runId}.png`);
            const res = await fetch(imgUrl);
            if (!res.ok || !res.body) {
                logger.error({ res, status: res.status, statusTest: res.statusText }, "download image failed");
                throw new Error(`Failed to download: ${res.status} ${res.statusText}`);
            }
            await pipeline(res.body as any, createWriteStream(imagePath));
            console.log("image saved to:", imagePath);
            return;
        } else if (status === "failed") {
            throw new Error("Generation failed");
        }
    }
    // 超时
    throw new Error("Timed out waiting for result");
}