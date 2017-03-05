const path = require('path');
const fs = require('graceful-fs-extra');
const Util = require('../../../util.js');

exports.help = function (api) {
    api.log('verbose', 'exec => mowa help');

    api.showUsage();

    console.log('mowa init - Initiate a new mowa project.');
    console.log();
};

exports.init = function (api) {
    api.log('verbose', 'exec => mowa init');

    //generate a deploy.<env>.js if not exist
    const deployJs = path.resolve(__dirname, 'template/deploy.js.sample');
    const deployJsDst = path.resolve(api.base, 'etc', 'deploy.' + api.getOption('env') + '.js');

    if (!fs.existsSync(deployJsDst)) {
        fs.ensureFileSync(deployJsDst);
        fs.copySync(deployJs, deployJsDst);
        api.log('info', `copied "${deployJs}" to "${deployJsDst}".`);
    } else {
        api.log('info', 'Project already exist.');
    }
    
    //generate a package.json if not exist
    const packageJson = path.resolve(api.base, 'package.json');
    let npmInit = fs.existsSync(packageJson) ?
        Promise.resolve() :
        new Promise((resolve, reject) => {
            Util.runCmd('npm init -y', (error, output) => {
                if (output.stdout) {
                    api.log('verbose', output.stdout);
                }

                if (output.stderr) {
                    api.log('error', output.stderr);
                }

                if (error) return reject(error);

                api.log('info', 'Created package.json file.');

                resolve();
            });
        });

    return npmInit.then(() => new Promise((resolve, reject) => {
        //generate entry file
        const serverJs = path.resolve(__dirname, 'template/server.js.sample');
        const serverJsDst = path.resolve(api.base, 'server.js');

        const pkg = require(packageJson);

        let serverJsTmpl = fs.readFileSync(serverJs, 'utf8');
        let serverJsContent = Util.S(serverJsTmpl).template({serverName: pkg.name}).s;
        fs.writeFileSync(serverJsDst, serverJsContent, 'utf8');

        var npm = require('npm');
        npm.load(function (err) {
            //handle errors
            if (err) return reject(err);

            //install module ffi
            npm.commands.install(['mowa'], function (er, data) {
                //log errors or data
                if (er) return reject(err);

                api.log('verbose', data.join('\n'));
                api.log('info', 'Install mowa as dependency.');
                resolve();
            });

            npm.on('log', function (message) {
                //log installation progress
                api.log('verbose', message);
            });
        });

    }));
};

exports.createApp = function (api) {
    api.log('verbose', 'exec => mowa createApp');

    //ask for app name
    const inquirer = require('inquirer');
    inquirer.prompt([
        { type: 'input', name: 'appName', message: 'App Name: ' }
    ]).then(function (answers) {
        let appName = answers.appName.trim();
        if (!appName) {
            return Promise.reject('App name is required!');
        }

        //check name availability
        const appFolder = path.resolve(api.base, 'web_modules', appName);

        if (fs.existsSync(appFolder)) {
            return Promise.reject('App "' + appName + '" already exist!');
        }

        //create folder
        fs.ensureDirSync(appFolder);

        const appEtc = path.resolve(appFolder, 'etc', 'app.default.js');
        
        

    });
};