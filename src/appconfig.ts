import * as fs from "node:fs";
import * as path from "node:path";

export type PromptsMap = Record<string, unknown>;

export type AppConfig = {
    apiKey: string;

    textPrompts: PromptsMap;
    textPrompt: string;

    imagePrompts: PromptsMap;
    imagePrompt: string;

    imageInputUrls: string[];
};

/**
 * 按 JSON 对象的插入顺序拼接所有 string 值（JSON.parse 后 Object.entries 会保持该顺序）
 */
function buildPromptFromMap(prompts: PromptsMap): string {
    const parts: string[] = [];
    for (const [, v] of Object.entries(prompts ?? {})) {
        if (typeof v === "string" && v.trim()) parts.push(v.trim());
    }
    return parts.join("\n");
}

export function loadConfig(p: string = "gpts.config.json"): AppConfig {
    const rawText = fs.readFileSync(path.resolve(process.cwd(), p), "utf8");
    const raw = JSON.parse(rawText) as AppConfig;

    const apiKey = raw.apiKey;
    if (!apiKey) throw new Error(`Missing "apiKey" in ${p}`);

    const textPrompts = raw.textPrompts;
    const imagePrompts = raw.imagePrompts;
    const imageInputUrls = raw.imageInputUrls;

    const textPrompt = buildPromptFromMap(textPrompts);
    const imagePrompt = buildPromptFromMap(imagePrompts);

    return {
        apiKey,
        textPrompts,
        textPrompt,
        imagePrompts,
        imagePrompt,
        imageInputUrls,
    };
}

export const cfg = loadConfig("gpts.config.json");