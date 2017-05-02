"use strict";

const modules = require('./modules/');
const MowaAPI = require('./mowa-api.js');
const { restart } = require('./utils.js');

const api = new MowaAPI(modules);

let env = api.getOption('env');
if (process.env.NODE_ENV && env !== process.env.NODE_ENV) {
    api.log('info', `The current environment is "${process.env.NODE_ENV}". The program will be restarted in "${env}" mode.`);

    restart(env);    
} else {
    let commandHandler = api.getCommandHandler();
    
    if (!commandHandler) {
        api.log('error', `unknown command ${api.command}`);
        api.showUsage();
        process.exit(1);
    }

    (api.skipUpdateCheck ? Promise.resolve() : api.checkUpdate()).then(
        () => Promise.resolve(commandHandler(api))
    ).then(
        ()=> {
            if (api.command !== 'help') {
                console.log('done.');
            }

            process.exit(0);
        }
    ).catch(
        e => {
            api.log('error', e.stack ? e.stack : e);
            process.exit(1);
        }
    );
}