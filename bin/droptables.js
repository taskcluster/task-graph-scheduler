#!/usr/bin/env node
var path        = require('path');
var Promise     = require('promise');
var debug       = require('debug')('scheduler:bin:handlers');
var data        = require('../scheduler/data');
var base        = require('taskcluster-base');

/** Launch drop-tables */
var launch = function(profile) {
  // Load configuration
  var cfg = base.config({
    defaults:     require('../config/defaults'),
    profile:      require('../config/' + profile),
    envs: [
      'azure_accountName',
      'azure_accountKey'
    ],
    filename:     'task-graph-scheduler'
  });

  // Configure Task and TaskGraph entities
  var Task = data.Task.configure({
    schedulerId:      cfg.get('scheduler:schedulerId'),
    tableName:        cfg.get('scheduler:taskGraphTableName'),
    credentials:      cfg.get('azure')
  });
  var TaskGraph = data.TaskGraph.configure({
    schedulerId:      cfg.get('scheduler:schedulerId'),
    tableName:        cfg.get('scheduler:taskGraphTableName'),
    credentials:      cfg.get('azure')
  });

  // Delete tables
  return Promise.all([
    Task.deleteTable(),
    TaskGraph.deleteTable()
  ]).then(function() {
    console.log('Azure tables now deleted');

    // Notify parent process, so that this worker can run using LocalApp
    base.app.notifyLocalAppInParentProcess();
  });
};

// If droptables.js is executed start the droptables
if (!module.parent) {
  // Find configuration profile
  var profile = process.argv[2];
  if (!profile) {
    console.log("Usage: droptables.js [profile]")
    console.error("ERROR: No configuration profile is provided");
  }
  // Launch with given profile
  launch(profile).then(function() {
    debug("Launched droptables successfully");
  }).catch(function(err) {
    debug("Failed to start droptables, err: %s, as JSON: %j",
          err, err, err.stack);
    // If we didn't launch the droptables we should crash
    process.exit(1);
  });
}

// Export launch in-case anybody cares
module.exports = launch;