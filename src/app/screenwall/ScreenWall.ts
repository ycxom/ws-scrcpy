import { TypedEmitter } from '../../common/TypedEmitter';
import { ParamsBase } from '../../types/ParamsBase';
import { ACTION } from '../../common/Action';
import { ScreenWallLink, ScreenWallMessage } from '../../types/ScreenWall';
import SvgImage from '../ui/SvgImage';

type ScreenWallParams = ParamsBase;

class ScreenWallBase extends TypedEmitter<Record<string, never>> {
    protected title = '屏幕墙';
    protected params: ScreenWallParams;

    protected constructor(params: ScreenWallParams) {
        super();
        this.params = params;
    }

    public setTitle(text = this.title): void {
        let titleTag: HTMLTitleElement | null = document.querySelector('head > title');
        if (!titleTag) {
            titleTag = document.createElement('title');
        }
        titleTag.innerText = text;
    }

    public setBodyClass(text: string): void {
        document.body.className = text;
    }
}

export class ScreenWall extends ScreenWallBase {
    public static readonly ACTION = ACTION.SCREEN_WALL;
    private links: ScreenWallLink[] = [];
    private ws: WebSocket | null = null;
    private gridColumns: number = 0;
    private gridRows: number = 0;

    constructor() {
        super({ action: ScreenWall.ACTION });
        this.setBodyClass('screen-wall');
        this.initUI();
        this.connect();
    }

    private buildUrl(params: Record<string, string>): string {
        const url = new URL(window.location.href);
        Object.entries(params).forEach(([key, value]) => {
            url.searchParams.set(key, value);
        });
        return url.toString();
    }

    protected initUI(): void {
        document.body.innerHTML = '';
        const container = document.createElement('div');
        container.id = 'screen-wall-container';
        container.innerHTML = this.getTemplate();
        document.body.appendChild(container);
        
        this.loadGridConfig();
        this.bindEvents();
        this.bindGridConfigEvents();
    }

    private getTemplate(): string {
        return `
            <div id="screen-wall-header">
                <h1>屏幕墙</h1>
                <div class="screen-wall-controls">
                    <div class="grid-config">
                        <label>
                            列数:
                            <input type="number" id="grid-columns" min="0" max="10" value="0" placeholder="自动">
                        </label>
                        <label>
                            行数:
                            <input type="number" id="grid-rows" min="0" max="10" value="0" placeholder="自动">
                        </label>
                        <button id="apply-grid-config" class="screen-wall-btn screen-wall-btn-primary">应用</button>
                    </div>
                </div>
            </div>
            <div id="screen-wall-grid" class="screen-wall-grid">
                ${this.getEmptyTemplate()}
            </div>
        `;
    }

    private getEmptyTemplate(): string {
        const displayIcon = SvgImage.create(SvgImage.Icon.MENU);
        return `
            <div class="screen-wall-empty">
                <div class="screen-wall-empty-icon">${displayIcon.outerHTML}</div>
                <div class="screen-wall-empty-text">屏幕墙为空</div>
                <div class="screen-wall-empty-hint">点击"添加链接"添加屏幕</div>
            </div>
        `;
    }

    private connect(): void {
        const url = this.buildUrl({ action: ScreenWall.ACTION });
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
            console.log('[屏幕墙] 已连接');
        };

        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data) as ScreenWallMessage & { links?: ScreenWallLink[] };
                this.handleMessage(message);
            } catch (e) {
                console.error('[屏幕墙] 解析消息失败:', e);
            }
        };

        this.ws.onclose = () => {
            console.log('[屏幕墙] 已断开');
        };

        this.ws.onerror = (error) => {
            console.error('[屏幕墙] 错误:', error);
        };
    }

    private handleMessage(message: ScreenWallMessage & { links?: ScreenWallLink[] }): void {
        if (message.links) {
            this.links = message.links;
            this.render();
        }
    }

    private render(): void {
        const grid = document.getElementById('screen-wall-grid');
        if (!grid) return;

        if (this.links.length === 0) {
            grid.innerHTML = this.getEmptyTemplate();
            return;
        }

        this.adjustGridLayout(grid, this.links.length);

        grid.innerHTML = this.links.map((link) => this.getCardTemplate(link)).join('');
        this.bindEvents();
    }

    private getCardTemplate(link: ScreenWallLink): string {
        const bitrateKbps = Math.round((link.bitrate || 200000) / 1000);
        const fps = link.maxFps || 10;
        const streamUrl = this.buildStreamUrl(link);
        
        return `
            <div class="screen-wall-card" data-link-id="${link.id}" data-udid="${encodeURIComponent(link.udid || link.id)}" data-ws="${encodeURIComponent(link.url || '')}">
                <div class="screen-wall-card-preview">
                    <iframe src="${streamUrl}" class="card-iframe" frameborder="0" scrolling="no"></iframe>
                    <div class="card-click-overlay" title="点击进入控制模式"></div>
                    <span class="no-signal hidden" id="no-signal-${link.id}">无信号</span>
                    <div class="screen-wall-card-info">
                        <span class="screen-wall-card-name" title="${link.name}">${link.name}</span>
                        <span class="screen-wall-card-status">
                            <span class="status-dot offline" id="status-dot-${link.id}"></span>
                            ${bitrateKbps}kbps / ${fps}fps
                        </span>
                    </div>
                </div>
            </div>
        `;
    }
    
    private bindEvents(): void {
        const grid = document.getElementById('screen-wall-grid');
        if (!grid) return;
        
        grid.addEventListener('click', (e) => {
            console.log('[ScreenWall] Click event triggered');
            const card = (e.target as HTMLElement).closest('.screen-wall-card');
            if (card) {
                const linkId = card.getAttribute('data-link-id');
                console.log('[ScreenWall] Navigating to control, linkId:', linkId);
                this.navigateToControl(linkId || '');
            }
        });
    }
    
    private buildStreamUrl(link: ScreenWallLink): string {
        const url = new URL(window.location.href);
        // 屏幕墙使用独立的视频设置，避免与控制模式冲突
        // 默认使用较低的码率和帧率以节省带宽
        const screenWallParams = new URLSearchParams({
            bitrate: '2000000',     // 2Mbps
            maxFps: '15',          // 15fps
            maxSize: '1920',       // 最大1080p
            iFrameInterval: '5',
            sendFrameMeta: 'false',
        });
        
        const uuid = link.uuid || link.id;
        
        url.hash = `#!action=stream&uuid=${encodeURIComponent(uuid)}&player=webcodecs&hiddenUI=true&${screenWallParams.toString()}`;
        
        return url.toString();
    }

    private navigateToControl(linkId: string): void {
        // 从 this.links 中找到对应的 link
        const link = this.links.find(l => l.id === linkId);
        if (!link) {
            console.error('[ScreenWall] Link not found:', linkId);
            return;
        }
        
        const uuid = link.uuid || link.id;
        
        const hash = `#!action=stream&uuid=${encodeURIComponent(uuid)}&player=webcodecs`;
        console.log('[ScreenWall] Setting hash:', hash);
        window.location.hash = hash;
        window.location.reload();
    }

    private adjustGridLayout(grid: HTMLElement, deviceCount: number): void {
        if (this.gridColumns > 0) {
            grid.style.gridTemplateColumns = `repeat(${this.gridColumns}, 1fr)`;
            grid.classList.remove('dynamic-layout');
            grid.classList.add('custom-layout');
        } else {
            let columns: number;
            
            if (deviceCount === 1) {
                columns = 1;
            } else if (deviceCount === 2) {
                columns = 2;
            } else if (deviceCount <= 4) {
                columns = 2;
            } else if (deviceCount <= 6) {
                columns = 3;
            } else if (deviceCount <= 9) {
                columns = 3;
            } else {
                columns = 4;
            }

            grid.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
            grid.classList.add('dynamic-layout');
            grid.classList.remove('custom-layout');
        }
        grid.style.gap = '20px';
        grid.style.rowGap = '20px';
        grid.style.columnGap = '20px';
    }

    private loadGridConfig(): void {
        try {
            const savedColumns = localStorage.getItem('screen-wall-columns');
            const savedRows = localStorage.getItem('screen-wall-rows');
            
            if (savedColumns) {
                this.gridColumns = parseInt(savedColumns, 10);
                const columnsInput = document.getElementById('grid-columns') as HTMLInputElement;
                if (columnsInput) {
                    columnsInput.value = this.gridColumns.toString();
                }
            }
            
            if (savedRows) {
                this.gridRows = parseInt(savedRows, 10);
                const rowsInput = document.getElementById('grid-rows') as HTMLInputElement;
                if (rowsInput) {
                    rowsInput.value = this.gridRows.toString();
                }
            }
        } catch (e) {
            console.error('[ScreenWall] 加载网格配置失败:', e);
        }
    }

    private saveGridConfig(): void {
        try {
            if (this.gridColumns > 0) {
                localStorage.setItem('screen-wall-columns', this.gridColumns.toString());
            } else {
                localStorage.removeItem('screen-wall-columns');
            }
            
            if (this.gridRows > 0) {
                localStorage.setItem('screen-wall-rows', this.gridRows.toString());
            } else {
                localStorage.removeItem('screen-wall-rows');
            }
        } catch (e) {
            console.error('[ScreenWall] 保存网格配置失败:', e);
        }
    }

    private bindGridConfigEvents(): void {
        const applyButton = document.getElementById('apply-grid-config');
        if (applyButton) {
            applyButton.addEventListener('click', () => {
                const columnsInput = document.getElementById('grid-columns') as HTMLInputElement;
                const rowsInput = document.getElementById('grid-rows') as HTMLInputElement;
                
                this.gridColumns = columnsInput ? parseInt(columnsInput.value, 10) || 0 : 0;
                this.gridRows = rowsInput ? parseInt(rowsInput.value, 10) || 0 : 0;
                
                this.saveGridConfig();
                
                if (this.links.length > 0) {
                    const grid = document.getElementById('screen-wall-grid');
                    if (grid) {
                        this.adjustGridLayout(grid, this.links.length);
                    }
                }
            });
        }
    }

    public static parseParameters(_params: URLSearchParams): ScreenWallParams {
        return {
            action: ACTION.SCREEN_WALL,
        };
    }
}
