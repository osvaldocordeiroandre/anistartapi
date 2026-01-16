import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const FILE = path.resolve("public/Schedule.json");
const URL = "https://subsplease.org/api/?f=schedule&tz=Etc/GMT";

async function run() {
  const res = await fetch(URL);
  const remote = await res.json();

  const local = fs.existsSync(FILE)
    ? JSON.parse(fs.readFileSync(FILE, "utf8"))
    : null;

  if (JSON.stringify(local?.schedule) === JSON.stringify(remote.schedule)) {
    console.log("Sem mudanças.");
    return;
  }

  const output = {
    updatedAt: new Date().toISOString(),
    schedule: remote.schedule,
  };

  fs.writeFileSync(FILE, JSON.stringify(output, null, 2));

  execSync("git add public/Schedule.json");
  execSync('git commit -m "update: subsplease schedule"');
  execSync("git push");

  console.log("Schedule atualizado!");
}

run().catch(console.error);
