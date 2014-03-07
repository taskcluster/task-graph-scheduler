var Promise     = require('promise');
var Task        = require('./data').Task;
var TaskGraph   = require('./data').TaskGraph;
var debug       = require('debug')('scheduler:handlers');
var request     = require('superagent');
var events      = require('../../scheduler/events');
var _           = require('lodash');
var nconf       = require('nconf');

/** Schedule task with the queue, **note** this is an idempotent operation */
var scheduleTask = function(taskId) {
  return new Promise(function(accept, reject) {
    var endpoint = '/v1/task/' + taskId + '/schedule';
    request
      .post(nconf.get('queue:baseUrl') + endpoint)
      .end(function(res) {
        if (!res.ok) {
          debug("Failed to schedule task: %s", task.taskId);
          return reject(res.body);
        }
        accept(res.body);
      });
  });
};

var scheduleDependentTasks = function(task) {
  // Let's load, modify and schedule all dependent tasks that are ready
  return Promse.all(task.dependents.map(function(dependentTaskId) {
    // First we load the dependent task
    return Task.load(
      task.taskGraphId,
      dependentTaskId
    ).then(function(dependentTask) {
      // Then we modify the dependent task
      return dependentTask.modify(function() {
        // If the successfully completed task isn't required by the dependent
        // task then we don't need to modify or schedule it
        if (!_.contains(this.requires, task.taskId)) {
          return;
        }

        // Now we know the successful task is blocking, we remove it
        this.requires = _.without(this.requires, taskId);

        // If no other tasks are blocked the dependent tasks then we should
        // schedule it.
        if (this.requires.length == 0) {
          // Note, that on the queue this is an idempotent operation, so it is
          // not a problem if we do this more than once.
          return scheduleTask(depTask.taskId);
        }
      });
    });
  });
};


/**
 * Check if the task-graph is finished and given a `successfullTaskId` is a leaf
 * task that has just been completed successfully.
 */
var checkTaskGraphFinished = function(taskGraphId, successfullTaskId) {
  return TaskGraph.load(taskGraphId).then(function(taskGraph) {
    var taskGraphFinishedNow;
    return taskGraph.modify(function() {
      // Always initialize taskGraphFinishedNow to false, if previous
      // application of the modifier wasn't successful, then I don't care about
      // the result
      taskGraphFinishedNow = false;

      // If the successfully completed task isn't required by the task-graph
      // then we don't need to modify or declare it finished it
      if (!_.contains(this.requires, successfullTaskId)) {
        return;
      }

      // Now we know the successful task is blocking, we remove it
      this.requires = _.without(this.requires, successfullTaskId);

      // If no other tasks are blockinghte task-graph from being finished
      // the we're finishing the task-graph now.
      taskGraphFinishedNow = (this.requires.length == 0);

      // If the task-graph is finished, we might as well declare this
      if (taskGraphFinishedNow) {
        this.state = 'finished';
      }
    }).then(function() {
      // If the task-graph really just did finish now, then we're responsible
      // for sending an event
      if (taskGraphFinishedNow) {
        return events.publish('task-graph-finished', {
          version:          '0.2.0',
          status: {
            taskGraphId:    taskGraphId,
            schedulerId:    nconf.get('scheduler:taskGraphSchdulerId'),
            state:          'finished',
            routing:        taskGraph.routing
          }
        });
      }
    });
  });
};


/** Change task-graph state to blocked and publish an event */
var blockTaskGraph = function (taskGraphId, blockingTaskId) {
  var loaded_taskgraph = TaskGraph.load(taskGraphId);

  debug("Reported task-graph: %s blocked, if this isn't already the case",
        taskGraphId);

  // Wait for task-graph to load
  loaded_taskgraph.then(function(taskGraph) {
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
        return events.publish('task-graph-blocked', {
          version:          '0.2.0',
          status: {
            taskGraphId:    taskGraphId,
            schedulerId:    nconf.get('taskGraphSchdulerId'),
            state:          'blocked',
            routing:        taskGraph.routing
          },
          taskId:           blockingTaskId
        });
      }
      debug("Task-graph: %s was already declared blocked", taskGraphId);
    });
  });
};

/** Rerun a task or block the taskgraph if all reruns are used */
var rerunTask = function(task) {
  // Check if there is a rerun available
  var has_rerun_available = true;
  var task_modified = task.modify(function() {
    has_rerun_available = this.rerunsLeft < this.rerunsAllowed;
    if (has_rerun_available) {
      this.rerunsLeft += 1;
    }
  });

  return task_modified,then(function() {
    // If there was a rerun available, we ask the queue to rerun it
    if (has_rerun_available) {
      return new Promise(function(accept, reject) {
        var endpoint = '/v1/task/' + task.taskId + '/rerun';
        request
          .post(nconf.get('queue:baseUrl') + endpoint)
          .end(function(res) {
            if (!res.ok) {
              debug("Failed to issue a rerun for %s", task.taskId);
              return reject(res.body);
            }
            accept(res.body);
          });
      });
    } else {
      return blockTaskGraph(task.taskGraphId, task.taskId);
    }
  });
};

/**
 * Handle notifications of failed messages
 * `events.setup()` will take care of subscribing to a queue, bind to exchanges
 * and invoke this method with messages. This method should return a promise
 * of success, if the promise fails the message will be rejected and requeued.
 */
exports.failed = function(message) {
  // Extract the taskGraphId from the task-specific routing key
  var taskGraphId     = message.status.routing.split('.')[7];
  var blockingTaskId  = message.status.taskId;

  // Load the blocked task
  var task_loaded = Task.load(taskGraphId, blockingTaskId);

  // When modify the task resolution
  var task_modified = task_loaded.then(function(task) {
    return task.modify(function() {
      if (this.resolution === null) {
        this.resolution = {
          success:      false,
          completed:    false
        };
      } else if (this.resolution.success) {
        debug("ERROR: We're getting failed result from a successfully " +
              "completed task! This implies that we've been rerun a " +
              "successfully completed task! Investigate taskGraphId: %s and " +
              "taskId: %s", taskGraphId, blockingTaskId);
        throw new Error(
          "Somehow getting failed result from a successfully completed task!"
        );
      }
      // Note, if the task was completed unsuccessfully before, then we won't
      // overwrite that resolution to just mark it as failed...
    });
  });

  // When task is modified with new resolution it's time declare the task-graph
  // as blocked by given taskId, note that we should not try to rerun tasks
  // that have failed, as the number of retries have been exhausted by the
  // queue.
  return task_modified.then(function() {
    return blockTaskGraph(taskGraphId, blockingTaskId);
  });
};

/**
 * Handle notifications of completed messages
 * `events.setup()` will take care of subscribing to a queue, bind to exchanges
 * and invoke this method with messages. This method should return a promise
 * of success, if the promise fails the message will be rejected and requeued.
 */
exports.completed = function(message) {
  // Extract the taskGraphId from the task-specific routing key
  var taskGraphId     = message.status.routing.split('.')[7];
  var completedTaskId  = message.status.taskId;

  // Fetch result.json and determine if the task completed successfully
  var got_success = new Promise(function(accept, reject) {
    request
      .get(message.resultUrl)
      .end(function(res) {
        if (!res.ok) {
          debug("Failed to fetch result.json for taskId: %s", completedTaskId);
          return reject(res.body);
        }
        accept(res.body.result.success);
      });
  });

  // Load the completed task
  var task_loaded = Task.load(taskGraphId, completedTaskId);

  // When result.json and task entity is loaded we modify the task resolution
  return Promise.all(
    got_success,
    task_loaded
  ).spread(function(success, task) {
    var task_modified = task.modify(function() {
      // We can go from:
      //  - `null` (unresolved) to unsuccessful completion,
      //  - unsuccessful task to successful completed task.
      //  - any state to successfully completed task.
      // Specifically, we permit a task to transition from successfully
      // completed to unsuccessfully completed. This shouldn't happen as we
      // won't rerun successful tasks, but we better check it anyway.
      if (this.resolution === null || success || !this.resolution.success) {
        this.resolution = {
          completed:      true,
          success:        success,
          resultUrl:      message.resultUrl,
          logsUrl:        message.logsUrl
        };
      } else if (!success && this.resolution.success) {
        debug(
          "ERROR: Got message of unsuccessfully completed task, that have "+
          "been successfully completed before. Investigate taskGraphId: %s " +
          "and taskId: %s, runId: %s", taskGraphId, completedTaskId,
          message.runId
        );
        throw new Error(
          "ERROR: Got message of unsuccessfully completed task, that have "+
          "been successfully completed before."
        );
      }
    });

    // When resolution has been saved,
    return task_modified.then(function() {
      if (success) {
        if (task.dependents.length != 0) {
          // There are dependent tasks, when we should try to schedule those
          return scheduleDependentTasks(task);
        } else {
          // If there is no dependent tasks then we should check if the task-
          // graph is finished
          return checkTaskGraphFinished(taskGraphId, task.taskId);
        }
      } else {
        return rerunTask(task);
      }
    });
  });
};

