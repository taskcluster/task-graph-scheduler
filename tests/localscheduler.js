var spawn = require('child_process').spawn;
var path  = require('path');
var _     = require('lodash');

/** Wrapper for a process with a local scheduler, useful for testing */
var LocalScheduler = function() {
  this.process    = null;
};

/** Launch the local scheduler instance as a subprocess */
LocalScheduler.prototype.launch = function() {
  // Launch scheduler process
  this.process = spawn('node', [path.join(__dirname, '../server.js')], {
    env:      _.cloneDeep(process.env),
    stdio:    'inherit',
    cwd:      path.join(__dirname, '../')
  });

  // Listen for early exits, these are bad
  this.process.once('exit', this.onEarlyExit);
};

/** Handle early exits */
LocalScheduler.prototype.onEarlyExit = function() {
  throw new Error("Local scheduler process exited early");
};

/** Terminate local scheduler instance */
LocalScheduler.prototype.terminate = function() {
  if (this.process) {
    this.process.removeListener('exit', this.onEarlyExit);
    this.process.kill();
    this.process = null;
  }
};

// Export LocalScheduler
module.exports = LocalScheduler;
