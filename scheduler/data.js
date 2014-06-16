var base    = require('taskcluster-base');
var assert  = require('assert');

/** Configure a taskgraph Entity subclass */
var TaskGraph = base.Entity.configure({
  mapping: [
    {
      key:              'PartitionKey',
      property:         'taskGraphId',
      type:             'string'
    }, {
      // This is always hardcoded to 'task-graph', so we can use the same table
      // for both TaskGraph and Task entities. This ensures that we can make
      // atomic operations should we ever need to do this.
      key:              'RowKey',
      type:             'string',
      hidden:           true
    }, {
      key:              'version',
      type:             'string'
    }, {
      key:              'requires',
      type:             'json'
    }, {
      key:              'requiresLeft',
      type:             'json'
    }, {
      key:              'state',
      type:             'string'
    }, {
      key:              'routing',
      type:             'string'
    }, {
      key:              'details',
      type:             'json'
    }
  ]
});

// RowKey constant, used as we don't need a RowKey
var ROW_KEY_CONST = 'task-graph';

/** Create a taskGraph */
TaskGraph.create = function(properties) {
  properties.RowKey = ROW_KEY_CONST;
  return base.Entity.create.call(this, properties);
};

/** Load taskGraph from taskGraphId */
TaskGraph.load = function(taskGraphId) {
  return base.Entity.load.call(this, taskGraphId, ROW_KEY_CONST);
};

/** Get task-graph status structure */
TaskGraph.prototype.status = function() {
  return {
    taskGraphId:    this.taskGraphId,
    schedulerId:    this.schedulerId,
    state:          this.state,
    routing:        this.routing
  };
};

/**
 * Overwrite Entity.configure to support the additional configuration key
 * `schedulerId`, so that this can be configured dynamically.
 */
TaskGraph.configure = function(options) {
  assert(options.schedulerId, "schedulerId must be given!");

  // Configure class as Entity.configure would
  var Class = base.Entity.configure.call(this, options);

  // Add property schedulerId
  Class.prototype.schedulerId = options.schedulerId;

  // Return configured class
  return Class;
};

// Export TaskGraph
exports.TaskGraph = TaskGraph;



/** Configure a task Entity subclass */
var Task = base.Entity.configure({
  mapping: [
    {
      key:              'PartitionKey',
      property:         'taskGraphId',
      type:             'string'
    }, {
      key:              'RowKey',
      property:         'taskId',
      type:             'string'
    }, {
      key:              'version',
      type:             'string'
    }, {
      key:              'label',
      type:             'string'
    }, {
      key:              'rerunsAllowed',
      type:             'number'
    }, {
      key:              'rerunsLeft',
      type:             'number'
    }, {
      key:              'deadline',
      type:             'date'
    }, {
      key:              'requires',
      type:             'json'
    }, {
      key:              'requiresLeft',
      type:             'json'
    }, {
      key:              'dependents',
      type:             'json'
    }, {
      key:              'resolution',
      type:             'json'
    }
  ]
});

/** Create a task */
Task.create = function(properties) {
  return base.Entity.create.call(this, properties);
};

/** Load task from taskGraphId and taskId */
Task.load = function(taskGraphId, taskId) {
  return base.Entity.load.call(this, taskGraphId, taskId);
};

/** Load all tasks for a given task-graph */
Task.loadGraphTasks = function(taskGraphId) {
  var Class = this;
  assert(Class,     "Entity.create must be bound to an Entity subclass");
  var client    = Class.prototype._azClient;
  var tableName = Class.prototype._azTableName;
  var mapping   = Class.prototype.__mapping;
  assert(client,    "Azure credentials not configured");
  assert(tableName, "Azure tableName not configured");
  assert(mapping,   "Property mapping not configured");

  // Serialize RowKey
  partitionKey = mapping.PartitionKey.serialize(taskGraphId);

  return new Promise(function(accept, reject) {
    var entities = [];
    var fetchNext = function(continuationTokens) {
      client.queryEntities(tableName, {
        query:        azureTable.Query.create()
                        .where('PartitionKey', '==', partitionKey)
                        .and('RowKey', '!=', ROW_KEY_CONST),
        forceEtags:   true,
        continuation: continuationTokens
      }, function(err, data, continuationTokens) {
        // Reject if we hit an error
        if (err) {
          return reject(err);
        }
        // Create wrapper for each entity fetched
        entities.push.apply(entities, data.map(function(entity) {
          return new Class(entity);
        }));

        // If there are no continuation tokens then we accept data fetched
        if (!continuationTokens) {
          return accept(entities);
        }
        // Fetch next set based on continuation tokens
        fetchNext(continuationTokens);
      });
    }
    fetchNext(undefined);
  });
};

// Export Task
exports.Task = Task;