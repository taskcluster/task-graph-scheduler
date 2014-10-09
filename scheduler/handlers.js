var assert      = require('assert');
var taskcluster = require('taskcluster-client');
var Promise     = require('promise');
var debug       = require('debug')('scheduler:handlers');
var _           = require('lodash');
var base        = require('taskcluster-base');
var helpers     = require('./helpers');

/**
 * Create handlers
 * options:
 * {
 *   Task:               // Task instance from data.js
 *   TaskGraph:          // TaskGraph instance from data.js
 *   publisher:          // publisher creates from exchanges.js
 *   queue:              // taskcluster.Queue instance
 *   queueEvents:        // taskcluster.QueueEvents instance
 *   schedulerId:        // scheduler identifier
 *   connectionString:   // AMQP connection string
 *   queueName:          // Queue name (optional)
 *   drain:              // new base.Influx(...)
 *   component:          // Component name in statistics
 * }
 */
var Handlers = function(options) {
  // Validate options
  assert(options.Task,      "A subclass of data.Task is required");
  assert(options.TaskGraph, "A subclass of data.TaskGraph is required");
  assert(options.publisher instanceof base.Exchanges.Publisher,
         "An instance of base.Exchanges.Publisher is required");
  assert(options.queue instanceof taskcluster.Queue,
         "An instance of taskcluster.Queue is required");
  assert(options.queueEvents instanceof taskcluster.QueueEvents,
         "An instance of taskcluster.QueueEvents is required");
  assert(options.connectionString, "Connection string must be provided");
  assert(options.schedulerId,      "SchedulerId is required");
  assert(options.drain,             "statistics drains is required");
  assert(options.component,         "component name is needed for statistics");
  // Store options on this for use in event handlers
  this.Task             = options.Task;
  this.TaskGraph        = options.TaskGraph;
  this.publisher        = options.publisher;
  this.queue            = options.queue;
  this.queueEvents      = options.queueEvents;
  this.schedulerId      = options.schedulerId;
  this.connectionString = options.connectionString;
  this.queueName        = options.queueName;  // Optional
  this.drain            = options.drain;
  this.component        = options.component;
  this.listener         = null;
};

/** Setup handlers and start listening */
Handlers.prototype.setup = function() {
  assert(this.listener === null, "Cannot setup twice!");
  var that = this;

  // Create listener
  this.listener = new taskcluster.AMQPListener({
    connectionString:     this.connectionString,
    queueName:            this.queueName
  });

  // Binding for completed tasks
  var completedBinding = this.queueEvents.taskCompleted({
    schedulerId:    this.schedulerId
  });
  this.listener.bind(completedBinding);

  // Binding for failed tasks
  var failedBinding = this.queueEvents.taskFailed({
    schedulerId:    this.schedulerId
  });
  this.listener.bind(failedBinding);

  // Create handler
  var handler = function(message) {
    if (message.exchange === completedBinding.exchange) {
      return that.completed(message);
    }
    if (message.exchange === failedBinding.exchange) {
      return that.failed(message);
    }
    debug("WARNING: received message from unexpected exchange: %s, message: %j",
          message.exchange, message);
    throw new Error("Got message from unexpected exchange: " +
                    message.exchange);
  };

  // Create timed handler for statistics
  var timedHandler = base.stats.createHandlerTimer(handler, {
    drain:      this.drain,
    component:  this.component
  });

  // Listen for messages and handle them
  this.listener.on('message', timedHandler);

  // Start listening
  return this.listener.connect().then(function() {
    return that.listener.resume();
  })
};

// Export Handlers
module.exports = Handlers;

/**
 * Check if the task-graph is finished and given a `successfulTaskId` is a leaf
 * task that has just been completed successfully.
 */
Handlers.prototype.checkTaskGraphFinished = function(taskGraphId,
                                                     successfulTaskId) {
  var that = this;
  return that.TaskGraph.load(taskGraphId).then(function(taskGraph) {
    var taskGraphFinishedNow;
    return taskGraph.modify(function() {
      // Always initialize taskGraphFinishedNow to false, if previous
      // application of the modifier wasn't successful, then I don't care about
      // the result
      taskGraphFinishedNow = false;

      // If the successfully completed task isn't required by the task-graph
      // then we don't need to modify or declare it finished it
      if (!_.contains(this.requiresLeft, successfulTaskId)) {
        return;
      }

      // Now we know the successful task is blocking, we remove it
      this.requiresLeft = _.without(this.requiresLeft, successfulTaskId);

      // If no other tasks are blocking the task-graph from being finished
      // the we're finishing the task-graph now.
      taskGraphFinishedNow = (this.requiresLeft.length == 0);

      // If the task-graph is finished, we might as well declare this
      if (taskGraphFinishedNow) {
        this.state = 'finished';
      }
    }).then(function() {
      // If the task-graph really just did finish now, then we're responsible
      // for sending an event
      // Sending it here, might in fact not be the best thing to do... But it's
      // unlikely that we die here. And the alternative is duplicate messages
      // whenever we attempt an optimistic write... Honestly, we don't care at
      // this point we can improve consistency later.
      if (taskGraphFinishedNow) {
        assert(taskGraph.state == 'finished', "taskGraph should be finished!");
        return that.publisher.taskGraphFinished({
          status:           taskGraph.status()
        }, taskGraph.routes);
      }
    });
  });
};


/** Change task-graph state to blocked and publish an event */
Handlers.prototype.blockTaskGraph = function (taskGraphId, blockingTaskId) {
  var that = this;
  debug("Reported task-graph: %s blocked, if this isn't already the case",
        taskGraphId);

  // Load task-graph
  this.TaskGraph.load(taskGraphId).then(function(taskGraph) {
    // Modify taskGraph if it's running
    var wasRunning = false;
    return taskGraph.modify(function() {
      wasRunning = (this.state == 'running');
      if (wasRunning) {
        this.state = 'blocked';
      }
    }).then(function() {
      // Publish event if the task-graph was running and we set it to blocked
      if (wasRunning) {
        assert(taskGraph.state == 'blocked', "taskGraph should be blocked now");
        return that.publisher.taskGraphBlocked({
          status:           taskGraph.status(),
          taskId:           blockingTaskId
        }, taskGraph.routes);
      }
      debug("Task-graph: %s was already declared blocked", taskGraphId);
    });
  });
};


/**
 * Rerun a task or block the taskgraph if all reruns are used
 * Called with a task-completed message.
 */
Handlers.prototype.rerunTaskOrBlock = function(task, message) {
  var that = this;
  // Modify while checking if there is a rerun available
  var has_rerun_available = true;
  return task.modify(function() {
    has_rerun_available = this.rerunsLeft > 0;
    if (has_rerun_available) {
      this.rerunsLeft -= 1;
    } else {
      this.state = 'completed';
      this.details.satisfied = false;
    }
  }).then(function() {
    // If there was a rerun available, we ask the queue to rerun it
    if (has_rerun_available) {
      return that.queue.rerunTask(task.taskId).catch(function(err) {
        debug("Failed to issue a rerun for %s, err: %j", task.taskId, err);
        throw err;
      });
    } else {
      return that.blockTaskGraph(task.taskGraphId, task.taskId);
    }
  });
};


/** Handle notifications of failed messages */
Handlers.prototype.failed = function(message) {
  var that = this;
  // Extract the taskGraphId from the routing key
  var taskGraphId     = message.routing.taskGroupId;
  var blockingTaskId  = message.payload.status.taskId;
  debug("Got message that taskId: %s failed", blockingTaskId);

  // Load the blocked task
  var task_loaded = this.Task.load(taskGraphId, blockingTaskId);

  // When modify the task state and satisfied
  var task_modified = task_loaded.then(function(task) {
    return task.modify(function() {
      this.state = 'failed';
      this.details.satisfied = false;
    });
  });

  // When task is modified with new state it's time declare the task-graph
  // as blocked by given taskId, note that we should not try to rerun tasks
  // that have failed, as the number of retries have been exhausted by the
  // queue.
  return task_modified.then(function() {
    return that.blockTaskGraph(taskGraphId, blockingTaskId);
  });
};


/** Handle notifications of completed messages */
Handlers.prototype.completed = function(message) {
  var that = this;
  // Extract the taskGraphId from the routing key
  var taskGraphId     = message.routing.taskGroupId;
  var completedTaskId = message.payload.status.taskId;
  debug("Got message that taskId: %s completed", completedTaskId);

  // Load the completed task
  var task_loaded = this.Task.load(taskGraphId, completedTaskId);

  // When task entity is loaded we modify the task state and satisfied
  return task_loaded.then(function(task) {
    if (message.payload.success) {
      var task_modified = task.modify(function() {
        this.state = 'completed';
        this.details.satisfied = true;
      });

      // When state and details has been saved,
      return task_modified.then(function() {
        if (task.dependents.length != 0) {
          // There are dependent tasks, when we should try to schedule those
          debug("Scheduling dependent tasks");
          return helpers.scheduleDependentTasks(task, that.queue, that.Task);
        } else {
          // If there is no dependent tasks then we should check if the task-
          // graph is finished
          debug("Checking if task graph has finished");
          return that.checkTaskGraphFinished(taskGraphId, task.taskId);
        }
      });
    } else {
      debug("Requesting a task to be rerun if possible");
      return that.rerunTaskOrBlock(task, message);
    }
  });
};

