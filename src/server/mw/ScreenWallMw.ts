import WS from 'ws';
import { Mw, RequestParameters } from './Mw';
import { ACTION } from '../../common/Action';
import { ScreenWallLink, ScreenWallDevice, ScreenWallMessage } from '../../types/ScreenWall';
import { Multiplexer } from '../../packages/multiplexer/Multiplexer';
import GoogDeviceDescriptor from '../../types/GoogDeviceDescriptor';

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

    public static readonly DEFAULT_MAX_FPS = 10;
    public static readonly DEFAULT_BITRATE = 200000;
    public static readonly MAX_BITRATE = 8000000;
    public static readonly MIN_BITRATE = 100000;

    private constructor() {
        this.initAutoDiscovery();
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
            if (this.autoAddedDevices.has(udid)) {
                return;
            }

            let deviceName = device['ro.product.model'] || device.udid;
            let deviceUrl = '';

            if (device.interfaces && device.interfaces.length > 0) {
                for (const iface of device.interfaces) {
                    if (iface.ipv4 && iface.ipv4 !== '127.0.0.1') {
                        deviceUrl = `ws://${iface.ipv4}:8886`;
                        break;
                    }
                }
            }

            if (!deviceUrl && device.pid !== -1) {
                deviceUrl = `ws://localhost:8886`;
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

            this.autoAddedDevices.add(udid);
            this.addLink(link);
            console.log(`[ScreenWallMw] Auto-added device: ${deviceName} (${udid})`);
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
        this.broadcast({
            type: 'add',
            data: fullLink,
        });
    }

    public removeLink(id: string): boolean {
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
        if (ws.readyState === WS.OPEN) {
            ws.send(JSON.stringify({ ...message, links: this.getLinks() }));
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
            const url = new URL(remoteUrl);
            let wsUrl = remoteUrl;

            if (this.link.useProxy) {
                const proxyUrl = new URL('/?action=proxy-ws', `${url.protocol}//${url.host}`);
                proxyUrl.searchParams.set('ws', remoteUrl);
                wsUrl = proxyUrl.toString();
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
