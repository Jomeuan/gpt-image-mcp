import * as fs from "node:fs";
import * as path from "node:path";
import { cfg } from "./appconfig";
import pino from "pino";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";


function ensureDir(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
}

export function getLogBaseDir(): string {
    return path.resolve(process.cwd(), "http-logs");
}

export function getLogDir(runId: string): string {
    return path.resolve(process.cwd(), "http-logs",runId);
}

export function getLogger(runId: string) {
    const loggerPath = getLogDir(runId);
    ensureDir(loggerPath);

    const logger = pino(
        { level: "info" },
        pino.destination(path.join(loggerPath, "run.log"))
    );

    return logger;
}