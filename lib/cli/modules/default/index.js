const path = require('path');
const sh = require('shelljs');
const fs = require('fs');

sh.config.silent = true;

exports.deploy = function (api) {
    api.log('verbose', 'exec => mowa deploy');  
};

exports.help = function (api) {
    api.log('verbose', 'exec => mowa help');

    api.showUsage();
};

exports.init = function (api) {
    api.log('verbose', 'exec => mowa init');

    const deployJs = path.resolve(__dirname, 'template/deploy.js.sample');
    const deployJsDst = path.resolve(api.base, 'etc', 'deploy.' + api.getOption('env') + '.js');

    if (!fs.existsSync(deployJsDst)) {
        sh.cp(deployJs, deployJsDst);
        api.log('info', `copied "${deployJs}" to "${deployJsDst}".`);
    } else {
        api.log('info', 'Project already init.');
    }
};

exports.restart = function (api) {
    api.log('verbose', 'exec => mowa restart');
};

exports.setup = function (api) {
    api.log('verbose', 'exec => mowa setup');
};

exports.start = function (api) {
    api.log('verbose', 'exec => mowa start');
};

exports.stop = function (api) {
    api.log('verbose', 'exec => mowa stop');
};

exports.rollback = function (api) {
    api.log('verbose', 'exec => mowa start')
};