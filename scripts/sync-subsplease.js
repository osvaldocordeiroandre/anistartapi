import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { parseStringPromise } from "xml2js";

const SCHEDULE_FILE = path.resolve("public/Schedule.json");
const RSS_FILE = path.resolve("public/Rss.json");

const SCHEDULE_URL = "https://subsplease.org/api/?f=schedule&tz=Etc/GMT";
const RSS_URL = "https://subsplease.org/rss/?r=1080";
const VERCEL_SYNC_FILE = path.resolve(".vercel-sync");
const TITLE_CACHE_FILE = path.resolve("public/TitleCache.json");

async function getEnglishTitle(romajiTitle) {
  // Uma query simples do GraphQL para pegar os títulos
  const query = `
    query ($search: String) {
      Media (search: $search, type: ANIME) {
        title {
          english
          romaji
        }
      }
    }
  `;

  try {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { search: romajiTitle } }),
    });

    const data = await response.json();

    // É importante um pequeno delay para não esgotar o limite da API se houver muitos animes novos
    await new Promise((r) => setTimeout(r, 600));

    // Retorna o título em inglês (se não existir, retorna nulo)
    return data.data?.Media?.title?.english || null;
  } catch (err) {
    console.error("Erro ao buscar título na AniList:", err);
    return null;
  }
}

async function syncSchedule() {
  const res = await fetch(SCHEDULE_URL);
  const remote = await res.json();

  const local = fs.existsSync(SCHEDULE_FILE)
    ? JSON.parse(fs.readFileSync(SCHEDULE_FILE, "utf8"))
    : null;

  // Carrega ou inicializa o nosso "dicionário" de traduções
  let titleCache = {};
  if (fs.existsSync(TITLE_CACHE_FILE)) {
    titleCache = JSON.parse(fs.readFileSync(TITLE_CACHE_FILE, "utf8"));
  }

  // 1. PRIMEIRO nós percorremos os dias e injetamos os títulos
  for (const day in remote.schedule) {
    for (let i = 0; i < remote.schedule[day].length; i++) {
      const anime = remote.schedule[day][i];
      const originalTitle = anime.title;

      if (titleCache[originalTitle] === undefined) {
        console.log(`Buscando tradução para: ${originalTitle}`);
        const englishTitle = await getEnglishTitle(originalTitle);
        titleCache[originalTitle] = englishTitle || originalTitle;
      }

      remote.schedule[day][i].title_en = titleCache[originalTitle];
    }
  }

  // 2. DEPOIS de injetar, verificamos se o objeto final (agora com title_en)
  // é igual ao que já temos salvo localmente. Se for igual, cancela o salvamento.
  if (JSON.stringify(local?.schedule) === JSON.stringify(remote.schedule)) {
    return false;
  }

  // Prepara o output com a schedule modificada
  const output = {
    updatedAt: new Date().toISOString(),
    schedule: remote.schedule,
  };

  fs.writeFileSync(TITLE_CACHE_FILE, JSON.stringify(titleCache, null, 2));
  fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(output, null, 2));

  console.log("Schedule atualizado com títulos em inglês!");
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
  const EXTRAS_SEARCHES = [
    "Akane-banashi+1080p",
    "Yani+Neko+1080p",
    "Tomb+Raider+King+1080p",
    "Bleach%3A+Thousand-Year+Blood+War+-+The+Calamity",
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
