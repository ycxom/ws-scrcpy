import * as fs from 'fs';
import * as path from 'path';

const EXPIRY_DAYS = 30;
const STORAGE_FILENAME = 'uuid_storage.json';

interface StoredUuidData {
    linkId: string;
    timestamp: number;
}

interface UuidStorageData {
    [uuid: string]: StoredUuidData;
}

export class UuidStorage {
    private static instance?: UuidStorage;
    private storagePath: string;
    private data: UuidStorageData = {};

    private constructor() {
        this.storagePath = path.join(process.cwd(), STORAGE_FILENAME);
        this.load();
        this.startCleanupInterval();
    }

    public static getInstance(): UuidStorage {
        if (!this.instance) {
            this.instance = new UuidStorage();
        }
        return this.instance;
    }

    private load(): void {
        try {
            if (fs.existsSync(this.storagePath)) {
                const content = fs.readFileSync(this.storagePath, 'utf-8');
                this.data = JSON.parse(content);
                console.log(`[UuidStorage] Loaded ${Object.keys(this.data).length} UUID mappings`);
            }
        } catch (e) {
            console.error('[UuidStorage] Failed to load storage:', e);
            this.data = {};
        }
    }

    private save(): void {
        try {
            fs.writeFileSync(this.storagePath, JSON.stringify(this.data, null, 2));
        } catch (e) {
            console.error('[UuidStorage] Failed to save storage:', e);
        }
    }

    private isExpired(timestamp: number): boolean {
        const now = Date.now();
        const expiry = timestamp + EXPIRY_DAYS * 24 * 60 * 60 * 1000;
        return now > expiry;
    }

    public set(uuid: string, linkId: string): void {
        this.data[uuid] = {
            linkId,
            timestamp: Date.now(),
        };
        this.save();
    }

    public get(uuid: string): string | null {
        const stored = this.data[uuid];
        if (!stored) {
            return null;
        }
        if (this.isExpired(stored.timestamp)) {
            delete this.data[uuid];
            this.save();
            return null;
        }
        stored.timestamp = Date.now();
        this.save();
        return stored.linkId;
    }

    public remove(uuid: string): void {
        delete this.data[uuid];
        this.save();
    }

    public removeByLinkId(linkId: string): void {
        const uuidsToRemove: string[] = [];
        for (const [uuid, stored] of Object.entries(this.data)) {
            if (stored.linkId === linkId) {
                uuidsToRemove.push(uuid);
            }
        }
        uuidsToRemove.forEach((uuid) => {
            delete this.data[uuid];
        });
        if (uuidsToRemove.length > 0) {
            this.save();
        }
    }

    public clearExpired(): number {
        const now = Date.now();
        const expiry = EXPIRY_DAYS * 24 * 60 * 60 * 1000;
        const uuidsToRemove: string[] = [];

        for (const [uuid, stored] of Object.entries(this.data)) {
            if (now > stored.timestamp + expiry) {
                uuidsToRemove.push(uuid);
            }
        }

        uuidsToRemove.forEach((uuid) => {
            delete this.data[uuid];
        });

        if (uuidsToRemove.length > 0) {
            this.save();
            console.log(`[UuidStorage] Cleared ${uuidsToRemove.length} expired UUID mappings`);
        }

        return uuidsToRemove.length;
    }

    private startCleanupInterval(): void {
        setInterval(() => {
            this.clearExpired();
        }, 60 * 60 * 1000);
    }

    public getAll(): UuidStorageData {
        return { ...this.data };
    }
}
