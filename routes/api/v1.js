var slugid      = require('slugid');
var jsonsubs    = require('../../utils/jsonsubs');
var Promise     = require('promise');
var _           = require('lodash');
var debug       = require('debug')('routes:api:v1');
var request     = require('superagent-promise');
var assert      = require('assert');
var base        = require('taskcluster-base');
var helpers     = require('../../scheduler/helpers');

// Common schema prefix
var SCHEMA_PREFIX_CONST = 'http://schemas.taskcluster.net/scheduler/v1/';

/**
 * API end-point for version v1/
 *
 * In this API implementation we shall assume the following context:
 * {
 *   Task:        // Instance of Task from data.js
 *   TaskGraph:   // Instance of TaskGraph from data.js
 *   publisher:   // Publisher from base.Exchanges
 *   queue:       // Instance of taskcluster.Queue
 *   schedulerId: // schedulerId from configuration
 *   validator:   // JSON validator created with base.validator
 * }
 */
var api = new base.API({
  title:        "Task-Graph Scheduler API Documentation",
  description: [
    "The task-graph scheduler, typically available at",
    "`scheduler.taskcluster.net`, is responsible for accepting task-graphs and",
    "scheduling tasks for evaluation by the queue as their dependencies are",
    "satisfied.",
    "",
    "This document describes API end-points offered by the task-graph",
    "scheduler. These end-points targets the following audience:",
    " * Post-commit hooks, that wants to submit task-graphs for testing,",
    " * End-users, who wants to execute a set of dependent tasks, and",
    " * Tools, that wants to inspect the state of a task-graph."
  ].join('\n')
});

// Export api
module.exports = api;

/** Create tasks */
api.declare({
  method:         'post',
  route:          '/task-graph/create',
  name:           'createTaskGraph',
  input:          SCHEMA_PREFIX_CONST + 'task-graph.json#',
  skipInputValidation:  true, // we'll do this after parameter substitution
  output:         SCHEMA_PREFIX_CONST + 'create-task-graph-response.json#',
  title:          "Create new task-graph",
  description: [
    "Create a new task-graph, the `status` of the resulting JSON is a",
    "task-graph status structure, you can find the `taskGraphId` in this",
    "structure.",
    "",
    "**Parameter substitution,** the task-graph submitted in the",
    "_request payload_ may feature a set of parameters, these will be",
    "substituted into all strings in the JSON body before the body is",
    "validated against the request schema.",
    "",
    "To reference a parameter specified in the `params` section, you wrap",
    "the _key_ in double braces inside a string in the JSON. In the example",
    "below the `routing` key becomes `\"try.task-graph\"` after parameter",
    "substitution.",
    "```js",
    "{",
    "  params: {",
    "    repository:   \"try\"",
    "  },",
    "  routing: \"{{repository}}.task-graph\",",
    "  ...",
    "}",
    "```",
    "",
    "Parameters are limited to string interpolation, but can also be",
    "substituted into JSON keys. The feature is useful for substituting in",
    "values that change like revision hash, or commonly used values, e.g. a",
    "preferred `workerType`.",
    "",
    "**Referencing required tasks**, in addition to the ability to substitute",
    "in parameters is also possible to substitute in `taskId`s based on",
    "task-labels. To substitute in the `taskId` of a task based on task-label,",
    "using the syntax: `\"{{taskId:<task-label>}}\"`.",
    "",
    "This is particularly useful if you want to use artifacts in a dependent",
    "task. In the example below this is used to make the `taskId` of \"taskA\"",
    "available in \"taskB\".",
    "```js",
    "{",
    "  ...",
    "  tasks: [",
    "    {",
    "      label:      \"taskA\",",
    "      requires:   [],",
    "      ...",
    "    },",
    "    {",
    "      label:      \"taskB\",",
    "      requires:   [\"taskA\"],",
    "      task: {",
    "        payload: {",
    "          env: {",
    "            TASK_A:   \"{{taskId:taskA}}\"",
    "          }",
    "          ...",
    "        }",
    "        ...",
    "      },",
    "      ...",
    "    }",
    "  ]",
    "}",
    "```",
    "",
    "**Task-labels**, as illustrated in the example above all tasks in a",
    "task-graph have a unique label. This label is used to reference required",
    "tasks. Please, note that these labels are only relevant at task-graph",
    "level, and the task-graph scheduler prefers to translate them to",
    "`taskId`s, but it does maintain the mapping.",
    "",
    "",
    "**Task routing keys**, all tasks in a task-graph will have their",
    "task-specific routing key prefixed with `schedulerId`, `taskGraphId` and",
    "`taskGraphRoutingKey`. This leaves tasks with a routing key on the",
    "following format",
    "`<schedulerId>.<taskGraphId>.<taskGraphRoutingKey>.<taskRoutingKey>`.",
    "",
    "In production the `schedulerId` is typically `\"task-graph-scheduler\"`,",
    "but this is configurable, which is useful for testing and configuration",
    "of staging areas, etc.",
    "",
    "**Remark**, prefixing all task-specific routing keys in this manner does",
    "reduce the maximum size of the task-specific routing key. So keep this",
    "in mind when constructing the task-graph routing key and task-specific",
    "routing keys.",
  ].join('\n')
}, function(req, res) {
  var ctx = this;
  var input       = req.body;
  var taskGraphId = slugid.v4();

  // Prepare tasks
  return helpers.prepareTasks(input, {
    taskGraphId:      taskGraphId,
    params:           input.params,
    schedulerId:      ctx.schedulerId,
    existingTasks:    [],
    queue:            ctx.queue,
    routing:          undefined,
    schema:           SCHEMA_PREFIX_CONST + 'task-graph.json#',
    validator:        ctx.validator
  }).then(function(result) {
    if (result.error || !result.tasks) {
      return res.json(400, result);
    }

    // Find leaf tasks, these are the ones the task-graph will wait for before
    // declaring it self finished. Note that all other tasks will have finished
    // before the leaf tasks finish.
    var requires = result.tasks.filter(function(task) {
      return task.dependents.length == 0;
    }).map(function(task) {
      return task.taskId;
    });

    // Create taskGraph entity
    debug("Create TaskGraph entity for %s with %s required tasks",
          taskGraphId, requires.length);
    return ctx.TaskGraph.create({
      taskGraphId:        taskGraphId,
      version:            '0.2.0',
      requires:           requires,
      requiresLeft:       _.cloneDeep(requires),
      state:              'running',
      routing:            result.input.routing,
      details: {
        metadata:         result.input.metadata,
        tags:             result.input.tags,
        params:           input.params
      }
    }).then(function(taskGraph) {
      // Create all task entities
      return Promise.all(result.tasks.map(function(task) {
        return ctx.Task.create(task);
      })).then(function(tasks) {
        // Schedule initial tasks...
        return Promise.all(tasks.filter(function(task) {
          return task.requires.length === 0;
        }).map(function(task) {
          return ctx.queue.scheduleTask(task.taskId);
        }));
      }).then(function() {
        debug("Publishing event about taskGraphId: %s", taskGraphId);
        return ctx.publisher.taskGraphRunning({
          status:               taskGraph.status()
        });
      }).then(function() {
        return res.reply({
          status:               taskGraph.status()
        });
      });
    });
  });
});

/** Post a task-graph decision to extend a task-graph */
api.declare({
    method:       'post',
  route:          '/task-graph/:taskGraphId/extend',
  name:           'extendTaskGraph',
  input:          SCHEMA_PREFIX_CONST + 'extend-task-graph-request.json#',
  skipInputValidation:  true, // we'll do this after parameter substitution
  output:         SCHEMA_PREFIX_CONST + 'extend-task-graph-response.json#',
  title:          "Extend existing task-graph",
  description: [
    "Add a set of tasks to an existing task-graph. The request format is very",
    "similar to the request format for creating task-graphs. But `routing`",
    "prefix, `metadata` and `tags` cannot be modified and tasks added to the",
    "task-graph will be prefixed with the same routing key as the existing",
    "tasks. See `createTaskGraph` for details in routing key prefixing.",
    "",
    "**Parameter substitution**, tasks added to a task-graph using this API",
    "end-point are subjected to the same parameter substitution as when the",
    "task-graph was created. The `params` from request payload can be used to",
    "add extend and overwrite parameters substituted. Note, that parameters",
    "modified by `params` submitted here will not be stored and used in",
    "future calls to this API end-point.",
    "",
    "**Task-labels**, just as when task-graphs are created, each task is",
    "assigned a label. These are used to reference required tasks and to",
    "substitute in the `taskId` a task using the pattern `{{taskId:<label>}}`.",
    "",
    "It is possible to reference task labels of the existing tasks, and the",
    "labels of the new tasks must be unique within the task-graph, and cannot",
    "conflict with the labels of the existing tasks.",
    "",
    "**Safety,** it is only _safe_ to call this API end-point while the",
    "task-graph being modified is still running. If the task-graph is",
    "_finished_ or _blocked_, this method will leave the task-graph in this",
    "state. Hence, it is only truly _safe_ to call this API end-point from",
    "within a task in the task-graph being modified."
  ].join('\n')
}, function(req, res) {
  var ctx = this;
  var input       = req.body;
  var taskGraphId = req.params.taskGraphId;

  // Load task graph and tasks
  var taskGraph       = null;
  var existingTasks   = null;
  var existingTaskIds = null;
  var gotTaskGraph = Promise.all(
    ctx.TaskGraph.load(taskGraphId),
    ctx.Task.loadGraphTasks(taskGraphId)
  ).then(function(values) {
    taskGraph       = values.shift();
    existingTasks   = values.shift();
    existingTaskIds = existingTasks.map(function(task) {
      return task.taskId;
    });
  });

  // Prepare tasks
  return gotTaskGraph.then(function() {
    return helpers.prepareTasks(input, {
      taskGraphId:      taskGraphId,
      params:           _.defaults(input.params, taskGraph.details.params),
      schedulerId:      ctx.schedulerId,
      existingTasks:    existingTasks,
      queue:            ctx.queue,
      routing:          taskGraph.routing,
      schema:           SCHEMA_PREFIX_CONST + 'extend-task-graph-request.json#',
      validator:        ctx.validator
    }).then(function(result) {
      if (result.error || !result.tasks) {
        return res.json(400, result);
      }

      // Find new leaf tasks that the task-graph should depend on
      var newRequires = result.tasks.filter(function(task) {
        return task.dependents.length == 0;
      }).map(function(task) {
        return task.taskId;
      });

      // Find old tasks that should be required by the task-graph
      var OldRequires = existingTasks.filter(function(task) {
        return task.dependents.length === 0;
      }).map(function(task) {
        return task.taskId;
      });

      // Update task-graph with new tasks that it should wait for
      return taskGraph.modify(function() {
        // Update requires, removing tasks that have dependents and adding new
        // required tasks
        this.requires = _.intersection(
          this.requires,
          OldRequires
        ).concat(newRequires);

        // Update requiresLeft the same way
        this.requiresLeft = _.intersection(
          this.requiresLeft,
          OldRequires
        ).concat(newRequires);
      }).then(function() {
        return Promise.all(result.tasks.map(function(task) {
          return ctx.Task.create(task);
        })).then(function(tasks) {
          // Schedule initial tasks...
          return Promise.all(tasks.filter(function(task) {
            return task.requires.length === 0;
          }).map(function(task) {
            return ctx.queue.scheduleTask(task.taskId);
          }));
        }).then(function() {
          // Load all tasks, so we can ensure that tasks are scheduled, if one
          // of the required tasks was resolved...
          return ctx.Task.loadGraphTasks(taskGraphId);
        }).then(function(tasks) {
          // Find existing that is resolved successfully
          return Promise.all(tasks.filter(function(task) {
            return task.resolution &&
                   task.resolution.success &&
                   _.contains(existingTaskIds, task.taskId);
          }).map(function(task) {
            return helpers.scheduleDependentTasks(task);
          }));
        }).then(function() {
          debug("Publishing event about taskGraphId: %s", taskGraphId);
          return ctx.publisher.taskGraphExtended({
            status:               taskGraph.status()
          });
        }).then(function() {
          return res.reply({
            status:               taskGraph.status()
          });
       });
      });
    });
  });
});


/** Get task-graph status */
api.declare({
  method:     'get',
  route:      '/task-graph/:taskGraphId/status',
  name:       'getTaskGraphStatus',
  input:      undefined,
  output:     SCHEMA_PREFIX_CONST + 'task-graph-status-response.json',
  title:      "Task Graph Status",
  description: [
    "Get task-graph status, this will return the _task-graph status",
    "structure_. which can be used to check if a task-graph is `running`,",
    "`blocked` or `finished`.",
    "",
    "**Note**, that `finished` implies successfully completion."
  ].join('\n')
}, function(req, res) {
  // Find task-graph id
  var taskGraphId = req.params.taskGraphId;

  // Load task-graph and build a status
  return this.TaskGraph.load(taskGraphId).then(function(taskGraph) {
    res.reply({
      status:               taskGraph.status()
    });
  });
});

/** Get task-graph metadata and tags */
api.declare({
  method:     'get',
  route:      '/task-graph/:taskGraphId/info',
  name:       'getTaskGraphInfo',
  input:      undefined,
  output:     SCHEMA_PREFIX_CONST + 'task-graph-info-response.json',
  title:      "Task Graph Information",
  description: [
    "Get task-graph information, this includes the _task-graph status",
    "structure_, along with `metadata` and `tags`, but not information",
    "about all tasks.",
    "",
    "If you want more detailed information use the `inspectTaskGraph`",
    "end-point instead."
  ].join('\n')
}, function(req, res) {
  // Find task-graph id
  var taskGraphId = req.params.taskGraphId;

  // Load task-graph and build a status
  return this.TaskGraph.load(taskGraphId).then(function(taskGraph) {
    res.reply({
      status:               taskGraph.status(),
      metadata:             taskGraph.details.metadata,
      tags:                 taskGraph.details.tags
    });
  });
});


/** Get inspect task-graph */
api.declare({
  method:     'get',
  route:      '/task-graph/:taskGraphId/inspect',
  name:       'inspectTaskGraph',
  input:      undefined,
  output:     SCHEMA_PREFIX_CONST + 'inspect-task-graph-response.json',
  title:      "Inspect Task Graph",
  description: [
    "Inspect a task-graph, this returns all the information the task-graph",
    "scheduler knows about the task-graph and the state of its tasks.",
    "",
    "**Warning**, some of these fields are borderline internal to the",
    "task-graph scheduler and we may choose to change or make them internal",
    "later. Also note that note all of the information is formalized yet.",
    "The JSON schema will be updated to reflect formalized values, we think",
    "it's safe to consider the values stable.",
    "",
    "Take these considerations into account when using the API end-point,",
    "as we do not promise it will remain fully backward compatible in",
    "the future.",
  ].join('\n')
}, function(req, res) {
  // Find task-graph id
  var taskGraphId = req.params.taskGraphId;

  // Load task-graph and all tasks
  return Promise.all(
    this.TaskGraph.load(taskGraphId),
    this.Task.loadGraphTasks(taskGraphId)
  ).then(function(values) {
    var taskGraph = values.shift();
    var tasks     = values.shift();

    var taskData = {};
    tasks.forEach(function(task) {
      taskData[task.label] = {
        taskId:       task.taskId,
        taskUrl:      'http://tasks.taskcluster.net/' + task.taskId + '/task.json',
        requires:     task.requires,
        requiresLeft: task.requiresLeft,
        reruns:       task.rerunsAllowed,
        rerunsLeft:   task.rerunsLeft,
        resolution:   task.resolution || {},
        dependents:   task.dependents
      };
    });

    res.reply({
      status:   taskGraph.status(),
      tasks:    taskData,
      params:   taskGraph.details.params,
      metadata: taskGraph.details.metadata,
      tags:     taskGraph.details.tags
    });
  });
});

