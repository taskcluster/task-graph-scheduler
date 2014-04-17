var Promise   = require('promise');
var nconf     = require('nconf');
var amqp      = require('amqp');
var request   = require('superagent-promise');
var validate  = require('../utils/validate');
var assert    = require('assert');
var debug     = require('debug')('scheduler:events');
var handlers  = require('./handlers');

// Number of message to be working on concurrently
var PREFETCH_COUNT = 5;

// AMQP connection created by events.setup()
var _conn = null;

// Exchanges setup by events.setup()
var _exchanges = null;

/**
 * Setup AMQP connection and declare the required exchanges, this returns a
 * promise that we're ready to publish messages.
 *
 * **Warning** the `node-amqp` library have some fairly limited error reporting
 * capability, so don't except this to fail. This isn't bad because failure to
 * setup exchanges is critical... Whether server crashes or loops doesn't really
 * matter to me.
 */
exports.setup = function() {
  // Connection created
  var conn = null;

  // Fetch connection string from queue
  var fetched_connection_string =
    request
      .get(nconf.get('queue:baseUrl') + '/v1/settings/amqp-connection-string')
      .end()
      .then(function(res) {
        if (!res.ok) {
          throw new Error(res.body);
        }
        assert(res.body.url, "amqp-connection-string reply missing url!");
        return res.body.url;
      });

  // Get a promise that we'll be connected
  var connected = fetched_connection_string.then(function(connectionString) {
    return new Promise(function(accept, reject) {
      debug("Connecting to AMQP server");
      // Create connection
      conn = amqp.createConnection({url: connectionString});
      conn.once('ready', function() {
        debug("Connection to AMQP is now ready for work");
        accept();
      });
    });
  });

  // Create a dictionary for exchanges
  var exchanges = {};

  // When we're connected, let's defined exchanges
  var exchanges_declared = connected.then(function() {
    // For each desired exchange we create a promise that the exchange will be
    // declared (we just carry name to function below as name, enjoy)
    var exchanges_declared_promises = [
      'scheduler/v1/task-graph-running',
      'scheduler/v1/task-graph-blocked',
      'scheduler/v1/task-graph-finished'
    ].map(function(name) {
      // Promise that exchange with `name` will be created
      return new Promise(function(accept, reject) {
        debug("Declaring exchange: " + name);
        // For all intents and purposes these exchanges must be durable and
        // not auto deleted, they should never disappear!
        exchanges[name] = conn.exchange(name, {
          type:             'topic',
          durable:          true,
          confirm:          true,
          autoDelete:       false
        }, function() {
          debug("Declared exchange: " + name);
          accept();
        });
      });
    });

    // Return a promise that all exchanges have been configured
    return Promise.all(exchanges_declared_promises);
  });

  // Declare queue
  var queue = null;
  var queue_declared = exchanges_declared.then(function() {
    return new Promise(function(accept, reject) {
      var queueName = nconf.get('scheduler:amqpQueueName');
      var hasName   = queueName !== undefined;
      queue = conn.queue(queueName || '', {
        passive:                    false,
        durable:                    hasName,
        exclusive:                  !hasName,
        autoDelete:                 !hasName,
        closeChannelOnUnsubscribe:  false
      }, function() {
        debug("Declared AMQP queue");
        accept();
      });
    });
  });


  // Subscribe to messages
  var subscribe_to_messages = queue_declared.then(function() {
    // Handle incoming messages and send them to handers
    queue.subscribe({
      ack:                true,
      prefetchCount:      PREFETCH_COUNT
    }, function(message, headers, deliveryInfo, raw) {
      // WARNING: Raw is not documented, but exposed and it is the only way
      // to handle more than one message at the time, as queue.shift() only
      // allows us to acknowledge the last message.
      debug("Received message from: %s with routingKey: %s",
            deliveryInfo.exchange, deliveryInfo.routingKey);

      // Check that this is for an exchange we want
      var m = /queue\/v1\/task-(completed|failed)/.exec(deliveryInfo.exchange)
      if (!m) {
        debug("ERROR: Received message from exchange %s, which we bind to",
              deliveryInfo.exchange);
        raw.acknowledge();
        return;
      }

      // Handle the message
      try {
        handlers[m[1]](message).then(function() {
          // Acknowledge that message is completed
          debug("Acknowledging successfully handled message!");
          raw.acknowledge();
        }).catch(function(err) {
          var requeue = true;
          // Don't requeue if this has been tried before
          if (deliveryInfo.redelivered) {
            requeue = false;
            debug(
              "ERROR: Failed to handle message %j due to err: " +
              "%s, as JSON: %j, now rejecting message without requeuing!",
              message, err, err, err.stack
            );
          } else {
            debug(
              "WARNING: Failed to handle message %j due to err: " +
              "%s, as JSON: %j, now requeuing message",
              message, err, err, err.stack
            );
          }
          raw.reject(requeue);
        });
      }
      catch (err) {
        debug("Failed to handle message: %j, with err: %s",
              message, err, err.stack);
      }
    });
    debug("Subscribed to messages from queue");
  });

  // Bind queue to exchanges
  var setup_completed = subscribe_to_messages.then(function() {
    var id = nconf.get('scheduler:taskGraphSchedulerId');
    assert(id.length <= 22, "taskGraphSchedulerId is too long!");
    var routingPattern = '*.*.*.*.*.*.' + id + '.#';
    return new Promise(function(accept, reject) {
      debug('Binding to exchanges');
      // Only the last of the two binds will emit an event... this is crazy, but
      // I don't want to port to another AMQP library just yet.
      queue.bind('queue/v1/task-completed', routingPattern);
      queue.bind('queue/v1/task-failed', routingPattern, function() {
        debug('Bound queue to exchanges');
        accept();
      });
    });
  });

  return setup_completed.then(function() {
    // Set connection and exchange globally
    _conn = conn;
    _exchanges = exchanges;
  });
};

/**
 * Disconnect from AMQP server, returns a promise of success
 * Mainly used for testing...
 */
exports.disconnect = function() {
  return new Promise(function(accept, reject) {
    _conn.on('close', function() {
      accept();
    });
    _conn.destroy();
  });
};

/**
 * Publish a message to exchange, routing key will be constructed from message
 */
exports.publish = function(exchange, message) {
  // Check if exchanges are created, don't give a promise if exchanges aren't
  // setup...
  if (_exchanges === null) {
    throw new Error("Exchanges are not setup yet, call events.setup()!");
  }

  return new Promise(function(accept, reject) {
    // Check if we're supposed to validate out-going messages
    if (nconf.get('queue:validateOutgoing')) {
      var schema = 'http://schemas.taskcluster.net/scheduler/v1/' + exchange
                    + '-message.json#';
      var errors = validate(message, schema);
      // Reject message if there's any errors
      if (errors) {
        debug(
          "Failed to publish message, errors: %s, as JSON: %j",
          errors,
          errors
        );
        debug("Message: %j", message);
        reject(errors);
        return;
      }
    }

    // Construct routing key from task-graph status structure in message
    var routingKey = [
      // The following constant ensures that schedulerId, taskGraphId and
      // task-graph routing key has the same routing-key index for both
      // scheduler exchanges and queue exchanges.
      '_._._._._._',
      message.status.schedulerId,
      message.status.taskGraphId,
      message.status.routing
    ].join('.');

    // Publish message to RabbitMQ
    _exchanges['scheduler/v1/' + exchange].publish(routingKey, message, {
      contentType:        'application/json',
      deliveryMode:       2,
    }, function(err) {
      if (err) {
        reject(new Error("Failed to send message"));
      } else {
        debug(
          "Published message to %s with taskGraphId: %s",
          exchange,
          message.status.taskGraphId
        );
        accept();
      }
    });
  });
};
