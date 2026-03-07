import { BaseClient } from '../../client/BaseClient';
import { ParamsStreamScrcpy } from '../../../types/ParamsStreamScrcpy';
import { GoogMoreBox } from '../toolbox/GoogMoreBox';
import { GoogToolBox } from '../toolbox/GoogToolBox';
import VideoSettings from '../../VideoSettings';
import Size from '../../Size';
import { ControlMessage } from '../../controlMessage/ControlMessage';
import { ClientsStats, DisplayCombinedInfo } from '../../client/StreamReceiver';
import { CommandControlMessage } from '../../controlMessage/CommandControlMessage';
import Util from '../../Util';
import FilePushHandler from '../filePush/FilePushHandler';
import DragAndPushLogger from '../DragAndPushLogger';
import { KeyEventListener, KeyInputHandler } from '../KeyInputHandler';
import { KeyCodeControlMessage } from '../../controlMessage/KeyCodeControlMessage';
import { BasePlayer, PlayerClass } from '../../player/BasePlayer';
import GoogDeviceDescriptor from '../../../types/GoogDeviceDescriptor';
import { ConfigureScrcpy } from './ConfigureScrcpy';
import { DeviceTracker } from './DeviceTracker';
import { ControlCenterCommand } from '../../../common/ControlCenterCommand';
import { html } from '../../ui/HtmlTag';
import {
    FeaturedInteractionHandler,
    InteractionHandlerListener,
} from '../../interactionHandler/FeaturedInteractionHandler';
import DeviceMessage from '../DeviceMessage';
import { DisplayInfo } from '../../DisplayInfo';
import { Attribute } from '../../Attribute';
import { HostTracker } from '../../client/HostTracker';
import { ACTION } from '../../../common/Action';
import { StreamReceiverScrcpy } from './StreamReceiverScrcpy';
import { UdpStreamReceiver } from './UdpStreamReceiver';
import { ParamsDeviceTracker } from '../../../types/ParamsDeviceTracker';
import { ScrcpyFilePushStream } from '../filePush/ScrcpyFilePushStream';

type StartParams = {
    udid: string;
    playerName?: string;
    player?: BasePlayer;
    fitToScreen?: boolean;
    videoSettings?: VideoSettings;
};

const TAG = '[StreamClientScrcpy]';

export class StreamClientScrcpy
    extends BaseClient<ParamsStreamScrcpy, never>
    implements KeyEventListener, InteractionHandlerListener
{
    public static ACTION = 'stream';
    private static players: Map<string, PlayerClass> = new Map<string, PlayerClass>();

    private deviceName = '';
    private clientId = -1;
    private clientsCount = -1;
    private joinedStream = false;
    private requestedVideoSettings?: VideoSettings;
    private touchHandler?: FeaturedInteractionHandler;
    private moreBox?: GoogMoreBox;
    private player?: BasePlayer;
    private filePushHandler?: FilePushHandler;
    private fitToScreen?: boolean;
    private streamStarted = false;
    private readonly streamReceiver: StreamReceiverScrcpy | UdpStreamReceiver;
    private readonly useUdp: boolean;

    public static registerPlayer(playerClass: PlayerClass): void {
        if (playerClass.isSupported()) {
            this.players.set(playerClass.playerFullName, playerClass);
        }
    }

    public static getPlayers(): PlayerClass[] {
        return Array.from(this.players.values());
    }

    private static getPlayerClass(playerName: string): PlayerClass | undefined {
        let playerClass: PlayerClass | undefined;
        for (const value of StreamClientScrcpy.players.values()) {
            if (value.playerFullName === playerName || value.playerCodeName === playerName) {
                playerClass = value;
            }
        }
        if (!playerClass) {
            const availablePlayers = this.getPlayers();
            console.warn(
                `[StreamClientScrcpy] Player "${playerName}" not found. Available players:`,
                availablePlayers.map((p) => p.playerFullName),
            );
            if (availablePlayers.length > 0) {
                const fallback = availablePlayers[0];
                console.warn(`[StreamClientScrcpy] Using fallback player: ${fallback.playerFullName}`);
                return fallback;
            }
            console.error(`[StreamClientScrcpy] No available players found!`);
        }
        console.log(`[StreamClientScrcpy] Returning player class:`, playerClass?.playerFullName);
        return playerClass;
    }

    public static createPlayer(playerName: string, udid: string, displayInfo?: DisplayInfo): BasePlayer | undefined {
        const playerClass = this.getPlayerClass(playerName);
        console.log(
            `[StreamClientScrcpy] createPlayer: playerName=${playerName}, playerClass=${playerClass?.playerFullName}`,
        );
        if (!playerClass) {
            console.error(`[StreamClientScrcpy] createPlayer failed: no player class for "${playerName}"`);
            return;
        }
        return new playerClass(udid, displayInfo);
    }

    public static getFitToScreen(playerName: string, udid: string, displayInfo?: DisplayInfo): boolean {
        const playerClass = this.getPlayerClass(playerName);
        if (!playerClass) {
            return false;
        }
        return playerClass.getFitToScreenStatus(udid, displayInfo);
    }

    public static start(
        query: URLSearchParams | ParamsStreamScrcpy,
        streamReceiver?: StreamReceiverScrcpy,
        player?: BasePlayer,
        fitToScreen?: boolean,
        videoSettings?: VideoSettings,
    ): StreamClientScrcpy {
        if (query instanceof URLSearchParams) {
            const params = StreamClientScrcpy.parseParameters(query);
            return new StreamClientScrcpy(params, streamReceiver, player, fitToScreen, videoSettings);
        } else {
            return new StreamClientScrcpy(query, streamReceiver, player, fitToScreen, videoSettings);
        }
    }

    private static createVideoSettingsWithBounds(old: VideoSettings, newBounds: Size): VideoSettings {
        return new VideoSettings({
            crop: old.crop,
            bitrate: old.bitrate,
            bounds: newBounds,
            maxFps: old.maxFps,
            iFrameInterval: old.iFrameInterval,
            sendFrameMeta: old.sendFrameMeta,
            lockedVideoOrientation: old.lockedVideoOrientation,
            displayId: old.displayId,
            codecOptions: old.codecOptions,
            encoderName: old.encoderName,
        });
    }

    protected constructor(
        params: ParamsStreamScrcpy,
        streamReceiver?: StreamReceiverScrcpy | UdpStreamReceiver,
        player?: BasePlayer,
        fitToScreen?: boolean,
        videoSettings?: VideoSettings,
    ) {
        super(params);
        this.useUdp = false; // 不再使用 UDP
        if (streamReceiver) {
            this.streamReceiver = streamReceiver;
        } else {
            this.streamReceiver = new StreamReceiverScrcpy(this.params);
        }

        if (params.hiddenUI) {
            const style = document.createElement('style');
            style.textContent = `
                body.stream {
                    margin: 0;
                    padding: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 100vw;
                    height: 100vh;
                    overflow: hidden;
                }
                .device-view {
                    float: none !important;
                    max-width: 100% !important;
                    max-height: 100% !important;
                    width: 100% !important;
                    height: 100% !important;
                    display: flex !important;
                }
                .video {
                    float: none !important;
                    width: 100% !important;
                    height: 100% !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    flex: 1 !important;
                }
                .video > div,
                .video > canvas {
                    /* 让 WebCodecsPlayer 的 transform 缩放来处理 */
                }
                .video-layer,
                .touch-layer {
                    /* 让 WebCodecsPlayer 的 transform 缩放来处理 */
                }
            `;
            document.head.appendChild(style);
        }

        const { udid, player: playerName } = this.params;
        this.startStream({ udid, player, playerName, fitToScreen, videoSettings });
        this.setBodyClass('stream');

        if (!params.hiddenUI) {
            this.fitToScreen = true;
        }
    }

    public static parseParameters(params: URLSearchParams): ParamsStreamScrcpy {
        const typedParams = super.parseParameters(params);
        const { action } = typedParams;
        if (action !== ACTION.STREAM_SCRCPY) {
            throw Error('Incorrect action');
        }
        const hiddenUI = Util.parseBoolean(params, 'hiddenUI', false);

        // 解析视频设置参数（屏幕墙模式使用独立的设置）
        let videoSettings: VideoSettings | undefined;
        const bitrate = Util.parseInt(params, 'bitrate', false);
        const maxFps = Util.parseInt(params, 'maxFps', false);
        const maxSize = Util.parseInt(params, 'maxSize', false);
        const iFrameInterval = Util.parseInt(params, 'iFrameInterval', false);

        if (bitrate || maxFps || maxSize) {
            // 从 URL 参数创建设置，不从 localStorage 加载
            videoSettings = new VideoSettings({
                bitrate: bitrate || 8000000,
                maxFps: maxFps || 30,
                bounds: maxSize ? new Size(maxSize, maxSize) : new Size(1920, 1920),
                iFrameInterval: iFrameInterval || 10,
                sendFrameMeta: Util.parseBoolean(params, 'sendFrameMeta', false),
                lockedVideoOrientation: -1,
            });
        }

        return {
            ...typedParams,
            action,
            player: Util.parseString(params, 'player', true),
            udid: Util.parseString(params, 'udid', true),
            ws: Util.parseString(params, 'ws', true),
            uuid: Util.parseString(params, 'uuid', false),
            hiddenUI,
            videoSettings,
        };
    }

    public OnDeviceMessage = (message: DeviceMessage): void => {
        if (this.moreBox) {
            this.moreBox.OnDeviceMessage(message);
        }
    };

    public onVideo = (data: ArrayBuffer): void => {
        if (!this.player) {
            return;
        }
        const STATE = BasePlayer.STATE;
        if (this.player.getState() === STATE.PAUSED) {
            this.player.play();
        }
        if (this.player.getState() === STATE.PLAYING) {
            this.player.pushFrame(new Uint8Array(data));
        }
    };

    public onClientsStats = (stats: ClientsStats): void => {
        this.deviceName = stats.deviceName;
        this.clientId = stats.clientId;
        this.setTitle(`Stream ${this.deviceName}`);
    };

    public onDisplayInfo = (infoArray: DisplayCombinedInfo[]): void => {
        if (!this.player) {
            return;
        }
        let currentSettings = this.player.getVideoSettings();
        const displayId = currentSettings.displayId;
        const info = infoArray.find((value) => {
            return value.displayInfo.displayId === displayId;
        });
        if (!info) {
            return;
        }
        if (this.player.getState() === BasePlayer.STATE.PAUSED) {
            this.player.play();
        }
        const { videoSettings, screenInfo } = info;
        this.player.setDisplayInfo(info.displayInfo);
        if (typeof this.fitToScreen !== 'boolean') {
            this.fitToScreen = this.player.getFitToScreenStatus();
        }
        if (this.fitToScreen) {
            const newBounds = this.getMaxSize();
            if (newBounds) {
                currentSettings = StreamClientScrcpy.createVideoSettingsWithBounds(currentSettings, newBounds);
                this.player.setVideoSettings(currentSettings, this.fitToScreen, false);
            }
        }
        if (!videoSettings || !screenInfo) {
            this.joinedStream = true;
            this.sendMessage(CommandControlMessage.createSetVideoSettingsCommand(currentSettings));
            return;
        }

        this.clientsCount = info.connectionCount;
        let min = VideoSettings.copy(videoSettings);
        const oldInfo = this.player.getScreenInfo();
        if (!screenInfo.equals(oldInfo)) {
            this.player.setScreenInfo(screenInfo);
        }

        if (!videoSettings.equals(currentSettings)) {
            this.applyNewVideoSettings(videoSettings, videoSettings.equals(this.requestedVideoSettings));
        }
        if (!oldInfo) {
            const bounds = currentSettings.bounds;
            const videoSize: Size = screenInfo.videoSize;
            const onlyOneClient = this.clientsCount === 0;
            const smallerThenCurrent = bounds && (bounds.width < videoSize.width || bounds.height < videoSize.height);
            if (onlyOneClient || smallerThenCurrent) {
                min = currentSettings;
            }
            const minBounds = currentSettings.bounds?.intersect(min.bounds);
            if (minBounds && !minBounds.equals(min.bounds)) {
                min = StreamClientScrcpy.createVideoSettingsWithBounds(min, minBounds);
            }
        }
        if (!min.equals(videoSettings) || !this.joinedStream) {
            this.joinedStream = true;
            this.sendMessage(CommandControlMessage.createSetVideoSettingsCommand(min));
        }
    };

    public onDisconnected = (): void => {
        this.streamReceiver.off('deviceMessage', this.OnDeviceMessage);
        this.streamReceiver.off('video', this.onVideo);
        this.streamReceiver.off('clientsStats', this.onClientsStats);
        this.streamReceiver.off('displayInfo', this.onDisplayInfo);
        this.streamReceiver.off('disconnected', this.onDisconnected);

        this.filePushHandler?.release();
        this.filePushHandler = undefined;
        this.touchHandler?.release();
        this.touchHandler = undefined;
    };

    public startStream({ udid, player, playerName, videoSettings, fitToScreen }: StartParams): void {
        if (this.streamStarted) {
            console.log(TAG, 'Stream already started, skipping duplicate startStream call');
            return;
        }
        this.streamStarted = true;

        if (!udid) {
            throw Error(`Invalid udid value: "${udid}"`);
        }

        this.fitToScreen = fitToScreen;
        if (!player) {
            if (typeof playerName !== 'string') {
                throw Error('Must provide BasePlayer instance or playerName');
            }
            let displayInfo: DisplayInfo | undefined;
            if (this.streamReceiver && videoSettings) {
                displayInfo = this.streamReceiver.getDisplayInfo(videoSettings.displayId);
            }
            const p = StreamClientScrcpy.createPlayer(playerName, udid, displayInfo);
            if (!p) {
                throw Error(`Unsupported player: "${playerName}"`);
            }
            const actualPlayerName = p.getName();
            if (typeof fitToScreen !== 'boolean') {
                fitToScreen = StreamClientScrcpy.getFitToScreen(actualPlayerName, udid, displayInfo);
            }
            player = p;
        }
        this.player = player;

        const deviceView = document.createElement('div');
        deviceView.className = 'device-view';

        const isHiddenUI = !!this.params.hiddenUI;

        let moreBoxInstance: GoogMoreBox | undefined;
        let controlButtons: HTMLElement | undefined;
        let stop: ((ev?: string | Event) => void) | undefined;

        stop = (ev?: string | Event) => {
            if (ev && ev instanceof Event && ev.type === 'error') {
                console.error(TAG, ev);
            }
            let parent;
            parent = deviceView.parentElement;
            if (parent) {
                parent.removeChild(deviceView);
            }
            if (moreBoxInstance) {
                const holder = moreBoxInstance.getHolderElement();
                parent = holder.parentElement;
                if (parent) {
                    parent.removeChild(holder);
                }
            }
            // 停止 UDP 接收器（如果使用 UDP）
            if (this.useUdp && 'stopUdp' in this.streamReceiver) {
                this.streamReceiver.stopUdp();
            }
            this.streamReceiver.stop();
            if (this.player) {
                this.player.stop();
            }
        };

        if (!isHiddenUI) {
            const googMoreBox = (this.moreBox = new GoogMoreBox(udid, player, this));
            moreBoxInstance = googMoreBox;
            googMoreBox.setOnStop(stop);
            const googToolBox = GoogToolBox.createToolBox(udid, player, this, moreBoxInstance);
            controlButtons = googToolBox.getHolderElement();
        }

        const video = document.createElement('div');
        video.className = 'video';
        deviceView.appendChild(video);

        const bottomBar = document.createElement('div');
        bottomBar.className = 'bottom-bar';

        if (controlButtons && !isHiddenUI) {
            bottomBar.appendChild(controlButtons);
        }

        deviceView.appendChild(bottomBar);

        if (moreBoxInstance && !isHiddenUI) {
            document.body.appendChild(moreBoxInstance.getHolderElement());
        }

        player.setParent(video);
        player.pause();

        document.body.appendChild(deviceView);

        if (!videoSettings) {
            // 屏幕墙模式使用默认设置，不从 localStorage 加载
            if (isHiddenUI) {
                videoSettings = player.getPreferredVideoSetting();
            } else {
                videoSettings = player.getVideoSettings();
            }
        }

        if (fitToScreen) {
            const newBounds = this.getMaxSize();
            if (newBounds) {
                videoSettings = StreamClientScrcpy.createVideoSettingsWithBounds(videoSettings, newBounds);
            }
        }
        // 屏幕墙模式不保存设置到 localStorage
        this.applyNewVideoSettings(videoSettings, !isHiddenUI);

        if (!isHiddenUI) {
            this.setTouchListeners(player);
            const element = player.getTouchableElement();
            const logger = new DragAndPushLogger(element);
            this.filePushHandler = new FilePushHandler(element, new ScrcpyFilePushStream(this.streamReceiver));
            this.filePushHandler.addEventListener(logger);
        }

        const streamReceiver = this.streamReceiver;
        streamReceiver.on('deviceMessage', this.OnDeviceMessage);
        streamReceiver.on('video', this.onVideo);
        streamReceiver.on('clientsStats', this.onClientsStats);
        streamReceiver.on('displayInfo', this.onDisplayInfo);
        streamReceiver.on('disconnected', this.onDisconnected);

        // 启动 UDP 接收器（如果使用 UDP）
        if (this.useUdp && 'startUdp' in streamReceiver) {
            streamReceiver.startUdp();
        }

        console.log(TAG, player.getName(), udid);
    }

    public sendMessage(message: ControlMessage): void {
        this.streamReceiver.sendEvent(message);
    }

    public getDeviceName(): string {
        return this.deviceName;
    }

    public setHandleKeyboardEvents(enabled: boolean): void {
        if (enabled) {
            KeyInputHandler.addEventListener(this);
        } else {
            KeyInputHandler.removeEventListener(this);
        }
    }

    public onKeyEvent(event: KeyCodeControlMessage): void {
        this.sendMessage(event);
    }

    public sendNewVideoSetting(videoSettings: VideoSettings): void {
        this.requestedVideoSettings = videoSettings;
        this.sendMessage(CommandControlMessage.createSetVideoSettingsCommand(videoSettings));
    }

    public getClientId(): number {
        return this.clientId;
    }

    public getClientsCount(): number {
        return this.clientsCount;
    }

    public getMaxSize(): Size | undefined {
        const body = document.body;
        const bottomBarHeight = 80;
        const width = body.clientWidth & ~15;
        const height = (body.clientHeight - bottomBarHeight) & ~15;
        return new Size(width, height);
    }

    private setTouchListeners(player: BasePlayer): void {
        if (this.touchHandler) {
            return;
        }
        this.touchHandler = new FeaturedInteractionHandler(player, this);
    }

    private applyNewVideoSettings(videoSettings: VideoSettings, saveToStorage: boolean): void {
        let fitToScreen = false;

        // TODO: create control (switch/checkbox) instead
        if (videoSettings.bounds && videoSettings.bounds.equals(this.getMaxSize())) {
            fitToScreen = true;
        }
        if (this.player) {
            this.player.setVideoSettings(videoSettings, fitToScreen, saveToStorage);
        }
    }

    public static createEntryForDeviceList(
        descriptor: GoogDeviceDescriptor,
        blockClass: string,
        fullName: string,
        params: ParamsDeviceTracker,
    ): HTMLElement | DocumentFragment | undefined {
        const hasPid = descriptor.pid !== -1;
        if (hasPid) {
            const configureButtonId = `configure_${Util.escapeUdid(descriptor.udid)}`;
            const e = html`<div class="stream ${blockClass}">
                <button
                    ${Attribute.UDID}="${descriptor.udid}"
                    ${Attribute.COMMAND}="${ControlCenterCommand.CONFIGURE_STREAM}"
                    ${Attribute.FULL_NAME}="${fullName}"
                    ${Attribute.SECURE}="${params.secure}"
                    ${Attribute.HOSTNAME}="${params.hostname}"
                    ${Attribute.PORT}="${params.port}"
                    ${Attribute.PATHNAME}="${params.pathname}"
                    ${Attribute.USE_PROXY}="${params.useProxy}"
                    id="${configureButtonId}"
                    class="active action-button"
                >
                    Configure stream
                </button>
            </div>`;
            const a = e.content.getElementById(configureButtonId);
            a && (a.onclick = this.onConfigureStreamClick);
            return e.content;
        }
        return;
    }

    private static onConfigureStreamClick = (event: MouseEvent): void => {
        const button = event.currentTarget as HTMLAnchorElement;
        const udid = Util.parseStringEnv(button.getAttribute(Attribute.UDID) || '');
        const fullName = button.getAttribute(Attribute.FULL_NAME);
        const secure = Util.parseBooleanEnv(button.getAttribute(Attribute.SECURE) || undefined) || false;
        const hostname = Util.parseStringEnv(button.getAttribute(Attribute.HOSTNAME) || undefined) || '';
        const port = Util.parseIntEnv(button.getAttribute(Attribute.PORT) || undefined);
        const pathname = Util.parseStringEnv(button.getAttribute(Attribute.PATHNAME) || undefined) || '';
        const useProxy = Util.parseBooleanEnv(button.getAttribute(Attribute.USE_PROXY) || undefined);
        if (!udid) {
            throw Error(`Invalid udid value: "${udid}"`);
        }
        if (typeof port !== 'number') {
            throw Error(`Invalid port type: ${typeof port}`);
        }
        const tracker = DeviceTracker.getInstance({
            type: 'android',
            secure,
            hostname,
            port,
            pathname,
            useProxy,
        });
        const descriptor = tracker.getDescriptorByUdid(udid);
        if (!descriptor) {
            return;
        }
        event.preventDefault();
        const elements = document.getElementsByName(`${DeviceTracker.AttributePrefixInterfaceSelectFor}${fullName}`);
        if (!elements || !elements.length) {
            return;
        }
        const select = elements[0] as HTMLSelectElement;
        const optionElement = select.options[select.selectedIndex];
        const ws = optionElement.getAttribute(Attribute.URL);
        const name = optionElement.getAttribute(Attribute.NAME);
        if (!ws || !name) {
            return;
        }
        const options: ParamsStreamScrcpy = {
            udid,
            ws,
            player: '',
            action: ACTION.STREAM_SCRCPY,
            secure,
            hostname,
            port,
            pathname,
            useProxy,
        };
        const dialog = new ConfigureScrcpy(tracker, descriptor, options);
        dialog.on('closed', StreamClientScrcpy.onConfigureDialogClosed);
    };

    private static onConfigureDialogClosed = (event: { dialog: ConfigureScrcpy; result: boolean }): void => {
        event.dialog.off('closed', StreamClientScrcpy.onConfigureDialogClosed);
        if (event.result) {
            HostTracker.getInstance().destroy();
        }
    };
}
