var nconf       = require('nconf');
var utils       = require('./utils');
var slugid      = require('slugid');
var jsonsubs    = require('../../utils/jsonsubs');
var validate    = require('../../utils/validate');
var Promise     = require('promise');
var _           = require('lodash');
var Task        = require('../../scheduler/data').Task;
var TaskGraph   = require('../../scheduler/data').TaskGraph;
var debug       = require('debug')('routes:api:v1');
var request     = require('superagent');
var events      = require('../../scheduler/events');
var assert      = require('assert');
var querystring = require('querystring');

/** API end-point for version v1/ */
var api = module.exports = new utils.API({
  limit:          '10mb'
});

/** Create tasks */
api.declare({
  method:         'post',
  route:          '/task-graph/create',
  requestSchema:  'http://schemas.taskcluster.net/scheduler/v1/task-graph.json#',
  output:         'http://schemas.taskcluster.net/scheduler/v1/create-task-graph-response.json#',
  title:          "Create new task-graph",
  desc: [
    "TODO: Write documentation"
  ].join('\n')
}, function(req, res) {
  var input = req.body;
  // Generate taskGraphId
  var taskGraphId = slugid.v4();

  // Get list of task Labels
  var taskLables = _.keys(input.tasks || {});

  // Define tasks on queue and get a set of Put URLs, so we can store the task
  // definitions on S3 immediately. Note, this won't schedule the tasks yet!
  // We need these taskIds prior to parameter substitution, which is right now.
  var tasks_defined = new Promise(function(accept, reject) {
    request
      .get(nconf.get('queue:baseUrl') + '/v1/define-tasks')
      .send({
        tasksRequested:   taskLables.length
      })
      .end(function(res) {
        if (!res.ok) {
          debug("Failed to fetch taskIds and PUT URLs from queue");
          return reject(res.body);
        }
        accept(res.body.tasks);
      });
  });

  // When tasks are defined we have to substitute parameters and validate posted
  // json input against schema. Then we translate task labels to ids and upload
  // all tasks to PUT URLs without scheduling them just yet
  return tasks_defined.then(function(taskIdToPutUrlMapping) {
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

    // Parameterize input JSON
    input = jsonsubs(input, _.defaults(input.params, taskIdParams));
    // Validate input
    var schema = 'http://schemas.taskcluster.net/scheduler/v1/task-graph.json#';
    var errors = validate(input, schema);
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
    var routingPrefix = [
      nconf.get('scheduler:taskGraphSchedulerId'),
      taskGraphId,
      input.routing
    ].join('.');

    // Let's upload all task definitions
    var tasks_uploaded = Promise.all(taskNodes.map(function(taskNode) {
      // Create task definition
      var taskDefintion = _.cloneDeep(taskNode.task);

      // Prefix routing key with <schedulerId>.<taskGraphId>.<taskGraph.routing>
      taskDefintion.routing = routingPrefix + '.' + taskDefintion.routing;

      // Upload all task definitions to S3 using PUT URLs
      return new Promise(function(accept, reject) {
        request
          .put(taskIdToPutUrlMapping[taskNode.taskId].taskPutUrl)
          .send(taskDefintion)
          .end(function(res) {
            if (!res.ok) {
              debug("Failed to upload taskId: %s to PUT URL", taskNode.taskId);
              return reject(res.body);
            }
            accept(res.body);
          });
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
      return TaskGraph.create({
        taskGraphId:        taskGraphId,
        version:            '0.2.0',
        requires:           requires,
        requiresLeft:       _.cloneDeep(requires),
        state:              'running',
        routing:            input.routing
      });
    });

    // Get the create taskGraph instance
    var taskGraph = null;
    var got_task_graph_instance = task_graph_created.then(function(taskGraph_) {
      taskGraph = taskGraph_;
    });

    // When all tasks have been posted to S3 next step is to create the task
    // entities
    var task_entities_created = got_task_graph_instance.then(function() {
      debug("Creating %s Task entities", taskNodes.length);
      return Promise.all(taskNodes.map(function(taskNode) {
        return Task.create({
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
    });

    // When all task entities are created, we iterate through them and schedule
    // those are have an empty requirements set
    var tasks_scheduled = task_entities_created.then(function(tasks) {
      return Promise.all(tasks.filter(function(task) {
        return task.requires.length == 0;
      }).map(function(task) {
        var endpoint = '/v1/task/' + task.taskId + '/schedule';
        return new Promise(function(accept, reject) {
          request
            .post(nconf.get('queue:baseUrl') + endpoint)
            .end(function(res) {
              if (!res.ok) {
                debug("Failed to schedule initial task: %s", task.taskId);
                return reject(res.body);
              }
              accept(res.body);
            });
        });
      }));
    });

    // Post event on AMQP
    var event_posted = tasks_scheduled.then(function() {
      return events.publish('task-graph-running', {
        version:              '0.2.0',
        status:               taskGraph.status()
      });
    });

    // Reply with task graph scheduler status
    return event_posted.then(function() {
      res.reply({
        status:               taskGraph.status()
      });
    });
  });
});


/** Get SAS Signature for Azure Table Access */
api.declare({
  method:     'get',
  route:      '/table-access',
  input:      undefined,
  output:     undefined,
  title:      "Get Access to Azure Table",
  desc: [
    "**Warning**, this API end-point is **not stable**. At this point in time",
    "right is reserved to change the table at any time.. People shouldn't",
    "build fancy tools on this. Jump onto #taskcluster if you want a stable",
    "API for this... We should think up something reasonable.",
    "",
    "TODO: Write documentation"
  ].join('\n')
}, function(req, res) {
  res.json(200, {
    accountName:        nconf.get('azureTableCredentials:accountName'),
    sharedSignature:    querystring.parse(TaskGraph.generateSAS()),
    taskGraphTable:     nconf.get('scheduler:azureTaskGraphTable')
  });
});
