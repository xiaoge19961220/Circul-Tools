// 1️⃣ 建立 SSH 隧道
const {createTunnel} = require("tunnel-ssh");
const { getSshOption } = require("../connection-config/index");

class Tunnel {
    dataCenter=null
    sshOptions=null
    forwardOptions=null
    server=null
    client=null
    port=null
    constructor(dataCenter='us1') {
        const {sshOptions,forwardOptions}=getSshOption(dataCenter)
        this.dataCenter=dataCenter;
        this.sshOptions=sshOptions
        this.forwardOptions=forwardOptions
    }
    async connect() {
        const [server,client]=await createTunnel(null,null,this.sshOptions,this.forwardOptions);
        const addr = server.address();
        this.server=server
        this.client=client
        this.port=addr.port;
        console.log(`隧道建立成功，端口为 ${this.port}`)
    }
    close() {
        console.log(`销毁隧道${this.dataCenter}，端口${this.port}`)
        this.server.close()
        this.sshOptions=null
        this.forwardOptions=null
        this.server=null
        this.client=null
        this.dataCenter=null
        this.port=null
    }
}

module.exports = Tunnel
