import { ToolBox } from '../../toolbox/ToolBox';
import KeyEvent from '../android/KeyEvent';
import SvgImage from '../../ui/SvgImage';
import { KeyCodeControlMessage } from '../../controlMessage/KeyCodeControlMessage';
import { ToolBoxButton } from '../../toolbox/ToolBoxButton';
import { ToolBoxElement } from '../../toolbox/ToolBoxElement';
import { ToolBoxCheckbox } from '../../toolbox/ToolBoxCheckbox';
import { ToolBoxMultiButton } from '../../toolbox/ToolBoxMultiButton';
import { StreamClientScrcpy } from '../client/StreamClientScrcpy';
import { BasePlayer } from '../../player/BasePlayer';
import { GoogMoreBox } from './GoogMoreBox';

// 支持复选的按钮（电源、音量）
const MULTI_SELECT_BUTTONS = [
    {
        title: '电源',
        code: KeyEvent.KEYCODE_POWER,
        icon: SvgImage.Icon.POWER,
    },
    {
        title: '音量+',
        code: KeyEvent.KEYCODE_VOLUME_UP,
        icon: SvgImage.Icon.VOLUME_UP,
    },
    {
        title: '音量-',
        code: KeyEvent.KEYCODE_VOLUME_DOWN,
        icon: SvgImage.Icon.VOLUME_DOWN,
    },
];

// 普通按钮（返回、主页、多任务）- 不支持复选
const SINGLE_BUTTONS = [
    {
        title: '返回',
        code: KeyEvent.KEYCODE_BACK,
        icon: SvgImage.Icon.BACK,
    },
    {
        title: '主页',
        code: KeyEvent.KEYCODE_HOME,
        icon: SvgImage.Icon.HOME,
    },
    {
        title: '多任务',
        code: KeyEvent.KEYCODE_APP_SWITCH,
        icon: SvgImage.Icon.OVERVIEW,
    },
];

export class GoogToolBox extends ToolBox {
    protected constructor(list: ToolBoxElement<any>[]) {
        super(list);
    }

    public static createToolBox(
        udid: string,
        player: BasePlayer,
        client: StreamClientScrcpy,
        moreBox?: GoogMoreBox,
    ): GoogToolBox {
        const playerName = player.getName();

        // 长按状态映射：记录按钮是否处于长按状态
        const longPressState = new Map<ToolBoxElement<any>, boolean>();
        // 长按定时器映射
        const longPressTimers = new Map<ToolBoxElement<any>, number>();
        const LONG_PRESS_DELAY = 600; // 长按触发时间（毫秒）

        // 存储所有多选按钮
        const multiButtons: ToolBoxMultiButton[] = [];

        // 组合键长按状态
        let comboLongPressActive = false;

        // 触发组合键（短按）
        const triggerCombination = () => {
            const checkedButtons = multiButtons.filter((btn) => btn.isChecked());
            if (checkedButtons.length < 2) {
                console.log('[GoogToolBox] 至少需要选择2个按钮才能触发组合键');
                return;
            }

            console.log(`[GoogToolBox] 触发组合键: ${checkedButtons.map((b) => b.optional?.code).join('+')}`);

            // 同时发送所有选中按钮的按下事件
            checkedButtons.forEach((btn) => {
                if (btn.optional?.code) {
                    const downEvent = new KeyCodeControlMessage(KeyEvent.ACTION_DOWN, btn.optional.code, 0, 0);
                    client.sendMessage(downEvent);
                }
            });

            // 延迟后同时释放
            setTimeout(() => {
                checkedButtons.forEach((btn) => {
                    if (btn.optional?.code) {
                        const upEvent = new KeyCodeControlMessage(KeyEvent.ACTION_UP, btn.optional.code, 0, 0);
                        client.sendMessage(upEvent);
                    }
                });

                // 触发后取消所有选中状态
                checkedButtons.forEach((btn) => btn.setChecked(false));
            }, 100);
        };

        // 开始组合键长按
        const startComboLongPress = () => {
            const checkedButtons = multiButtons.filter((btn) => btn.isChecked());
            if (checkedButtons.length < 2) {
                return;
            }

            comboLongPressActive = true;
            console.log(`[GoogToolBox] 开始组合键长按: ${checkedButtons.map((b) => b.optional?.code).join('+')}`);

            // 同时发送所有选中按钮的按下事件（只发送一次）
            checkedButtons.forEach((btn) => {
                if (btn.optional?.code) {
                    const downEvent = new KeyCodeControlMessage(KeyEvent.ACTION_DOWN, btn.optional.code, 0, 0);
                    client.sendMessage(downEvent);
                }
            });
        };

        // 停止组合键长按
        const stopComboLongPress = () => {
            if (!comboLongPressActive) {
                return;
            }

            comboLongPressActive = false;
            const checkedButtons = multiButtons.filter((btn) => btn.isChecked());
            console.log(`[GoogToolBox] 停止组合键长按: ${checkedButtons.map((b) => b.optional?.code).join('+')}`);

            // 同时释放所有选中的按钮
            checkedButtons.forEach((btn) => {
                if (btn.optional?.code) {
                    const upEvent = new KeyCodeControlMessage(KeyEvent.ACTION_UP, btn.optional.code, 0, 0);
                    client.sendMessage(upEvent);
                }
            });

            // 取消所有选中状态
            checkedButtons.forEach((btn) => btn.setChecked(false));
        };

        // 创建普通按钮（返回、主页、多任务）- 不支持复选
        const createSingleButton = (item: (typeof SINGLE_BUTTONS)[0]): ToolBoxElement<any> => {
            const button = new ToolBoxButton(item.title, item.icon, {
                code: item.code,
            });

            const btnElement = button.getElement();

            // 鼠标/触摸按下事件
            const onPointerDown = (event: MouseEvent | TouchEvent) => {
                event.preventDefault();
                console.log(`[GoogToolBox] 普通按钮按下: ${item.title}`);
                if (!button.optional?.code) {
                    return;
                }
                const { code } = button.optional;

                // 发送按下事件
                console.log(`[GoogToolBox] 发送按下事件: ${item.title} (code=${code})`);
                const downEvent = new KeyCodeControlMessage(KeyEvent.ACTION_DOWN, code, 0, 0);
                client.sendMessage(downEvent);

                // 清除之前的状态
                longPressState.set(button, false);
                if (longPressTimers.has(button)) {
                    window.clearTimeout(longPressTimers.get(button));
                    longPressTimers.delete(button);
                }

                // 设置长按定时器 - 标记为长按状态
                const timer = window.setTimeout(() => {
                    console.log(`[GoogToolBox] 标记为长按状态: ${item.title}`);
                    longPressState.set(button, true);
                }, LONG_PRESS_DELAY);

                longPressTimers.set(button, timer);
            };

            // 鼠标/触摸释放事件
            const onPointerUp = (event: MouseEvent | TouchEvent) => {
                event.preventDefault();
                if (!button.optional?.code) {
                    return;
                }
                const { code } = button.optional;

                // 清除长按定时器
                if (longPressTimers.has(button)) {
                    window.clearTimeout(longPressTimers.get(button)!);
                    longPressTimers.delete(button);
                }

                // 获取长按状态
                const isLongPress = longPressState.get(button) || false;
                longPressState.delete(button);

                console.log(`[GoogToolBox] 普通按钮释放: ${item.title}, isLongPress=${isLongPress}`);

                // 发送释放事件
                console.log(`[GoogToolBox] 发送释放事件: ${item.title}`);
                const upEvent = new KeyCodeControlMessage(KeyEvent.ACTION_UP, code, 0, 0);
                client.sendMessage(upEvent);
            };

            // 鼠标离开事件（取消长按）- 只在按钮被按下时处理
            const onPointerLeave = () => {
                console.log(`[GoogToolBox] 普通按钮鼠标离开: ${item.title}`);

                // 只有在按钮被按下（有定时器）时才处理
                if (!longPressTimers.has(button)) {
                    return;
                }

                // 清除长按定时器
                window.clearTimeout(longPressTimers.get(button)!);
                longPressTimers.delete(button);

                // 清除长按状态
                longPressState.delete(button);

                // 发送释放事件
                if (button.optional?.code) {
                    const { code } = button.optional;
                    console.log(`[GoogToolBox] 发送释放事件(离开): ${item.title}`);
                    const upEvent = new KeyCodeControlMessage(KeyEvent.ACTION_UP, code, 0, 0);
                    client.sendMessage(upEvent);
                }
            };

            btnElement.addEventListener('mousedown', onPointerDown);
            btnElement.addEventListener('mouseup', onPointerUp);
            btnElement.addEventListener('mouseleave', onPointerLeave);
            btnElement.addEventListener('touchstart', onPointerDown, { passive: false });
            btnElement.addEventListener('touchend', onPointerUp, { passive: false });
            btnElement.addEventListener('touchcancel', onPointerUp, { passive: false });

            return button;
        };

        // 创建多选按钮（电源、音量）- 支持复选
        const createMultiButton = (item: (typeof MULTI_SELECT_BUTTONS)[0]): ToolBoxElement<any> => {
            const button = new ToolBoxMultiButton(item.title, item.icon, {
                code: item.code,
            });
            multiButtons.push(button);

            const btnElement = button.getElement();

            // 鼠标/触摸按下事件
            const onPointerDown = (event: MouseEvent | TouchEvent) => {
                event.preventDefault();
                console.log(`[GoogToolBox] 多选按钮按下: ${item.title}`);
                if (!button.optional?.code) {
                    return;
                }
                const { code } = button.optional;

                // 检查是否有其他按钮被选中（组合键模式）
                const hasOtherChecked = multiButtons.some((b) => b !== button && b.isChecked());
                const isSelfChecked = button.isChecked();

                if (hasOtherChecked || isSelfChecked) {
                    // 组合键模式：将当前按钮加入组合（如果还没选中）
                    if (!isSelfChecked) {
                        button.setChecked(true);
                    }

                    // 设置组合键长按定时器
                    const timer = window.setTimeout(() => {
                        startComboLongPress();
                    }, LONG_PRESS_DELAY);

                    longPressTimers.set(button, timer);
                    longPressState.set(button, false);
                    return;
                }

                // 普通模式：发送按下事件
                console.log(`[GoogToolBox] 发送按下事件: ${item.title} (code=${code})`);
                const downEvent = new KeyCodeControlMessage(KeyEvent.ACTION_DOWN, code, 0, 0);
                client.sendMessage(downEvent);

                // 清除之前的状态
                longPressState.set(button, false);
                if (longPressTimers.has(button)) {
                    window.clearTimeout(longPressTimers.get(button));
                    longPressTimers.delete(button);
                }

                // 设置长按定时器 - 标记为长按状态
                const timer = window.setTimeout(() => {
                    console.log(`[GoogToolBox] 标记为长按状态: ${item.title}`);
                    longPressState.set(button, true);
                }, LONG_PRESS_DELAY);

                longPressTimers.set(button, timer);
                console.log(`[GoogToolBox] 设置长按定时器: ${item.title}, 延迟=${LONG_PRESS_DELAY}ms`);
            };

            // 鼠标/触摸释放事件
            const onPointerUp = (event: MouseEvent | TouchEvent) => {
                event.preventDefault();
                if (!button.optional?.code) {
                    return;
                }
                const { code } = button.optional;

                // 检查是否有其他按钮被选中或当前按钮被选中（组合键模式）
                const hasOtherChecked = multiButtons.some((b) => b !== button && b.isChecked());
                const isSelfChecked = button.isChecked();

                // 清除长按定时器
                if (longPressTimers.has(button)) {
                    window.clearTimeout(longPressTimers.get(button)!);
                    longPressTimers.delete(button);
                }

                if (comboLongPressActive && isSelfChecked) {
                    // 如果正在组合键长按，停止它
                    stopComboLongPress();
                    return;
                }

                if (hasOtherChecked || isSelfChecked) {
                    // 组合键短按模式：触发组合
                    triggerCombination();
                    return;
                }

                // 获取长按状态
                const isLongPress = longPressState.get(button) || false;
                longPressState.delete(button);

                console.log(`[GoogToolBox] 多选按钮释放: ${item.title}, isLongPress=${isLongPress}`);

                // 普通模式：发送释放事件
                console.log(`[GoogToolBox] 发送释放事件: ${item.title}`);
                const upEvent = new KeyCodeControlMessage(KeyEvent.ACTION_UP, code, 0, 0);
                client.sendMessage(upEvent);
            };

            // 鼠标离开事件（取消长按）- 只在按钮被按下时处理
            const onPointerLeave = () => {
                console.log(`[GoogToolBox] 多选按钮鼠标离开: ${item.title}`);

                // 如果正在组合键长按，停止它
                if (comboLongPressActive && button.isChecked()) {
                    stopComboLongPress();
                    return;
                }

                // 只有在按钮被按下（有定时器）时才处理
                if (!longPressTimers.has(button)) {
                    return;
                }

                // 清除长按定时器
                window.clearTimeout(longPressTimers.get(button)!);
                longPressTimers.delete(button);

                // 获取长按状态并清除
                const isLongPress = longPressState.get(button) || false;
                longPressState.delete(button);

                // 发送释放事件
                if (button.optional?.code) {
                    const { code } = button.optional;
                    console.log(`[GoogToolBox] 发送释放事件(离开): ${item.title}, wasLongPress=${isLongPress}`);
                    const upEvent = new KeyCodeControlMessage(KeyEvent.ACTION_UP, code, 0, 0);
                    client.sendMessage(upEvent);
                }
            };

            btnElement.addEventListener('mousedown', onPointerDown);
            btnElement.addEventListener('mouseup', onPointerUp);
            btnElement.addEventListener('mouseleave', onPointerLeave);
            btnElement.addEventListener('touchstart', onPointerDown, { passive: false });
            btnElement.addEventListener('touchend', onPointerUp, { passive: false });
            btnElement.addEventListener('touchcancel', onPointerUp, { passive: false });

            return button;
        };

        // 创建所有按钮
        const elements: ToolBoxElement<any>[] = [];

        // 添加多选按钮（电源、音量）
        MULTI_SELECT_BUTTONS.forEach((item) => {
            elements.push(createMultiButton(item));
        });

        // 添加普通按钮（返回、主页、多任务）
        SINGLE_BUTTONS.forEach((item) => {
            elements.push(createSingleButton(item));
        });

        if (player.supportsScreenshot) {
            const screenshot = new ToolBoxButton('截图', SvgImage.Icon.CAMERA);
            screenshot.addEventListener('click', () => {
                player.createScreenshot(client.getDeviceName());
            });
            elements.push(screenshot);
        }

        const keyboard = new ToolBoxCheckbox(
            '捕获键盘',
            SvgImage.Icon.KEYBOARD,
            `capture_keyboard_${udid}_${playerName}`,
        );
        keyboard.addEventListener('click', (_, el) => {
            const element = el.getElement();
            client.setHandleKeyboardEvents(element.checked);
        });
        elements.push(keyboard);

        if (moreBox) {
            const displayId = player.getVideoSettings().displayId;
            const id = `show_more_${udid}_${playerName}_${displayId}`;
            const more = new ToolBoxCheckbox('更多', SvgImage.Icon.MORE, id);
            more.addEventListener('click', (_, el) => {
                const element = el.getElement();
                if (element.checked) {
                    moreBox.show();
                } else {
                    moreBox.hide();
                }
            });
            moreBox.setOnHide(() => {
                const element = more.getElement();
                element.checked = false;
            });
            elements.unshift(more);
        }
        return new GoogToolBox(elements);
    }
}
