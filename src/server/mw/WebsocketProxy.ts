import { Mw, RequestParameters } from './Mw';
import WS from 'ws';
import { ACTION } from '../../common/Action';
import { Multiplexer } from '../../packages/multiplexer/Multiplexer';
import { ScreenWallService } from './ScreenWallMw';
import { HlsStreamService } from '../services/HlsStreamService';
import { SimpleTsMuxer } from '../services/H264ToTsEncoder';

export class WebsocketProxy extends Mw {
    public static readonly TAG = 'WebsocketProxy';
    private remoteSocket?: WS;
    private released = false;
    private storage: WS.MessageEvent[] = [];
    private udid?: string;
    private hlsStreamActive: boolean = false;
    private tsMuxer?: SimpleTsMuxer;
    private frameBuffer: Buffer[] = [];
    private frameCount: number = 0;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public static processRequest(ws: WS, params: RequestParameters): WebsocketProxy | undefined {
        const { action, url } = params;
        if (action !== ACTION.PROXY_WS) {
            return;
        }
        const wsString = url.searchParams.get('ws');
        if (!wsString) {
            ws.close(4003, `[${this.TAG}] Invalid value "${ws}" for "ws" parameter`);
            return;
        }
        const udidParam = url.searchParams.get('udid');
        const udid = udidParam !== null ? udidParam : undefined;
        return this.createProxy(ws, wsString, udid);
    }

    public static createProxy(ws: WS | Multiplexer, remoteUrl: string, udid?: string): WebsocketProxy {
        const service = new WebsocketProxy(ws);
        if (udid) {
            service.setUdid(udid);
        }
        service.init(remoteUrl).catch((e) => {
            const msg = `[${this.TAG}] Failed to start service: ${e.message}`;
            console.error(msg);
            ws.close(4005, msg);
        });
        return service;
    }

    constructor(ws: WS | Multiplexer) {
        super(ws);
    }
    
    public setUdid(udid: string): void {
        this.udid = udid;
        console.log(`[${WebsocketProxy.TAG}] Set udid: ${udid}`);
    }
    
    private initHlsStream(): void {
        if (!this.udid) {
            return;
        }
        try {
            HlsStreamService.getInstance().createStream(this.udid);
            this.hlsStreamActive = true;
            this.tsMuxer = new SimpleTsMuxer();
            console.log(`[${WebsocketProxy.TAG}] HLS stream started for ${this.udid}`);
        } catch (e) {
            console.error(`[${WebsocketProxy.TAG}] Failed to start HLS stream:`, e);
        }
    }
    
    private addHlsFrame(data: Buffer): void {
        if (!this.hlsStreamActive || !this.udid || !this.tsMuxer) {
            return;
        }
        try {
            // 简单的缓冲区策略：每 15 帧创建一个 TS 片段
            this.frameBuffer.push(data);
            this.frameCount++;
            
            if (this.frameCount >= 15) {
                const combinedData = Buffer.concat(this.frameBuffer);
                const tsData = this.tsMuxer.addH264Frame(combinedData);
                HlsStreamService.getInstance().addSegment(this.udid, tsData);
                this.frameBuffer = [];
                this.frameCount = 0;
            }
        } catch (e) {
            console.error(`[${WebsocketProxy.TAG}] Failed to add HLS frame:`, e);
        }
    }

    public async init(remoteUrl: string): Promise<void> {
        this.name = `[${WebsocketProxy.TAG}{$${remoteUrl}}]`;
        const remoteSocket = new WS(remoteUrl);
        remoteSocket.onopen = () => {
            this.remoteSocket = remoteSocket;
            this.flush();
            // 如果有屏幕墙客户端，初始化 HLS 流
            if (ScreenWallService.getInstance().getClientCount() > 0) {
                this.initHlsStream();
            }
        };
        remoteSocket.onmessage = (event) => {
            if (this.ws && this.ws.readyState === this.ws.OPEN) {
                if (Array.isArray(event.data)) {
                    event.data.forEach((data) => {
                        this.ws.send(data);
                        // 发送到 HLS 流
                        this.sendToHls(data);
                    });
                } else {
                    this.ws.send(event.data);
                    // 发送到 HLS 流
                    this.sendToHls(event.data);
                }
            }
        };
        remoteSocket.onclose = (e) => {
            if (this.ws.readyState === this.ws.OPEN) {
                this.ws.close(e.wasClean ? 1000 : 4010);
            }
        };
        remoteSocket.onerror = (e) => {
            if (this.ws.readyState === this.ws.OPEN) {
                this.ws.close(4011, e.message);
            }
        };
    }

    private flush(): void {
        if (this.remoteSocket) {
            while (this.storage.length) {
                const event = this.storage.shift();
                if (event && event.data) {
                    this.remoteSocket.send(event.data);
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
            this.remoteSocket.send(event.data);
        } else {
            this.storage.push(event);
        }
    }

    private sendToHls(data: any): void {
        if (!this.udid) return;
        
        // 确保数据是 Buffer 或 Uint8Array
        let buffer: Buffer;
        if (data instanceof Buffer) {
            buffer = data;
        } else if (data instanceof ArrayBuffer) {
            buffer = Buffer.from(data);
        } else if (data instanceof Uint8Array) {
            buffer = Buffer.from(data);
        } else {
            return; // 不是视频数据，跳过
        }
        
        // 如果 HLS 流未激活但有屏幕墙客户端，初始化
        if (!this.hlsStreamActive && ScreenWallService.getInstance().getClientCount() > 0) {
            this.initHlsStream();
        }
        
        // 如果 HLS 流激活了，添加帧
        if (this.hlsStreamActive) {
            this.addHlsFrame(buffer);
        }
    }

    public release(): void {
        if (this.released) {
            return;
        }
        // 清理 HLS 流
        if (this.udid && this.hlsStreamActive) {
            try {
                HlsStreamService.getInstance().removeStream(this.udid);
            } catch (e) {
                console.error(`[${WebsocketProxy.TAG}] Error removing HLS stream:`, e);
            }
        }
        super.release();
        this.released = true;
        this.flush();
    }
}
