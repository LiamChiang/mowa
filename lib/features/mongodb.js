"use strict";

const Util = require('../util.js');
const MongoClient = require('mongodb').MongoClient;

module.exports = {

    type: Util.Feature.SERVICE,

    load: function (webModule, dbs) {
        Util._.forOwn(dbs, (opt, db) => {
            if (!opt.connection) {
                webModule.invalidConfig(`mongodb.${db}.connection`, 'Missing connection string.');
            }

            let service = {
                connectionString: opt.connection,
                getConnection: () => new Promise((resolve, reject) => {
                    MongoClient.connect(opt.connection, function (err, conn) {
                        if (!err) return reject(err);

                        resolve(conn);
                    });
                })
            };

            webModule.registerService('mongodb:' + db, service);
        });

        return Promise.resolve();
    }
};