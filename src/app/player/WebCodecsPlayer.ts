import { BaseCanvasBasedPlayer } from './BaseCanvasBasedPlayer';
import VideoSettings from '../VideoSettings';
import Size from '../Size';
import { DisplayInfo } from '../DisplayInfo';
import H264Parser from 'h264-converter/dist/h264-parser';
import NALU from 'h264-converter/dist/util/NALU';
import ScreenInfo from '../ScreenInfo';
import Rect from '../Rect';

type ParametersSubSet = {
    codec: string;
    width: number;
    height: number;
};

function toHex(value: number) {
    return value.toString(16).padStart(2, '0').toUpperCase();
}

export class WebCodecsPlayer extends BaseCanvasBasedPlayer {
    public static readonly storageKeyPrefix = 'WebCodecsPlayer';
    public static readonly playerFullName = 'WebCodecs';
    public static readonly playerCodeName = 'webcodecs';

    public static readonly preferredVideoSettings: VideoSettings = new VideoSettings({
        lockedVideoOrientation: -1,
        bitrate: 524288,
        maxFps: 24,
        iFrameInterval: 5,
        bounds: new Size(1920, 1920),
        sendFrameMeta: false,
    });

    public static isSupported(): boolean {
        if (typeof VideoDecoder !== 'function' || typeof VideoDecoder.isConfigSupported !== 'function') {
            return false;
        }

        // FIXME: verify support
        // const result = await VideoDecoder.isConfigSupported();
        return true;
    }

    private static parseSPS(data: Uint8Array): ParametersSubSet {
        const {
            profile_idc,
            constraint_set_flags,
            level_idc,
            pic_width_in_mbs_minus1,
            frame_crop_left_offset,
            frame_crop_right_offset,
            frame_mbs_only_flag,
            pic_height_in_map_units_minus1,
            frame_crop_top_offset,
            frame_crop_bottom_offset,
            sar,
        } = H264Parser.parseSPS(data);

        const sarScale = sar[0] / sar[1];
        const codec = `avc1.${[profile_idc, constraint_set_flags, level_idc].map(toHex).join('')}`;
        const width = Math.ceil(
            ((pic_width_in_mbs_minus1 + 1) * 16 - frame_crop_left_offset * 2 - frame_crop_right_offset * 2) * sarScale,
        );
        const height =
            (2 - frame_mbs_only_flag) * (pic_height_in_map_units_minus1 + 1) * 16 -
            (frame_mbs_only_flag ? 2 : 4) * (frame_crop_top_offset + frame_crop_bottom_offset);
        return { codec, width, height };
    }

    public readonly supportsScreenshot = true;
    private context: CanvasRenderingContext2D;
    private decoder: VideoDecoder;
    private buffer: ArrayBuffer | undefined;
    private hadIDR = false;
    private bufferedSPS = false;
    private bufferedPPS = false;
    private resizeObserver?: ResizeObserver;

    constructor(udid: string, displayInfo?: DisplayInfo, name = WebCodecsPlayer.playerFullName) {
        super(udid, displayInfo, name, WebCodecsPlayer.storageKeyPrefix);
        const context = this.tag.getContext('2d');
        if (!context) {
            throw Error('Failed to get 2d context from canvas');
        }
        this.context = context;
        this.decoder = this.createDecoder();
    }

    private createDecoder(): VideoDecoder {
        return new VideoDecoder({
            output: (frame) => {
                this.onFrameDecoded(0, 0, frame);
            },
            error: (error: DOMException) => {
                console.warn('[WebCodecsPlayer] Decode error (non-fatal):', error.message);
            },
        });
    }

    protected addToBuffer(data: Uint8Array): Uint8Array {
        let array: Uint8Array;
        if (this.buffer) {
            array = new Uint8Array(this.buffer.byteLength + data.byteLength);
            array.set(new Uint8Array(this.buffer));
            array.set(new Uint8Array(data), this.buffer.byteLength);
        } else {
            array = data;
        }
        this.buffer = array.buffer as ArrayBuffer;
        return array;
    }

    protected scaleCanvas(width: number, height: number): void {
        const screenInfo = new ScreenInfo(new Rect(0, 0, width, height), new Size(width, height), 0);
        this.emit('input-video-resize', screenInfo);
        this.setScreenInfo(screenInfo);

        // FIXME: canvas was initialized from `.setScreenInfo()` call above, but with wrong values
        this.initCanvas(width, height);
        
        // 延迟应用缩放，确保 parent 元素已经布局好
        requestAnimationFrame(() => {
            this.applyScaling();
        });
    }

    private applyScaling(): void {
        if (!this.parentElement) {
            return;
        }
        const containerWidth = this.parentElement.clientWidth;
        const containerHeight = this.parentElement.clientHeight;
        const videoWidth = this.tag.width;
        const videoHeight = this.tag.height;

        if (videoWidth === 0 || videoHeight === 0 || containerWidth === 0 || containerHeight === 0) {
            return;
        }

        // 确保完整显示视频，不裁剪，适用于屏幕墙模式和控制模式
        const scaleX = containerWidth / videoWidth;
        const scaleY = containerHeight / videoHeight;
        const scale = Math.min(scaleX, scaleY);

        this.tag.style.transform = `translate(-50%, -50%) scale(${scale})`;
        this.touchableCanvas.style.transform = `translate(-50%, -50%) scale(${scale})`;
    }

    protected decode(data: Uint8Array): void {
        if (!data || data.length < 4) {
            return;
        }
        const type = data[4] & 31;
        const isIDR = type === NALU.IDR;

        if (type === NALU.SPS) {
            const { codec, width, height } = WebCodecsPlayer.parseSPS(data.subarray(4));
            this.scaleCanvas(width, height);
            const config: VideoDecoderConfig = {
                codec,
                optimizeForLatency: true,
            } as VideoDecoderConfig;
            this.decoder.configure(config);
            this.bufferedSPS = true;
            this.addToBuffer(data);
            this.hadIDR = false;
            return;
        } else if (type === NALU.PPS) {
            this.bufferedPPS = true;
            this.addToBuffer(data);
            return;
        } else if (type === NALU.SEI) {
            // Workaround for lonely SEI from ws-qvh
            if (!this.bufferedSPS || !this.bufferedPPS) {
                return;
            }
        }
        const array = this.addToBuffer(data);
        this.hadIDR = this.hadIDR || isIDR;
        if (array && this.decoder.state === 'configured' && this.hadIDR) {
            this.buffer = undefined;
            this.bufferedPPS = false;
            this.bufferedSPS = false;
            try {
                this.decoder.decode(
                    new EncodedVideoChunk({
                        type: isIDR ? 'key' : 'delta',
                        timestamp: 0,
                        data: array.buffer,
                    }),
                );
            } catch (e) {
                console.warn('[WebCodecsPlayer] Decode failed, skipping:', e);
            }
            return;
        }
    }

    protected drawDecoded = (): void => {
        if (this.receivedFirstFrame) {
            const data = this.decodedFrames.shift();
            if (data) {
                const frame: VideoFrame = data.frame;
                this.context.drawImage(frame, 0, 0);
                frame.close();
            }
        }
        if (this.decodedFrames.length) {
            this.animationFrameId = requestAnimationFrame(this.drawDecoded);
        } else {
            this.animationFrameId = undefined;
        }
    };

    protected dropFrame(frame: VideoFrame): void {
        frame.close();
    }

    public getFitToScreenStatus(): boolean {
        return false;
    }

    public getPreferredVideoSetting(): VideoSettings {
        return WebCodecsPlayer.preferredVideoSettings;
    }

    public loadVideoSettings(): VideoSettings {
        return WebCodecsPlayer.loadVideoSettings(this.udid, this.displayInfo);
    }

    protected needScreenInfoBeforePlay(): boolean {
        return false;
    }

    public setParent(parent: HTMLElement): void {
        super.setParent(parent);
        
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
        
        this.resizeObserver = new ResizeObserver(() => {
            this.applyScaling();
        });
        
        this.resizeObserver.observe(parent);
    }

    public stop(): void {
        super.stop();
        if (this.decoder.state === 'configured') {
            this.decoder.close();
        }
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = undefined;
        }
    }
}
