import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { parseStringPromise } from "xml2js";

const SCHEDULE_FILE = path.resolve("public/Schedule.json");
const RSS_FILE = path.resolve("public/Rss.json");

const SCHEDULE_URL = "https://subsplease.org/api/?f=schedule&tz=Etc/GMT";
const RSS_URL = "https://subsplease.org/rss/?r=1080";
const VERCEL_SYNC_FILE = path.resolve(".vercel-sync");

async function syncSchedule() {
  const res = await fetch(SCHEDULE_URL);
  const remote = await res.json();

  const local = fs.existsSync(SCHEDULE_FILE)
    ? JSON.parse(fs.readFileSync(SCHEDULE_FILE, "utf8"))
    : null;

  if (JSON.stringify(local?.schedule) === JSON.stringify(remote.schedule)) {
    return false;
  }

  const output = {
    updatedAt: new Date().toISOString(),
    schedule: remote.schedule,
  };

  fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(output, null, 2));
  console.log("Schedule atualizado");
  return true;
}

async function syncRss() {
  const res = await fetch(RSS_URL);
  const xml = await res.text();

  const parsed = await parseStringPromise(xml, {
    explicitArray: false,
  });

  const newItems = parsed?.rss?.channel?.item ?? [];

  const local = fs.existsSync(RSS_FILE)
    ? JSON.parse(fs.readFileSync(RSS_FILE, "utf8"))
    : { items: [] };

  // Junta os itens novos com os antigos
  const allItems = [...newItems, ...(local.items || [])];

  // Remove duplicatas usando o link do magnet como referência única
  const uniqueItems = [];
  const seenLinks = new Set();

  for (const item of allItems) {
    if (!seenLinks.has(item.link)) {
      seenLinks.add(item.link);
      uniqueItems.push(item);
    }
  }

  // Ordena do mais recente para o mais antigo
  uniqueItems.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  if (JSON.stringify(local.items) === JSON.stringify(uniqueItems)) {
    return false;
  }

  const output = {
    updatedAt: new Date().toISOString(),
    items: uniqueItems,
  };

  fs.writeFileSync(RSS_FILE, JSON.stringify(output, null, 2));
  console.log("RSS atualizado e episódios acumulados");
  return true;
}

async function run() {
  let changed = false;

  if (await syncSchedule()) changed = true;
  if (await syncRss()) changed = true;

  if (!changed) {
    console.log("Sem mudanças.");
    return;
  }

  fs.writeFileSync(VERCEL_SYNC_FILE, `Last sync: ${new Date().toISOString()}`);

  execSync("git add public/*.json .vercel-sync");
  execSync('git commit -m "chore: sync subsplease data"');
  execSync("git push");

  console.log("Dados sincronizados!");
}

run().catch(console.error);
