#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const DEFAULT_OUTPUT_DIR = path.resolve("tools/menu-flow-output");
const CLICK_DEBOUNCE_MS = 350;
const NETWORK_IDLE_TIMEOUT_MS = 2500;
const SENSITIVE_KEY_RE = /(authorization|cookie|token|secret|password|passwd|pwd|session|credential|phone|mobile|email)/i;
const API_RESOURCE_TYPES = new Set(["fetch", "xhr"]);

function printUsage() {
  console.log(`
Usage:
  node tools/record-menu-flow.mjs <url> [options]

Options:
  --output <dir>     Output directory. Default: tools/menu-flow-output
  --browser <name>   Browser engine: chromium, firefox, or webkit. Default: chromium
  --include-sensitive
                     Save raw headers, request bodies, and response samples.
                     By default sensitive fields are redacted.
  --headed           Run with a visible browser window. This is the default.
  --help             Show this help message.

Example:
  node tools/record-menu-flow.mjs https://example.com
  node tools/record-menu-flow.mjs https://example.com --output docs/menu-flow

Workflow:
  1. The script opens the target website.
  2. Log in manually if the site requires it.
  3. Return to this terminal and press Enter to start recording.
  4. Click menus and links manually in the browser.
  5. Press Ctrl+C in this terminal to stop and save the final files.
`);
}

function parseArgs(argv) {
  const args = {
    url: "",
    outputDir: DEFAULT_OUTPUT_DIR,
    browserName: "chromium",
    includeSensitive: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--help" || value === "-h") {
      args.help = true;
      continue;
    }

    if (value === "--output") {
      args.outputDir = path.resolve(argv[index + 1] ?? "");
      index += 1;
      continue;
    }

    if (value === "--browser") {
      args.browserName = argv[index + 1] ?? "chromium";
      index += 1;
      continue;
    }

    if (value === "--include-sensitive") {
      args.includeSensitive = true;
      continue;
    }

    if (value === "--headed") {
      continue;
    }

    if (!args.url) {
      args.url = value;
      continue;
    }

    throw new Error(`Unknown argument: ${value}`);
  }

  return args;
}

function assertValidUrl(url) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("URL must start with http:// or https://");
    }
  } catch (error) {
    throw new Error(`Invalid URL: ${url || "(missing)"}. ${error.message}`);
  }
}

async function loadPlaywright(browserName) {
  try {
    const playwright = await import("playwright");
    const browserType = playwright[browserName];

    if (!browserType) {
      throw new Error(`Unsupported browser "${browserName}". Use chromium, firefox, or webkit.`);
    }

    return browserType;
  } catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" || error.message.includes("Cannot find package")) {
      throw new Error(
        [
          "Playwright is not installed.",
          "Install it first:",
          "  npm install -D playwright",
          "  npx playwright install chromium"
        ].join("\n")
      );
    }

    throw error;
  }
}

async function ensureOutputDirs(outputDir) {
  const screenshotsDir = path.join(outputDir, "screenshots");
  const capturesDir = path.join(outputDir, "captures");
  await fs.mkdir(screenshotsDir, { recursive: true });
  await fs.mkdir(capturesDir, { recursive: true });
  return { screenshotsDir, capturesDir };
}

function nowStamp() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "page";
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

function markdownNodeId(value, index) {
  return `N${index}_${slugify(value).replaceAll("-", "_")}`;
}

function isSensitiveKey(key) {
  return SENSITIVE_KEY_RE.test(String(key));
}

function redactText(text) {
  return String(text)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, "[REDACTED_PHONE]")
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED_TOKEN]")
    .replace(/([?&](?:token|access_token|refresh_token|session|password|secret)=)[^&\s]+/gi, "$1[REDACTED]");
}

function redactValue(value, key = "") {
  if (isSensitiveKey(key)) {
    return "[REDACTED]";
  }

  if (typeof value === "string") {
    return redactText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, key));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactValue(entryValue, entryKey)
      ])
    );
  }

  return value;
}

function maybeRedact(value, includeSensitive, key = "") {
  return includeSensitive ? value : redactValue(value, key);
}

function safeParseJson(text) {
  if (!text || typeof text !== "string") {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseQuery(url) {
  try {
    const parsed = new URL(url);
    return Object.fromEntries(parsed.searchParams.entries());
  } catch {
    return {};
  }
}

function summarizeDataShape(value, depth = 0) {
  if (depth > 4) {
    return "[MaxDepth]";
  }

  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      items: value.length > 0 ? summarizeDataShape(value[0], depth + 1) : "unknown"
    };
  }

  if (value === null) {
    return { type: "null" };
  }

  if (typeof value === "object") {
    return {
      type: "object",
      fields: Object.fromEntries(
        Object.entries(value).map(([key, entryValue]) => [
          key,
          summarizeDataShape(entryValue, depth + 1)
        ])
      )
    };
  }

  return { type: typeof value };
}

function extensionForResponse(url, contentType = "") {
  let ext = "";
  try {
    ext = path.extname(new URL(url).pathname);
  } catch {
    ext = "";
  }

  if (ext && ext.length <= 10) {
    return ext;
  }

  if (contentType.includes("text/html")) return ".html";
  if (contentType.includes("text/css")) return ".css";
  if (contentType.includes("javascript")) return ".js";
  if (contentType.includes("json")) return ".json";
  if (contentType.includes("svg")) return ".svg";
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("jpeg")) return ".jpg";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("gif")) return ".gif";
  if (contentType.includes("font")) return ".font";
  return ".bin";
}

async function writeOutputs(records, outputDir) {
  await fs.mkdir(outputDir, { recursive: true });

  const jsonPath = path.join(outputDir, "navigation-log.json");
  const csvPath = path.join(outputDir, "navigation-map.csv");
  const markdownPath = path.join(outputDir, "navigation-flow.md");

  await fs.writeFile(jsonPath, `${JSON.stringify(records, null, 2)}\n`);

  const headers = [
    "timestamp",
    "source_url",
    "target_url",
    "target_title",
    "clicked_text",
    "element_role",
    "element_tag",
    "element_href",
    "new_page",
    "capture_id",
    "screenshot",
    "html",
    "network_log",
    "api_log"
  ];
  const csvRows = [
    headers.join(","),
    ...records.map((record) =>
      headers.map((header) => csvEscape(record[header])).join(",")
    )
  ];
  await fs.writeFile(csvPath, `${csvRows.join("\n")}\n`);

  const knownNodes = new Map();
  const nodeFor = (url) => {
    if (!knownNodes.has(url)) {
      knownNodes.set(url, markdownNodeId(url, knownNodes.size + 1));
    }
    return knownNodes.get(url);
  };

  const flowLines = [
    "# Navigation Flow",
    "",
    "```mermaid",
    "graph TD"
  ];

  for (const record of records) {
    const sourceId = nodeFor(record.source_url);
    const targetId = nodeFor(record.target_url);
    const label = record.clicked_text || record.element_href || "click";
    flowLines.push(
      `  ${sourceId}["${record.source_url.replaceAll('"', '\\"')}"] -->|${label.replaceAll('"', '\\"')}| ${targetId}["${record.target_url.replaceAll('"', '\\"')}"]`
    );
  }

  if (records.length === 0) {
    flowLines.push('  Empty["No navigation records captured"]');
  }

  flowLines.push("```", "");
  await fs.writeFile(markdownPath, flowLines.join("\n"));

  return { jsonPath, csvPath, markdownPath };
}

function createNetworkCollector({ includeSensitive }) {
  const events = [];
  let sequence = 0;

  const attach = (page) => {
    page.on("response", async (response) => {
      const request = response.request();
      const resourceType = request.resourceType();
      const responseHeaders = response.headers();
      const contentType = responseHeaders["content-type"] || "";
      const url = response.url();
      const id = `net-${String(++sequence).padStart(5, "0")}`;
      const entry = {
        id,
        timestamp: new Date().toISOString(),
        page_url: page.url(),
        url,
        method: request.method(),
        resource_type: resourceType,
        status: response.status(),
        status_text: response.statusText(),
        content_type: contentType,
        request_headers: maybeRedact(request.headers(), includeSensitive),
        response_headers: maybeRedact(responseHeaders, includeSensitive),
        query: maybeRedact(parseQuery(url), includeSensitive),
        request_body: maybeRedact(request.postData() || "", includeSensitive, "body"),
        body_buffer: null,
        body_error: "",
        saved_resource: ""
      };

      try {
        entry.body_buffer = await response.body();
      } catch (error) {
        entry.body_error = error.message;
      }

      events.push(entry);
    });
  };

  const sliceSince = (startIndex) => events.slice(startIndex);
  const mark = () => events.length;

  return { attach, sliceSince, mark };
}

async function writeCaptureFiles({
  page,
  outputDir,
  capturesDir,
  networkEvents,
  includeSensitive,
  titleOrUrl
}) {
  const captureId = `${nowStamp()}-${slugify(titleOrUrl)}`;
  const captureDir = path.join(capturesDir, captureId);
  const resourcesDir = path.join(captureDir, "resources");
  await fs.mkdir(resourcesDir, { recursive: true });

  const screenshot = path.join(captureDir, "screenshot.png");
  const html = path.join(captureDir, "page.html");
  const networkLog = path.join(captureDir, "network.json");
  const apiLog = path.join(captureDir, "api-calls.json");

  await page.screenshot({ path: screenshot, fullPage: true });
  const renderedHtml = await page.evaluate(() => document.documentElement.outerHTML);
  await fs.writeFile(html, `${renderedHtml}\n`);

  const networkRecords = [];
  const apiRecords = [];

  for (const event of networkEvents) {
    const contentType = event.content_type || "";
    const isApi = API_RESOURCE_TYPES.has(event.resource_type);
    const baseNetworkRecord = {
      id: event.id,
      timestamp: event.timestamp,
      page_url: event.page_url,
      url: event.url,
      method: event.method,
      resource_type: event.resource_type,
      status: event.status,
      status_text: event.status_text,
      content_type: contentType,
      query: event.query,
      request_headers: event.request_headers,
      response_headers: event.response_headers,
      saved_resource: "",
      body_error: event.body_error
    };

    if (!isApi && event.body_buffer) {
      const resourceExt = extensionForResponse(event.url, contentType);
      const resourceFile = `${event.id}-${slugify(event.url)}${resourceExt}`;
      const resourcePath = path.join(resourcesDir, resourceFile);
      await fs.writeFile(resourcePath, event.body_buffer);
      baseNetworkRecord.saved_resource = path.relative(outputDir, resourcePath);
    }

    networkRecords.push(baseNetworkRecord);

    if (isApi) {
      const bodyText = event.body_buffer
        ? event.body_buffer.toString("utf8").slice(0, includeSensitive ? 20000 : 4000)
        : "";
      const parsedBody = safeParseJson(bodyText);
      const responseShape = parsedBody
        ? summarizeDataShape(parsedBody)
        : { type: bodyText ? "text" : "empty" };

      apiRecords.push({
        id: event.id,
        timestamp: event.timestamp,
        page_url: event.page_url,
        url: event.url,
        method: event.method,
        status: event.status,
        status_text: event.status_text,
        content_type: contentType,
        query: event.query,
        request_headers: event.request_headers,
        request_body: maybeRedact(event.request_body, includeSensitive, "body"),
        response_shape: responseShape,
        response_sample: includeSensitive ? bodyText : redactText(bodyText),
        body_error: event.body_error
      });
    }
  }

  await fs.writeFile(networkLog, `${JSON.stringify(networkRecords, null, 2)}\n`);
  await fs.writeFile(apiLog, `${JSON.stringify(apiRecords, null, 2)}\n`);

  return {
    captureId,
    captureDir,
    screenshot,
    html,
    networkLog,
    apiLog
  };
}

async function installClickTracker(page, networkCollector) {
  await page.exposeFunction("recordMenuFlowClick", async (event) => {
    page.__lastClick = {
      ...event,
      capturedAt: Date.now(),
      source_url: page.url()
    };
    page.__navigationNetworkStartIndex = networkCollector.mark();
  });

  await page.addInitScript(() => {
    window.addEventListener(
      "click",
      (event) => {
        const element = event.target instanceof Element
          ? event.target.closest("a,button,[role='menuitem'],[role='link'],[data-menu],[data-nav]")
          : null;

        if (!element) {
          return;
        }

        const rect = element.getBoundingClientRect();
        const text = (element.innerText || element.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 240);

        window.recordMenuFlowClick({
          clicked_text: text,
          element_tag: element.tagName.toLowerCase(),
          element_role: element.getAttribute("role") || "",
          element_href: element instanceof HTMLAnchorElement ? element.href : "",
          element_id: element.id || "",
          element_classes: element.className || "",
          element_bounds: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        });
      },
      true
    );
  });
}

async function screenshotPage(page, screenshotsDir, titleOrUrl) {
  const fileName = `${nowStamp()}-${slugify(titleOrUrl)}.png`;
  const screenshotPath = path.join(screenshotsDir, fileName);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
}

async function createRecord({
  page,
  sourceUrl,
  newPage,
  outputDir,
  capturesDir,
  networkCollector,
  networkStartIndex,
  includeSensitive
}) {
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => undefined);
  await page.waitForTimeout(CLICK_DEBOUNCE_MS);

  const targetTitle = await page.title().catch(() => "");
  const targetUrl = page.url();
  const lastClick = page.__lastClick ?? {};
  const networkEvents = networkCollector.sliceSince(networkStartIndex);
  const capture = await writeCaptureFiles({
    page,
    outputDir,
    capturesDir,
    networkEvents,
    includeSensitive,
    titleOrUrl: targetTitle || targetUrl
  });

  return {
    timestamp: new Date().toISOString(),
    source_url: sourceUrl || lastClick.source_url || "",
    target_url: targetUrl,
    target_title: targetTitle,
    clicked_text: lastClick.clicked_text || "",
    element_role: lastClick.element_role || "",
    element_tag: lastClick.element_tag || "",
    element_href: lastClick.element_href || "",
    element_id: lastClick.element_id || "",
    element_classes: lastClick.element_classes || "",
    element_bounds: lastClick.element_bounds || null,
    new_page: Boolean(newPage),
    capture_id: capture.captureId,
    capture_dir: capture.captureDir,
    screenshot: capture.screenshot,
    html: capture.html,
    network_log: capture.networkLog,
    api_log: capture.apiLog
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  assertValidUrl(args.url);

  const browserType = await loadPlaywright(args.browserName);
  const { screenshotsDir, capturesDir } = await ensureOutputDirs(args.outputDir);
  const records = [];
  const networkCollector = createNetworkCollector({
    includeSensitive: args.includeSensitive
  });

  const browser = await browserType.launch({
    headless: false
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 }
  });
  const page = await context.newPage();
  await installClickTracker(page, networkCollector);
  networkCollector.attach(page);

  context.on("page", async (newPage) => {
    newPage.__lastClick = page.__lastClick;
    newPage.__navigationNetworkStartIndex = page.__navigationNetworkStartIndex;
    await installClickTracker(newPage, networkCollector);
    networkCollector.attach(newPage);
    const networkStartIndex = newPage.__navigationNetworkStartIndex ?? networkCollector.mark();
    await newPage.waitForLoadState("domcontentloaded").catch(() => undefined);

    const record = await createRecord({
      page: newPage,
      sourceUrl: page.url(),
      newPage: true,
      outputDir: args.outputDir,
      capturesDir,
      networkCollector,
      networkStartIndex,
      includeSensitive: args.includeSensitive
    });
    records.push(record);
    await writeOutputs(records, args.outputDir);
    console.log(`Recorded new page: ${record.source_url} -> ${record.target_url}`);
  });

  let previousUrl = "";
  page.on("framenavigated", async (frame) => {
    if (frame !== page.mainFrame()) {
      return;
    }

    const currentUrl = page.url();
    if (!previousUrl || currentUrl === previousUrl) {
      previousUrl = currentUrl;
      return;
    }

    const sourceUrl = page.__lastClick?.source_url || previousUrl;
    const networkStartIndex = page.__navigationNetworkStartIndex ?? networkCollector.mark();
    const record = await createRecord({
      page,
      sourceUrl,
      newPage: false,
      outputDir: args.outputDir,
      capturesDir,
      networkCollector,
      networkStartIndex,
      includeSensitive: args.includeSensitive
    });
    records.push(record);
    previousUrl = currentUrl;
    await writeOutputs(records, args.outputDir);
    console.log(`Recorded navigation: ${record.source_url} -> ${record.target_url}`);
  });

  await page.goto(args.url, { waitUntil: "domcontentloaded" });
  previousUrl = page.url();

  const rl = readline.createInterface({ input, output });
  console.log(`Opened ${args.url}`);
  console.log("Log in manually if needed. When you are ready to record menu clicks, return here.");
  await rl.question("Press Enter to start recording...");
  rl.close();

  previousUrl = page.url();
  await screenshotPage(page, screenshotsDir, "recording-start");
  await writeOutputs(records, args.outputDir);

  console.log("Recording started.");
  console.log("Click menus in the browser. Press Ctrl+C here to stop and finalize output.");

  const shutdown = async () => {
    const outputs = await writeOutputs(records, args.outputDir);
    console.log("\nRecording stopped.");
    console.log(`Records: ${records.length}`);
    console.log(`JSON: ${outputs.jsonPath}`);
    console.log(`CSV: ${outputs.csvPath}`);
    console.log(`Flow: ${outputs.markdownPath}`);
    await browser.close();
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await new Promise(() => undefined);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
