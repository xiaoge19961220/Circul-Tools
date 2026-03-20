module.exports = {
    ssh: {
        username: 'ec2-user',
        host: 'your-bastion-ip',
        privateKey: require('fs').readFileSync('./id_ed25519'),
        dstHost: 'docdb-xxx.amazonaws.com',
        dstPort: 27017,
        localHost: '127.0.0.1',
        localPort: 0,
    },
};
