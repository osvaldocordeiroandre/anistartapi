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
  // 1. Puxa do Subsplease normalmente
  const res = await fetch(RSS_URL);
  const xml = await res.text();
  const parsed = await parseStringPromise(xml, { explicitArray: false });

  let newItems = parsed?.rss?.channel?.item || [];
  if (!Array.isArray(newItems)) newItems = [newItems];

  // 2. BUSCA OS ANIMES EXTRAS NO NYAA.SI (Onde tem todos os animes)
  // Separe os espaços do nome por "+" e coloque +1080p
  const EXTRAS_SEARCHES = ["Akane-banashi+1080p"];

  for (const query of EXTRAS_SEARCHES) {
    try {
      const nyaaRes = await fetch(
        `https://nyaa.si/?page=rss&q=${query}&c=1_2&f=0`,
      );
      const nyaaXml = await nyaaRes.text();
      const nyaaParsed = await parseStringPromise(nyaaXml, {
        explicitArray: false,
      });

      let nyaaItems = nyaaParsed?.rss?.channel?.item || [];
      if (!Array.isArray(nyaaItems)) nyaaItems = [nyaaItems];

      // Junta os itens do Nyaa com os do Subsplease
      newItems = [...newItems, ...nyaaItems];
    } catch (err) {
      console.error("Erro ao buscar extra no Nyaa:", query);
    }
  }

  // 3. Lê o arquivo local para não perder o histórico (A Lógica de Acúmulo)
  const local = fs.existsSync(RSS_FILE)
    ? JSON.parse(fs.readFileSync(RSS_FILE, "utf8"))
    : { items: [] };

  const allItems = [...newItems, ...(local.items || [])];

  // 4. Remove duplicatas
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

  const output = {
    updatedAt: new Date().toISOString(),
    items: uniqueItems,
  };

  fs.writeFileSync(RSS_FILE, JSON.stringify(output, null, 2));
  console.log("RSS atualizado com Subsplease + Nyaa Extras!");
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
