import WS from 'ws';
import { Mw, RequestParameters } from './Mw';
import { ACTION } from '../../common/Action';
import { ScreenWallLink, ScreenWallDevice, ScreenWallMessage } from '../../types/ScreenWall';
import { Multiplexer } from '../../packages/multiplexer/Multiplexer';
import GoogDeviceDescriptor from '../../types/GoogDeviceDescriptor';
import { UuidStorage } from '../UuidStorage';

let ControlCenter: any;

try {
    const controlCenterModule = require('../goog-device/services/ControlCenter');
    ControlCenter = controlCenterModule.ControlCenter;
} catch (e) {
    console.error('[ScreenWallMw] Failed to import ControlCenter:', e);
}

export class ScreenWallService {
    private static instance?: ScreenWallService;
    private links: Map<string, ScreenWallLink> = new Map();
    private devices: Map<string, ScreenWallDevice> = new Map();
    private clients: Set<WS> = new Set();
    private proxies: Map<string, ScreenWallProxy> = new Map();
    private autoAddedDevices: Set<string> = new Set();
    private uuidToLinkId: Map<string, string> = new Map();
    private linkIdToUuid: Map<string, string> = new Map();
    private uuidStorage: UuidStorage;

    public static readonly DEFAULT_MAX_FPS = 10;
    public static readonly DEFAULT_BITRATE = 200000;
    public static readonly MAX_BITRATE = 8000000;
    public static readonly MIN_BITRATE = 100000;

    private constructor() {
        this.uuidStorage = UuidStorage.getInstance();
        this.clearAllLinks();
        this.initAutoDiscovery();
        this.loadSavedUuids();
    }

    private clearAllLinks(): void {
        for (const linkId of Array.from(this.links.keys())) {
            if (linkId.startsWith('auto_')) {
                this.removeLink(linkId);
            }
        }
        this.autoAddedDevices.clear();
        console.log('[ScreenWallMw] Cleared all auto-added links');
    }

    private initAutoDiscovery(): void {
        if (!ControlCenter) {
            console.log('[ScreenWallMw] ControlCenter not available, auto discovery disabled');
            return;
        }

        try {
            const controlCenter = ControlCenter.getInstance();
            controlCenter.init();

            controlCenter.on('device', (device: GoogDeviceDescriptor) => {
                this.handleDeviceUpdate(device);
            });

            const existingDevices = controlCenter.getDevices();
            existingDevices.forEach((device: any) => this.handleDeviceUpdate(device));
        } catch (e) {
            console.error('[ScreenWallMw] Failed to init auto discovery:', e);
        }
    }

    private handleDeviceUpdate(device: any): void {
        const udid = device.udid;
        const linkId = `auto_${udid}`;
        
        if (device.state === 'device') {
            let deviceName = device['ro.product.model'] || device.udid;
            let deviceUrl = '';

            if (device.pid !== -1) {
                const proxyUrl = new URL('http://localhost:3003');
                proxyUrl.pathname = '/';
                proxyUrl.searchParams.set('action', 'proxy-adb');
                proxyUrl.searchParams.set('remote', 'tcp:8886');
                proxyUrl.searchParams.set('udid', udid);
                
                deviceUrl = proxyUrl.toString();
            }

            const link: ScreenWallLink = {
                id: linkId,
                name: deviceName,
                url: deviceUrl,
                bitrate: ScreenWallService.DEFAULT_BITRATE,
                maxFps: ScreenWallService.DEFAULT_MAX_FPS,
                useProxy: true,
                udid: udid,
            };

            if (this.autoAddedDevices.has(udid)) {
                this.removeLink(linkId);
                this.addLink(link);
                console.log(`[ScreenWallMw] Auto-updated device: ${deviceName} (${udid})`);
            } else {
                this.autoAddedDevices.add(udid);
                this.addLink(link);
                console.log(`[ScreenWallMw] Auto-added device: ${deviceName} (${udid})`);
            }
        } else {
            if (this.autoAddedDevices.has(udid)) {
                this.autoAddedDevices.delete(udid);
                this.removeLink(linkId);
                console.log(`[ScreenWallMw] Auto-removed device: ${device['ro.product.model'] || udid} (${udid})`);
            }
        }
    }

    public static getInstance(): ScreenWallService {
        if (!this.instance) {
            this.instance = new ScreenWallService();
        }
        return this.instance;
    }

    public addClient(ws: WS): void {
        this.clients.add(ws);
        this.sendList(ws);
        console.log(`[ScreenWallService] Client connected, total: ${this.clients.size}`);
    }

    public removeClient(ws: WS): void {
        this.clients.delete(ws);
        console.log(`[ScreenWallService] Client disconnected, total: ${this.clients.size}`);
        // 如果没有屏幕墙客户端了，可以通知 UDP 服务器停止广播
        if (this.clients.size === 0) {
            console.log('[ScreenWallService] No more screen wall clients, stopping UDP broadcast');
        }
    }

    public addLink(link: ScreenWallLink): void {
        const id = link.id || `link_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const fullLink: ScreenWallLink = {
            ...link,
            id,
            bitrate: link.bitrate || ScreenWallService.DEFAULT_BITRATE,
            maxFps: link.maxFps || ScreenWallService.DEFAULT_MAX_FPS,
            useProxy: link.useProxy !== undefined ? link.useProxy : true,
        };
        this.links.set(id, fullLink);
        this.getOrCreateUuid(id);
        this.broadcast({
            type: 'add',
            data: fullLink,
        });
    }

    public removeLink(id: string): boolean {
        this.removeUuidMappings(id);
        const deleted = this.links.delete(id);
        if (deleted) {
            this.broadcast({ type: 'remove', data: { id } as ScreenWallLink });
        }
        return deleted;
    }

    public updateLink(id: string, updates: Partial<ScreenWallLink>): ScreenWallLink | null {
        const link = this.links.get(id);
        if (!link) return null;
        const updated = { ...link, ...updates };
        this.links.set(id, updated);
        this.broadcast({ type: 'update', data: updated });
        return updated;
    }

    public getLinks(): ScreenWallLink[] {
        return Array.from(this.links.values());
    }

    public getLink(id: string): ScreenWallLink | undefined {
        return this.links.get(id);
    }

    public addDevice(device: ScreenWallDevice): void {
        this.devices.set(device.id, device);
        this.broadcast({ type: 'status', data: device });
    }

    public updateDeviceStatus(id: string, status: ScreenWallDevice['status']): void {
        const device = this.devices.get(id);
        if (device) {
            device.status = status;
            this.broadcast({ type: 'status', data: device });
        }
    }

    public getDevices(): ScreenWallDevice[] {
        return Array.from(this.devices.values());
    }

    public getClientCount(): number {
        return this.clients.size;
    }

    private sendList(ws: WS): void {
        const message: ScreenWallMessage = {
            type: 'list',
            data: undefined,
        };
        const linksWithUuid = this.getLinks().map(link => ({
            ...link,
            uuid: this.getOrCreateUuid(link.id),
        }));
        if (ws.readyState === WS.OPEN) {
            ws.send(JSON.stringify({ ...message, links: linksWithUuid }));
        }
    }

    private broadcast(message: ScreenWallMessage): void {
        const data = JSON.stringify(message);
        this.clients.forEach((client) => {
            if (client.readyState === WS.OPEN) {
                client.send(data);
            }
        });
    }

    public createProxy(linkId: string, ws: WS | Multiplexer): ScreenWallProxy | null {
        const link = this.links.get(linkId);
        if (!link) return null;

        const proxy = new ScreenWallProxy(link, ws);
        this.proxies.set(linkId, proxy);
        return proxy;
    }

    public removeProxy(linkId: string): void {
        const proxy = this.proxies.get(linkId);
        if (proxy) {
            proxy.release();
            this.proxies.delete(linkId);
        }
    }

    public getProxy(linkId: string): ScreenWallProxy | undefined {
        return this.proxies.get(linkId);
    }

    private generateUuid(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    private loadSavedUuids(): void {
        const savedData = this.uuidStorage.getAll();
        for (const [uuid, stored] of Object.entries(savedData)) {
            this.uuidToLinkId.set(uuid, stored.linkId);
            this.linkIdToUuid.set(stored.linkId, uuid);
        }
        console.log(`[ScreenWallService] Loaded ${Object.keys(savedData).length} saved UUID mappings`);
    }

    public getOrCreateUuid(linkId: string): string {
        let uuid = this.linkIdToUuid.get(linkId);
        if (!uuid) {
            uuid = this.generateUuid();
            this.linkIdToUuid.set(linkId, uuid);
            this.uuidToLinkId.set(uuid, linkId);
            this.uuidStorage.set(uuid, linkId);
        }
        return uuid;
    }

    public getLinkByUuid(uuid: string): ScreenWallLink | undefined {
        const linkId = this.uuidToLinkId.get(uuid);
        if (linkId) {
            const link = this.links.get(linkId);
            if (link) {
                this.uuidStorage.get(uuid);
            }
            return link;
        }
        
        const storedLinkId = this.uuidStorage.get(uuid);
        if (storedLinkId) {
            const link = this.links.get(storedLinkId);
            if (link) {
                this.uuidToLinkId.set(uuid, storedLinkId);
                this.linkIdToUuid.set(storedLinkId, uuid);
            }
            return link;
        }
        return undefined;
    }

    public removeUuidMappings(linkId: string): void {
        const uuid = this.linkIdToUuid.get(linkId);
        if (uuid) {
            this.linkIdToUuid.delete(linkId);
            this.uuidToLinkId.delete(uuid);
            this.uuidStorage.remove(uuid);
        }
        this.uuidStorage.removeByLinkId(linkId);
    }
}

export class ScreenWallProxy extends Mw {
    public static readonly TAG = 'ScreenWallProxy';
    private remoteSocket?: WS;
    private released = false;
    private storage: Buffer[] = [];
    private link: ScreenWallLink;

    constructor(
        _link: ScreenWallLink,
        ws: WS | Multiplexer,
    ) {
        super(ws);
        this.link = _link;
        this.init(_link.url);
    }

    private async init(remoteUrl: string): Promise<void> {
        this.name = `[${ScreenWallProxy.TAG}{${remoteUrl}}]`;

        try {
            let wsUrl = remoteUrl;
            
            const url = new URL(remoteUrl);
            const action = url.searchParams.get('action');

            if (action === 'proxy-adb') {
                const wsProxyUrl = new URL(remoteUrl);
                wsProxyUrl.protocol = wsProxyUrl.protocol === 'https:' ? 'wss:' : 'ws:';
                wsUrl = wsProxyUrl.toString();
            } else if (this.link.useProxy) {
                const proxyUrl = new URL('http://localhost:3003');
                proxyUrl.pathname = '/';
                proxyUrl.search = '';
                proxyUrl.hash = '';
                proxyUrl.searchParams.set('action', 'proxy-ws');
                proxyUrl.searchParams.set('ws', remoteUrl);
                proxyUrl.protocol = 'ws:';
                wsUrl = proxyUrl.toString();
            } else if (!remoteUrl.startsWith('ws://') && !remoteUrl.startsWith('wss://')) {
                const wsUrlObj = new URL(remoteUrl);
                wsUrlObj.protocol = wsUrlObj.protocol === 'https:' ? 'wss:' : 'ws:';
                wsUrl = wsUrlObj.toString();
            }

            this.remoteSocket = new WS(wsUrl);

            this.remoteSocket.onopen = () => {
                console.log(`[${this.name}] Connected to remote`);
                this.flush();
            };

            this.remoteSocket.onmessage = (event) => {
                if (this.ws && (this.ws as WS).readyState === (this.ws as WS).OPEN) {
                    if (Array.isArray(event.data)) {
                        event.data.forEach((data) => (this.ws as WS).send(data));
                    } else {
                        (this.ws as WS).send(event.data);
                    }
                }
            };

            this.remoteSocket.onclose = (e) => {
                console.log(`[${this.name}] Remote closed: ${e.code}`);
                if ((this.ws as WS).readyState === (this.ws as WS).OPEN) {
                    (this.ws as WS).close(e.wasClean ? 1000 : 4010);
                }
            };

            this.remoteSocket.onerror = (e) => {
                console.error(`[${this.name}] Remote error:`, e);
                if ((this.ws as WS).readyState === (this.ws as WS).OPEN) {
                    (this.ws as WS).close(4011, 'Remote connection error');
                }
            };
        } catch (e) {
            console.error(`[${this.name}] Failed to connect:`, e);
            (this.ws as WS).close(4004, 'Invalid URL');
        }
    }

    private flush(): void {
        if (this.remoteSocket) {
            while (this.storage.length) {
                const data = this.storage.shift();
                if (data) {
                    this.remoteSocket.send(data);
                }
            }
            if (this.released) {
                this.remoteSocket.close();
            }
        }
        this.storage.length = 0;
    }

    protected onSocketMessage(event: WS.MessageEvent): void {
        if (this.remoteSocket) {
            if (typeof event.data === 'string') {
                this.remoteSocket.send(event.data);
            } else if (event.data instanceof Buffer) {
                this.remoteSocket.send(event.data);
            } else if (ArrayBuffer.isView(event.data)) {
                this.remoteSocket.send(Buffer.from(event.data as ArrayBuffer));
            }
        }
    }

    public release(): void {
        if (this.released) {
            return;
        }
        super.release();
        this.released = true;
        this.flush();
        if (this.remoteSocket) {
            this.remoteSocket.close();
        }
    }

    public updateSettings(bitrate?: number, maxFps?: number): void {
        if (bitrate !== undefined) {
            this.link.bitrate = bitrate;
        }
        if (maxFps !== undefined) {
            this.link.maxFps = maxFps;
        }
    }
}

export class ScreenWallMw extends Mw {
    public static readonly TAG = 'ScreenWallMw';
    private service: ScreenWallService;

    public static processRequest(ws: WS, params: RequestParameters): ScreenWallMw | undefined {
        const { action } = params;
        if (action !== ACTION.SCREEN_WALL && action !== ACTION.SCREEN_WALL_DEVICE) {
            return;
        }
        return this.createService(ws, params);
    }

    private static createService(ws: WS, params: RequestParameters): ScreenWallMw {
        const service = new ScreenWallMw(ws);
        service.init(params);
        return service;
    }

    constructor(ws: WS | Multiplexer) {
        super(ws);
        this.service = ScreenWallService.getInstance();
    }

    private init(params: RequestParameters): void {
        const { action, url } = params;
        this.name = `[${ScreenWallMw.TAG}]`;

        if (action === ACTION.SCREEN_WALL) {
            this.service.addClient(this.ws as WS);
            this.ws.addEventListener('close', () => {
                this.service.removeClient(this.ws as WS);
            });
        } else if (action === ACTION.SCREEN_WALL_DEVICE) {
            const linkId = url.searchParams.get('linkId');
            if (linkId) {
                const proxy = this.service.createProxy(linkId, this.ws);
                if (!proxy) {
                    (this.ws as WS).close(4003, 'Link not found');
                    return;
                }
                this.ws.addEventListener('close', () => {
                    this.service.removeProxy(linkId);
                });
            } else {
                (this.ws as WS).close(4003, 'Missing linkId parameter');
            }
        }
    }

    protected onSocketMessage(event: WS.MessageEvent): void {
        try {
            const data = JSON.parse(event.data as string);
            const { action: messageAction, data: messageData } = data;

            switch (messageAction) {
                case 'add':
                    this.service.addLink(messageData as ScreenWallLink);
                    break;
                case 'update':
                    if (messageData && messageData.id) {
                        this.service.updateLink(messageData.id, messageData);
                    }
                    break;
                case 'remove':
                    if (messageData && messageData.id) {
                        this.service.removeLink(messageData.id);
                    }
                    break;
            }
        } catch (e) {
            console.error(`[${ScreenWallMw.TAG}] Failed to handle message:`, e);
        }
    }
}
