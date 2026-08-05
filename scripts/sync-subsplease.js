import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { parseStringPromise } from "xml2js";

const SCHEDULE_FILE = path.resolve("public/Schedule.json");
const RSS_FILE = path.resolve("public/Rss.json");

const SCHEDULE_URL = "https://subsplease.org/api/?f=schedule&tz=Etc/GMT";
const RSS_URL = "https://subsplease.org/rss/?r=1080";
const ERAI_URL =
  "https://www.erai-raws.info/episodes/feed/?res=1080p&type=torrent&token=49df38593bec4aba739626f9a6a00344";
const VERCEL_SYNC_FILE = path.resolve(".vercel-sync");

// 1. Extrai o nome base para comparar com o Schedule
function getBaseAnimeName(title) {
  return title
    .toLowerCase()
    .replace(/\[.*?\]/g, "")
    .replace(/\(1080p\)/g, "")
    .replace(/-\s*\d+.*$/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

// 2. Extrai Nome + Episódio para não adicionar duplicatas do MESMO episódio
function getExactEpisodeIdentifier(title) {
  let clean = title.toLowerCase();
  clean = clean.replace(/\[.*?\]/g, "");
  clean = clean.replace(/\(1080p\)/g, "");
  clean = clean.replace(/\.mkv|\.mp4/gi, "");
  return clean
    .replace(/[^a-z0-9\s\-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

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

  // 2. Busca os Extras no Nyaa.si
  const EXTRAS_SEARCHES = [
    "Akane-banashi+1080p",
    "Yani+Neko+1080p",
    "Tomb+Raider+King+1080p",
  ];

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

      newItems = [...newItems, ...nyaaItems];
    } catch (err) {
      console.error("Erro ao buscar extra no Nyaa:", query);
    }
  }

  // 3. Lê o arquivo local
  const local = fs.existsSync(RSS_FILE)
    ? JSON.parse(fs.readFileSync(RSS_FILE, "utf8"))
    : { items: [] };

  const allItems = [...newItems, ...(local.items || [])];

  // ==========================================
  // 4. LÓGICA DE FALLBACK COM O ERAI-RAWS
  // ==========================================

  // Puxa a lista de animes do Schedule atual
  const scheduleData = fs.existsSync(SCHEDULE_FILE)
    ? JSON.parse(fs.readFileSync(SCHEDULE_FILE, "utf8"))
    : { schedule: {} };

  const scheduledAnimes = new Set();
  for (const day in scheduleData.schedule) {
    scheduleData.schedule[day].forEach((anime) => {
      scheduledAnimes.add(getBaseAnimeName(anime.title));
    });
  }

  // Registra os episódios que JÁ EXISTEM no histórico para evitar duplicação
  const existingEpisodes = new Set();
  for (const item of allItems) {
    existingEpisodes.add(getExactEpisodeIdentifier(item.title));
  }

  // Compara e puxa do Erai-raws o que estiver faltando
  try {
    const eraiRes = await fetch(ERAI_URL);
    const eraiXml = await eraiRes.text();
    const eraiParsed = await parseStringPromise(eraiXml, {
      explicitArray: false,
    });

    let eraiItems = eraiParsed?.rss?.channel?.item || [];
    if (!Array.isArray(eraiItems)) eraiItems = [eraiItems];

    for (const item of eraiItems) {
      const baseName = getBaseAnimeName(item.title);
      const exactEp = getExactEpisodeIdentifier(item.title);

      // Se o anime está no cronograma, mas este episódio ainda não consta na lista
      if (scheduledAnimes.has(baseName) && !existingEpisodes.has(exactEp)) {
        console.log(`Fallback do Erai-raws adicionado: ${item.title}`);
        allItems.push(item);
        existingEpisodes.add(exactEp); // Impede que adicione o mesmo episódio se o Erai listar duas vezes
      }
    }
  } catch (err) {
    console.error("Erro ao processar feed do Erai-raws:", err);
  }

  // ==========================================

  // 5. Remove duplicatas pelo link exato do Torrent
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
  console.log("RSS atualizado com sucesso (Subsplease + Nyaa + Erai-raws)!");
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
