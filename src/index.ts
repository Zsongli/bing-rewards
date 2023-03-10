import type { Protocol, Browser } from "puppeteer";
import puppeteer from "./puppeteer-fix";
import fs from "fs";
import cron from "node-cron";
import launchLogin from "./login";
import getPoints from "./get-points";
import sendInvalidTokenWebhook from "./send-webhook";

async function main() {
    await import("dotenv/config");
    if (!fs.existsSync("session.json")) {
        console.log(`Login required. Launching browser...\nNote: It is recommended to choose "Yes" at the "Stay signed in?" option to avoid having to log in frequently.`);

        try {
            const cookies = await launchLogin();
            fs.writeFileSync("session.json", JSON.stringify(cookies));
        } catch (e) {
            console.error("Login failed:", e);
            return;
        }

        console.log("Login successful.");
    }

    const cookies = JSON.parse(fs.readFileSync("session.json").toString()) as Protocol.Network.Cookie[];

    const browser = await puppeteer.launch() as Browser;
    browser.pages().then(pages => pages.forEach(page => page.close())); // close all pages that were opened by default
    const page = await browser.newPage();

    // authenticate using previous login information
    await page.setCookie({ name: "_EDGE_V", value: "1", domain: ".bing.com", path: "/", expires: 2147483647 }, ...cookies);

    const argv = process.argv.slice(2);
    const cronExpIndex = argv.findIndex(arg => cron.validate(arg));
    const cronExp = (cronExpIndex != -1) ? argv[cronExpIndex] : ((process.env.CRON_EXPRESSION && cron.validate(process.env.CRON_EXPRESSION)) ? process.env.CRON_EXPRESSION : "0 12 * * *");
    console.log(`Point collection is scheduled to run according to the following cron expression: (${cronExp})\nKeep the script running as long as you want it to operate.\nYou may use Ctrl+C to stop it.`);

    cron.schedule(cronExp, async () => { // schedule point collection task
        try {
            await getPoints(page);
        } catch (e) {
            if (e instanceof Error && e.message == "invalid session") {
                console.error("Session is invalid or expired. Please restart the script and log in again.");
                if (fs.existsSync("session.json")) fs.rmSync("session.json");
                if (process.env.DISCORD_URL) await sendInvalidTokenWebhook();
                process.exit(1);
            }
            else console.error("Failed to get points:", e);
        }
    }, { runOnInit: argv.includes("--now") });

    process.on("beforeExit", async () => await browser.close());
}

main();
