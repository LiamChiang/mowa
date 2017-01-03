"use strict";

const modules = require('./modules/');
const MowaAPI = require('./mowa-api.js');
const { restart } = require('./utils.js');

const api = new MowaAPI(modules);

let env = api.getOption('env');
if (env !== process.env.NODE_ENV) {
    restart(env);    
} else {
    api.runCommand().then(()=> {
        api.log('info', 'done.');
        process.exit(0);
    }).catch(e => {
        api.log('error', e.stack ? e.stack : e);
        process.exit(1);
    });
}