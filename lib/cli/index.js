"use strict";

const modules = require('./modules/');
const MowaAPI = require('./mowa-api.js');
const { restart } = require('./utils.js');
const inflection = require('inflection');

const api = new MowaAPI(modules);

let env = api.getOption('env');
if (env !== process.env.NODE_ENV) {
    restart(env);    
} else {
    const args = api.getArguments();
    if (!args || args.length == 0) {
        api.log('error', 'missing required deploy command.');
        api.showUsage();
        process.exit(1);
    }

    const firstArg = inflection.camelize(args[0], true);

    let module = modules['default'];
    if (modules[firstArg]) {
        module = modules[firstArg];
        args.splice(0, 1);
    }

    const command = args.shift();
    if (!module[command]) {
        api.log('error', `unknown command ${command}`);
        api.showUsage();
        process.exit(1);
    }

    Promise.resolve(module[command](api)).then(()=> {
        api.log('info', 'done.');
        process.exit(0);
    }).catch(e => {
        api.log('error', e.stack ? e.stack : e);
        process.exit(1);
    });
}

function handleErrors(e) {
    api.log('error', 'UncaughtException ' + e.stack);
    process.exit(1);
}

process.on('uncaughtException', handleErrors);