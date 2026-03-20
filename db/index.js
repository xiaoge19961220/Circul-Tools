const { getConnectOptions } = require("../connection-config/index");
const { MongoClient } = require("mongodb");

class MongoDB {
    port = null;
    client = null;
    db = null;
    dataCenter = null;
    constructor(tunnel, dataCenter) {
        this.port = tunnel.port;
        this.dataCenter = dataCenter;
    }

    async connect() {
        const connectOptions = getConnectOptions();
        const uri = `mongodb://${connectOptions.username}:${connectOptions.password}@${connectOptions.url}:${this.port}/?${connectOptions.options}`;
        this.client = new MongoClient(uri, connectOptions.pem);
        await this.client.connect();
        this.db = this.client.db(connectOptions.database);
        console.log("MongoDB connected successfully");
    }

    async find(collection, query, projection = {}) {
        const option = {
            sort: {
                _id: -1,
            },
            projection: projection,
            limit: 1,
        };
        const data = await this.db.collection(collection).find(query, option).toArray();
        if (data.length !== 0) return data[0];
        return null;
    }

    close() {
        this.client.close();
        console.log(`销毁${this.dataCenter}隧道的数据库连接，端口${this.port}`);
    }
}

module.exports = MongoDB;

