"use strict";

const _ = require('lodash');
const path = require('path');
const fs = require('fs-extra');
const inflection = require('inflection');
const Oolong = require('../lang/oolong.js');
const OolUtil = require('../lang/ool-utils.js');
const EventEmitter = require('events');
const JsLang = require('./ast.js');

const escodegen = require('escodegen');
const TopoSort = require('topo-sort');
const mysql = require('mysql');

function allDependenciesResolved(context, modifier) {
    if (!_.isEmpty(modifier.arguments)) {
        let hasUnresolvedDependency = _.find(modifier.arguments.value, arg => {
            if (arg.type === 'ObjectReference') {
                let refTo = OolUtil.extractMemberAccess(arg.name).shift();
                return !context[refTo];
            }

            return false;
        });

        return !hasUnresolvedDependency;
    }

    return true;
}

function applyModifier(varName, modifier) {
    let args = [ JsLang.astId(varName) ];

    if (!_.isEmpty(modifier.arguments)) {
        args = args.concat(_.map(modifier.arguments.value, a => JsLang.astValue(a)));
    }

    return JsLang.astAssign(varName, JsLang.astCallInline(
        modifier.name,
        args
    ));
}

const fieldModifierContextSource = {
    'existing': 'existingData',
    'new': 'newData',
    'raw': 'rawData'
};

function applyFieldModifier(fieldName, modifier, astBody) {
    let args = [ JsLang.astVarRef('newData.' + fieldName) ];
    let thenDo = [];

    if (!_.isEmpty(modifier.arguments)) {
        args = args.concat(_.map(modifier.arguments.value, a => {
            if (_.isPlainObject(a) && a.type == 'ObjectReference') {
                let  p = a.name.split('.');
                if (p.length < 2) {
                    p = [ 'new' ].concat(p);
                }

                if (p[0] in fieldModifierContextSource) {
                    p[0] = fieldModifierContextSource[p[0]];
                } else {
                    throw new Error('Unsupported field modifier data source: ' + p[0]);
                }

                thenDo.push(JsLang.astIf(
                    JsLang.astNot(JsLang.astBinExp(JsLang.astValue(p[1]), 'in', JsLang.astId(p[0]))),
                    JsLang.astThrow('ModelOperationError', [
                        JsLang.astVarRef('ModelOperationError.REFERENCE_NON_EXIST_VALUE'),
                        JsLang.astValue(fieldName)
                    ])
                ));

                return JsLang.astVarRef(p.join('.'));
            } else {
                return JsLang.astValue(a);
            }
        }));
    }

    thenDo.push(JsLang.astAssign('newData.' + fieldName, JsLang.astCallInline(
        modifier.name,
        args
    )));

    astBody.push(JsLang.astIf(
        JsLang.astBinExp(JsLang.astValue(fieldName), 'in', JsLang.astId('newData')),
        thenDo
    ));
}

function processModifiersQueue(context, modifiersQueue, astBody) {
    if (modifiersQueue.length == 0) return;

    let processed = new Set();

    while (modifiersQueue.length > 0 && !processed.has(modifiersQueue[0])) {
        let modifierEntry = modifiersQueue.shift();
        processed.add(modifierEntry);

        do {
            if (allDependenciesResolved(context, modifierEntry.modifier)) {
                astBody.push(applyModifier(modifierEntry.variable, modifierEntry.modifier));

                if (modifierEntry.following.length == 0) {
                    context[modifierEntry.variable] = true;
                } else {
                    modifierEntry.modifier = modifierEntry.following.shift();
                }
            } else {
                modifiersQueue.push(modifierEntry);

                break;
            }
        } while (modifierEntry.following.length > 0);
    }

    return modifiersQueue.length == 0;
}

function prepareDbConnection(dbType, body) {
    body.push(JsLang.astDeclare('dbService', JsLang.astCallInline('this.webModule.getService', [
        JsLang.astVarRef('ModelMeta.connectionId')
    ])));
    body.push(JsLang.astDeclare('db', JsLang.astYield(JsLang.astCallInline('dbService.getConnection', [
        JsLang.astValue(true)
    ]))));
}

function processPopulate(context, dbType, op, astBody) {
    let mainTable;
    let columns = [];
    let joining = {};
    
    _.each(op.projection, collection => {
        let names = OolUtil.extractMemberAccess(collection);
        
        if (!mainTable) {
            mainTable = names[0];
        } else if (mainTable !== names[0]) {
            throw new Error('unsupported relationship.');
        }
        
        if (names.length > 2) {
            //joining exist
            throw new Error('tbd');
        } else {
            if (names[1] == '*') {
                columns.push('*');
            } else {
                columns.push(names[1]);
            }
        }        
    });

    let sql, queryValues;

    if (columns.length == 1 && columns[0] == '*') {
        sql = 'SELECT * FROM ??';
        columns = [];
        queryValues = [ mainTable ];
    } else {
        sql = 'SELECT ?? FROM ??';
        queryValues = [ columns, mainTable ];
    }

    let filter = processFilter(op.filter);
    if (!_.isEmpty(filter.dependency)) {
        let unresovledDep = _.find(filter.dependency, item => !context[item]);
        if (unresovledDep) {
            throw new Error('The populate operation has unresolved dependency: ' + unresovledDep);
        }
    }

    sql += ' WHERE ' + filter.statement;

    if (!_.isEmpty(filter.values)) {
        queryValues = queryValues.concat(filter.values);
    }

    let sqlVarName = op.output + 'Sql';
    astBody.push(JsLang.astDeclare(sqlVarName, JsLang.astValue(sql)));
    astBody.push(JsLang.astDeclare(op.output, JsLang.astYield(
        JsLang.astCallInline('db.query', [
            JsLang.astVarRef(sqlVarName),
            JsLang.astValue({ type: 'Array', value: queryValues })
        ])
    )));

    context[op.output] = true;
}

function processFilter(filter) {
    if (filter.type === 'BinaryExpression') {
        return processBinaryExpression(filter);
    } else if (filter.type === 'UnaryExpression') {
        return processUnaryExpression(filter);
    }

    let statement, values, dependency;

    if (_.isPlainObject(filter)) {
        if (filter.type === 'Variable') {
            statement = '??';
            values = [ filter.name ];
        } else if (filter.type === 'ObjectReference') {
            statement = '?';
            values = [ filter ];
            dependency = [ OolUtil.extractMemberAccess(filter.name).shift() ];
        } else if (filter.type === 'Object') {
            throw new Error('unsupported');
        } else if (filter.type === 'Array') {
            statement = '?';
            values = [ filter.value ];
        } else {
            throw new Error('unsupported');
        }
    } else {
        statement = '?';
        values = [ filter ];
    }

    return { statement, values, dependency };
}
    
function processBinaryExpression(filter) {
    let statement, values = [], dependency = [];

    let left = processFilter(filter.left);
    let right = processFilter(filter.right);
    let operator;

    switch (filter.operator) {
        case '>':
        case '<':
        case '>=':
        case '<=':
        case '=':
        case 'in':
        case 'and':
        case 'or':
            operator = filter.operator;
            break;

        case '!=':
            operator = '<>';
            break;

        default:
            throw new Error('unsupported filter operator: ' + filter.operator);
    }

    statement = `(${left.statement} ${operator} ${right.statement})`;

    if (!_.isEmpty(left.values)) {
        values = values.concat(left.values);
    }
    if (!_.isEmpty(right.values)) {
        values = values.concat(right.values);
    }

    if (!_.isEmpty(left.dependency)) {
        dependency = dependency.concat(left.dependency);
    }
    if (!_.isEmpty(right.dependency)) {
        dependency = dependency.concat(right.dependency);
    }

    return { statement, values, dependency };
}

function processUnaryExpression(filter) {
    let statement, values = [], dependency = [];

    let processed = processFilter(filter.argument);

    switch (filter.operator) {
        case 'exists':
        case 'is-not-null':
            statement = '(' + processed.statement + ' IS NOT NULL)';
            break;

        case 'not-exists':
        case 'is-null':
            statement = '(' + processed.statement + ' IS NULL)';
            break;

        case 'not':
            statement = '(NOT ' + processed.statement + ')';
            break;

        default:
            throw new Error('unsupported filter operator: ' + filter.operator);
    }

    if (!_.isEmpty(processed.values)) {
        values = values.concat(processed.values);
    }

    if (!_.isEmpty(processed.dependency)) {
        dependency = dependency.concat(processed.dependency);
    }

    return { statement, values, dependency };
}

function translateTestToAst(context, test) {
    if (_.isPlainObject(test)) {
        if (test.type === 'BinaryExpression') {
            let op;

            switch (test.operator) {
                case '>':
                case '<':
                case '>=':
                case '<=':
                case 'in':
                    op = test.operator;
                    break;

                case 'and':
                    op = '&&';
                    break;

                case 'or':
                    op = '||';
                    break;

                case '=':
                    op = '===';
                    break;

                case '!=':
                    op = '!==';
                    break;

                default:
                    throw new Error('unsupported test operator: ' + test.operator);
            }

            return {
                "type": "BinaryExpression",
                "operator": op,
                "left": translateTestToAst(context, test.left),
                "right": translateTestToAst(context, test.right)
            };
        } else if (test.type === 'UnaryExpression') {
            let astTest;

            switch (test.operator) {
                case 'exists':
                    astTest = JsLang.astNot(JsLang.astCallInline('Mowa._.isEmpty', [
                        translateTestToAst(context, test.argument)
                    ]));
                    break;

                case 'is-not-null':
                    astTest = JsLang.astNot(JsLang.astCallInline('Mowa._.isNil', [
                        translateTestToAst(context, test.argument)
                    ]));
                    break;

                case 'not-exists':
                    astTest = JsLang.astCallInline('Mowa._.isEmpty', [
                        translateTestToAst(context, test.argument)
                    ]);
                    break;

                case 'is-null':
                    astTest = JsLang.astCallInline('Mowa._.isNil', [
                        translateTestToAst(context, test.argument)
                    ]);
                    break;

                case 'not':
                    astTest = JsLang.astNot(translateTestToAst(context, test.argument));
                    break;

                default:
                    throw new Error('unsupported test operator: ' + test.operator);
            }

            return astTest;
        } else {
            if (test.type == 'ObjectReference') {
                let ref = OolUtil.extractMemberAccess(test.name).shift();
                if (!context[ref]) {
                    throw new Error('Returned uninitialized object: ' + ref);
                }
            }

            return JsLang.astValue(test);
        }
    }

    return JsLang.astValue(test);
}

function processExcepitonalReturn(context, excp, astBody) {
    if (excp.type != 'ConditionalStatement') {
        throw new Error('unsupported exceptional type: ' + excp.type);
    }

    let test = translateTestToAst(context, excp.test);
    astBody.push(JsLang.astIf(test, JsLang.astReturn(JsLang.astValue(excp.then))));
}

class ModelGenerator {
    constructor(linker, options) {
        this.linker = linker;
        this.events = new EventEmitter();
        this.options = Object.assign({buildPath: './oolong/build'}, options);
    }

    generateModifierFile(m, dbName, entityName, fieldName) {
        let modifierFilePath = path.resolve(
            this.options.buildPath,
            dbName,
            'modifiers',
            entityName + '-' + m.name + '.js'
        );

        if (fs.existsSync(modifierFilePath)) {
            //todo: analyse code
            return;
        }
        
        let params = [ fieldName ];

        _.each(m.arguments, p => {
            let name;

            if (p.type == 'ObjectReference') {
                if (OolUtil.isMemberAccess(p.name)) {
                    name = OolUtil.extractMemberAccess(p.name).pop();
                } else {
                    name = p.name;
                }
            } else {
                name = 'arg' + params.length + 1;
            }

            if (params.indexOf(name) != -1) {
                throw new Error('need change param name.');
            }

            params.push(name);
        });


        let ast = JsLang.astProgram([
            JsLang.astRequire('Mowa', 'mowa'),
            JsLang.astFunction(m.name, _.map(params, p => JsLang.astId(p)), []),
            JsLang.astAssign('module.exports', JsLang.astVarRef(m.name))
        ]);
                
        this.exportSourceCode(ast, modifierFilePath);
        this.linker.log('info', 'Generated field modifier file: ' + modifierFilePath);
    }

    generate(schemas) {        
        _.forOwn(schemas, (schema, schemaName) => {
            _.forOwn(schema.deployments, (db, dbName) => {                
                _.forOwn(schema.entities, (entity, entityName) => {

                    let ast = JsLang.astProgram([
                        JsLang.astRequire('Mowa', 'mowa'),
                        JsLang.astRequire('mysql', 'mysql'),
                        JsLang.astDeclare('Oolong', JsLang.astVarRef('Mowa.OolongRuntime'), true),
                        JsLang.astDeclare('Util', JsLang.astVarRef('Mowa.Util'), true),
                        JsLang.astMatchObject(['ModelValidationError', 'ModelOperationError'], JsLang.astVarRef('Oolong'))
                    ]);

                    let modifiersQueue = this.generateModifiers(entity, entityName, dbName, ast);

                    if (entityName == 'user') {
                        console.log(JSON.stringify(entity, null, 4));
                    }

                    let translatedFields = { type: 'Object', value: _.reduce(entity.fields, (result, v, k) => {
                        if (_.isPlainObject(v.default) && v.default.type != 'Object') {
                            v.default = { type: 'Object', value: v.default };
                        }

                        result[k] = { type: 'Object', value: v };
                        return result;
                    }, {})};

                    let modelMetaInit = {
                        connectionId: db.type + ':' + dbName,
                        modelName: entityName,
                        primaryKey: entity.key,
                        fields: translatedFields,
                        flags: { type: 'Object', value: entity.modelingFlags }
                    };

                    let modelMeta = JsLang.astValue({type: 'Object', value: modelMetaInit});

                    this.generateCreateMethod(modifiersQueue, entity, modelMeta);
                    
                    if (entity.interfaces) {
                        this.generateInterfaces(entity, db, modelMeta);
                    }                    

                    JsLang.astAddBodyExpression(ast, JsLang.astDeclare('ModelMeta', modelMeta, true));
                    JsLang.astAddBodyExpression(ast, JsLang.astAssign('module.exports', JsLang.astVarRef('ModelMeta')));

                    if (entityName == 'user') {
                        //console.log(JSON.stringify(ast, null, 4));
                    }
                    
                    let modelFilePath = path.resolve(this.options.buildPath, schemaName, entityName + '.js');
                    this.exportSourceCode(ast, modelFilePath);
                    this.linker.log('info', 'Generated data access model: ' + modelFilePath);
                });
            });
        });
    }

    exportSourceCode(ast, modelFilePath) {
        let content = escodegen.generate(ast, {
            format: {
                indent: {
                    style: '    ',
                    base: 0,
                    adjustMultilineComment: false
                },
                newline: '\n',
                space: ' ',
                json: false,
                renumber: false,
                hexadecimal: false,
                quotes: 'single',
                escapeless: false,
                compact: false,
                parentheses: true,
                semicolons: true,
                safeConcatenation: false
            }
        });

        fs.ensureFileSync(modelFilePath);
        fs.writeFileSync(modelFilePath, content);
    };

    generateCreateMethod(modifiersQueue, entity, modelMeta) {
        let createBody = [
            JsLang.astMatchObject(
                ['errors', 'warnings', 'newData', 'dbFunctionCalls'],
                JsLang.astYield(
                    JsLang.astCallInline(
                        'Oolong.modelPreCreate',
                        [ JsLang.astVarRef('this.webModule'), JsLang.astId('ModelMeta'), JsLang.astId('rawData') ]
                    )
                )
            )
        ];

        if (!_.isEmpty(entity.extraValidationRules)) {
            _.each(entity.extraValidationRules, rule => {
                if (rule.name == 'atLeastOneNotNull') {
                        
                }       
            }); 
        }

        createBody.push(JsLang.astIf(
            JsLang.astId('errors'),
            [ {
                "type": "ThrowStatement",
                "argument": JsLang.astCallInline('ModelValidationError.fromErrors', [
                    JsLang.astId('errors'),
                    JsLang.astId('warnings'),
                    JsLang.astBinExp(JsLang.astVarRef('ModelMeta.modelName'), '+', JsLang.astValue('.create'))
                ])
            } ]
        ));

        createBody.push(JsLang.astIf(
            JsLang.astBinExp(JsLang.astVarRef('warnings.length'), '>', JsLang.astValue(0)),
            [ JsLang.astCall(
                'this.webModule.log',
                [ JsLang.astValue('warn'), JsLang.astCallInline({
                    "type": "MemberExpression",
                    "computed": false,
                    "object": JsLang.astCallInline('Mowa.Util._.map', [
                        JsLang.astId('warnings'),
                        JsLang.astArrowFunction([ JsLang.astId('w') ], JsLang.astVarRef('w.message'))
                    ]),
                    "property": JsLang.astId('join')
                }, [ JsLang.astValue('\n') ]) ])
            ]
        ));

        _.each(modifiersQueue, field => {
            let p = field.split('.');
            let [ stage, fieldName ] = p.length > 1 ? p : ['new', p[0]];

            if (stage == 'existing' || stage == 'raw') return;

            if (stage != 'new') {
                throw new Error('Unsupported data stage: ' + stage);
            }

            if (fieldName in entity.fieldModifiers) {
                let modifiers = entity.fieldModifiers[fieldName];

                _.each(modifiers, m => {
                    applyFieldModifier(fieldName, m, createBody);
                });
            }
        });

        createBody.push(
            JsLang.astReturn(JsLang.astYield(
                JsLang.astCallInline(
                    'Oolong.mysqlModelCreate',
                    [ JsLang.astVarRef('this.webModule'), JsLang.astId('ModelMeta'), JsLang.astId('rawData'), JsLang.astId('newData'), JsLang.astId('dbFunctionCalls') ]
                )
            ))
        );

        JsLang.astAddMember(modelMeta, JsLang.astMember('create', JsLang.astAnonymousFunction([JsLang.astId('rawData')], createBody, true)));
    };

    generateModifiers(entity, entityName, dbName, ast) {
        let modifiersTable = {}; // name -> file
        let modifierReverseMappingTable = {}; // file -> name
        let tsort = new TopoSort();

        if (entity.fieldModifiers) {
            _.forOwn(entity.fieldModifiers, (mods, fieldName) => {
                let modEntityName, modRefName, modJsFile;

                _.each(mods, m => {
                    //extract modifier naming and import information
                    if (OolUtil.isMemberAccess(m.name)) {
                        let names = OolUtil.extractMemberAccess(m.name);
                        if (names.length > 2) {
                            throw new Error('not supported yet.');
                        }

                        modEntityName = names[0];
                        modRefName = names[1];
                    } else {
                        modEntityName = entityName;
                        modRefName = m.name;

                        this.generateModifierFile(m, dbName, entityName, fieldName);
                    }

                    modJsFile = modEntityName + '-' + modRefName + '.js';

                    if (modifiersTable[modRefName] && modifiersTable[modRefName] != modJsFile) {
                        modRefName = modEntityName + inflection.camelize(modRefName);

                        if (modifiersTable[modRefName]) {
                            throw new Error('need change modifier name.');
                        }
                    }

                    modifiersTable[modRefName] = modJsFile;
                    modifierReverseMappingTable[modJsFile] = modRefName;

                    //extract dependencies information
                    if (_.isPlainObject(m.arguments)) {
                        if (m.arguments.type != 'Array') {
                            throw new Error('Invalid modifier arguments.');
                        }

                        _.each(m.arguments.value, arg => {
                            if (_.isPlainObject(arg) && arg.type == 'ObjectReference') {
                                tsort.add(arg.name, [ 'new.' + fieldName ]);
                            }
                        });
                    }
                });
            });
        }

        if (!_.isEmpty(modifiersTable)) {
            _.forOwn(modifiersTable, (jsFile, varName) => {
                JsLang.astAddBodyExpression(ast, JsLang.astRequire(varName, './modifiers/' + jsFile));
            });
        }

        return tsort.sort();
    };

    generateInterfaces(entity, db, modelMeta) {
        _.forOwn(entity.interfaces, (method, name) => {
            let body = [], params = [], modifiersQueue = [], context = {};

            if (method.accept) {
                params = _.map(method.accept, variable => {
                    if (variable.type === 'Variable') {
                        if (!('optional' in variable) || !variable.optional) {
                            body.push(JsLang.astIf(
                                JsLang.astCallInline('Util._.isNil', JsLang.astVarRef(variable.name)),
                                JsLang.astThrow('ModelValidationError', [
                                    JsLang.astVarRef('ModelValidationError.MISSING_REQUIRED_VALUE'),
                                    JsLang.astValue(variable.name)
                                ])
                            ));
                        }

                        if (variable.modifiers) {
                            //discover dependency
                            while (variable.modifiers.length > 0) {
                                let modifier = variable.modifiers.shift();

                                if (allDependenciesResolved(context, modifier)) {
                                    body.push(applyModifier(variable.name, modifier));

                                    if (variable.modifiers.length == 0) {
                                        context[variable.name] = true;
                                    }
                                } else {
                                    modifiersQueue.push({
                                        variable: variable.name,
                                        modifier: modifier,
                                        following: variable.modifiers
                                    });

                                    break;
                                }
                            }
                        } else {
                            context[variable.name] = true;
                        }

                        return JsLang.astValue(variable);
                    } else {
                        throw new Error('not implemented yet');
                    }
                });

                processModifiersQueue(context, modifiersQueue, body);
            }

            let preparedDb = false;

            _.each(method.implementation, operation => {
                switch (operation.type) {
                    case 'populate':
                        if (!preparedDb) {
                            prepareDbConnection(db.type, body);
                            preparedDb = true;
                        }
                        processPopulate(context, db.type, operation, body);
                        //console.log(context);
                        processModifiersQueue(context, modifiersQueue, body);
                        break;

                    case 'update':
                        if (!preparedDb) {
                            prepareDbConnection(db.type, body);
                            preparedDb = true;
                        }
                        break;

                    case 'create':
                        if (!preparedDb) {
                            prepareDbConnection(db.type, body);
                            preparedDb = true;
                        }
                        break;

                    case 'delete':
                        if (!preparedDb) {
                            prepareDbConnection(db.type, body);
                            preparedDb = true;
                        }
                        break;

                    case 'javascript':
                        break;

                    case 'assignment':
                        break;

                    default:
                        throw new Error('unsupported operation type: ' + operation.type);
                }
            });

            if (method.return) {
                if (!_.isEmpty(method.return.exceptions)) {
                    _.each(method.return.exceptions, excp => {
                        processExcepitonalReturn(context, excp, body);
                    });
                }

                body.push(JsLang.astReturn(JsLang.astValue(method.return.value)));
            }

            JsLang.astAddMember(modelMeta, JsLang.astMember(name, JsLang.astAnonymousFunction(params, body, true)));
        });
    };
}

module.exports = ModelGenerator;