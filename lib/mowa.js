"use strict";

require('debug')('tracing')(__filename);

const path = require('path');
const util = require('util');
const Util = require('./util.js');
const WebModule = require('./webmodule.js');
const OolongRuntime = require('./oolong/runtime');

let firstMowaInstance = true;

class Mowa extends WebModule {

    /**
      * A Mowa object.
      * @constructs Mowa
      * @param {string} name - The name of the web module.
      * @param {object} options - The web module's extra options defined in its parent's configuration.
      */
    constructor(name, options) {
        if (typeof options === 'undefined' && util.isObject(name)) {
            options = name;
            name = 'server';
        }

        super(null, name, null, options);
        
        this.httpServers = [];
        this.pendingHttpServer = 0;

        if (firstMowaInstance) {
            process.on('uncaughtException', e => {
                this.log('error', 'UncaughtException: ' + e.stack);
                process.exit(1);
            });

            process.on('SIGINT', () => {
                this.log('info', 'Server is shutting down.');
                this.emit('shutdown', this);
                process.exit();
            });

            firstMowaInstance = false;
        }
    }

    start(extraFeatures) {
        this.emit('starting', this);
        
        //register builtin middlewares
        this.loadMiddlewareFiles(path.resolve(__dirname, 'middlewares'));

        super.start(extraFeatures).then(() => {
            if (this.pendingHttpServer > 0) {
                this.once('allHttpReady', () => {
                    this.emit('started', this);
                })
            } else {
                this.emit('started', this);
            }
        }).catch(error => {
            if (this.env === 'development' && util.isError(error)) {
                console.log(error.stack);
            }

            this.log('error', 'Failed to start server!');

            process.exit(1);
        });

        return this;
    }

    stop() {
        this.emit('stopping', this);
        
        let promises = this.httpServers.reverse().map(s => {
            let port = s.address().port;
            s.close(() => {
                this.log('info', `The http server listening on port [${port}] is stopped.`);
            });
        });

        Promise.all(promises).then(() => {
            this.httpServers = [];
            this.emit('stopped', this);
        });

        return this;
    }
    
    addHttpServer(webModule, httpServer) {
        this.httpServers.push(httpServer);
        this.pendingHttpServer++;

        webModule.once('httpReady', () => {
            this.pendingHttpServer--;
            if (this.pendingHttpServer == 0) {
                this.emit('allHttpReady');
            }
        });
    }
}

Mowa.Util = Util;
Mowa.OolongRuntime = OolongRuntime;

module.exports = Mowa;