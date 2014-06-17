var slugid      = require('slugid');
var jsonsubs    = require('../../utils/jsonsubs');
var Promise     = require('promise');
var _           = require('lodash');
var debug       = require('debug')('routes:api:v1');
var request     = require('superagent-promise');
var assert      = require('assert');
var base        = require('taskcluster-base');

// TODO: Move request to super-agent promise

// Remove querystring things...
var querystring = require('querystring');

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
  input:          'http://schemas.taskcluster.net/scheduler/v1/task-graph.json#',
  skipInputValidation:  true, // we'll do this after parameter substitution
  output:         'http://schemas.taskcluster.net/scheduler/v1/create-task-graph-response.json#',
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
    "  tasks: {",
    "    taskA: {",
    "      requires:   [],",
    "      ...",
    "    },",
    "    taskB: {",
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
    "  }",
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
  var input = req.body;
  // Generate taskGraphId
  var taskGraphId = slugid.v4();

  // Get list of task Labels
  var taskLables = _.keys(input.tasks || {});

  // Define tasks on queue and get a set of Put URLs, so we can store the task
  // definitions on S3 immediately. Note, this won't schedule the tasks yet!
  // We need these taskIds prior to parameter substitution, which is right now.
  var tasks_defined = ctx.queue.defineTasks({
    tasksRequested:       taskLables.length
  });

  // When tasks are defined we have to substitute parameters and validate posted
  // json input against schema. Then we translate task labels to ids and upload
  // all tasks to PUT URLs without scheduling them just yet
  return tasks_defined.then(function(taskPutUrls) {
    var taskIdToPutUrlMapping = taskPutUrls.tasks;
    // Find task ids we've been assigned
    var availableTaskIds = _.keys(taskIdToPutUrlMapping);

    // Check that we have enough
    assert(
      availableTaskIds.length == taskLables.length,
      "ERROR: We didn't get the number of taskIds required from the queue"
    );

    // Create parameters mapping from taskLabel to taskId
    var taskIdParams = {};
    for (var i = 0; i < taskLables.length; i++) {
      taskIdParams['taskId:' + taskLables[i]] = availableTaskIds[i];
    }

    // Store patched parameters
    var unpatch_parameters = _.defaults(input.params, taskIdParams);

    // Parameterize input JSON
    input = jsonsubs(input, _.defaults(input.params, taskIdParams));
    // Validate input
    var schema = 'http://schemas.taskcluster.net/scheduler/v1/task-graph.json#';
    var errors = ctx.validator.check(input, schema);
    if (errors) {
      debug("Request payload for %s didn't follow schema %s",
            req.url, schema);
      return res.json(400, {
        'message': "Request payload must follow the schema: " + schema,
        'error':              errors,
        'parameterizedInput': input
      });
    }

    // Find taskLabels again, just in case something was substituted into them,
    // Note, substituting things in task labels would surely be poor practice
    // and be totally useless... as we substitute all parameters at once.
    taskLables = _.keys(input.tasks);

    // Extend task-wrappers with empty set of dependents, add taskLabel and add
    // to a list for simplicity
    var taskNodes = [];
    for(var taskLabel in input.tasks) {
      var taskNode = input.tasks[taskLabel];
      taskNode.dependents = [];
      taskNode.taskLabel  = taskLabel;
      taskNodes.push(taskNode);
    }

    // Add dependent tasks to dependents, and check errors
    var errors = [];
    for(var taskLabel in input.tasks) {
      var taskNode = input.tasks[taskLabel];

      // Check requires for duplicates
      if(taskNode.requires.length != _.uniq(taskNode.requires).length) {
        errors.push({
          message: "Task labelled: " + taskLabel + " has duplicate labels in " +
                    "it's list of required tasks",
          taskNode:         taskNode,
          requires:         taskNode.requires
        });
      }

      // Check that combined routing key is less than 128
      // <schedulerId>.<taskGraphId>.<taskGraph.routing>
      var patchedRoutingKeyLength = 22 + 1 + 22 + 1 +
                                    input.routing.length + 1 +
                                    taskNode.task.routing.length;
      if (patchedRoutingKeyLength > 128) {
        errors.push({
          message: "Task labelled: " + taskLabel + " will get routing key " +
                   "longer than the 128 bytes allowed",
          taskNode:         taskNode,
          routing:          taskNode.routing
        });
      }

      // Add taskLabel to required task nodes
      taskNode.requires.forEach(function(requiredLabel) {
        var requiredTaskNode = input.tasks[requiredLabel];

        // If we can't find a node labeled with the required label we have a
        // bad request
        if (!requiredTaskNode) {
          return errors.push({
            message: "Task labelled: " + taskLabel + " requires undefined " +
                     "label: " + requiredLabel,
            taskNode:         taskNode,
            requires:         taskNode.requires,
            undefinedLabel:   requiredLabel
          });
        }

        // Add to dependents
        requiredTaskNode.dependents.push(taskLabel);
      });

      // If you've provided a taskGraphId, then it's invalid. You cannot define
      // these when posting a task-graph
      if (taskNode.task.metadata.taskGraphId) {
        errors.push({
          message:      "You can't specify task.metadata.taskGraphId, by the " +
                        "nature of this API you can't know the identifier.",
          taskNode:     taskNode
        });
      }
    }

    // If we encountered anything suspicious we abort and ask the user to fix it
    if (errors.length != 0) {
      return res.json(400, {
        message: "Semantic errors in task-graph definition",
        error: errors
      });
    }

    // Create mapping from taskLabel to taskId
    var taskLabelToIdMapping = {};
    for (var i = 0; i < taskLables.length; i++) {
      taskLabelToIdMapping[taskLables[i]] = availableTaskIds[i];
    }

    // Translate required and dependent labels to taskIds
    var translate = function(taskLabel) {
      return taskLabelToIdMapping[taskLabel];
    }
    taskNodes.forEach(function(taskNode) {
      taskNode.taskId     = translate(taskNode.taskLabel);
      taskNode.requires   = taskNode.requires.map(translate);
      taskNode.dependents = taskNode.dependents.map(translate);
    });

    // Routing prefix for task.routing
    var routingPrefix = [ctx.schedulerId, taskGraphId, input.routing].join('.');

    // Let's upload all task definitions
    var tasks_uploaded = Promise.all(taskNodes.map(function(taskNode) {
      // Create task definition
      var taskDefintion = _.cloneDeep(taskNode.task);

      // Prefix routing key with <schedulerId>.<taskGraphId>.<taskGraph.routing>
      // Note, we have already check that this length fits in the 128 bytes
      // available according to task schema
      taskDefintion.routing = routingPrefix + '.' + taskDefintion.routing;
      taskDefintion.metadata.taskGraphId = taskGraphId;

      // Upload all task definitions to S3 using PUT URLs
      return request
      .put(taskIdToPutUrlMapping[taskNode.taskId].taskPutUrl)
      .send(taskDefintion)
      .end()
      .then(function(res) {
        if (!res.ok) {
          debug("Failed to upload taskId: %s to PUT URL, Error: %s",
                taskNode.taskId, res.text);
          throw new Error("Failed to upload task to put URLs");
        }

        return res.body;
      });
    }));

    // When the tasks have been uploaded we create the taskGraph entity
    var task_graph_created = tasks_uploaded.then(function() {
      // Find leaf tasks, these are the ones the task-graph will wait for before
      // declaring it self finished. Note that all other tasks will have finished
      // before the leaf tasks finish.
      var requires = taskNodes.filter(function(taskNode) {
        return taskNode.dependents.length == 0;
      }).map(function(taskNode) {
        return taskNode.taskId;
      });
      debug("Create TaskGraph entity for %s with %s required tasks",
            taskGraphId, requires.length);
      return ctx.TaskGraph.create({
        taskGraphId:        taskGraphId,
        version:            '0.2.0',
        requires:           requires,
        requiresLeft:       _.cloneDeep(requires),
        state:              'running',
        routing:            input.routing,
        details: {
          metadata:         input.metadata,
          tags:             input.tags,
          params:           unpatch_parameters
        }
      });
    });

    // Get the create taskGraph instance
    var taskGraph = null;
    var got_task_graph_instance = task_graph_created.then(function(taskGraph_) {
      taskGraph = taskGraph_;
    });

    // When all tasks have been posted to S3 next step is to create the task
    // entities
    var tasks = null;
    var task_entities_created = got_task_graph_instance.then(function() {
      debug("Creating %s Task entities", taskNodes.length);
      return Promise.all(taskNodes.map(function(taskNode) {
        return ctx.Task.create({
          taskGraphId:      taskGraphId,
          taskId:           taskNode.taskId,
          version:          '0.2.0',
          label:            taskNode.taskLabel,
          rerunsAllowed:    taskNode.reruns,
          rerunsLeft:       taskNode.reruns,
          deadline:         new Date(taskNode.task.deadline),
          requires:         taskNode.requires,
          requiresLeft:     _.cloneDeep(taskNode.requires),
          dependents:       taskNode.dependents,
          resolution:       null
        });
      }));
    }).then(function(tasks_) {
      tasks = tasks_;
    });

    // Post event on AMQP that task-graph is now running
    // No task will be running at this point, be we shall schedule them in a
    // few seconds...
    var event_posted = task_entities_created.then(function() {
      return ctx.publisher.taskGraphRunning({
        status:               taskGraph.status()
      });
    });

    // When the task-graph have been announced, we iterate through all tasks
    // and schedule those are have an empty requirements set
    var tasks_scheduled = event_posted.then(function() {
      return Promise.all(tasks.filter(function(task) {
        return task.requires.length == 0;
      }).map(function(task) {
        return ctx.queue.scheduleTask(task.taskId);
      }));
    });

    // Reply with task graph scheduler status
    return tasks_scheduled.then(function() {
      res.reply({
        status:               taskGraph.status()
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
  output:     'http://schemas.taskcluster.net/scheduler/v1/task-graph-status-response.json',
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
  output:     'http://schemas.taskcluster.net/scheduler/v1/task-graph-info-response.json',
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
  output:     'http://schemas.taskcluster.net/scheduler/v1/inspect-task-graph-response.json',
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

