import { StreamReceiver } from '../../client/StreamReceiver';
import { ParamsStreamScrcpy } from '../../../types/ParamsStreamScrcpy';
import { ACTION } from '../../../common/Action';
import Util from '../../Util';

export class UdpStreamReceiver extends StreamReceiver<ParamsStreamScrcpy> {
    public static parseParameters(params: URLSearchParams): ParamsStreamScrcpy {
        const typedParams = super.parseParameters(params);
        const { action } = typedParams;
        if (action !== ACTION.STREAM_SCRCPY) {
            throw Error('Incorrect action');
        }
        return {
            ...typedParams,
            action,
            udid: Util.parseString(params, 'udid', true),
            ws: Util.parseString(params, 'ws', true),
            player: Util.parseString(params, 'player', true),
        };
    }

    protected buildDirectWebSocketUrl(): URL {
        return new URL((this.params as ParamsStreamScrcpy).ws);
    }

    public startUdp(): void {
        // 使用 WebRTC 数据通道模拟 UDP 接收
        // 实际项目中可能需要使用真正的 UDP 套接字
        // 这里我们使用 WebSocket 作为备用方案
        console.log('[UdpStreamReceiver] Starting UDP receiver');
    }

    public stopUdp(): void {
        console.log('[UdpStreamReceiver] Stopping UDP receiver');
    }
}
