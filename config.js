var nconf   = require('nconf');
var aws     = require('aws-sdk-promise');

/** Default configuration values */
var DEFAULT_CONFIG_VALUES = {
  // Task-Graph Scheduler configuration
  scheduler: {
    // Bucket to which schemas should be published
    schemaBucket:                   'schemas.taskcluster.net',

    // Publish schemas to bucket on startup, this should default to false, only
    // do this in the actual production server... Hence, set it by environment
    // variable. Unset it `inorder` to set it false by environment variable.
    publishSchemas:                 false,

    // Validate out-going messages, this can be disabled if we trust that we
    // generate correct JSON internally and want more performance
    validateOutgoing:               true,

    // Azure task graph table name
    azureTaskGraphTable:            "TaskGraphs",

    // Queue to be used on AMQP, leave it undefined to use an exclusive,
    // auto-delete queue (use; `tash-graph-scheduler-input` in production)
    amqpQueueName:                  undefined,

    // Task-Graph Scheduler Identifier used in routing for tasks submitted, this
    // is therefore limited to 22 characters. In production we'll use
    // `task-graph-scheduler`, do **NOT** use this for testing, as your messages
    // would be sent to the scheduler too.
    taskGraphSchedulerId:           "jonasfj-test-tgs",

    // Always set CORS on azure after restarting
    ensureAzureCORS:                false
  },

  // Queue configuration
  queue: {
    baseUrl:                        'http://queue.taskcluster.net'
  },

  // Azure table credentials
  azureTableCredentials: {
    accountUrl:                     null,
    accountName:                    null,
    accountKey:                     null
  },

  // Server (HTTP) configuration
  server: {
    // Server hostname
    hostname:                       'localhost',

    // Port on which HTTP server is exposed, and port on which node will listen
    // unless `$PORT` is specified.
    port:                           3030,

    // Cookie secret used to sign cookies, must be secret at deployment
    cookieSecret:                   "Warn, if no secret is used on production"
  },

  // AWS SDK configuration for publication of schemas
  'aws': {
    // Default AWS region, this is where the S3 bucket lives
    'region':                       'us-west-2',

    // Lock API version to use the latest API from 2013, this is fuzzy locking,
    // but it does the trick...
    'apiVersion':                   '2014-01-01'
  }
};

var loaded = false;
/** Load configuration */
exports.load = function() {
  if (loaded) {
    return;
  }
  loaded = true;

  // Load configuration from command line arguments, if requested
  nconf.argv();

  // Configurations elements loaded from commandline, these are the only
  // values we should ever really need to change.
  nconf.env({
    separator:  '__',
    whitelist:  [
      'scheduler__publishSchemas',
      'scheduler__amqpQueueName',
      'scheduler__taskGraphSchedulerId',
      'scheduler__ensureAzureCORS',
      'azureTableCredentials__accountUrl',
      'azureTableCredentials__accountName',
      'azureTableCredentials__accountKey',
      'queue__baseUrl',
      'server__hostname',
      'server__port',
      'server__cookieSecret',
      'aws__accessKeyId',
      'aws__secretAccessKey'
    ]
  });

  // Config from current working folder if present
  nconf.file('local', 'task-graph-scheduler.conf.json');

  // User configuration
  nconf.file('user', '~/.task-graph-scheduler.conf.json');

  // Global configuration
  nconf.file('global', '/etc/task-graph-scheduler.conf.json');

  // Load default configuration
  nconf.defaults(DEFAULT_CONFIG_VALUES);

  // Set configuration for aws-sdk
  aws.config.update(nconf.get('aws'));
}
