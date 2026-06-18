import * as fs from "node:fs";
import * as path from "node:path";

export type PromptsConfig = {
    first?: string;
    important?: string[];
    leg?: string;
    face?: string;
    skin?: string;
    hair?: string;
    cloth?: string;
    background?: string;
    action?: string;
    composition?: string;

    // 允许额外字段（不影响拼接）
    [k: string]: unknown;
};

export type AppConfig = {
    apiKey: string;
    // 实际的prompts
    prompts: PromptsConfig;
    // 后面解析出来的prompt
    prompt: string | undefined;
};

function buildPromptFromPrompts(prompts: PromptsConfig): string {
    const order: (keyof PromptsConfig)[] = [
        "first",
        "important",
        "leg",
        "face",
        "skin",
        "hair",
        "cloth",
        "background",
        "action",
        "composition",
    ];

    const parts: string[] = [];

    for (const k of order) {
        const v = prompts[k];
        if (!v) continue;

        if (k === "important" && Array.isArray(v)) {
            for (const line of v) {
                if (typeof line === "string" && line.trim()) parts.push(line.trim());
            }
            continue;
        }

        if (typeof v === "string" && v.trim()) parts.push(v.trim());
    }

    return parts.join("\n");
}

export function loadConfig(p: string = "gpts.config.json"): AppConfig {
    const rawText = fs.readFileSync(
        path.resolve(process.cwd(), p)
        , "utf8"
    );
    const raw: AppConfig = JSON.parse(rawText) as AppConfig;

    const apiKey: string = raw.apiKey;
    if (!apiKey) {
        throw new Error(`Missing API key (set GPTS_API_KEY or put "apiKey" in ${p})`);
    }

    const prompt = buildPromptFromPrompts(raw.prompts);
    if (!prompt) {
        throw new Error(`Missing "prompt" or "prompts" in ${raw}`);
    }

    return { apiKey, prompts: raw.prompts, prompt };
}

export const cfg = loadConfig("gpts.config.json");