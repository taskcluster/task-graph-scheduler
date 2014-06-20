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
    "enum":         ["0.2.0"]
  },

  // Slugid pattern, for when-ever that is useful
  "slugid-pattern":  "^[a-zA-Z0-9-_]{22}",

  // Task-graph State
  "state": {
    "description":  "Task-graph state, this enum is **frozen** new values will " +
                    "**not** be added.",
    "enum":         ["running", "blocked", "finished"]
  },

  // Task-graph specific routing key, also prefixed to all task-specific routing
  // keys along with taskGraphId and schedulerId
  "routing": {
    "title":        "Routing Key",
    "description":  "Task-graph specific routing key, may contain dots (`.`) for arbitrary sub-routes",
    "type":         "string",
    "maxLength":    64
  },

  // List of task nodes
  "task-nodes": {
    "title":                  "Tasks",
    "description":            "List of nodes in the task-graph, eaching featuring a task definition and scheduling preferences, such as number of _reruns_ to attempt.",
    "type":                   "array",
    "items": {
      "title":                "Task Node",
      "description":          "Representation of a tasks in the task-graph",
      "type":                 "object",
      "properties": {
        "label": {
          "title":            "Task Label",
          "description":      "Task label used to reference the task in lists of required tasks for other task nodes and to substitute in `taskId` using the pattern `{{taskId:<task-label>}}`",
          "type":             "string"
        },
        "requires": {
          "title":            "Required tasks",
          "description":      "List of required task labels",
          "type":             "array",
          "items": {
            "title":          "Required task-label",
            "description":    "Label for task that is required to be _successfully completed_ before this task is scheduled.",
            "type":           "string",
            "maxLength":      255
          }
        },
        "reruns": {
          "title":            "Re-runs",
          "description":      "Number of times to _rerun_ the task if it completed unsuccessfully. **Note**, this does not capture _retries_ due to infrastructure issues.",
          "type":             "integer",
          "minimum":          0,
          "maximum":          999
        },
        "task":               {"$ref": "http://schemas.taskcluster.net/queue/v1/task.json#"}
      },
      "required":             ["label", "requires", "reruns", "task"]
    }
  }
};