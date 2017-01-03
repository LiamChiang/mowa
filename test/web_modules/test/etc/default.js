module.exports = {
    middlewares: {
        serveStatic: { root: 'www' }
    },
    routes: {
        '/': {
            rule: {
                middlewares: {
                    swig: {
                        autoescape: true,
                        cache: false, // disable, set to false
                        ext: 'swig'
                    }
                },
                rules: {
                    'get:/test': 'test.index'
                }
            }
        }
    }
};