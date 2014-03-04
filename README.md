TaskCluster - Task-Graph Scheduler
==================================


Task-Graph Format
-----------------
This is the task-graph format in which task-graphs are submitted to the task-
graph scheduler.

{
  // Routing post-fix for all messages regarding this task-graph or it's tasks
  routing;        '...',  // limit 10 chars

  // Task definitions as mapping from taskLabel to task-node which contains a
  // task definition...
  tasks: {
    // taskLabel
    'test-task-1': {
      // Tasks required to completed successfully before this one is scheduled
      requires:   ['build-task', ...],

      // Number of reruns before this task is considered failed
      reruns:     5,

      // Task specification for this node
      task: {
        <task-definition>
        // routing is limited to 10 chars
        // routing key of the actual task will be:
        // <schedulerId>.<taskGraphId>.<taskGraph.routing>.<task.routing>
        // Task payload may contain {'$subs': 'taskId:<taskLabel>'} objects
        // which will be substituted for taskId of taskLabel.
      },
    },
    ...
  }
}

Azure Table Storage Design
--------------------------

Entities: (task-graph)
  partitionKey:           <task-graph-id>
  rowKey:                 task-graph
  requires:               [<taskId>, <taskId>, ...]
  nameMapping:            JSON mapping from taskLabel -> taskId
  state:                  running | blocked | finished

Entities:
  partitionKey:           <taskGraphId>
  rowKey:                 tasks/<taskId>
  rerunsAllowed:          5
  rerunsLeft:             4
  deadline:               Datetime
  requires:               ['<taskId>, <taskId>, ...']
  dependents:             ['<taskId>, ..., task-graph']
  resolution:             {resultUrl?, logsUrl?, failed}

Operations:
  Add tasks during execution (A):
    - Scan through required tasks and update dependents accordingly
    - Insert tasks with requires from definition
    - Scan through required tasks and update requires accordingly
      - If setting requires = [] schedule the new task
  Task completed successfully (B):
    - Scan through dependent tasks updating their requires
        (if dependent is missing ignore, it)
      - If setting requires = [] schedule the task
      - If setting requires = [] for task-graph entry:
        - Post message that task-graph is finished
    - Ack completed message
  Task completed unsuccessfully (C):
    - If reruns != 0:
      - Schedule a rerun with the queue
      - Decrement reruns
      - Ack completed message
    - Else, do the "Task failed" operation
  Task failed (D):
    - Set 'task-graph' entry state to blocked
    - Post message that task-graph is now blocked
    - Ack message
