import { chromium } from "playwright";
import { existsSync, mkdirSync, chmodSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { invalidateSessionCache } from "./session-fetch.js";
export const SESSION_DIR = join(homedir(), ".config", "ddb-mcp");
export const SESSION_PATH = join(SESSION_DIR, "session.json");
let browserInstance = null;
let browserHeadless = null;
let contextInstance = null;
export async function getBrowser(headless = true) {
    // If a browser is already running with a different headless setting, close it
    // first so ddb_login always gets a visible window even if headless tools ran before.
    if (browserInstance && browserHeadless !== headless) {
        await closeBrowser();
    }
    if (browserInstance)
        return browserInstance;
    browserInstance = await chromium.launch({
        headless,
        args: [
            "--no-sandbox",
            "--disable-blink-features=AutomationControlled",
        ],
    });
    browserHeadless = headless;
    return browserInstance;
}
export async function getContext(browser) {
    if (contextInstance)
        return contextInstance;
    if (!existsSync(SESSION_DIR)) {
        mkdirSync(SESSION_DIR, { recursive: true });
    }
    const contextOptions = {
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 800 },
    };
    contextInstance = await browser.newContext(existsSync(SESSION_PATH) ? { ...contextOptions, storageState: SESSION_PATH } : contextOptions);
    return contextInstance;
}
export async function saveSession(context) {
    if (!existsSync(SESSION_DIR)) {
        mkdirSync(SESSION_DIR, { recursive: true });
    }
    await context.storageState({ path: SESSION_PATH });
    // Restrict session file to owner-only access — it contains sensitive auth cookies.
    chmodSync(SESSION_PATH, 0o600);
    // Invalidate the in-memory cookie/token cache so the next request reads the new session.
    invalidateSessionCache();
}
export async function getPage(context) {
    const pages = context.pages();
    if (pages.length > 0)
        return pages[0];
    return context.newPage();
}
export async function closeBrowser() {
    if (contextInstance) {
        await contextInstance.close();
        contextInstance = null;
    }
    if (browserInstance) {
        await browserInstance.close();
        browserInstance = null;
    }
    browserHeadless = null;
}
//# sourceMappingURL=browser.js.map