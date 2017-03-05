"use strict";

require('debug')('tracing')(__filename);

// Built-in libs
const URL = require('url');
const QS = require('querystring');
const _ = require('lodash');

/**
 * @module Util
 * @summary Collection of utilities.
 */

let U = module.exports = {

    //exports commonly-used utility class

    /**
     * A utility-belt library for JavaScript that provides support for the usual functional suspects (each, map, reduce, filter...) without extending any core JavaScript objects.
     * @member {lodash}
     */
    _: _,

    /**
     * Contains methods that aren't included in the vanilla JavaScript string such as escaping html, decoding html entities, stripping tags, etc.
     * @member {S}
     */
    get S() { return require('string'); },

    /**
     * Contains methods that aren't included in the vanilla Node.js fs package. Such as mkdir -p, cp -r, and rm -rf.
     * @member {fs}
     */
    get fs() { return require('fs-extra'); },

    get glob() { return require('glob'); },

    get connect() { return require('koa-connect'); },

    /**
     * Generator based control flow goodness for nodejs and the browser, using promises, letting you write non-blocking code in a nice-ish way.
     * @member {co}
     */
    get co() { return require('co'); },

    /**
     * Higher-order functions and common patterns for asynchronous code.
     * @member {async}
     */
    get async() { return require('async'); },    

    /**
     * A lightweight JavaScript date library for parsing, validating, manipulating, and formatting dates.
     * @member {moment}
     */
    get moment() { return require('moment'); },

    /**
     * Parse and display moments in any timezone.
     * @member {moment}
     */
    get timezone() { return require('moment-timezone'); },

    /**
     * Create a least recently used cache object.
     * @param {object} options
     * @returns {LRUCache}
     */
    createLRUCache(options) { var LRU = require("lru-cache"); return new LRU(options); },

    /**
     * Execute a shell command
     * @param {string} cmd - Command line to execute
     * @param cb - Callback
     * @returns {*|Array|{index: number, input: string}}
     */
    runCmd(cmd, cb) {
        const exec = require('child_process').exec;

        return exec(cmd, function (error, stdout, stderr) {
            let output = { stdout, stderr };

            cb(error, output);
        });
    },

    //exports utilities of this library

    /**
     * Load a js file in sand box.
     * @param {string} file - Source file
     * @param {object} variables - Variables as global
     * @param {object} deps = Dependencies
     */
    load: require('./util/loadInSandbox.js'),   

    // exports errors and constants of this library

    get Error() { return require('./util/error.js'); },

    get HttpCode() { return require('./const/httpcode.js'); },

    get Pattern() { return require('./const/pattern.js'); },

    get Feature() { return require('./const/feature.js'); },

    get Extension() { return require('./const/extension.js'); },

    //yieldable iteration-----------

    /**
     * Wrap a generator to be a callback-style async function
     * @param gen
     * @param cb
     * @param args
     * @returns {*|Promise|Function|any}
     */
    coWrap: function (gen, cb, ...args) {
        return U.co.wrap(gen)(...args).then(result => cb(null, result)).catch(reason => cb(reason || new Error()));
    },

    /**
     * co-style async eachSeries
     * @param {array|object} coll - A collection to iterate over.
     * @param {generator} gen - A generator function to apply to each item in coll. iteratee*(item)
     */
    coEach: function* (coll, gen) {
        yield (done => U.async.eachSeries(
            coll,
            (item, cb) => U.coWrap(gen, cb, item),
            done
        ));
    },

    /**
     * co-style async eachOfSeries
     * @param {array|object} coll - A collection to iterate over.
     * @param {generator} gen - A generator function to apply to each item in coll. iteratee*(item, key)
     */
    coEachOf: function* (coll, gen) {
        yield (done => U.async.eachOfSeries(
            coll,
            (item, key, cb) => U.coWrap(gen, cb, item, key),
            done
        ));
    },

    /**
     * co-style event handler
     * @param {EventEmitter} emitter - The event emitter object to listen to
     * @param {string} event - The event
     * @param {generator} gen - A generator style event handler.
     */
    coListenOn: function* (emitter, event, gen) {
        yield (done => emitter.on(
            event,
            (data) => U.coWrap(gen, done, data)
        ));
    },

    /**
     * co-style "once" event handler
     * @param {EventEmitter} emitter - The event emitter object to listen to
     * @param {string} event - The event
     * @param {generator} gen - A generator style event handler.
     */
    coListenOnce: function* (emitter, event, gen) {
        yield (done => emitter.once(
            event,
            (data) => U.coWrap(gen, done, data)
        ));
    },

    //debug related-----------
    
    contract: function (checker, principle) {
        if (process.env.NODE_ENV && process.env.NODE_ENV === 'production') return;
        
        if (!checker()) {
            throw new U.Error.BreakContractError(principle);
        }
    },
    
    //async related-----------
    eachPromiseFactories: function (arrayOfPromiseFactory) {
        var accumulator = [];
        var ready = Promise.resolve(null);

        arrayOfPromiseFactory.forEach(function (promiseFactory) {
            ready = ready.then(promiseFactory).then(function (value) {
                accumulator.push(value);
            });
        });

        return ready.then(function () { return accumulator; });
    },    

    //url related-----------

    /**
     * Merge the query parameters into given url.
     * @method
     * @param {string} url - Original url.
     * @param {object} query - Key-value pairs query object to be merged into the url.
     * @returns {string}
     */
    urlAppendQuery: function (url, query) {
        if (!query) return url;

        if (url.indexOf('?') === -1) {
            if (typeof query !== 'string') {
                return url + '?' + QS.stringify(query);
            }

            return url + '?' + query;
        }

        var urlObj = URL.parse(url, true);
        if (typeof query !== 'string') {
            delete urlObj.search;
            Object.assign(urlObj.query, query);
        } else {
            urlObj.search += '&' + query;
        }

        return URL.format(urlObj);
    },

    /**
     * Join url parts by adding necessary '/', query not supported, use urlAppendQuery instead
     * @method
     * @param {string} base - Left part
     * @param {array} parts - The rest of Url component parts
     * @returns {string}
     */
    urlJoin: function (base, ...parts) {
        base = U.trimRightSlash(base);

        if (!parts || parts.length === 0) {
            return base;
        }

        return base + U.ensureLeftSlash(parts.join('/'));
    },

    /**
     * Trim left '/' of a path
     * @method
     * @param {string} path - The path
     * @returns {string}
     */
    trimLeftSlash: function (path) {
        return U.S(path).chompLeft('/').s;
    },

    /**
     * Trim right '/' of a path
     * @method
     * @param {string} path - The path
     * @returns {string}
     */
    trimRightSlash: function (path) {
        return U.S(path).chompRight('/').s;
    },

    /**
     * Add a '/' to the left of a path if it does not have one
     * @method
     * @param {string} path - The path
     * @returns {string}
     */
    ensureLeftSlash: function (path) {
        return U.S(path).ensureLeft('/').s;
    },

    /**
     * Add a '/' to the right of a path if it does not have one
     * @method
     * @param {string} path - The path
     * @returns {string}
     */
    ensureRightSlash: function (path) {
        return U.S(path).ensureRight('/').s;
    },

    quote: function (str, quoteChar = '"') {
        return quoteChar + str.replace(quoteChar, "\\" + quoteChar) + quoteChar;
    },

    bin2Hex: function (bin) {
        bin = bin.toString();
        return '0x' + _.range(bin.length).map(i, bin.charCodeAt(i).toString(16)).join('');
    },

    //collection related-----------

    /**
     * Get a value by dot-separated path from a collection
     * @method
     * @param {object} collection - The collection
     * @param {string} path - A dot-separated path (dsp), e.g. settings.xxx.yyy
     * @param {object} [defaultValue] - The default value if the path does not exist
     * @returns {*}
     */
    getValueByPath: function (collection, path, defaultValue) {
        var nodes = path.split('.'),
            value = collection;

        if (!value) {
            return defaultValue;
        }

        if (nodes.length === 0) return null;

        U._.find(nodes, function(e) {
            value = value[e];
            return typeof value === 'undefined';
        });

        return value || defaultValue;
    },

    /**
     * Set a value by dot-separated path from a collection
     * @method
     * @param {object} collection - The collection
     * @param {string} path - A dot-separated path (dsp), e.g. settings.xxx.yyy
     * @param {object} value - The default value if the path does not exist
     * @returns {*}
     */
    setValueByPath: function (collection, path, value) {
        var nodes = path.split('.');
        var lastKey = nodes.pop();
        var lastNode = collection;

        U._.each(nodes, function(key) {
            if (key in collection) {
                lastNode = collection[key];
            } else {
                lastNode = collection[key] = {};
            }
        });

        lastNode[lastKey] = value;
    },

    /**
     * Push a non-array value into a bucket of a collection
     * @param {object} collection
     * @param {string} key
     * @param {object} value
     */
    pushObjIntoBucket: function (collection, key, value) {
        U.contract(() => !U._.isArray(value));

        let bucket = collection[key];
        
        if (!bucket) {
            bucket = collection[key] = value;
        } else if (U._.isArray(bucket)) {
            bucket.push(value);
        } else {
            bucket = collection[key] = [ bucket, value ];
        }

        return bucket;
    }
};