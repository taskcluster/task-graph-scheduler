#!/usr/bin/env node
var path        = require('path');
var Promise     = require('promise');
var debug       = require('debug')('scheduler:bin:server');
var base        = require('taskcluster-base');
var taskcluster = require('taskcluster-client');
var data        = require('../scheduler/data');
var exchanges   = require('../scheduler/exchanges');
var v1          = require('../routes/api/v1');

/** Launch server */
var launch = function(profile) {
  // Load configuration
  var cfg = base.config({
    defaults:     require('../config/defaults'),
    profile:      require('../config/' + profile),
    envs: [
      'scheduler_publishMetaData',
      'taskcluster_queueBaseUrl',
      'taskcluster_authBaseUrl',
      'taskcluster_credentials_clientId',
      'taskcluster_credentials_accessToken',
      'amqp_url',
      'aws_accessKeyId',
      'aws_secretAccessKey',
      'azure_accountUrl',
      'azure_accountName',
      'azure_accountKey'
    ],
    filename:     'task-graph-scheduler'
  });

  // Configure Task and TaskGraph entities
  var Task = data.Task.configure({
    schedulerId:      cfg.get('scheduler:schedulerId'),
    tableName:        cfg.get('scheduler:taskGraphTableName'),
    credentials:      cfg.get('azureTable')
  });
  var TaskGraph = data.TaskGraph.configure({
    schedulerId:      cfg.get('scheduler:schedulerId'),
    tableName:        cfg.get('scheduler:taskGraphTableName'),
    credentials:      cfg.get('azureTable')
  });

  // Setup AMQP exchanges and create a publisher
  // First create a validator and then publisher
  var validator = null;
  var publisher = null;
  var publisherCreated = base.validator({
    folder:           path.join(__dirname, '..', 'schemas'),
    constants:        require('../schemas/constants'),
    publish:          cfg.get('scheduler:publishMetaData') === 'true',
    schemaPrefix:     'scheduler/v1/',
    preload: [
      'http://schemas.taskcluster.net/queue/v1/task.json'
    ],
    aws:              cfg.get('aws')
  }).then(function(validator_) {
    validator = validator_;
    return exchanges.setup({
      connectionString:   cfg.get('amqp:url'),
      exchangePrefix:     cfg.get('scheduler:exchangePrefix'),
      validator:          validator,
      referencePrefix:    'scheduler/v1/exchanges.json',
      publish:            cfg.get('scheduler:publishMetaData') === 'true',
      aws:                cfg.get('aws')
    });
  }).then(function(publisher_) {
    publisher = publisher_;
  });

  // Configure queue and queueEvents
  var queue = new taskcluster.Queue({
    baseUrl:        cfg.get('taskcluster:queueBaseUrl'),
    credentials:    cfg.get('taskcluster:credentials')
  });

  // When: publisher, schema and validator is created, proceed
  return publisherCreated.then(function() {
    // Create API router and publish reference if needed
    return v1.setup({
      context: {
        Task:           Task,
        TaskGraph:      TaskGraph,
        publisher:      publisher,
        queue:          queue,
        schedulerId:    cfg.get('scheduler:schedulerId'),
        validator:      validator
      },
      validator:        validator,
      authBaseUrl:      cfg.get('taskcluster:authBaseUrl'),
      credentials:      cfg.get('taskcluster:credentials'),
      publish:          cfg.get('scheduler:publishMetaData') === 'true',
      baseUrl:          cfg.get('server:publicUrl') + '/v1',
      referencePrefix:  'scheduler/v1/api.json',
      aws:              cfg.get('aws')
    });
  }).then(function(router) {
    // Create app
    var app = base.app({
      port:           Number(process.env.PORT || cfg.get('server:port'))
    });

    // Mount API router
    app.use('/v1', router);

    // Create server
    return app.createServer();
  });
};

// If server.js is executed start the server
if (!module.parent) {
  // Find configuration profile
  var profile = process.argv[2];
  if (!profile) {
    console.log("Usage: server.js [profile]")
    console.error("ERROR: No configuration profile is provided");
  }
  // Launch with given profile
  launch(profile).then(function() {
    debug("Launched authentication server successfully");
  }).catch(function(err) {
    debug("Failed to start server, err: %s, as JSON: %j", err, err, err.stack);
    // If we didn't launch the server we should crash
    process.exit(1);
  });
}

// Export launch in-case anybody cares
module.exports = launch;