"use strict";

const Util = require('../util.js');
const mysql = require('node-mysql-promise2');

module.exports = {
    type: Util.Feature.SERVICE,

    load: function (webModule, dbs) {

        Util._.forOwn(dbs, (opt, db) => {
            if (!opt.connection) {
                webModule.invalidConfig(`mysql.${db}.connection`, 'Missing connection string.');
            }

            let poolByConn = {};
            let service = {
                connectionString: opt.connection,
                getConnection: autoRelease => {
                    let pool = poolByConn[service.connectionString];

                    if (!pool) {
                        pool = poolByConn[service.connectionString] = mysql.createPool(service.connectionString)
                    }

                    if (autoRelease) {
                        return pool.getConnection().then(conn => {
                            webModule.once('actionCompleted', () => {
                                conn.release();
                            });

                            return Promise.resolve(conn);
                        });
                    }

                    return pool.getConnection();
                }
            };

            webModule.registerService('mysql:' + db, service);
        });

        return Promise.resolve();
    }
};