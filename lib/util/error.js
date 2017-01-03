"use strict";

require('debug')('tracing')(__filename);

const HttpCode = require('../const/httpcode.js');

/**
 * Definition of InvalidConfiguration
 * Caused by invalid configuration
 */
class InvalidConfiguration extends Error {
    constructor(message, file, item) {
        message || (message = 'Invalid configuration.');
        if (file) message += ' ' + 'File: ' + file;
        if (item) message += ' ' + 'Item: ' + item;

        super(message);

        this.name = 'InvalidConfiguration';
        this.status = HttpCode.HTTP_INTERNAL_SERVER_ERROR;
    }
}

/**
 * Definition of InternalError
 * Invalid object detected
 */
class InternalError extends Error {
    constructor(message) {
        super(message);

        this.name = 'InternalError';
        this.status = HttpCode.HTTP_INTERNAL_SERVER_ERROR;
    }
}

class BreakContractError extends Error {
    constructor(principle) {
        super(principle ? principle : 'Design contract Violation.');

        this.name = 'BreakContractError';
        this.status = HttpCode.HTTP_INTERNAL_SERVER_ERROR;
    }
}

exports.InvalidConfiguration = InvalidConfiguration;
exports.InternalError = InternalError;
exports.BreakContractError = BreakContractError;