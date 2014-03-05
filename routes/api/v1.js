var nconf   = require('nconf');
var utils   = require('./utils');
var uuid    = require('uuid');
var Promise = require('promise');
var _       = require('lodash');
var debug   = require('debug')('routes:api:v1');

var events  = require('../../scheduler/events');

/** API end-point for version v1/ */
var api = module.exports = new utils.API({
  limit:          '10mb'
});

/** Create tasks */
api.declare({
  method:     'post',
  route:      '/task-graph/new',
  input:      'http://schemas.taskcluster.net/v1/scheduler:task-graph.json#',
  output:     null,
  title:      "Create new task-graph",
  desc: [
    "TODO: Write documentation"
  ].join('\n')
}, function(req, res) {


  var taskGraphId =
  res.reply({});

  /*

Add tasks during execution (A):
    - Scan through required tasks and update dependents accordingly
    - Insert tasks with requires from definition
    - Scan through required tasks and update requires accordingly
      - If setting requires = [] sc

  */
});



