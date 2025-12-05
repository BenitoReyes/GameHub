import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

export const games = {};

export async function initGames({ app, io, prisma, serverClient }) {
  const gamesDir = path.join(process.cwd(), 'BackEnd', 'games');
  if (!fs.existsSync(gamesDir)) return;
  const entries = fs.readdirSync(gamesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const modPath = path.join(gamesDir, entry.name, 'index.js');
    if (!fs.existsSync(modPath)) continue;
    try {
      const mod = (await import(pathToFileURL(modPath).href)).default;
      if (mod && mod.name) {
        games[mod.name] = mod;
        if (typeof mod.registerHTTP === 'function') {
          mod.registerHTTP(app, { prisma, serverClient });
        }
        if (typeof mod.init === 'function') {
          await mod.init({ app, io, prisma, serverClient });
        }
        console.log(`Loaded game module: ${mod.name}`);
      }
    } catch (err) {
      console.error(`Failed loading module ${entry.name}:`, err);
    }
  }
}

export function getGame(name) { return games[name]; }
