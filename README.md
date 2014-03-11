TaskCluster - Task-Graph Scheduler
==================================


Task-Graph Format
-----------------
This is the task-graph format in which task-graphs are submitted to the task-
graph scheduler.

{
  // Routing post-fix for all messages regarding this task-graph or it's tasks
  routing:        '...',  // limit 10 chars

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
  requiresLeft:           [...]
  state:                  running | blocked | finished
  routing:                <taskGraph.routing>

Entities:
  partitionKey:           <taskGraphId>
  rowKey:                 <taskId>
  label:                  <taskLabel>
  rerunsAllowed:          5
  rerunsLeft:             4
  deadline:               Datetime
  requires:               ['<taskId>, <taskId>, ...']
  requiresLeft:           [...]
  dependents:             ['<taskId>, ..., ] // if empty check task-graph
  resolution:             {resultUrl?, logsUrl?, success, completed} | null

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


Task-Graph Status Structure
---------------------------

{
  schedulerId:        <schedulerId>
  taskGraphId:        <compressed uuid>,
  state:              running | blocked | finished
  routing:            <taskGraph.routing>
}


RabbitMQ Exchanges
==================
We have the following **topic exchanges**:

  Exchange                            | Message Occur When
  -----------------------------------:|-----------------------------------------
  `v1/scheduler:task-graph-running`   | A task-graph is submitted
  `v1/scheduler:task-graph-blocked`   | A task-graph becomes blocked
  `v1/scheduler:task-graph-finished`  | A task-graph is finished successfully

Message Routing Key
-------------------
All messages have the same **routing key format**, which is a dot (`.`)
separated list of identifiers, defined as follows:

  1. The constant '_._._._._._', the inclusion of this constant ensures that
     the same routing pattern can be used for both task-graph scheduler
     exchanges and task queue exchanges.
  2. `schedulerId`, identifier for the task-graph scheduler to which the
      task-graph was submitted. For production this is always
      `task-graph-scheduler`.
  3. `taskGraphId`, task-graph identifier as assigned at submission.
  4. `taskGraph.routing`, the `routing` property from the submitted task-graph,
      **note** that this property may contain additional dots.

Task Message Routing Key Prefixes
---------------------------------
All task submitted by the task-scheduler will be submitted with `task.routing`
prefixed, such that the `task.routing` will be:
`<schedulerId>.<taskGraphId>.<taskGraph.routing>.<task.routing>`.

This means that messages sent by queue for any task scheduled by the task-graph
scheduler will have the following routing key:

  1.  `task-id`
  2.  `run-id`
  3.  `worker-group`
  4.  `worker-id`
  5.  `provisioner-id`
  6.  `worker-type`
  7.  `schedulerId`
  8.  `taskGraphId`
  9.  `taskGraph.routing` (May contain additional dots)
  10. `task.routing` (May contain additional dots)
