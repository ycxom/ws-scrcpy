import { Optional, ToolBoxElement } from './ToolBoxElement';
import SvgImage, { Icon } from '../ui/SvgImage';

export class ToolBoxMultiButton extends ToolBoxElement<HTMLButtonElement> {
    private readonly btn: HTMLButtonElement;
    private readonly checkbox: HTMLInputElement;
    private readonly container: HTMLDivElement;
    private checked = false;
    private onCheckChange?: (checked: boolean) => void;

    constructor(title: string, icon: Icon, optional?: Optional) {
        super(title, optional);

        // 创建容器
        const container = document.createElement('div');
        container.classList.add('control-button-container');
        container.style.position = 'relative';
        container.style.display = 'inline-block';

        // 创建主按钮
        const btn = document.createElement('button');
        btn.classList.add('control-button');
        btn.title = title;
        btn.appendChild(SvgImage.create(icon));

        // 创建右上角勾选框
        const checkboxWrapper = document.createElement('div');
        checkboxWrapper.classList.add('button-checkbox-wrapper');
        checkboxWrapper.style.cssText = `
            position: absolute;
            top: -4px;
            right: -4px;
            width: 16px;
            height: 16px;
            z-index: 10;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.classList.add('button-checkbox');
        checkbox.style.cssText = `
            width: 14px;
            height: 14px;
            margin: 0;
            cursor: pointer;
            accent-color: #00BEA4;
        `;

        checkboxWrapper.appendChild(checkbox);
        container.appendChild(btn);
        container.appendChild(checkboxWrapper);

        // 勾选框点击事件
        checkboxWrapper.addEventListener('click', (e) => {
            e.stopPropagation();
            checkbox.checked = !checkbox.checked;
            this.checked = checkbox.checked;
            this.updateVisualState();
            this.onCheckChange?.(this.checked);
        });

        // 防止勾选框自身的点击事件冒泡
        checkbox.addEventListener('click', (e) => {
            e.stopPropagation();
            this.checked = checkbox.checked;
            this.updateVisualState();
            this.onCheckChange?.(this.checked);
        });

        this.btn = btn;
        this.checkbox = checkbox;
        this.container = container;
    }

    private updateVisualState(): void {
        if (this.checked) {
            this.btn.classList.add('button-checked');
            this.btn.style.boxShadow = '0 0 0 2px #00BEA4';
        } else {
            this.btn.classList.remove('button-checked');
            this.btn.style.boxShadow = '';
        }
    }

    public isChecked(): boolean {
        return this.checked;
    }

    public setChecked(checked: boolean): void {
        this.checked = checked;
        this.checkbox.checked = checked;
        this.updateVisualState();
    }

    public onCheckedChange(callback: (checked: boolean) => void): void {
        this.onCheckChange = callback;
    }

    public getElement(): HTMLButtonElement {
        return this.btn;
    }

    public getAllElements(): HTMLElement[] {
        return [this.container];
    }

    public getContainer(): HTMLDivElement {
        return this.container;
    }

    public getCheckboxElement(): HTMLInputElement {
        return this.checkbox;
    }
}
