export const store = 'y5y3p1-hw.myshopify.com';

export const workflows = [
  { key: 'paid', name: 'MSH POS - Take today after payment', tag: 'msh-handover-paid-v1' },
  { key: 'routed', name: 'MSH POS - Take today after order routing', tag: 'msh-handover-routed-v1' },
];

const specifications = {
  paid: { type: 'TRIGGER', label: 'Order paid' },
  routed: { type: 'TRIGGER', label: 'Fulfillment order ready to fulfill' },
  wait: { type: 'WAIT', label: 'Wait' },
  plan: { type: 'ACTION', id: 'shopify::flow::run_code', fields: ['input', 'script', 'output_schema'] },
  check: { type: 'CONDITION', id: 'shopify::flow::condition', fields: ['condition'] },
  fulfill: { type: 'ACTION', id: 'shopify::admin::admin_api_operation', fields: ['api_call'] },
};

const workflowFields = 'id name version activeVersion versionState adminApiVersion tags configuration validationErrors { code message stepId configFieldId }';
export const queries = {
  tasks: `query Tasks($type: AutomationTaskType!, $after: String) {
    automationTasks(first: 100, taskType: $type, after: $after) {
      nodes { id taskId label state taskType version connector { installed } }
      pageInfo { hasNextPage endCursor }
    }
  }`,
  task: `query Task($id: ID!) {
    automationTask(id: $id) {
      id taskId version label state taskType connector { installed } outputPortIds
      configFields { __typename id required defaultValue
        ... on AutomationDurationConfigField { possibleUnits }
      }
      returnFields { name type }
    }
  }`,
  list: `query Workflows($after: String) {
    shop { myshopifyDomain }
    automationWorkflows(first: 100, after: $after) {
      nodes { id name tags version activeVersion } pageInfo { hasNextPage endCursor }
    }
  }`,
  read: `query ReadWorkflow($id: ID!, $version: String) {
    automationWorkflow(id: $id, version: $version) { ${workflowFields} }
  }`,
  create: `mutation CreateWorkflow($name: String!, $configuration: JSON!, $tags: [String!], $note: String!) {
    automationWorkflowCreate(name: $name, configuration: $configuration, tags: $tags, note: $note) {
      automationWorkflow { ${workflowFields} } userErrors { field message code }
    }
  }`,
  activate: `mutation ActivateWorkflow($id: ID!, $version: String!) {
    automationWorkflowActivate(id: $id, version: $version) {
      automationWorkflow { ${workflowFields} } userErrors { field message code }
    }
  }`,
  runtimeSchema: `query CheckFulfillmentApi {
    mutation: __type(name: "Mutation") { fields(includeDeprecated: true) { name args { name } } }
    payload: __type(name: "FulfillmentInput") { inputFields { name } }
    group: __type(name: "FulfillmentOrderLineItemsInput") { inputFields { name } }
    line: __type(name: "FulfillmentOrderLineItemInput") { inputFields { name } }
  }`,
};

async function pages(fetchPage, done = () => false) {
  const nodes = [], seen = new Set();
  let after = null;
  do {
    const page = await fetchPage(after);
    if (!Array.isArray(page?.nodes) || !page?.pageInfo) throw new Error('Shopify returned an incomplete list.');
    nodes.push(...page.nodes);
    if (done(nodes) || !page.pageInfo.hasNextPage) return nodes;
    after = page.pageInfo.endCursor;
    if (!after || seen.has(after)) throw new Error('Shopify returned an incomplete page cursor.');
    seen.add(after);
  } while (true);
}

export async function listWorkflows(api) {
  return pages(async after => {
    const data = await api(queries.list, { after });
    if (data.shop?.myshopifyDomain !== store) throw new Error('The signed-in store does not match Macron Sports Hub Hastings.');
    return data.automationWorkflows;
  });
}

function matches(task, spec) {
  return task.taskType === spec.type && task.state === 'MAIN' && task.connector?.installed === true &&
    (spec.id ? task.taskId === spec.id : task.taskId.startsWith('shopify::') && task.label.toLowerCase() === spec.label.toLowerCase());
}

export async function discoverTasks(api) {
  const tasks = {};
  for (const type of new Set(Object.values(specifications).map(spec => spec.type))) {
    const specs = Object.entries(specifications).filter(([, spec]) => spec.type === type);
    const nodes = await pages(async after => (await api(queries.tasks, { type, after })).automationTasks,
      found => specs.every(([, spec]) => found.some(task => matches(task, spec))));
    for (const [key, spec] of specs) {
      const found = nodes.filter(task => matches(task, spec));
      if (found.length !== 1) throw new Error('Shopify Flow needs one installed MAIN task for ' + (spec.label ?? spec.id) + '.');
      const task = (await api(queries.task, { id: found[0].id })).automationTask;
      if (!task || !matches(task, spec) || !Array.isArray(task.configFields)) throw new Error('Shopify changed a task during setup. Run setup again.');
      for (const field of spec.fields ?? []) {
        if (!task.configFields.some(f => f.id === field)) throw new Error(task.label + ' is missing the ' + field + ' setting.');
      }
      tasks[key] = task;
    }
  }
  return tasks;
}

export function routedInput(query) {
  const match = query.trim().match(/^(?:query\s*(?:[A-Za-z_]\w*\s*)?)?\{\s*(order\s*\{[\s\S]*\})\s*\}$/);
  if (!match) throw new Error('The supplied Run code input must select order at its root.');
  return 'query {\n  fulfillmentOrder {\n' + match[1] + '\n  }\n}';
}

export function buildWorkflow(key, tasks, source) {
  const steps = [], links = [];
  function append(id, task, values = {}) {
    for (const field of task.configFields) {
      if (field.required && !(field.id in values) && field.defaultValue == null) {
        throw new Error(task.label + ' requires an additional setting: ' + field.id);
      }
    }
    steps.push({ step_id: id, task_id: task.taskId, task_version: task.version, task_type: task.taskType,
      config_field_values: Object.entries(values).map(([config_field_id, value]) => ({ config_field_id, value })) });
  }
  function link(from, task, to, port = 'output') {
    if (!task.outputPortIds?.includes(port)) throw new Error(task.label + ' is missing the ' + port + ' output.');
    links.push({ from_step_id: from, from_port_id: port, to_step_id: to, to_port_id: 'input' });
  }
  append(key, tasks[key]);
  if (key === 'paid') {
    const duration = tasks.wait.configFields.find(f => f.__typename === 'AutomationDurationConfigField' && f.possibleUnits?.includes('SECONDS'));
    if (!duration) throw new Error('The Shopify Wait task needs a duration that supports seconds.');
    append('wait_for_routing', tasks.wait, { [duration.id]: JSON.stringify({ amount: 10, unit: 'seconds' }) });
    link('paid', tasks.paid, 'wait_for_routing');
    link('wait_for_routing', tasks.wait, 'plan');
  } else {
    link(key, tasks[key], 'plan');
  }
  append('plan', tasks.plan, { input: key === 'paid' ? source.input : routedInput(source.input), script: source.script, output_schema: source.output });
  append('check', tasks.check, { condition: '(runCode.ready == true)' });
  append('fulfill', tasks.fulfill, { api_call: JSON.stringify({ name: 'fulfillmentCreate', blob: '{{ runCode.mutationInput }}' }) });
  link('plan', tasks.plan, 'check');
  link('check', tasks.check, 'fulfill', 'true');
  return { __metadata: { version: 0.1 }, root: { steps, links, patched_fields: [] } };
}

export function matchingWorkflows(list, def) {
  return list.filter(w => w.name === def.name || w.tags.includes(def.tag));
}

export function selectWorkflow(list, def) {
  const found = matchingWorkflows(list,def);
  if (found.length > 1 || (found.length === 1 && (found[0].name !== def.name || !found[0].tags.includes(def.tag)))) {
    throw new Error('Open Shopify Flow and check for a duplicate, renamed or manually created workflow named "' + def.name + '". Setup stopped to protect your existing workflow.');
  }
  return found[0];
}

// Shopify may add canvas positions, display names, and reorder arrays when saving a definition.
function canonical(config) {
  const root = config?.root;
  if (!root || !Array.isArray(root.steps) || !Array.isArray(root.links)) throw new Error('Shopify returned an unreadable workflow definition.');
  const sorted = items => items.map(item => JSON.stringify(item)).sort();
  const steps = root.steps.map(s => [s.step_id, s.task_id, s.task_version, s.task_type,
    sorted(s.config_field_values.map(f => [f.config_field_id, f.value?.replaceAll('\r\n','\n') ?? f.value]))]);
  const links = root.links.map(l => [l.from_step_id, l.from_port_id, l.to_step_id, l.to_port_id]);
  return JSON.stringify([sorted(steps), sorted(links), root.patched_fields ?? []]);
}

// A merchant may tune the Wait on a running payment workflow. Compare the expected
// definition using that one saved field, without changing either workflow.
function expectedConfiguration(actual, def) {
  if (def.key !== 'paid' || actual.activeVersion !== actual.version) return def.configuration;
  const expected = structuredClone(def.configuration);
  const duration = expected.root.steps.find(step => step.step_id === 'wait_for_routing').config_field_values[0];
  const savedWait = actual.configuration?.root?.steps?.find(step => step.step_id === 'wait_for_routing');
  const field = savedWait?.config_field_values?.find(field => field.config_field_id === duration.config_field_id);
  if (typeof field?.value !== 'string') return expected;
  let setting;
  try { setting = JSON.parse(field.value); } catch { return expected; }
  if (!setting || typeof setting !== 'object' || Object.keys(setting).sort().join(',') !== 'amount,unit') return expected;
  const secondsPerUnit = {seconds:1, minutes:60, hours:3600, days:86400, weeks:604800};
  if (typeof setting.unit !== 'string' || !Object.hasOwn(secondsPerUnit, setting.unit)) return expected;
  const amount = typeof setting.amount === 'string' && /^\d+(?:\.\d+)?$/.test(setting.amount) ? Number(setting.amount) : setting.amount;
  if (Number.isFinite(amount) && amount >= 0 && amount * secondsPerUnit[setting.unit] <= 90 * 86400) {
    duration.value = field.value;
  }
  return expected;
}

export function verifyWorkflow(actual, def) {
  if (!actual?.id || !actual.version || !Array.isArray(actual.validationErrors)) throw new Error('Shopify returned an incomplete workflow.');
  const errors = actual.validationErrors;
  if (errors.length) throw new Error(actual.name + ' has Flow validation errors:\n' + errors.map(e => [e.stepId, e.configFieldId, e.message ?? e.code].filter(Boolean).join(' / ')).join('\n'));
  if (actual.name !== def.name || !actual.tags.includes(def.tag) || canonical(actual.configuration) !== canonical(expectedConfiguration(actual, def))) {
    throw new Error('The saved steps differ from the installer for "' + def.name + '". Open the workflow in Shopify Flow to review it before making changes.');
  }
  if (actual.activeVersion && actual.activeVersion !== actual.version) throw new Error(actual.name + ' already has a different active version.');
  return actual;
}

export function verifyRuntime(schema) {
  const operation = schema.mutation?.fields.find(f => f.name === 'fulfillmentCreate');
  function includes(fields, required) { return required.every(n => fields?.some(f => f.name === n)); }
  if (!includes(operation?.args, ['fulfillment','message']) || !includes(schema.payload?.inputFields, ['lineItemsByFulfillmentOrder','notifyCustomer']) ||
      !includes(schema.group?.inputFields,['fulfillmentOrderId','fulfillmentOrderLineItems']) || !includes(schema.line?.inputFields,['id','quantity'])) {
    throw new Error("The workflow's Shopify API version does not support the required line-specific fulfillment.");
  }
}
