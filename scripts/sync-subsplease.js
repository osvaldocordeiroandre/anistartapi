import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { parseStringPromise } from "xml2js";

const SCHEDULE_FILE = path.resolve("public/Schedule.json");
const RSS_FILE = path.resolve("public/Rss.json");

const SCHEDULE_URL = "https://subsplease.org/api/?f=schedule&tz=Etc/GMT";
const RSS_URL = "https://subsplease.org/rss/?t&r=1080";

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

  const items = parsed?.rss?.channel?.item ?? [];

  const local = fs.existsSync(RSS_FILE)
    ? JSON.parse(fs.readFileSync(RSS_FILE, "utf8"))
    : null;

  if (JSON.stringify(local?.items) === JSON.stringify(items)) {
    return false;
  }

  const output = {
    updatedAt: new Date().toISOString(),
    items,
  };

  fs.writeFileSync(RSS_FILE, JSON.stringify(output, null, 2));
  console.log("RSS atualizado");
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

  execSync("git add public/*.json");
  execSync('git commit -m "chore: sync subsplease data"');
  execSync("git push");

  console.log("Dados sincronizados!");
}

run().catch(console.error);
