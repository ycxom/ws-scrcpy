import * as os from 'os';

export class Utils {
    public static printListeningMsg(proto: string, port: number, pathname: string): void {
        const ipv4List: string[] = [];
        const ipv6List: string[] = [];
        const formatAddress = (ip: string, scopeid: number | undefined): void => {
            if (typeof scopeid === 'undefined') {
                ipv4List.push(`${proto}://${ip}:${port}${pathname}`);
                return;
            }
            if (scopeid === 0) {
                ipv6List.push(`${proto}://[${ip}]:${port}${pathname}`);
            } else {
                return;
            }
        };
        Object.keys(os.networkInterfaces())
            .map((key) => os.networkInterfaces()[key])
            .forEach((info) => {
                info.forEach((iface) => {
                    let scopeid: number | undefined;
                    if (iface.family === 'IPv6') {
                        scopeid = iface.scopeid;
                    } else if (iface.family === 'IPv4') {
                        scopeid = undefined;
                    } else {
                        return;
                    }
                    formatAddress(iface.address, scopeid);
                });
            });
        const nameList = [
            encodeURI(`${proto}://${os.hostname()}:${port}${pathname}`),
            encodeURI(`${proto}://localhost:${port}${pathname}`),
        ];
        console.log('Listening on:\n\t' + nameList.join(' '));
        if (ipv4List.length) {
            console.log('\t' + ipv4List.join(' '));
        }
        if (ipv6List.length) {
            console.log('\t' + ipv6List.join(' '));
        }
    }

    public static getFirstIpv4Address(): string {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            const netInterface = interfaces[name];
            if (!netInterface) continue;
            for (const info of netInterface) {
                if (info.family === 'IPv4' && !info.internal) {
                    return info.address;
                }
            }
        }
        return 'localhost';
    }
}
