import { Service } from './Service';
import dgram from 'dgram';
import { MwFactory } from '../mw/Mw';

interface UdpClient {
    address: string;
    port: number;
    lastSeen: number;
}

export class UdpServer implements Service {
    private static instance?: UdpServer;
    private server?: dgram.Socket;
    private port: number = 8888;
    private clients: Map<string, UdpClient> = new Map();
    private mwFactories: Set<MwFactory> = new Set();
    private cleanupInterval?: NodeJS.Timeout;

    protected constructor() {
        // nothing here
    }

    public static getInstance(): UdpServer {
        if (!this.instance) {
            this.instance = new UdpServer();
        }
        return this.instance;
    }

    public static hasInstance(): boolean {
        return !!this.instance;
    }

    public registerMw(mwFactory: MwFactory): void {
        this.mwFactories.add(mwFactory);
    }

    public addClient(address: string, port: number): void {
        const clientKey = `${address}:${port}`;
        this.clients.set(clientKey, {
            address,
            port,
            lastSeen: Date.now()
        });
        console.log(`[UdpServer] Client connected: ${clientKey}, total: ${this.clients.size}`);
    }

    public removeClient(address: string, port: number): void {
        const clientKey = `${address}:${port}`;
        this.clients.delete(clientKey);
        console.log(`[UdpServer] Client disconnected: ${clientKey}, total: ${this.clients.size}`);
    }

    public broadcast(data: Buffer): void {
        if (this.clients.size === 0) {
            return;
        }

        this.clients.forEach((client, clientKey) => {
            this.server?.send(data, client.port, client.address, (err) => {
                if (err) {
                    console.error(`[UdpServer] Broadcast error to ${clientKey}: ${err}`);
                    this.removeClient(client.address, client.port);
                }
            });
        });
    }

    public getClientsCount(): number {
        return this.clients.size;
    }

    public getName(): string {
        return `UDP Server Service`;
    }

    public async start(): Promise<void> {
        this.server = dgram.createSocket('udp4');

        this.server.on('message', (_msg, rinfo) => {
            // 处理客户端消息
            console.log(`[UdpServer] Received message from ${rinfo.address}:${rinfo.port}`);
            // 更新客户端最后活跃时间
            this.addClient(rinfo.address, rinfo.port);
        });

        this.server.on('error', (err) => {
            console.error(`[UdpServer] Error: ${err}`);
            this.server?.close();
        });

        this.server.on('listening', () => {
            const address = this.server?.address();
            console.log(`[UdpServer] Listening on ${address?.address}:${address?.port}`);
        });

        this.server.bind(this.port);

        // 启动客户端清理定时器
        this.startCleanupTimer();
    }

    private startCleanupTimer(): void {
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            const timeout = 60000; // 60秒超时

            this.clients.forEach((client, clientKey) => {
                if (now - client.lastSeen > timeout) {
                    console.log(`[UdpServer] Client timeout: ${clientKey}`);
                    this.removeClient(client.address, client.port);
                }
            });
        }, 30000); // 每30秒检查一次
    }

    public release(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.server?.close();
        this.clients.clear();
    }
}
