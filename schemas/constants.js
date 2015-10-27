/**
 * This module defines a mapping from keys to value that can be rendered into
 * JSON schemas using render-schema.js from utils
 *
 * This enables us to reuse the same slugid-pattern everywhere we define slugids
 * but give a different description of each occurrence. It makes it easy to
 * maintain consistent schemas without using `$ref`s for every single pattern
 * that can be reused.
 */
module.exports = {
  // Identifier pattern, min and max length, these limitations are applied to
  // all common identifiers. It's not personal, it's just that without these
  // limitation, the identifiers won't be useful as routing keys in RabbitMQ
  // topic exchanges. Specifically, the length limitation and the fact that
  // identifiers can't contain dots `.` is critical.
  "identifier-pattern":     "^([a-zA-Z0-9-_]*)$",
  "identifier-min-length":  1,
  "identifier-max-length":  22,

  // Message version numbers
  "message-version": {
    "description":  "Message version",
    "type":         "integer",
    "enum":         [1]
  },

  // Slugid pattern, for when-ever that is useful
  "slugid-pattern":  "^[A-Za-z0-9_-]{8}[Q-T][A-Za-z0-9_-][CGKOSWaeimquy26-][A-Za-z0-9_-]{10}[AQgw]$",

  // Task-graph State
  "state": {
    "description":  "Task-graph state, this enum is **frozen** new values will " +
                    "**not** be added.",
    "type":         "string",
    "enum":         ["running", "blocked", "finished"]
  },

  // Task-Graph scopes
  "scopes": {
    "title":        "Scopes",
    "description":  "List of scopes (or scope-patterns) that tasks of the "+
                    "task-graph is authorized to use.",
    "type":         "array",
    "items": {
      "title":        "Scope",
      "description":  "A scope (or scope-patterns) which a task of the " +
                      "task-graph is authorized to use. " +
                      "This can be a string or a string ending with `*` " +
                      "which will authorize all scopes for which the string " +
                      "is a prefix.",
      "type":         "string"
    }
  },

  // Task-Graph nodes
  "task-nodes": {
    "title":                  "Tasks",
    "description":            "List of nodes in the task-graph, each featuring a task definition and scheduling preferences, such as number of _reruns_ to attempt.",
    "type":                   "array",
    "items": {
      "title":                "Task Node",
      "description":          "Representation of a tasks in the task-graph",
      "type":                 "object",
      "properties": {
        "taskId": {
          "title":            "Task Identifier",
          "description":      "Task identifier (`taskId`) for the task when submitted to the queue, also used in `requires` below. This must be formatted as a **slugid** that is a uuid encoded in url-safe base64 following [RFC 4648 sec. 5](http://tools.ietf.org/html/rfc4648#section-5)), but without `==` padding.",
          "type":             "string",
          "pattern":          {"$const": "slugid-pattern"}
        },
        "requires": {
          "title":            "Required tasks",
          "description":      "List of required `taskId`s",
          "type":             "array",
          "items": {
            "title":          "Required `taskId`",
            "description":    "`taskId` for task that is required to be _successfully completed_ before this task is scheduled.",
            "type":           "string",
            "pattern":        {"$const": "slugid-pattern"}
          },
          "default":          []
        },
        "reruns": {
          "title":            "Re-runs",
          "description":      "Number of times to _rerun_ the task if it completed unsuccessfully. **Note**, this does not capture _retries_ due to infrastructure issues.",
          "type":             "integer",
          "minimum":          0,
          "maximum":          100,
          "default":          0
        },
        "task":               {"$ref": "http://schemas.taskcluster.net/queue/v1/create-task-request.json#"}
      },
      "required":             ["taskId", "task"]
    }
  }
};
