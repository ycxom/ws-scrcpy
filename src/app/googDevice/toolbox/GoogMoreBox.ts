import '../../../style/morebox.css';
import { BasePlayer } from '../../player/BasePlayer';
import { TextControlMessage } from '../../controlMessage/TextControlMessage';
import { CommandControlMessage } from '../../controlMessage/CommandControlMessage';
import { ControlMessage } from '../../controlMessage/ControlMessage';
import Size from '../../Size';
import DeviceMessage from '../DeviceMessage';
import VideoSettings from '../../VideoSettings';
import { StreamClientScrcpy } from '../client/StreamClientScrcpy';

const TAG = '[GoogMoreBox]';

export class GoogMoreBox {
    private static defaultSize = new Size(1920, 1920);
    private onStop?: () => void;
    private onHide?: () => void;
    private readonly holder: HTMLElement;
    private readonly overlay: HTMLElement;
    private readonly input: HTMLTextAreaElement;
    private readonly bitrateInput?: HTMLInputElement;
    private readonly bitrateUnitSelect?: HTMLSelectElement;
    private readonly maxFpsInput?: HTMLInputElement;
    private readonly iFrameIntervalInput?: HTMLInputElement;
    private readonly maxWidthInput?: HTMLInputElement;
    private readonly maxHeightInput?: HTMLInputElement;

    private static readonly BITRATE_UNITS = [
        { label: 'Mbps', value: 1000000 },
        { label: 'Kbps', value: 1000 },
        { label: 'bps', value: 1 },
    ];

    private static convertBitrateToDisplay(bitrate: number, unit: number): number {
        return Math.round(bitrate / unit);
    }

    private static convertBitrateFromDisplay(value: number, unit: number): number {
        return value * unit;
    }

    constructor(udid: string, private player: BasePlayer, private client: StreamClientScrcpy) {
        const playerName = player.getName();
        const videoSettings = player.getVideoSettings();
        const { displayId } = videoSettings;
        const preferredSettings = player.getPreferredVideoSetting();

        // 创建遮罩层
        this.overlay = document.createElement('div');
        this.overlay.className = 'more-box-overlay';
        document.body.appendChild(this.overlay);

        // 点击遮罩层关闭侧边栏
        this.overlay.addEventListener('click', () => {
            this.hide();
        });

        // 创建侧边栏
        const moreBox = document.createElement('div');
        moreBox.className = 'more-box';
        const nameBox = document.createElement('p');
        nameBox.innerText = `${udid} (${playerName})`;
        nameBox.className = 'text-with-shadow';
        moreBox.appendChild(nameBox);
        const input = (this.input = document.createElement('textarea'));
        input.classList.add('text-area');
        const sendButton = document.createElement('button');
        sendButton.innerText = '作为按键发送';

        const inputWrapper = GoogMoreBox.wrap('p', [input, sendButton], moreBox);
        sendButton.onclick = () => {
            if (input.value) {
                client.sendMessage(new TextControlMessage(input.value));
            }
        };

        const commands: HTMLElement[] = [];
        const codes = CommandControlMessage.Commands;
        for (const [action, command] of codes.entries()) {
            const btn = document.createElement('button');
            let bitrateInput: HTMLInputElement;
            let maxFpsInput: HTMLInputElement;
            let iFrameIntervalInput: HTMLInputElement;
            let maxWidthInput: HTMLInputElement;
            let maxHeightInput: HTMLInputElement;
            if (action === ControlMessage.TYPE_CHANGE_STREAM_PARAMETERS) {
                const spoiler = document.createElement('div');
                const spoilerLabel = document.createElement('label');
                const spoilerCheck = document.createElement('input');

                const innerDiv = document.createElement('div');
                const id = `spoiler_video_${udid}_${playerName}_${displayId}_${action}`;

                spoiler.className = 'spoiler';
                spoilerCheck.type = 'checkbox';
                spoilerCheck.id = id;
                spoilerLabel.htmlFor = id;
                spoilerLabel.innerText = command;
                innerDiv.className = 'box';
                spoiler.appendChild(spoilerCheck);
                spoiler.appendChild(spoilerLabel);
                spoiler.appendChild(innerDiv);

                const bitrateLabel = document.createElement('label');
                bitrateLabel.innerText = '码率:';
                bitrateInput = document.createElement('input');
                const DEFAULT_UNIT = 1000000;
                const bitrateInMbps = GoogMoreBox.convertBitrateToDisplay(videoSettings.bitrate, DEFAULT_UNIT);
                bitrateInput.placeholder = `${GoogMoreBox.convertBitrateToDisplay(
                    preferredSettings.bitrate,
                    DEFAULT_UNIT,
                )}`;
                bitrateInput.value = bitrateInMbps.toString();

                const bitrateUnitSelect = document.createElement('select');
                GoogMoreBox.BITRATE_UNITS.forEach((unit) => {
                    const option = document.createElement('option');
                    option.value = unit.value.toString();
                    option.text = unit.label;
                    if (unit.value === DEFAULT_UNIT) {
                        option.selected = true;
                    }
                    bitrateUnitSelect.appendChild(option);
                });

                const bitrateWrapper = document.createElement('div');
                bitrateWrapper.style.display = 'flex';
                bitrateWrapper.style.gap = '5px';
                bitrateWrapper.appendChild(bitrateInput);
                bitrateWrapper.appendChild(bitrateUnitSelect);
                GoogMoreBox.wrap('div', [bitrateLabel, bitrateWrapper], innerDiv);
                this.bitrateInput = bitrateInput;
                this.bitrateUnitSelect = bitrateUnitSelect;

                const maxFpsLabel = document.createElement('label');
                maxFpsLabel.innerText = '最大帧率:';
                maxFpsInput = document.createElement('input');
                maxFpsInput.placeholder = `${preferredSettings.maxFps} fps`;
                maxFpsInput.value = videoSettings.maxFps.toString();
                GoogMoreBox.wrap('div', [maxFpsLabel, maxFpsInput], innerDiv);
                this.maxFpsInput = maxFpsInput;

                const iFrameIntervalLabel = document.createElement('label');
                iFrameIntervalLabel.innerText = '关键帧间隔:';
                iFrameIntervalInput = document.createElement('input');
                iFrameIntervalInput.placeholder = `${preferredSettings.iFrameInterval} 秒`;
                iFrameIntervalInput.value = videoSettings.iFrameInterval.toString();
                GoogMoreBox.wrap('div', [iFrameIntervalLabel, iFrameIntervalInput], innerDiv);
                this.iFrameIntervalInput = iFrameIntervalInput;

                const { width, height } = videoSettings.bounds || client.getMaxSize() || GoogMoreBox.defaultSize;
                const pWidth = preferredSettings.bounds?.width || width;
                const pHeight = preferredSettings.bounds?.height || height;

                const maxWidthLabel = document.createElement('label');
                maxWidthLabel.innerText = '最大宽度:';
                maxWidthInput = document.createElement('input');
                maxWidthInput.placeholder = `${pWidth} px`;
                maxWidthInput.value = width.toString();
                GoogMoreBox.wrap('div', [maxWidthLabel, maxWidthInput], innerDiv);
                this.maxWidthInput = maxWidthInput;

                const maxHeightLabel = document.createElement('label');
                maxHeightLabel.innerText = '最大高度:';
                maxHeightInput = document.createElement('input');
                maxHeightInput.placeholder = `${pHeight} px`;
                maxHeightInput.value = height.toString();
                GoogMoreBox.wrap('div', [maxHeightLabel, maxHeightInput], innerDiv);
                this.maxHeightInput = maxHeightInput;

                innerDiv.appendChild(btn);
                const fitButton = document.createElement('button');
                fitButton.innerText = '适配屏幕';
                fitButton.onclick = this.fit;
                innerDiv.insertBefore(fitButton, innerDiv.firstChild);
                const resetButton = document.createElement('button');
                resetButton.innerText = '重置';
                resetButton.onclick = this.reset;
                innerDiv.insertBefore(resetButton, innerDiv.firstChild);
                commands.push(spoiler);
            } else {
                if (
                    action === CommandControlMessage.TYPE_SET_CLIPBOARD ||
                    action === CommandControlMessage.TYPE_GET_CLIPBOARD
                ) {
                    inputWrapper.appendChild(btn);
                } else {
                    commands.push(btn);
                }
            }
            btn.innerText = command;
            if (action === ControlMessage.TYPE_CHANGE_STREAM_PARAMETERS) {
                btn.onclick = () => {
                    const bitrateValue = parseInt(bitrateInput.value, 10);
                    const unitValue = parseInt(this.bitrateUnitSelect!.value, 10);
                    const bitrate = isNaN(bitrateValue)
                        ? 0
                        : GoogMoreBox.convertBitrateFromDisplay(bitrateValue, unitValue);
                    const maxFps = parseInt(maxFpsInput.value, 10);
                    const iFrameInterval = parseInt(iFrameIntervalInput.value, 10);
                    if (isNaN(bitrate) || isNaN(maxFps)) {
                        return;
                    }
                    const width = parseInt(maxWidthInput.value, 10) & ~15;
                    const height = parseInt(maxHeightInput.value, 10) & ~15;
                    const bounds = new Size(width, height);
                    const current = player.getVideoSettings();
                    const { lockedVideoOrientation, sendFrameMeta, displayId, codecOptions, encoderName } = current;

                    const videoSettings = new VideoSettings({
                        bounds,
                        bitrate,
                        maxFps,
                        iFrameInterval,
                        lockedVideoOrientation,
                        sendFrameMeta,
                        displayId,
                        codecOptions,
                        encoderName,
                    });
                    client.sendNewVideoSetting(videoSettings);
                    
                    let fitToScreen = false;
                    const maxSize = client.getMaxSize();
                    if (maxSize && bounds && bounds.equals(maxSize)) {
                        fitToScreen = true;
                    }
                    
                    console.log('[GoogMoreBox] Saving user changed video settings:', { bitrate, maxFps, iFrameInterval, bounds, fitToScreen });
                    
                    const playerClass = Object.getPrototypeOf(player).constructor;
                    playerClass.putVideoSettingsToStorage(
                        player.storageKeyPrefix,
                        player.udid,
                        videoSettings,
                        fitToScreen,
                        player.displayInfo,
                    );
                    
                    player.setVideoSettings(videoSettings, fitToScreen, false);
                };
            } else if (action === CommandControlMessage.TYPE_SET_CLIPBOARD) {
                btn.onclick = () => {
                    const text = input.value;
                    if (text) {
                        client.sendMessage(CommandControlMessage.createSetClipboardCommand(text));
                    }
                };
            } else {
                btn.onclick = () => {
                    client.sendMessage(new CommandControlMessage(action));
                };
            }
        }
        GoogMoreBox.wrap('p', commands, moreBox);

        // 屏幕电源控制按钮 - 直接显示两个独立按钮
        const screenOffButton = document.createElement('button');
        screenOffButton.innerText = '熄灭屏幕';
        screenOffButton.onclick = () => {
            const message = CommandControlMessage.createSetScreenPowerModeCommand(false);
            client.sendMessage(message);
        };

        const screenOnButton = document.createElement('button');
        screenOnButton.innerText = '点亮屏幕';
        screenOnButton.onclick = () => {
            const message = CommandControlMessage.createSetScreenPowerModeCommand(true);
            client.sendMessage(message);
        };

        GoogMoreBox.wrap('p', [screenOffButton, screenOnButton], moreBox, ['flex-center']);

        const qualityId = `show_video_quality_${udid}_${playerName}_${displayId}`;
        const qualityLabel = document.createElement('label');
        const qualityCheck = document.createElement('input');
        qualityCheck.type = 'checkbox';
        qualityCheck.checked = BasePlayer.DEFAULT_SHOW_QUALITY_STATS;
        qualityCheck.id = qualityId;
        qualityLabel.htmlFor = qualityId;
        qualityLabel.innerText = '显示质量统计';
        GoogMoreBox.wrap('p', [qualityCheck, qualityLabel], moreBox, ['flex-center']);
        qualityCheck.onchange = () => {
            player.setShowQualityStats(qualityCheck.checked);
        };

        const stop = (ev?: string | Event) => {
            if (ev && ev instanceof Event && ev.type === 'error') {
                console.error(TAG, ev);
            }
            const parent = moreBox.parentElement;
            if (parent) {
                parent.removeChild(moreBox);
            }
            const overlayParent = this.overlay.parentElement;
            if (overlayParent) {
                overlayParent.removeChild(this.overlay);
            }
            if (this.onStop) {
                this.onStop();
                delete this.onStop;
            }
        };

        const stopBtn = document.createElement('button') as HTMLButtonElement;
        stopBtn.innerText = `断开连接`;
        stopBtn.onclick = stop;

        GoogMoreBox.wrap('p', [stopBtn], moreBox);
        player.on('video-settings', this.onVideoSettings);
        this.holder = moreBox;
    }

    public show(): void {
        this.overlay.classList.add('show');
        this.holder.classList.add('show');
    }

    public hide(): void {
        this.overlay.classList.remove('show');
        this.holder.classList.remove('show');
        if (this.onHide) {
            this.onHide();
        }
    }

    public toggle(): void {
        if (this.holder.classList.contains('show')) {
            this.hide();
        } else {
            this.show();
        }
    }

    public setOnHide(callback: () => void): void {
        this.onHide = callback;
    }

    private onVideoSettings = (videoSettings: VideoSettings): void => {
        if (this.bitrateInput && this.bitrateUnitSelect) {
            const unitValue = parseInt(this.bitrateUnitSelect.value, 10);
            this.bitrateInput.value = GoogMoreBox.convertBitrateToDisplay(videoSettings.bitrate, unitValue).toString();
        }
        if (this.maxFpsInput) {
            this.maxFpsInput.value = videoSettings.maxFps.toString();
        }
        if (this.iFrameIntervalInput) {
            this.iFrameIntervalInput.value = videoSettings.iFrameInterval.toString();
        }
        if (videoSettings.bounds) {
            const { width, height } = videoSettings.bounds;
            if (this.maxWidthInput) {
                this.maxWidthInput.value = width.toString();
            }
            if (this.maxHeightInput) {
                this.maxHeightInput.value = height.toString();
            }
        }
    };

    private fit = (): void => {
        const { width, height } = this.client.getMaxSize() || GoogMoreBox.defaultSize;
        if (this.maxWidthInput) {
            this.maxWidthInput.value = width.toString();
        }
        if (this.maxHeightInput) {
            this.maxHeightInput.value = height.toString();
        }
    };

    private reset = (): void => {
        const preferredSettings = this.player.getPreferredVideoSetting();
        this.onVideoSettings(preferredSettings);
    };

    public OnDeviceMessage(ev: DeviceMessage): void {
        if (ev.type !== DeviceMessage.TYPE_CLIPBOARD) {
            return;
        }
        this.input.value = ev.getText();
        this.input.select();
        document.execCommand('copy');
    }

    private static wrap(
        tagName: string,
        elements: HTMLElement[],
        parent: HTMLElement,
        opt_classes?: string[],
    ): HTMLElement {
        const wrap = document.createElement(tagName);
        if (opt_classes) {
            wrap.classList.add(...opt_classes);
        }
        elements.forEach((e) => {
            wrap.appendChild(e);
        });
        parent.appendChild(wrap);
        return wrap;
    }

    public getHolderElement(): HTMLElement {
        return this.holder;
    }

    public setOnStop(listener: () => void): void {
        this.onStop = listener;
    }
}
