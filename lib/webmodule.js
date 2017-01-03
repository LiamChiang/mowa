"use strict";

require('debug')('tracing')(__filename);

const Util = require('./util.js');
const util = require('util');
const path = require('path');
const EventEmitter = require('events');
const koa = require('koa');
const mount = require('koa-mount');
const vhost = require('koa-vhost');

/**
 * options
 *   verbose
 *   modulesPath
 *   extensionPath
 *   etcPath
 */
class WebModule extends EventEmitter {
    /**
     * A web module object.
     * @constructs WebModule
     * @param {WebModule} parent
     * @param {string} name - The name of the web module.
     * @param {string} route - The base route of the  web module.
     * @param {object} options - The web module's extra options defined in its parent's configuration.
     */
    constructor(parent, name, route, options) {
        super();

        this.parent = parent;        
        this.options = Object.assign({
            modulesPath: 'web_modules',
            etcPath: 'etc',
            backendPath: 'server',
            frontendPath: 'client',
            middlewaresPath: 'middlewares',
            featuresPath: 'features'
        }, options);

        this.name = name || '';
        
        this.services = new Map(); // services
        this.middlewares = new Map(); // middlewares

        if (!parent) {
            this.etcPrefix = 'server';
            this.env = process.env.NODE_ENV || "development";
            this.path = '';
            this.absolutePath = process.cwd();
            this.route = '';

            this.router = koa();
            this.server = this;
            this.displayName = `Server::${this.name}`;
        } else {
            this.etcPrefix = 'app';
            this.env = parent.env;
            this.path = path.join(parent.options.modulesPath, name);
            this.absolutePath = parent.toAbsolutePath(this.path);
            this.route = Util.ensureLeftSlash(Util.trimRightSlash(Util.urlJoin(parent.route, route)));

            this.router = koa();
            this.server = parent.server;
            this.displayName = this.name;

            if (this.parent == this.server) {
                this.displayName = 'App::' + this.displayName;
            } else {
                this.displayName = this.parent.displayName + ' > ' + this.displayName;
            }

            if (!Util.fs.existsSync(this.absolutePath)) {
                throw new Error(`Web module [${this.name}] does not exist.`);
            }
        }
    }

    get hostingHttpServer() {
        return this.httpServer || this.parent.hostingHttpServer;
    }

    start(extraFeatures) {
        //load middlewares of the web module
        this.loadMiddlewareFiles(this.toAbsolutePath(this.options.backendPath, this.options.middlewaresPath));

        let cfgFile = this.toAbsolutePath(this.options.etcPath, this.etcPrefix + '.' + this.env + '.js');
        return this._loadConfiguration(cfgFile).then(c => {
            this.config = c;
            return this._loadDefaultConfiguration();

        }).then(cDef => {
            Util._.defaults(this.config, cDef);
            if (!Util._.isEmpty(extraFeatures)) Util._.extend(this.config, extraFeatures);

            return this._loadFeatures();
        }).then(() => {
            if (this.options.logger) {
                this.logger = this.getLoggerById(this.options.logger);
                
                if (!this.logger) {
                    throw new Error('No logger');
                }
            }
        });
    }

    toWebPath(relativePath, ...pathOrQuery) {
        let url, query;

        if (pathOrQuery && pathOrQuery.length > 0) {
            if (Util._.isObject(pathOrQuery[pathOrQuery.length - 1])) {
                query = pathOrQuery.pop();
            }
            pathOrQuery.unshift(relativePath);
            url = Util.urlJoin(this.route, ...pathOrQuery);
        } else {
            url = Util.urlJoin(this.route, relativePath);
        }

        url = Util.ensureLeftSlash(url);
        if (query) {
            url = Util.urlAppendQuery(url, query);
            url = url.replace('/?', '?');
        }

        return url;
    }

    toAbsolutePath(part) {
        if (arguments.length == 0) {
            return this.absolutePath;
        }

        let parts = Array.prototype.slice.call(arguments);
        parts.unshift(this.absolutePath);

        return path.resolve.apply(null, parts);
    }

    /**
     * Register a service
     * @memberof WebModule#
     * @param {string} name
     * @param {object} serviceObject
     * @param {boolean} override
     */
    registerService(name, serviceObject, override) {
        if (name in this.services && !override) {
            throw new Util.Error.InternalError('Service "'+ name +'" already registered!');
        }

        this.services[name] = serviceObject;
    }

    /**
     * [async] Get a service from module hierarchy
     * @memberof WebModule#
     * @param name
     * @returns {object}
     */
    getService(name) {
        if (name in this.services) {
            return this.services[name];
        }

        if (this.parent) {
            return this.parent.getService(name);
        }

        return undefined;
    }

    getModel(modelId) {
        let partNodes = modelId.split('.');
        let modelPath = this.toAbsolutePath(this.options.backendPath, 'models', ...partNodes) + '.js';

        return require(modelPath);
    }

    loadMiddlewareFiles(mwPath) {
        let files = Util.glob.sync(path.join(mwPath, '*.js'), {nodir: true});
        files.forEach(file => this.registerMiddleware(path.basename(file, '.js'), require(file)));
    }

    /**
     * Register a middleware
     * @memberof WebModule#
     * @param {string} name
     * @param {object} middleware
     */
    registerMiddleware(name, middleware) {
        if (name in this.middlewares) {
            throw new Util.Error.InternalError('Middleware "'+ name +'" already registered!');
        }

        this.middlewares[name] = middleware;
    }

    /**
     * Get a middlware from module hierarchy
     * @memberof WebModule#
     * @param name
     * @returns {Function}
     */
    getMiddleware(name) {
        if (name in this.middlewares) {
            return this.middlewares[name];
        }

        if (this.parent) {
            return this.parent.getMiddleware(name);
        }

        return undefined;
    }

    useMiddlewares(router, middlewares) {
        if (this.server.options.deaf) return;        

        Util._.forOwn(middlewares, (options, name) => {
            let middleware = this.getMiddleware(name);

            if (typeof middleware !== 'function') {
                this.invalidConfig('middlewares', 'Unregistered middlware: ' + name);
            }

            //walk around the fix: https://github.com/alexmingoia/koa-router/issues/182
            if (router.register && middleware.__metaMatchMethods && middleware.__metaMatchMethods.length) {
                router.register('(.*)', middleware.__metaMatchMethods, middleware(options, self), {end: false});
            } else {
                router.use(middleware(options, this));
            }

            this.consoleVerbose(`Attached middleware [${name}].`);
        });
    }

    addRoute(router, method, route, middlewares) {
        if (this.server.options.deaf) return;

        let generators = [];

        Util._.forOwn(middlewares, (options, name) => {
            let middleware = this.getMiddleware(name);

            if (typeof middleware !== 'function') {
                this.invalidConfig('middlewares', 'Unregistered middlware: ' + name);
            }

            generators.push(middleware(options, this));

            this.consoleVerbose(`Middleware "${name}" is attached at "${method}:${this.route}${route}".`);
        });

        router[method](route, ...generators);

        this.consoleVerbose(`Route "${method}:${this.route}${route}" is added from module [${this.name}].`);
    }

    addRouter(nestedRouter) {
        if (this.server.options.deaf) return;

        this.router.use(nestedRouter.routes());
    }

    addChildModule(baseRoute, childModule) {
        this.childModules || (this.childModules = {});
        this.childModules[childModule.name] = childModule;

        if (this.server.options.deaf || childModule.httpServer) return;

        if (childModule.options.host) {
            this.consoleVerbose(`Child module [${childModule.name}] is mounted at "${childModule.route}" with host pattern: "${childModule.options.host}".`);
            this.router.use(vhost(childModule.options.host, childModule.router));
        } else {
            this.consoleVerbose(`Child module [${childModule.name}] is mounted at "${childModule.route}".`);
            this.router.use(mount(baseRoute, childModule.router));
        }
    }

    getLoggerById(loggerId) {
        let loggers, logger, owner = this;
        let rootLoggers = this.server.getService('loggers');

        do {
            loggers = owner.getService('loggers');
            if (loggers) {
                logger = loggers.loggers[loggerId];
            }
            owner = this.parent;
        } while (!logger && owner && loggers != rootLoggers);


        if (!logger) {
            throw new Error(`Logger channel [${loggerId}] not found.`);
        }

        return logger;
    }

    /**
     * Write log.
     * @memberof WebModule#
     * @param {string} level - Log level, e.g., error, warn, info, verbose, debug
     * @param {string} message - Message
     * @param {*} [meta] - Any extra meta data
     */
    log(level, message, meta) {
        message = '[' + this.displayName + ']# ' + message;

        if (this.logger) {
            this.logger.log.call(this.logger, ...arguments);
        } else if (this.options.verbose || level < 3) {
            console.log(level + ': ' + message + (meta ? ' Related: ' + JSON.stringify(meta, null, 4) : ''));
        }
    }

    consoleVerbose(text) {
        if (this.options.verbose) {
            console.log('verbose: [' + this.displayName + ']# ' + text);
        }
    }

    invalidConfig(item, msg) {
        let cfgFile = path.relative(this.server.absolutePath, this.diagConfigLoading);
        throw new Util.Error.InvalidConfiguration(msg, cfgFile, item);
    }    

    _loadConfiguration(file) {
        let globals = {
            '$name': this.name,
            '$serverPath': (p) => this.server.toAbsolutePath(p),
            '$modulePath': (p) => this.toAbsolutePath(p),
            '$route': (p) => (p ? Util.urlJoin(this.route, p) : this.route),
            '$opt': (node) => Util.getValueByPath(this.options, node),
            '$setting': (node) => Util.getValueByPath(this.settings, node),
            '$now': Util.moment()
        };

        if (!Util.fs.existsSync(file)) {
            return Promise.resolve({});
        } else {
            this.diagConfigLoading = file;
            return Util.load(file, globals);
        }
    }

    _loadDefaultConfiguration() {
        return this._loadConfiguration(this.toAbsolutePath(this.options.etcPath, this.etcPrefix + '.default.js'));
    }

    _loadFeatures() {
        // features
        let features = {
            [Util.Feature.INIT]: [],
            [Util.Feature.SERVICE]: [],
            [Util.Feature.ENGINE]: [],
            [Util.Feature.MIDDLEWARE]: [],
            [Util.Feature.ROUTING]: []
        };

        Util._.forOwn(this.config, (block, name) => {
            let feature = this._loadFeature(name);

            if (!feature.type) {
                throw new Error(`Missing feature type. Feature: ${name}`);
            }

            if (!(feature.type in features)) {
                throw new Error(`Invalid feature type. Feature: ${name}, type: ${feature.type}`);
            }

            features[feature.type].push(() => {
                this.consoleVerbose(`Loading feature: ${name} ...`);

                return feature.load(this, block);
            });
        });

        let featureGroups = Object.keys(features);

        let result = Promise.resolve();

        featureGroups.forEach(group => {

            result = result.then(() => {
                this.emit('before:' + group);
                return Promise.resolve();
            });

            features[group].forEach(function (promiseFactory) {
                result = result.then(promiseFactory);
            });

            result = result.then(() => {
                this.emit('after:' + group);
                return Promise.resolve();
            });
        });

        return result;
    }

    /**
     * Load a feature
     * @memberof WebModule#
     * @param {string} feature
     * @returns {*}
     */
    _loadFeature(feature) {
        if (this._features && this._features[feature]) {
            return this._features[feature];
        }

        this._features || (this._features = {});

        let extensionJs = this.toAbsolutePath(this.options.backendPath, this.options.featuresPath, feature + '.js');

        if (!Util.fs.existsSync(extensionJs)) {
            if (this.parent) {
                return this.parent._loadFeature(feature);
            } else {
                extensionJs = path.resolve(__dirname, 'features', feature + '.js');

                if (!Util.fs.existsSync(extensionJs)) {
                    throw new Error(`Feature "${feature}" not exist.`);
                }
            }
        }

        return (this._features[feature] = require(extensionJs));
    }
}

module.exports = WebModule;