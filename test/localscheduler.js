var fork    = require('child_process').fork;
var path    = require('path');
var _       = require('lodash');
var Promise = require('promise');
var debug   = require('debug')('LocalScheduler');

/** Wrapper for a process with a local scheduler, useful for testing */
var LocalScheduler = function() {
  this.process    = null;
};

/** Launch the local scheduler instance as a subprocess */
LocalScheduler.prototype.launch = function() {
  var that = this;
  return new Promise(function(accept, reject) {
    // Arguments for node.js
    var args = [
      '--database:dropTables'
    ];

    // Launch scheduler process
    that.process = fork('server.js', args, {
      env:      _.cloneDeep(process.env),
      silent:   false,
      cwd:      path.join(__dirname, '../')
    });

    // Reject on exit
    that.process.once('exit', reject);

    // Message handler
    var messageHandler = function(message) {
      if (message.ready == true) {
        // Stop listening messages
        that.process.removeListener('message', messageHandler);

        // Stop listening for rejection
        that.process.removeListener('exit', reject);

        // Listen for early exits, these are bad
        that.process.once('exit', that.onEarlyExit);

        // Accept that the server started correctly
        debug("----------- LocalScheduler Running --------------");
        accept();
      }
    };

    // Listen for the started message
    that.process.on('message', messageHandler);
  });
};

/** Handle early exits */
LocalScheduler.prototype.onEarlyExit = function() {
  debug("----------- LocalScheduler Crashed --------------");
  throw new Error("Local scheduler process exited early");
};

/** Terminate local scheduler instance */
LocalScheduler.prototype.terminate = function() {
  debug("----------- LocalScheduler Terminated -----------");
  if (this.process) {
    this.process.removeListener('exit', this.onEarlyExit);
    this.process.kill();
    this.process = null;
  }
};

// Export LocalScheduler
module.exports = LocalScheduler;
