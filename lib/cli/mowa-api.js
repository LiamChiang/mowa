const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const optimist = require('optimist');
const winston = require('winston');
const async = require('async');
const inflection = require('inflection');
const checkUpdate = require('./update.js');
const Mowa = require('../mowa.js');

module.exports = class MowaAPI {
    constructor(modules) {
        //working folder
        this.base = process.cwd();

        //make default as the first module in the list
        let moduleNames = ['default'].concat(_.filter(Object.keys(modules), k => k != 'default')).join(' | ');

        //init argument settings
        this.argv = optimist
            .usage('Usage: $0 [cli module] <command> [--env=<target environment>] [--target=<target web module>] [--skip-update-check]\n    modules: ' + moduleNames)
            .options('e', {
                alias : 'env',
                describe: 'target environment',
                default : 'development'
            })
            .alias('t', 'target')
            .describe('t', 'only process specified target web module')
            .describe('skip-update-check', 'skip update checking')
            .boolean(['skip-update-check'])
            .argv;

        this.env = this.getOption('env');
        this.skipUpdateCheck = this.getOption('skip-update-check') || false;

        let args = this.getArguments();
        if (!args || args.length == 0) {
            console.error('error', 'missing required deploy command.');
            this.showUsage();
            process.exit(1);
        }

        //extract module and command
        if (args.length > 1) {
            this.cliModuleName = inflection.camelize(args[0], true);
            this.command = inflection.camelize(args[1], true);
        } else {
            this.cliModuleName = 'default';
            this.command = inflection.camelize(args[0], true);
        }
        this.cliModule = modules[this.cliModuleName];

        //load deploy config if exist
        const fileName = 'deploy.' + this.env + '.js';
        const filePath = path.join(this.base, 'etc', fileName);
        try {
            this.config = require(filePath);
        } catch (e) {
            if (e.code == 'MODULE_NOT_FOUND') {

                if ((this.cliModuleName !== 'default' || this.command !== 'init') && this.command !== 'help') {
                    console.error(`"${fileName}" file not found. Run 'mowa init' first.`);
                    process.exit(1);
                }

            } else {
                console.error(e.message);
                process.exit(1);
            }

            this.config = {};
        }

        //init logger for cli
        winston.cli();

        let defaultConfig = Object.assign({
            consoleLogLevel: 'info',
            consoleLogColorize: true,
            fileLogLevel: 'verbose',
            fileLogFilename: 'mowa-deploy.log',
            fileLogOptions: { flag: 'w' },
            mowaVerbose: false
        }, this.getConfig('default'));

        this.logger = new (winston.Logger)({
            transports: [
                new (winston.transports.Console)({ level: defaultConfig.consoleLogLevel, colorize: defaultConfig.consoleLogColorize }),
                new (winston.transports.File)({ level: defaultConfig.fileLogLevel, filename: defaultConfig.fileLogFilename, options: defaultConfig.fileLogOptions, json: false })
            ]
        });
        
        this.defaultConfig = defaultConfig;

        this.sessions = null;

        let handleErrors = e => {
            this.log('error', 'UncaughtException ' + e.stack);
            process.exit(1);
        };

        process.on('uncaughtException', handleErrors);
    }

    showUsage() {
        console.log(optimist.help());
    }

    checkUpdate() {
        return checkUpdate(this);
    }

    log(level, message, data) {
        if (data) {
            this.logger.log(level, message, data);
        } else {
            this.logger.log(level, message);
        }
    }

    getCommandHandler() {
        return this.cliModule[this.command];
    }

    getWebModules() {
        let webModulesPath = path.resolve(this.base, 'web_modules');

        return new Promise((resolve, reject) => {
            fs.readdir(webModulesPath, (err, files) => {
                if (err) return reject(err);

                let result = [];

                async.eachSeries(files, (f, cb) => {
                    let fp = path.join(webModulesPath, f);
                    fs.stat(fp, (err, stats) => {
                        if (err) return cb(err);

                        if (stats.isDirectory()) {
                            result.push(f);
                        }

                        cb();
                    });
                }, (err) => {
                    if (err) return reject(err);

                    resolve(result);
                });
            });
        });
    }
    
    startMowa(startedCb) {
        let mowa = new Mowa('cli', {deaf: true, verbose: this.defaultConfig.mowaVerbose});
        mowa.start().once('started', startedCb);
    }

    getArguments() {
        return this.argv._;
    }

    getOption(name) {
        return this.argv[name];
    }

    getConfig(moduleName) {
        return this.config[moduleName];
    }

    getSessions(modules = []) {
        const sessions = this._pickSessions(modules);
        return Object.keys(sessions).map(name => sessions[name]);
    }

    withSessions(modules = []) {
        const api = Object.create(this);
        api.sessions = this._pickSessions(modules);
        return api;
    }

    _pickSessions(modules = []) {
        if (!this.sessions) {
            this._loadSessions();
        }

        const sessions = {};

        modules.forEach(moduleName => {
            const moduleConfig = this.config[moduleName];
            if (!moduleConfig) {
                return;
            }

            for (var name in moduleConfig.servers) {
                if (!moduleConfig.servers.hasOwnProperty(name)) {
                    continue;
                }

                if (this.sessions[name]) {
                    sessions[name] = this.sessions[name];
                }
            }
        });

        return sessions;
    }

    _loadSessions() {
        const config = this.getConfig();
        this.sessions = {};

        // `mup.servers` contains login information for servers
        // Use this information to create nodemiral sessions.
        for (var name in config.servers) {
            if (!config.servers.hasOwnProperty(name)) {
                continue;
            }

            const info = config.servers[name];
            const auth = {username: info.username};
            const opts = {ssh: {}};

            var sshAgent = process.env.SSH_AUTH_SOCK;

            if (info.opts) {
                opts.ssh = info.opts;
            }

            if (info.pem) {
                auth.pem = fs.readFileSync(path.resolve(info.pem), 'utf8');
            } else if (info.password) {
                auth.password = info.password;
            } else if (sshAgent && fs.existsSync(sshAgent)) {
                opts.ssh.agent = sshAgent;
            } else {
                console.error(
                    'error: server %s doesn\'t have password, ssh-agent or pem',
                    name
                );
                process.exit(1);
            }

            const session = nodemiral.session(info.host, auth, opts);
            this.sessions[name] = session;
        }
    }
};
