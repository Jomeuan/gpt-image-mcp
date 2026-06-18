import * as fs from "node:fs";
import * as path from "node:path";
import { cfg } from "./appconfig";
import pino from "pino";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { getLogDir, getLogger } from "./util";

const ENDPOINT =
    "https://api.gptsapi.net/api/v3/openai/gpt-image-2/image-edit";

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

export async function image2Image() {
    const runId = `${Date.now()}`;
    const logger = getLogger(runId);

    // 1) 构造请求体
    const taskReqBody = {
        prompt: cfg.imagePrompt!,
        input_urls: cfg.imageInputUrls!,
       // resolution: "1K",
       // output_format: "png",
    };

    logger.info({ runId, taskReqBody }, "start image2image");

    // 2) 发起 task
    const taskResponse = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${cfg.apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(taskReqBody),
    });

    const taskResponseBody = await taskResponse.json().catch(() => "");
    logger.info({ taskResponseBody }, "task response");

    if (!taskResponse.ok) {
        throw new Error(
            `HTTP ${taskResponse.status} ${taskResponse.statusText}\n${JSON.stringify(
                taskResponseBody
            )}`
        );
    }

    // 3) 从 task 响应取 resultUrl
    const resultUrl: string = taskResponseBody?.data?.urls?.get;
    if (!resultUrl) {
        throw new Error(
            `resultUrl not found in task response: ${JSON.stringify(taskResponseBody)}`
        );
    }

    // 4) 轮询 resultUrl 拿 imgUrl
    for (let i = 0; i < 60; i++) {
        const { status, resultJson, imgUrl } = await getImgUrlFromResultUrl(
            resultUrl,
            runId
        );

        logger.info(
            { poll: i, status, jsonText: JSON.stringify(resultJson) },
            "result response "
        );

        if (status === "processing") {
            console.log(`poll: ${i}, status: ${status}\n jsonText: ${JSON.stringify(resultJson)}`);
            console.log(`polling again in 10s...\n`);
            await sleep(10_000);
            continue;
        } else if (status === "succeeded" || status === "success" || status === "completed") {
            if (!imgUrl) throw new Error("imgUrl missing in succeeded result");
            await downloadImageFromImgUrl(imgUrl, runId);
            return;
        } else if (status === "failed") {
            throw new Error(`Generation failed: ${resultJson?.error ?? ""}`);
        }
    }

    throw new Error("Timed out waiting for result");
}

export async function rerunImage2Image(runId: string) {
    const logsDir = path.resolve(process.cwd(), "http-logs", runId);

    const logPath = path.join(logsDir, "run.log");
    if (!fs.existsSync(logPath)) {
        throw new Error(`run.log not found: ${logPath}`);
    }

    // 保持与 text2image 一致：读 log 找最后一次 resultUrl
    const logger = pino(
        { level: "info" },
        pino.destination(path.join(logsDir, "run.log"))
    );

    const logText = fs.readFileSync(logPath, "utf8");
    const lines = logText.split(/\r?\n/).filter(Boolean);

    let resultUrl: string | undefined;

    for (const line of lines) {
        let obj = JSON.parse(line);

        if (obj?.msg === "result response ") {
            const parsed = JSON.parse(obj.jsonText);
            const url = parsed?.data?.urls?.get ?? parsed?.urls?.get;
            if (url) resultUrl = url;
        }
    }

    logger.info({ resultUrl }, "rerun image2image");

    if (!resultUrl) {
        throw new Error("resultUrl not found in run.log (no urls.get in result response jsonText)");
    }

    const { status, resultJson, imgUrl } = await getImgUrlFromResultUrl(resultUrl, runId);

    if (status === "completed") {
        if (!imgUrl) throw new Error("imgUrl missing in succeeded result");
        await downloadImageFromImgUrl(imgUrl, runId);
    } else {
        throw new Error(`rerun image2image failed: status=${status} json=${JSON.stringify(resultJson)}`);
    }

}

async function downloadImageFromImgUrl(imgUrl: string, runId: string) {
    const logger = getLogger(runId);
    const imagePath = path.join(getLogDir(runId), `image2image_${runId}.png`);

    const imageResponse = await fetch(imgUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
    });

    if (!imageResponse.ok || !imageResponse.body) {
        logger.error(
            {
                imgUrl,
                status: imageResponse.status,
                statusText: imageResponse.statusText,
            },
            "download image failed"
        );
        throw new Error(
            `Failed to download: ${imageResponse.status} ${imageResponse.statusText}`
        );
    }

    await pipeline(imageResponse.body as any, createWriteStream(imagePath));
    console.log("image saved to:", imagePath);
}

async function getImgUrlFromResultUrl(resultUrl: string, runId: string) {
    const logger = getLogger(runId);

    const resultResponse = await fetch(resultUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
    });

    if (!resultResponse.ok) {
        logger.error({ resultUrl }, "result response error");
        throw new Error(
            `Result HTTP ${resultResponse.status} ${resultResponse.statusText}`
        );
    }

    const resultJson = await resultResponse.json().catch(() => "");
    const status: string = resultJson?.data?.status;
    const imgUrl: string | undefined = resultJson?.data?.outputs?.[0];

    return { status, resultJson, imgUrl };
}