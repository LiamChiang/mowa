"use strict";

const path = require( 'path');
const fs = require( 'fs');
const oolong = require( '../../../oolong');
const _ = require( 'lodash');
const glob = require( 'glob');
const async = require('async');

function buildAppByName(api, appName) {
    api.log('info', `start building oolong dsl of app [${appName}] ...`);

    let modulePath = path.join(api.base, 'web_modules', appName);
    let oolongDir = path.join(modulePath, 'oolong');

    if (!fs.existsSync(oolongDir)) {
        api.log('info', `Oolong DSL files not found. Nothing to build for [${appName}].`);
        return Promise.resolve();
    }

    let schemaFiles = glob.sync(path.join(oolongDir, '*.ool'), {nodir: true});

    return Promise.all(_.map(schemaFiles, f => oolong.build({
            logger: api.logger
        },
        {
            oolPath: oolongDir,
            schemaPath: path.basename(f, '.ool'),
            sqlScriptPath: path.join(modulePath, 'server', 'db'),
            modelPath: path.join(modulePath, 'server', 'models')
        })
    ));
}

function startMowaAndRunWithSchemaFiles(api, command, callback) {
    let targetMod = api.getOption('target');

    return new Promise((resolve, reject) => {
        api.startMowa(server => {
            let moduleNames;

            if (targetMod) {
                if (!(targetMod in server.childModules)) {
                    return reject(`Target web module [${targetMod}] is not enabled in server setting.`);
                }

                moduleNames = [ targetMod ];
            } else {
                moduleNames = Object.keys(server.childModules);
            }

            async.eachSeries(moduleNames, (moduleName, cb) => {
                if (command === 'deploy') {
                    api.log('info', `Start deploying database of web module [${moduleName}] ...`);
                } else if (command == 'initTest') {
                    api.log('info', `Start importing data of web module [${moduleName}] ...`);
                }

                let webModule = server.childModules[moduleName];
                let oolongDir = webModule.toAbsolutePath('oolong');

                if (!fs.existsSync(oolongDir)) {
                    api.log('info', `Oolong DSL files not found. Nothing to do for [${moduleName}].`);

                    return resolve();
                }

                let schemaFiles = glob.sync(path.join(oolongDir, '*.ool'), {nodir: true});

                async.eachSeries(schemaFiles, callback(webModule), (err2) => {
                    if (err2) return cb(err2);

                    cb();
                });
            }, (err) => {
                if (err) return reject(err);

                server.stop();

                resolve();
            });
        });
    });
}

exports.desc = {
    'desc': 'Provide commands to initiate a new project or create a new app.',
    'create': 'Create database schema',
    'build': 'Generate database script and access models',
    'deploy': 'Create database structure',
    'initTest': 'Import test data'
};

exports.help = function (api) {
    let cmdOptions = {};

    switch (api.command) {
        case 'create':
            cmdOptions['app'] = {
                desc: 'Specify the name of the app to operate'
            };
            cmdOptions['dbms'] = {
                desc: 'Specify the dbms, e.g. mysql, mongodb',
                default: false
            };
            cmdOptions['n'] = {
                desc: 'Specify the schema name of the database',
                alias: [ 'db', 'schema' ],
                default: false
            };
            cmdOptions['conn'] = {
                desc: 'Specify the connection key of the database connection string',
                alias: [ 'connection' ],
                default: false
            };
            break;

        case 'deploy':
            cmdOptions['r'] = {
                desc: 'Reset all data if the database exists',
                default: false,
                alias: [ 'reset' ],
                bool: true
            };

        case 'build':
        case 'initTest':
            cmdOptions['app'] = {
                desc: 'Specify the name of the app to operate'
            };
            cmdOptions['a'] = {
                desc: 'Operate against all apps',
                default: false,
                alias: [ 'all' ],
                bool: true
            };
            break;

        case 'help':
        default:
            //module general options
            break;
    }

    return cmdOptions;
};

exports.create  = function (api) {
    api.log('verbose', 'exec => mowa oolong create');

    let appName = api.getOption('app');
    let all = api.getOption('a');

    if (!appName || !all) {
        return Promise.reject('App name is required or use --all instead!');
    }

    const inquirer = require('inquirer');

    /*
    let getSchema = api.getOption('s') ?
        Promise.resolve(api.getOption('s')) :
        inquirer.prompt([
            { type: 'input', name: 'schema', message: 'Schema name: ' }
        ]).then(function (answers) {
            if (answers.schema && answers.schema.length > 0) {
                return Promise.resolve(answers.schema);
            }

            return Promise.reject('Invalid scheam name!');
        });
    
    let getConnection = schemaName => {
        if (api.getOption('c')) return Promise.resolve(api.getOption('c'));
        
        api.startMowa(server => {
            
            server
            
        });
        
             
            inquirer.prompt([
                {type: 'input', name: 'schema', message: 'Schema name: '}
            ]).then(function (answers) {
                if (answers.schema && answers.schema.length > 0) {
                    return Promise.resolve(answers.schema);
                }

                return Promise.reject('Invalid scheam name!');
            });
    }
    */
    return buildModule(api, targetMod);
};

exports.build = function (api) {
    api.log('verbose', 'exec => mowa oolong build');
    
    let appName = api.getOption('app');
    let all = api.getOption('a');

    if (!appName && !all) {
        return Promise.reject('App name is required or use --all instead!');
    }

    if (appName && !fs.existsSync(path.join(api.base, 'web_modules', appName))) {
        return Promise.reject('App "' + appName + '" not exist!');
    }

    let apps = appName ? [ appName ] : api.getAppNames();

    return Promise.all(apps.map(app => buildAppByName(api, appName)));
};

exports.deploy = function (api) {
    api.log('verbose', 'exec => mowa oolong deploy');
    let reset = api.getOption('r') || false;

    return startMowaAndRunWithSchemaFiles(api, 'deploy', webModule => (f, cb) => {
        oolong.deploy(webModule, { logger: api.logger }, f, reset).then(() => cb(), e => cb(e));
    });
};

exports.initTest = function (api) {
    api.log('verbose', 'exec => mowa oolong initTest');

    return startMowaAndRunWithSchemaFiles(api, 'initTest', webModule => (f, cb) => {
        oolong.import(webModule, { logger: api.logger }, f, 'test').then(() => cb(), e => cb(e));
    });
};