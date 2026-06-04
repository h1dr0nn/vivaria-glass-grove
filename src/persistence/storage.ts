/**
 * Storage backend: Rust file IO inside Tauri (atomic + .bak), localStorage
 * in the plain-browser dev environment. Both async, both never throw out -
 * callers get null on failure and the game degrades gracefully.
 */

export interface StorageBackend {
  write(json: string): Promise<boolean>;
  read(): Promise<string | null>;
  readBackup(): Promise<string | null>;
}

const LOCAL_KEY = "vivaria-save";
const LOCAL_BAK_KEY = "vivaria-save-bak";

function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function createTauriStorage(): StorageBackend {
  return {
    async write(json: string): Promise<boolean> {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("save_game", { data: json });
        return true;
      } catch (error: unknown) {
        console.error("save failed", error);
        return false;
      }
    },
    async read(): Promise<string | null> {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<string | null>("load_game");
      } catch (error: unknown) {
        console.error("load failed", error);
        return null;
      }
    },
    async readBackup(): Promise<string | null> {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<string | null>("load_backup");
      } catch (error: unknown) {
        console.error("backup load failed", error);
        return null;
      }
    },
  };
}

function createLocalStorage(): StorageBackend {
  return {
    write(json: string): Promise<boolean> {
      try {
        const previous = window.localStorage.getItem(LOCAL_KEY);
        if (previous !== null) {
          window.localStorage.setItem(LOCAL_BAK_KEY, previous);
        }
        window.localStorage.setItem(LOCAL_KEY, json);
        return Promise.resolve(true);
      } catch (error: unknown) {
        console.error("save failed", error);
        return Promise.resolve(false);
      }
    },
    read(): Promise<string | null> {
      return Promise.resolve(window.localStorage.getItem(LOCAL_KEY));
    },
    readBackup(): Promise<string | null> {
      return Promise.resolve(window.localStorage.getItem(LOCAL_BAK_KEY));
    },
  };
}

export function createStorage(): StorageBackend {
  return isTauri() ? createTauriStorage() : createLocalStorage();
}
