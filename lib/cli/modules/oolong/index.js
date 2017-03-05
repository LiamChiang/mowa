"use strict";

const path = require( 'path');
const sh = require( 'shelljs');
const fs = require( 'fs');
const oolong = require( '../../../oolong');
const _ = require( 'lodash');
const glob = require( 'glob');
const async = require('async');

function buildModule(api, moduleName) {
    api.log('info', `start building oolong dsl of web module [${moduleName}] ...`);

    let modulePath = path.join(api.base, 'web_modules', moduleName); 
    let oolongDir = path.join(modulePath, 'oolong');

    if (!fs.existsSync(oolongDir)) {
        api.log('info', `Oolong DSL files not found. Nothing to build for [${moduleName}].`);
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
                if (command == 'deploy') {
                    api.log('info', `Start deploying database of web module [${moduleName}] ...`);
                } else if (command == 'importTestData') {
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

exports.help = function (api) {
    api.log('verbose', 'exec => mowa oolong help');

    console.log('mowa oolong create - Create database schema.');
    console.log('    -t: target module, required.');
    console.log();

    console.log('mowa oolong build - Generate database script and access models.');
    console.log();

    console.log('mowa oolong deploy - Create database structure.');
    console.log('    -r: Reset all data if the database exists');
    console.log();

    console.log('mowa oolong importTestData - Import test data.');
    console.log();
};

exports.create  = function (api) {
    api.log('verbose', 'exec => mowa oolong build');

    let targetMod = api.getOption('target');

    if (!targetMod) {
        return Promise.reject('Target module is required.')
    }

    return buildModule(api, targetMod);
};

exports.build = function (api) {
    api.log('verbose', 'exec => mowa oolong build');
    
    let targetMod = api.getOption('target');

    return api.getWebModules().then(mods => {

        if (targetMod) {
            if (mods.indexOf(targetMod) === -1) {
                throw new Error(`Target module [${targetMod}] not found.`);
            }

            return buildModule(api, targetMod);
        }

        return Promise.all(mods.map(mod => buildModule(api, mod)));
    });
};

exports.deploy = function (api) {
    api.log('verbose', 'exec => mowa oolong deploy');
    let reset = api.getOption('r') || false;

    return startMowaAndRunWithSchemaFiles(api, 'deploy', webModule => (f, cb) => {
        oolong.deploy(webModule, { logger: api.logger }, f, reset).then(() => cb(), e => cb(e));
    });
};

exports.importTestData = function (api) {
    api.log('verbose', 'exec => mowa oolong importTestData');

    return startMowaAndRunWithSchemaFiles(api, 'importTestData', webModule => (f, cb) => {
        oolong.import(webModule, { logger: api.logger }, f, 'test').then(() => cb(), e => cb(e));
    });
};