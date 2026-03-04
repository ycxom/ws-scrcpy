import { Service } from './Service';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface HlsStream {
    id: string;
    outputDir: string;
    segments: string[];
    latestSegmentIndex: number;
    m3u8Content: string;
    startedAt: number;
}

export class HlsStreamService implements Service {
    private static instance?: HlsStreamService;
    private streams: Map<string, HlsStream> = new Map();
    private baseOutputDir: string;

    private constructor() {
        this.baseOutputDir = path.join(process.cwd(), 'hls-streams');
        this.ensureOutputDir();
    }

    public static getInstance(): HlsStreamService {
        if (!this.instance) {
            this.instance = new HlsStreamService();
        }
        return this.instance;
    }
    
    public static hasInstance(): boolean {
        return !!this.instance;
    }

    private ensureOutputDir(): void {
        if (!fs.existsSync(this.baseOutputDir)) {
            fs.mkdirSync(this.baseOutputDir, { recursive: true });
        }
    }

    public createStream(udid: string): HlsStream {
        const streamId = crypto.randomBytes(8).toString('hex');
        const streamDir = path.join(this.baseOutputDir, streamId);
        fs.mkdirSync(streamDir, { recursive: true });

        const stream: HlsStream = {
            id: streamId,
            outputDir: streamDir,
            segments: [],
            latestSegmentIndex: -1,
            m3u8Content: this.generateInitialM3u8(),
            startedAt: Date.now(),
        };

        this.streams.set(udid, stream);
        console.log(`[HlsStreamService] Created stream for ${udid}, id: ${streamId}`);
        return stream;
    }

    private generateInitialM3u8(): string {
        return `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:0
`;
    }

    public addSegment(udid: string, data: Buffer): void {
        const stream = this.streams.get(udid);
        if (!stream) {
            return;
        }

        stream.latestSegmentIndex++;
        const segmentFilename = `segment-${stream.latestSegmentIndex}.ts`;
        const segmentPath = path.join(stream.outputDir, segmentFilename);
        fs.writeFileSync(segmentPath, data);

        stream.segments.push(segmentFilename);
        this.updateM3u8(stream);
    }

    private updateM3u8(stream: HlsStream): void {
        let m3u8 = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:0
`;
        stream.segments.forEach(segment => {
            m3u8 += `#EXTINF:2.0,
${segment}
`;
        });
        stream.m3u8Content = m3u8;

        const m3u8Path = path.join(stream.outputDir, 'stream.m3u8');
        fs.writeFileSync(m3u8Path, m3u8);
    }

    public getStreamM3u8(udid: string): string | null {
        const stream = this.streams.get(udid);
        return stream ? stream.m3u8Content : null;
    }

    public getSegment(udid: string, segmentName: string): Buffer | null {
        const stream = this.streams.get(udid);
        if (!stream) return null;

        const segmentPath = path.join(stream.outputDir, segmentName);
        if (fs.existsSync(segmentPath)) {
            return fs.readFileSync(segmentPath);
        }
        return null;
    }

    public getStreamUrl(udid: string, host: string): string | null {
        const stream = this.streams.get(udid);
        if (!stream) return null;
        return `http://${host}/hls/${udid}/stream.m3u8`;
    }

    public removeStream(udid: string): void {
        const stream = this.streams.get(udid);
        if (stream) {
            try {
                if (fs.existsSync(stream.outputDir)) {
                    const rimraf = require('rimraf');
                    rimraf.sync(stream.outputDir);
                }
            } catch (e) {
                console.error(`[HlsStreamService] Error cleaning up stream ${stream.id}:`, e);
            }
            this.streams.delete(udid);
            console.log(`[HlsStreamService] Removed stream for ${udid}`);
        }
    }

    public getName(): string {
        return 'HlsStreamService';
    }

    public async start(): Promise<void> {
        console.log('[HlsStreamService] Started');
    }

    public async stop(): Promise<void> {
        for (const udid of this.streams.keys()) {
            this.removeStream(udid);
        }
        console.log('[HlsStreamService] Stopped');
    }
    
    public release(): void {
        this.stop();
    }
}
