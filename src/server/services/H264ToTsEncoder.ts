/**
 * 将 H.264 流转换为 MPEG-TS 流
 * 基于简易 TS 封装器
 */

// TS 包常量
const TS_PACKET_SIZE = 188;
const SYNC_BYTE = 0x47;

// PES 头常量
const PES_START_CODE_PREFIX = 0x000001;
const STREAM_ID_VIDEO = 0xE0;

export class H264ToTsEncoder {
    private frameCount: number = 0;

    constructor() {
    }

    /**
     * 将 H.264 帧封装为 TS 包
     */
    public encodeFrame(h264Data: Buffer): Buffer[] {
        const tsPackets: Buffer[] = [];
        
        // 创建 PES 包
        const pesPacket = this.createPesPacket(h264Data);
        
        // 将 PES 包分割为 TS 包
        let offset = 0;
        let packetCounter = 0;
        while (offset < pesPacket.length) {
            const isFirst = (packetCounter === 0);
            const tsPacket = this.createTsPacket(
                pesPacket,
                offset,
                isFirst
            );
            tsPackets.push(tsPacket);
            
            const dataLen = Math.min(TS_PACKET_SIZE - 4, pesPacket.length - offset);
            offset += dataLen;
            packetCounter++;
        }
        
        return tsPackets;
    }

    /**
     * 创建 PES 包
     */
    private createPesPacket(h264Data: Buffer): Buffer {
        // 添加 start code + NALU 起始码
        const naluWithStartCode = Buffer.concat([
            Buffer.from([0x00, 0x00, 0x00, 0x01]),
            h264Data
        ]);

        const pesHeaderLength = 14;
        const pesPacketLength = naluWithStartCode.length + pesHeaderLength;
        
        const pesPacket = Buffer.alloc(pesPacketLength);
        
        let offset = 0;
        
        // PES start code prefix
        pesPacket.writeUIntBE(PES_START_CODE_PREFIX, offset, 3);
        offset += 3;
        
        // Stream ID
        pesPacket.writeUInt8(STREAM_ID_VIDEO, offset);
        offset += 1;
        
        // PES packet length
        pesPacket.writeUInt16BE(naluWithStartCode.length + 8, offset);
        offset += 2;
        
        // PES header
        pesPacket.writeUInt8(0x80, offset);
        offset += 1;
        
        // PES header flags
        pesPacket.writeUInt8(0x80, offset);
        offset += 1;
        
        // PES header data length
        pesPacket.writeUInt8(0x05, offset);
        offset += 1;
        
        // PTS
        const pts = Math.floor(Date.now() * 90000 / 1000);
        this.writePtsDts(pesPacket, offset, pts, 0x2);
        offset += 5;
        
        // 数据
        naluWithStartCode.copy(pesPacket, offset);
        
        return pesPacket;
    }

    private writePtsDts(buffer: Buffer, offset: number, pts: number, flags: number): void {
        let byte0 = (flags << 4) | (((pts >> 30) & 0x07) << 1) | 1;
        buffer.writeUInt8(byte0, offset);
        offset++;
        
        let byte1 = (((pts >> 15) & 0xff) << 1) | 1;
        buffer.writeUInt16BE(byte1 << 8 | 1, offset);
        offset += 2;
        
        let byte2 = (((pts) & 0x7fff) << 1) | 1;
        buffer.writeUInt16BE(byte2 << 8 | 1, offset);
        offset += 2;
    }

    /**
     * 创建单个 TS 包
     */
    private createTsPacket(
        data: Buffer, dataOffset: number, isFirst: boolean): Buffer {
        const tsPacket = Buffer.alloc(TS_PACKET_SIZE);
        let offset = 0;
        
        // 同步字节
        tsPacket.writeUInt8(SYNC_BYTE, offset);
        offset++;
        
        // Transport error indicator, Payload unit start, Transport priority
        let byte1 = 0x40;
        if (isFirst) {
            byte1 |= 0x40;
        }
        tsPacket.writeUInt8(byte1, offset);
        offset++;
        
        // PID
        tsPacket.writeUInt16BE(0x0100, offset);
        offset++;
        offset++;
        
        // Transport scrambling control, Adaptation field control, Continuity counter
        tsPacket.writeUInt8(0x10 | (this.frameCount & 0x0f), offset);
        offset++;
        
        // 数据
        const dataLen = Math.min(TS_PACKET_SIZE - 4, data.length - dataOffset);
        data.copy(tsPacket, offset, dataOffset, dataOffset + dataLen);
        
        this.frameCount++;
        this.frameCount = this.frameCount & 0x0f;
        
        return tsPacket;
    }
}

// 一个更简单的 TS 封装器 - 将所有数据连续写入 TS 格式
export class SimpleTsMuxer {
    private encoder: H264ToTsEncoder;
    
    constructor() {
        this.encoder = new H264ToTsEncoder();
    }
    
    public addH264Frame(data: Buffer): Buffer {
        const tsPackets = this.encoder.encodeFrame(data);
        
        const fullBuffer = Buffer.concat(tsPackets);
        return fullBuffer;
    }
}
