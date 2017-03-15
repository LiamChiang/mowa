const path = require('path');
const fs = require('graceful-fs-extra');
const Util = require('../../../util.js');

exports.help = function (api) {
    api.log('verbose', 'exec => mowa help');

    api.showUsage();

    console.log('mowa init - Initiate a new mowa project.');
    console.log('mowa createApp - Create a new app in the project.');
    console.log();
};

exports.init = function (api) {
    api.log('verbose', 'exec => mowa init');

    //generate a deploy.<env>.js if not exist
    const deployJs = path.resolve(__dirname, 'template/etc/deploy.js.sample');
    const deployJsDst = path.resolve(api.base, 'etc', 'deploy.' + api.getOption('env') + '.js');

    if (!fs.existsSync(deployJsDst)) {
        fs.ensureFileSync(deployJsDst);
        fs.copySync(deployJs, deployJsDst);
        api.log('info', `copied "${deployJs}" to "${deployJsDst}".`);
    } else {
        return Promise.reject('Project already exist.');
    }

    //generate a server.default.js / routing.js in etc
    
    const etcFolder = path.resolve(api.base, 'etc');
    const serverFolder = path.resolve(api.base, 'server');
    const etcDir = path.resolve(__dirname, 'template/etc');
    const serverDir = path.resolve(__dirname, 'template/server');
   
    fs.copySync(etcDir, etcFolder);
    fs.copySync(serverDir, serverFolder);

    //rename the Js files in etc
    const oldServerJsPath = path.join(etcFolder, 'server.js.sample.js');
    const newServerJsPath = path.join(etcFolder, 'server.default.js');
    const oldRouterJsPath = path.join(etcFolder, 'routing.js.sample.js');
    const newRouterJsPath = path.join(etcFolder, 'routing.js');
    fs.renameSync(oldServerJsPath, newServerJsPath);
    fs.renameSync(oldRouterJsPath, newRouterJsPath);    


    
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
    return inquirer.prompt([
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

        //cpoy app_directory
        const templateDir = path.resolve(__dirname, 'template/app');
        fs.copySync(templateDir, appFolder);
        
        //rename app_file
        const appJsPath = path.join(appFolder, 'etc', 'app.js.sample');
        return (new Promise((resolve, reject) =>{
        
            fs.move(appJsPath, path.join(appFolder, 'etc', 'app.default.js'), err => {
            
                if (err) return reject('err');

                resolve(); 
            });

        })).then(() => {           

            //add routing for the new module.
            const routingFile = path.resolve(api.base, 'etc', 'routing.js');
            if (fs.existsSync(routingFile)) {
                const routingConfig = require(routingFile);

                const appRoute = '/' + appName;
                if(appRoute in routingConfig){
                    //error handling.
                    return Promise.reject(appRoute + ' Already Exist');

                } else {
                    const routingSection = {
                        mod: {
                            name: appName
                        }
                    };

                    routingConfig[appRoute] = routingSection;
                    //write updated config into routing.js
                    const moduleExpert = 'module.exports = ';
                    const routingData = moduleExpert + JSON.stringify(routingConfig, null, 4);
                    fs.writeFileSync(routingFile, routingData);                    
                }
             
                return Promise.resolve();
            } else {
                //error handling
                return Promise.reject('routing.js Not Found');
            }
        });
        
    });
};