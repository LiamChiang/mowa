"use strict";

require('debug')('tracing')(__filename);

const koaMiddlwareSwig = require('koa-middleware-swig');

let swig = (opt, webModule) => {
    opt.views = webModule.toAbsolutePath(opt.views || 'server/views');
    return koaMiddlwareSwig(opt);
};

module.exports = swig;