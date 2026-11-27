import fs from 'node:fs/promises';
import path from 'node:path';
import type { SharedControlStore } from '../../src/types/controlCenter.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.resolve(DATA_DIR, 'control-center-store.json');

export async function readLocalStore(): Promise<SharedControlStore | null> {
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as SharedControlStore;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.agents)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function writeLocalStore(store: SharedControlStore): Promise<SharedControlStore> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const normalized: SharedControlStore = {
    ...store,
    lastSavedAt: new Date().toISOString(),
  };
  await fs.writeFile(STORE_PATH, JSON.stringify(normalized, null, 2), 'utf-8');
  return normalized;
}

export async function clearLocalStore(): Promise<void> {
  try {
    await fs.unlink(STORE_PATH);
  } catch {
    // Ignore if file does not exist
  }
}
