export interface ScreenWallLink {
    id: string;
    name: string;
    url: string;
    bitrate?: number;
    maxFps?: number;
    useProxy?: boolean;
    udid?: string;
}

export interface ScreenWallDevice {
    id: string;
    name: string;
    url: string;
    host: string;
    port: number;
    secure: boolean;
    bitrate: number;
    maxFps: number;
    status: 'online' | 'offline' | 'connecting';
}

export interface ScreenWallConfig {
    maxFps: number;
    defaultBitrate: number;
    maxBitrate: number;
    minBitrate: number;
}

export interface ScreenWallMessage {
    type: 'add' | 'remove' | 'update' | 'list' | 'status';
    data?: ScreenWallLink | ScreenWallDevice;
    error?: string;
}

export interface ScreenWallLinkParams {
    url: string;
    name?: string;
    bitrate?: number;
    maxFps?: number;
}
