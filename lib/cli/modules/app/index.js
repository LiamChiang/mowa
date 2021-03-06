"use strict";

const _ = require('lodash');
const path = require('path');
const fs = require('graceful-fs-extra');
const shell = require('shelljs');
const Util = require('../../../util.js');

exports.desc = {
    'desc': 'Provide commands to config a app.',
    'list': "List all apps in the project",
    'install': 'Install npm module for an app',
    'bootstrap': 'Add a bootstrap file for an app',
    'remove': "Remove an app from the project"
};

exports.help = function (api) {
    let cmdOptions = {};

    switch (api.command) {
        case 'install':
            cmdOptions['app'] = {
                desc: 'Specify the name of the app'
            };
            cmdOptions['nm'] = {
                desc: 'Specify the name of the npm module',
                alias: [ 'module', 'npm-module' ]
            };
            break;

        case 'bootstrap':
            cmdOptions['app'] = {
                desc: 'Specify the name of the app'
            };
            cmdOptions['name'] = {
                desc: 'Specify the name of the bootstrap file'
            };
            break;

        case 'remove':
            cmdOptions['app'] = {
                desc: 'Specify the name of the app to be removed'
            };
            cmdOptions['y'] = {
                desc: 'Skip removal confirmation',
                default: false,
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

exports.list = function (api) {
    api.log('verbose', 'exec => mowa app list');

    //get a list of apps
    let moduleNames = api.getAppNames();

    //read router config
    const routerJs = path.join(api.base, 'etc', 'routing.js');
    const routing = require(routerJs);
    let activatedMod = {};

    _.forOwn(routing, (config, route) => {
        if (config.mod) {
            activatedMod[route] = config.mod.name;
        }
    });

    console.log('All apps in the project:');
    console.log('  ' + moduleNames.join('\n  ') + '\n');

    console.log('Activated apps:');
    console.log(_.reduce(activatedMod, (sum, value, key) => (sum + key + ' -> ' + value + '\n'), '  '));
};

exports.install = function (api) {
    api.log('verbose', 'exec => mowa app install');

    let appName = api.getOption('app');

    if (!appName) {
        return Promise.reject('App name is required!');
    }

    const modFolder = path.join(api.base, 'web_modules', appName);
    if (!fs.existsSync(modFolder)) {
        return Promise.reject('App "' + appName + '" not exist!');
    }

    let moduleName = api.getOption('nm');
    if (!moduleName) {
        return Promise.reject('Npm module name is required!');
    }

    shell.cd(modFolder);
    let stdout = Util.runCmdSync(`npm install ${moduleName} --save`);
    shell.cd(api.base);

    api.log('verbose', stdout.toString());

    api.log('info', `Installed a npm module "${moduleName}" for app "${appName}".`);

    return Promise.resolve();
};

exports.bootstrap = function (api) {
    api.log('verbose', 'exec => mowa app install');

    let appName = api.getOption('app');

    if (!appName) {
        return Promise.reject('App name is required!');
    }

    const modFolder = path.join(api.base, 'web_modules', appName);
    if (!fs.existsSync(modFolder)) {
        return Promise.reject('App "' + appName + '" not exist!');
    }

    let bootstrapFileName = api.getOption('name');
    if (!bootstrapFileName) {
        return Promise.reject('Bootstrap file name is required!');
    }

    const templateFolder = path.resolve(__dirname, 'template');
    const bootstrapSource = path.join(templateFolder, 'bootstrap.template.js');
    const bootstrapDir = path.join(modFolder, 'server', 'bootstrap');

    fs.ensureDirSync(bootstrapDir);

    const bootstrapDesc = path.join(bootstrapDir, bootstrapFileName + '.js');
    if (fs.existsSync(bootstrapDesc)) {
        return Promise.reject('Bootstrap file "' + bootstrapFileName + '" already exist!');
    }

    fs.copySync(bootstrapSource, bootstrapDesc);

    api.log('info', `Created a bootstrap file "${bootstrapFileName}" for app "${appName}".`);

    return Promise.resolve();
};

function removeAppByName(api, name) {
    const modFolder = path.join(api.base, 'web_modules', name);
    shell.rm('-rf', modFolder);

    console.log('Removed ' + modFolder);

    //read router config
    const routerJs = path.join(api.base, 'etc', 'routing.js');
    const routing = require(routerJs);

    let routesToRemove = [];

    _.forOwn(routing, (config, route) => {
        if (config.mod && config.mod.name === name) {
            routesToRemove.push(route);
        }
    });

    _.each(routesToRemove, r => delete routing[r]);

    //write updated config into routing.js
    const moduleExpert = 'module.exports = ';
    const routingData = moduleExpert + JSON.stringify(routing, null, 4) + ';';
    fs.writeFileSync(routerJs, routingData);

    return Promise.resolve();
}

exports.remove = function (api) {
    api.log('verbose', 'exec => mowa app remove');

    let appName = api.getOption('app');

    if (!appName) {
        return Promise.reject('App name is required!');
    }

    //check the app folder
    const modFolder = path.join(api.base, 'web_modules', appName);
    if (!fs.existsSync(modFolder)) {
        return Promise.reject('App "' + appName + '" not exist!');
    }

    let skipConfirmaton = api.getOption('y');
    if (!skipConfirmaton) {
        //ask for app name
        const inquirer = require('inquirer');
        return inquirer.prompt([
            { type: 'confirm', name: 'continueRemove', message: 'Confirm to proceed: ', default: false }
        ]).then(function (answers) {
            if (answers.continueRemove) {
                return removeAppByName(api, appName);
            }

            console.log('User aborted.');
            return Promise.resolve();
        });
    }

    return removeAppByName(api, appName);
};