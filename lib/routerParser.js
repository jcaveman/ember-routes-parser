'use strict';

var esprima = require('esprima');
var fs = require('fs');

/**
 * Esprima name for expressions
 * @type {string}
 */
var EXPRESSION = 'ExpressionStatement';

/**
 * Esprima name for blocks
 * @type {string}
 */
var BLOCK = 'BlockStatement';

/**
 * Esprima name for Objects
 * @type {string}
 */
var OBJECT = 'ObjectExpression';

/**
 * Esprima name for function calls
 * @type {string}
 */
var CALL = 'CallExpression';

/**
 * Given the path to a router will parse it and object with the routes
 * @param {string} router - Path to the router we want to parse
 * @returns {object} routes - Object containing the routes in this format:
 *  {
 *    "routeName": {
 *      path: "some/:path/here"
 *    },
 *    ...
 *  }
 */
function getRoutesFromRouter(router) {
  try {
    return exports.parseRouter(fs.readFileSync(router, {encoding: 'utf8'}));
  } catch (e) {
    console.error('Router file not found');
  }
}

/**
 * Parses a router and returns object with the routes
 * @param {string} router - Router code to be parsed
 * @returns {object} routes - Object containing the routes
 */
function parseRouter(router) {
  var ast = esprima.parse(router);
  ast = exports.getRouterMapBody(ast);

  if (!ast || ast.type !== BLOCK) {
    return null;
  }

  var routes = {};

  var current;
  var parsed;
  for (var i = 0; i < ast.body.length; i++) {
    current = ast.body[i];
    if (current.type === EXPRESSION) {
      parsed = exports.parseExpressionStatement(current);
      for (var j in parsed) {
        routes[j] = parsed[j];
      }
    }
  }

  return routes;
}

/**
 * Delegates to addRoute or addResource depending on the expressionStatement
 * @param {object} expressionStatement - Expression statement to parse
 * @param {object} prefix - Object telling us the prefixes we will use
 * @returns {object} routes - Object containing the routes
 */
function parseExpressionStatement(expressionStatement, prefix) {
  var type = expressionStatement.expression.callee.property.name;
  switch (type) {
    case 'route':
      return exports.addRoute(expressionStatement, prefix);
    case 'resource':
      return exports.addResource(expressionStatement, prefix);
    default:
      return {};
  }
}

/**
 * Parses an ExpressionStatement representing a resource. Since resources can
 * have other resources and routes it will use recursion to go as deep as
 * necessary
 * @param {object} resource - ExpressionStatement parsed by esprima
 * @param {object} prefix - Object telling us the prefixes we will use for the
 *        route names and paths from this resource. This is the format:
 *        {
 *          name: 'somePrefix',
 *          path: '/some/prefix'
 *        }
 * @returns {object} routes - Object containing the routes in this format:
 *  {
 *    "routeName": {
 *      path: "some/:path/here"
 *    },
 *    ...
 *  }
 */
function addResource(resource, prefix) {
  var routes = {};
  var args = resource.expression.arguments;

  // If the last argument is not a callback then we can use addRoute
  if ((args.length === 2 && args[1].type === OBJECT) ||
      args.length === 1) {
    routes = exports.addRoute(resource, prefix);
  } else {
    var body;
    if (args.length === 2) {
      body = args[1].body.body;
    } else {
      body = args[2].body.body;
    }

    if (body.length > 0) {
      exports.mergeObjects(routes, exports.addRoute(resource, prefix));
      prefix = exports.buildPrefix(resource, prefix);
      for (var i = 0; i < body.length; i++) {
        if (body[i].type === EXPRESSION) {
          exports.mergeObjects(
            routes,
            exports.parseExpressionStatement(body[i], prefix)
          );
        }
      }
    }
  }

  return routes;
}

/**
 * Parses an ExpressionStatement representing a route and adds it to the routes
 * object
 * @param {object} expressionStatement - ExpressionStatement parsed by esprima
 * @param {object} prefix - Object telling us the prefixes we will use for the
 *        route names and paths from this resource. This is the format:
 *        {
 *          name: 'somePrefix',
 *          path: '/some/prefix'
 *        }
 * @returns {object} routes - Object containing the routes in this format:
 *  {
 *    "routeName": {
 *      path: "some/:path/here"
 *    },
 *    ...
 *  }
 */
function addRoute(expressionStatement, prefix) {
  var args = expressionStatement.expression.arguments;
  var routes = {};
  var newRoute;

  if (args.length > 1 && args[1].type === OBJECT) {
    var pathValue = exports.getPropertyValue(args[1], 'path');
    newRoute = {
      path: pathValue
    };
  } else {
    newRoute = {
      path: '/' + args[0].value
    };
  }

  if (!prefix) {
    routes[args[0].value] = newRoute;
  } else {
    newRoute.path = prefix.path + newRoute.path;
    var key = prefix.name + args[0].value.charAt(0).toUpperCase() +
        args[0].value.slice(1);
    routes[key] = newRoute;
  }

  return routes;
}

/**
 * Given a router AST it will return the part the FunctionExpression that
 * corresponds to the function passed to App.Router.map
 * @param {object} ast - AST generated by running esprima on the router
 * @returns {object} The CallExpression that was called by App.Router.map
 */
function getRouterMapBody(ast) {
  if (!ast || typeof ast !== 'object') {
    return undefined;
  }

  if (ast.type === CALL && ast.callee.property.name === 'map') {
    return ast;
  }

  var i,
      found;
  for (i in ast) {
    if (typeof ast[i] === 'object') {
      found = exports.getRouterMapBody(ast[i]);
      if (found) {
        if (found.callee && found.callee.property.name === 'map') {
          return found.arguments[0].body;
        }
        return found;
      }
    }
  }
}

/**
 * Builds a prefix object that will be used to create new routes inside of a
 * resource
 * @param {object} expression - ExpressionStatement parsed by esprima
 * @param {object} prefix - Prefix object for the current resource level. This
 *        is the format:
 *        {
 *          name: 'somePrefix',
 *          path: '/some/prefix'
 *        }
 * @returns {object} newPrefix - Prefix object created based on resource and
 *        given prefix. It follows the same format.
 */
function buildPrefix(expression, prefix) {
  var args = expression.expression.arguments;
  var value = args[0].value;
  var givenPath = '/' + value;
  var newPrefix;

  if (args.length === 3 || (args.length === 2 && args[1].type === OBJECT)) {
    givenPath = exports.getPropertyValue(args[1], 'path');
  }

  if (!prefix || !prefix.name) {
    newPrefix = {
      name: value,
      path: givenPath
    };
  } else {
    newPrefix = {
      name: prefix.name + value[0].toUpperCase() + value.slice(1),
      path: prefix.path + givenPath
    };
  }

  return newPrefix;
}

/**
 * Finds the a value inside an ObjectExpression properties
 * @param {object} objectExpression - esprima ObjectExpression
 * @param {string} key - The key we are looking for inside the properties
 * @returns {string} val - The value or undefined if not found
 */
function getPropertyValue(objectExpression, key) {
  var i;
  var property;

  for (i in objectExpression.properties) {
    property = objectExpression.properties[i];
    if (property.key.name === key) {
      return property.value.value;
    }
  }
}

/**
 * Copies attributues from o2 to o1. Attributes from o1 will be overwritten if
 * they already exist
 * @param {object} o1 - Object where the attributes will be copied
 * @param {object} o2 - Attributes will be taken from this object
 */
function mergeObjects(o1, o2) {
  var i;
  for (i in o2) {
    o1[i] = o2[i];
  }
}

exports.addResource = addResource;
exports.addRoute = addRoute;
exports.buildPrefix = buildPrefix;
exports.getPropertyValue = getPropertyValue;
exports.getRouterMapBody = getRouterMapBody;
exports.getRoutesFromRouter = getRoutesFromRouter;
exports.mergeObjects = mergeObjects;
exports.parseExpressionStatement = parseExpressionStatement;
exports.parseRouter = parseRouter;