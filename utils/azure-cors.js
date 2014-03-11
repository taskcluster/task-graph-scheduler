var Promise   = require('promise');
var nconf     = require('nconf');
var debug     = require('debug')('utils:azure-cors');

// Credit where due, this is a refactor of code by James Lal, released:
// https://github.com/lightsofapollo/azure-cors

/** Set Azure CORS rules on table service */
exports.setAzureCORS = function() {
  // Load libraries used for setting CORS on demand
  var azure         = require('azure');
  var azureCommon   = require('azure-common');
  var WebResource   = azureCommon.WebResource;
  var js2xmlparser  = require('js2xmlparser');

  var accountName   = nconf.get('azureTableCredentials:accountName');
  var accountKey    = nconf.get('azureTableCredentials:accountKey');
  var table = azure.createTableService(accountName, accountKey);

  // Specify API Version
  table.apiVersion = '2013-08-15';

  /** Get azure table service properties */
  var getServiceProperties = function() {
    return new Promise(function(accept, reject) {
      var req = WebResource
                  .get()
                  .withQueryOption('restype', 'service')
                  .withQueryOption('comp', 'properties');
      table.performRequest(req, null, {}, function(result, next) {
        if (result.error) {
          debug("Failed to fetch azure table properies, error: %s, as JSON: %j",
                 result.error, result.error, result.error.stack);
          return reject(result.error);
        }

        next(result, function(result) {
          if (result.error) {
            debug("Failed to fetch azure table properies, error: %s, as " +
                  "JSON: %j", result.error, result.error, result.error.stack);
            return reject(result.error);
          }
          accept(result.response.body);
        });
      });
    });
  };

  /** Set azure table service properties */
  var setServiceProperties = function(values) {
    return new Promise(function(accept, reject) {
      var req = WebResource
                  .put()
                  .withHeader('x-ms-version', '2013-08-15')
                  .withHeader('Content-Type', 'application/xml')
                  .withQueryOption('restype', 'service')
                  .withQueryOption('comp',    'properties');
      var xml = js2xmlparser('StorageServiceProperties',
                             values.StorageServiceProperties);
      table.performRequest(req, xml, {}, function(result, next) {
        if (result.error) {
          debug("Failed to set azure table properies, error: %s, as JSON: %j",
                result.error, result.error, result.error.stack);
          return reject(result.error);
        }

        next(result, function(result) {
          if (result.error) {
            debug("Failed to set azure table properies, error: %s, as JSON: %j",
                  result.error, result.error, result.error.stack);
            return reject(result.error);
          }
          accept(result.response.body);
        });
      });
    });
  };

  // Get service properties
  debug("Fetching azure table storage properties");
  var got_service_props = getServiceProperties();

  // Update service properties when fetched
  var updated_service_props = got_service_props.then(function(props) {
    debug("Fetched table storage properties:\n%s",
          JSON.stringify(props, null, 2));
    // Set CORS rules on service properties
    props.StorageServiceProperties.Cors = {
      CorsRule: {
        AllowedOrigins: '*',
        AllowedMethods: 'GET, HEAD',
        MaxAgeInSeconds: 3600,
        ExposedHeaders: 'ms-*',
        AllowedHeaders: 'ms-*'
      }
    };
    debug("Updating table storage properties to:\n%s",
          JSON.stringify(props, null, 2));

    return setServiceProperties(props);
  });

  return updated_service_props.then(function() {
    debug("Updated azure service properties");
  });
};

