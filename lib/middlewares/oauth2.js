"use strict";

require('debug')('tracing')(__filename);

const OAuth2lib = require('oauth20-provider');
const Util = require('../util.js');

module.exports = (config, webModule) => {
    let oauth2 = new OAuth2lib(config.options);

    if (!config.model || !config.model.path) {
        webModule.invalidConfig('oauth2.model.path', 'Model path is required.');
    }

    let modelPath = config.model.path;

    let Client = require(webModule.toAbsolutePath(modelPath, 'client.js'));
    let User = require(webModule.toAbsolutePath(modelPath, 'user.js'));
    let AccessToken = require(webModule.toAbsolutePath(modelPath, 'accessToken.js'));
    let RefreshToken = require(webModule.toAbsolutePath(modelPath, 'refreshToken.js'));
    let Code = require(webModule.toAbsolutePath(modelPath, 'code.js'));

    oauth2.model = {
        client: new Client(webModule, config.model.options),
        user: new User(webModule, config.model.options),
        accessToken: new AccessToken(webModule, config.model.options),
        refreshToken: new RefreshToken(webModule, config.model.options),
        code: new Code(webModule, config.model.options)
    };

    webModule.registerMiddleware('oauth2Token', () => function* (next) {
        //temp fix for oauth2 bug
        let headerBackup = this.res.header;
        let sendBackup = this.res.send;
        let self = this;
        this.res.header = this.res.setHeader.bind(this.res);
        this.res.send = function (data) {
            let s = data.message || JSON.stringify(data);
            self.res.end(s);
        };
        yield Util.connect(oauth2.controller.token);
        this.res.header = headerBackup;
        this.res.send = sendBackup;

        yield next;
    });
    webModule.registerMiddleware('oauth2Authorization', () => Util.connect(oauth2.controller.authorization));
    webModule.registerMiddleware('oauth2Bearer', () => Util.connect(oauth2.middleware.bearer));

    return Util.connect(oauth2.inject());
};