"use strict";

require('debug')('tracing')(__filename);

/**
 * @module Feature
 * @summary Feature level tokens.
 */

module.exports = {
    /**
     * init group
     * @member {string}
     */
    INIT: '10-init',    
    /**
     * service group
     * @member {string}
     */
    SERVICE: '20-service',
    /**
     * engine group
     * @member {string}
     */
    ENGINE: '30-engine',
    /**
     * engine group
     * @member {string}
     */
    MIDDLEWARE: '40-middleware',
    /**
     * routing group
     * @member {string}
     */
    ROUTING: '50-routing'
};