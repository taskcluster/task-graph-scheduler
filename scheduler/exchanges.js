var base    = require('taskcluster-base');
var assert  = require('assert');

/** Declaration of exchanges offered by the scheduler */
var exchanges = new base.Exchanges({
  title:      "Scheduler AMQP Exchanges",
  description: [
    "The scheduler, typically available at `scheduler.taskcluster.net` is",
    "responsible for accepting task-graphs and schedule tasks on the queue as",
    "their dependencies are completed successfully.",
    "",
    "This document describes the AMQP exchanges offered by the scheduler,",
    "which allows third-party listeners to monitor task-graph submission and",
    "resolution. These exchanges targets the following audience:",
    " * Reporters, who displays the state of task-graphs or emails people on",
    "   failures, and",
    " * End-users, who wants notification of completed task-graphs",
    "",
    "**Remark**, the task-graph scheduler will require that the `schedulerId`",
    "for tasks is set to the `schedulerId` for the task-graph scheduler. In",
    "production the `schedulerId` is typically `\"task-graph-scheduler\"`.",
    "Furthermore, the task-graph scheduler will also require that",
    "`taskGroupId` is equal to the `taskGraphId`.",
    "",
    "Combined these requirements ensures that `schedulerId` and `taskGroupId`",
    "have the same position in the routing keys for the queue exchanges.",
    "See queue documentation for details on queue exchanges. Hence, making",
    "it easy to listen for all tasks in a given task-graph.",
    "",
    "Note that routing key entries 2 through 7 used for exchanges on the",
    "task-graph scheduler is hardcoded to `_`. This is done to preserve",
    "positional equivalence with exchanges offered by the queue."
  ].join('\n')
});

// Export exchanges
module.exports = exchanges;

/** Common routing key construct for `exchanges.declare` */
var commonRoutingKey = [
  {
    name:             'routingKeyKind',
    summary:          "Identifier for the routing-key kind. This is " +
                      "always `'primary'` for the formalized routing key.",
    constant:         'primary',
    required:         true
  }, {
    name:             'taskId',
    summary:          "Always takes the value `_`",
    required:         false,
    maxSize:          22
  }, {
    name:             'runId',
    summary:          "Always takes the value `_`",
    required:         false,
    maxSize:          3
  }, {
    name:             'workerGroup',
    summary:          "Always takes the value `_`",
    required:         false,
    maxSize:          22
  }, {
    name:             'workerId',
    summary:          "Always takes the value `_`",
    required:         false,
    maxSize:          22
  }, {
    name:             'provisionerId',
    summary:          "Always takes the value `_`",
    required:         false,
    maxSize:          22
  }, {
    name:             'workerType',
    summary:          "Always takes the value `_`",
    required:         false,
    maxSize:          22
  }, {
    name:             'schedulerId',
    summary:          "Identifier for the task-graphs scheduler managing the " +
                      "task-graph this message concerns. Usually " +
                      "`task-graph-scheduler` in production.",
    required:         true,
    maxSize:          22
  }, {
    name:             'taskGraphId',
    summary:          "Identifier for the task-graph this message concerns",
    required:         true,
    maxSize:          22
  }, {
    name:             'reserved',
    summary:          "Space reserved for future routing-key entries, you " +
                      "should always match this entry with `#`. As " +
                      "automatically done by our tooling, if not specified.",
    multipleWords:    true,
    maxSize:          1
  }
];

/** Build an AMQP compatible message from a message */
var commonMessageBuilder = function(message) {
  message.version = 1;
  return message;
};

/** Build a routing-key from message */
var commonRoutingKeyBuilder = function(message) {
  return {
    schedulerId:      message.status.schedulerId,
    taskGraphId:      message.status.taskGraphId
  };
};

/** Build a list of routes to CC */
var commonCCBuilder = function(message, routes) {
  assert(routes instanceof Array, "routes must be an array");
  return routes.map(function(route) {
    return 'route.' + route;
  });
};

// Common schema prefix
var SCHEMA_PREFIX_CONST = 'http://schemas.taskcluster.net/scheduler/v1/';

/** Task-graph running exchange */
exchanges.declare({
  exchange:           'task-graph-running',
  name:               'taskGraphRunning',
  title:              "Task-Graph Running Message",
  description: [
    "When a task-graph is submitted it immediately starts running and a",
    "message is posted on this exchange to indicate that a task-graph have",
    "been submitted."
  ].join('\n'),
  routingKey:         commonRoutingKey,
  schema:             SCHEMA_PREFIX_CONST + 'task-graph-running-message.json#',
  messageBuilder:     commonMessageBuilder,
  routingKeyBuilder:  commonRoutingKeyBuilder,
  CCBuilder:          commonCCBuilder
});

/** Task-graph extended exchange */
exchanges.declare({
  exchange:           'task-graph-extended',
  name:               'taskGraphExtended',
  title:              "Task-Graph Extended Message",
  description: [
    "When a task-graph is extended, that is additional tasks is added to the",
    "task-graph, a message is posted on this exchange. This is useful if you",
    "are monitoring a task-graph and what to track states of the individual",
    "tasks in the task-graph."
  ].join('\n'),
  routingKey:         commonRoutingKey,
  schema:             SCHEMA_PREFIX_CONST + 'task-graph-extended-message.json#',
  messageBuilder:     commonMessageBuilder,
  routingKeyBuilder:  commonRoutingKeyBuilder,
  CCBuilder:          commonCCBuilder
});

/** Task-graph blocked exchange */
exchanges.declare({
  exchange:           'task-graph-blocked',
  name:               'taskGraphBlocked',
  title:              "Task-Graph Blocked Message",
  description: [
    "When a task is completed unsuccessfully and all reruns have been",
    "attempted, the task-graph will not complete successfully and it's",
    "declared to be _blocked_, by some task that consistently completes",
    "unsuccessfully.",
    "",
    "When a task-graph becomes blocked a messages is posted to this exchange.",
    "The message features the `taskId` of the task that caused the task-graph",
    "to become blocked."
  ].join('\n'),
  routingKey:         commonRoutingKey,
  schema:             SCHEMA_PREFIX_CONST + 'task-graph-blocked-message.json#',
  messageBuilder:     commonMessageBuilder,
  routingKeyBuilder:  commonRoutingKeyBuilder,
  CCBuilder:          commonCCBuilder
});

/** Task-graph finished exchange */
exchanges.declare({
  exchange:           'task-graph-finished',
  name:               'taskGraphFinished',
  title:              "Task-Graph Finished Message",
  description: [
    "When all tasks of a task-graph have completed successfully, the",
    "task-graph is declared to be finished, and a message is posted to this",
    "exchange."
  ].join('\n'),
  routingKey:         commonRoutingKey,
  schema:             SCHEMA_PREFIX_CONST + 'task-graph-finished-message.json#',
  messageBuilder:     commonMessageBuilder,
  routingKeyBuilder:  commonRoutingKeyBuilder,
  CCBuilder:          commonCCBuilder
});
