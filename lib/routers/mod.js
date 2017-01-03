"use strict";

require('debug')('tracing')(__filename);

const WebModule = require('../webmodule.js');
const util = require('util');

/*
 '<base path>': {
     mod: {
         modules: ''
         name:
         options: {

         },
        overrides: {
        }
     }
 }
 */

module.exports = function loadModRouter(webModule, baseRoute, config) {
    if (!config.name) {
        webModule.invalidConfig('routes.*.mod', 'Missing module name.');
    }

    let options = Object.assign({verbose: webModule.options.verbose}, config.options);

    let mod = new WebModule(webModule, config.name, baseRoute, options);
    mod.settings = config.settings || {};
    webModule.consoleVerbose(`Loading web module [${mod.name}] from "${mod.path}"`);

    return mod.start(config.overrides).then(() => {
        webModule.log('verbose', `App [${mod.name}] is loaded.`);
        webModule.addChildModule(baseRoute, mod);
    }).catch(reason => {
        webModule.log('error', `Failed to load app [${mod.name}]`);
        throw reason;
    });
};