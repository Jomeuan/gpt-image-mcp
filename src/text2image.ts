import * as fs from "node:fs";
import * as path from "node:path";
import { cfg } from "./appconfig";
import pino from "pino";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { getLogDir, getLogger } from "./util";

const ENDPOINT = "https://api.gptsapi.net/api/v3/openai/gpt-image-2/text-to-image";

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

export async function text2Image() {
    const runId = `${Date.now()}`;
    const logger = getLogger(runId);

    logger.info({ runId, prompts: cfg.prompts }, "start");

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

        const { status, resultJson, imgUrl } = await getImgUrlFromResultUrl(resultUrl, runId);

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
            downloadImageFromImgUrl(imgUrl!, runId);
            return;
        } else if (status === "failed") {
            console.log(`poll: ${i}, status: ${status}\n jsonText: ${JSON.stringify(resultJson)}`);
            console.error(`error message:${resultJson?.error}`)
            throw new Error("Generation failed ");
        }
    }
    // 超时
    throw new Error("Timed out waiting for result");
}

export async function rerunText2Image(runId: string) {
    const logsDir = path.resolve(process.cwd(), "http-logs", runId);

    const logPath = path.join(logsDir, "run.log");
    if (!fs.existsSync(logPath)) {
        throw new Error(`run.log not found: ${logPath}`);
    }

    const logger = pino(
        { level: "info" },
        pino.destination(path.join(logsDir, "run.log"))
    );

    // 1.从log文件读取到resultURL
    const logText = fs.readFileSync(logPath, "utf8");
    const lines = logText.split(/\r?\n/).filter(Boolean);

    let resultUrl: string | undefined;

    // 1.1 从最后一个"msg":"result response "的记录读取ImageURL
    for (const line of lines) {
        let obj = JSON.parse(line);
        if (obj?.msg === "result response ") {
            // obj.jsonText是string 所以要再解析一次
            const parsed = JSON.parse(obj.jsonText);
            const url = parsed?.data?.urls?.get ?? parsed?.urls?.get;
            resultUrl = url;
        } else {
            continue;
        }
    }

    if (!resultUrl) {
        throw new Error("ImageURL not found in run.log (no urls.get in result response jsonText)");
    }
    //2 从result读取imgUrl
    const { status, resultJson, imgUrl } = await getImgUrlFromResultUrl(resultUrl, runId);

    if (status === "succeeded" || status === "success" || status === "completed") {
        downloadImageFromImgUrl(imgUrl!, runId);
        return;
    } else {
        console.log(`status: ${status}\n jsonText: ${JSON.stringify(resultJson)}`);
        throw new Error("rerun text2image failed");
    }

}

async function downloadImageFromImgUrl(imgUrl: string, runId: string) {
    const logger = getLogger(runId);
    const imagePath = path.join(getLogDir(runId), `image_${runId}.png`);
    const imageResponse = await fetch(imgUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
    });
    if (!imageResponse.ok || !imageResponse.body) {
        logger.error({ imgUrl, res: imageResponse, status: imageResponse.status, statusTest: imageResponse.statusText }, "download image failed");
        throw new Error(`Failed to download: ${imageResponse.status} ${imageResponse.statusText}`);
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
        logger.error({
            errorMessage: resultResponse.text()
        }, "result response error");
        throw new Error(`Result HTTP ${resultResponse.status} ${resultResponse.statusText}`);
    }

    const resultJson = await resultResponse.json().catch(() => "");
    const status: string = resultJson.data.status;
    const imgUrl: string | undefined = resultJson?.data?.outputs?.[0];

    return { status, resultJson, imgUrl }

}