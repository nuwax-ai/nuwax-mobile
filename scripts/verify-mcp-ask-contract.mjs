import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const mcpDir = path.resolve(rootDir, "../nuwax-ask-question-mcp");

function read(relativePath, baseDir = rootDir) {
  return fs.readFileSync(path.join(baseDir, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(source, needle, label) {
  assert(source.includes(needle), `${label} missing: ${needle}`);
}

function assertNotIncludes(source, needle, label) {
  assert(!source.includes(needle), `${label} must not include: ${needle}`);
}

function extractConst(source, name) {
  const match = source.match(new RegExp(`export const ${name} = "([^"]+)"`));
  return match?.[1] ?? "";
}

const mcpTypes = read("src/types.ts", mcpDir);
const expectedAskVersion = extractConst(mcpTypes, "ASK_SCHEMA_VERSION");
const expectedUiVersion = extractConst(
  mcpTypes,
  "INTERACTION_UI_SCHEMA_VERSION",
);
const expectedToolName = extractConst(mcpTypes, "MCP_ASK_TOOL_NAME");

assert(
  expectedAskVersion,
  "Could not read ASK_SCHEMA_VERSION from nuwax-ask-question-mcp",
);
assert(
  expectedUiVersion,
  "Could not read INTERACTION_UI_SCHEMA_VERSION from nuwax-ask-question-mcp",
);
assert(
  expectedToolName,
  "Could not read MCP_ASK_TOOL_NAME from nuwax-ask-question-mcp",
);

const schema = read("utils/mcpAskSchema.uts");
const interventionTypes = read("types/intervention.uts");
assertIncludes(
  interventionTypes,
  "export const MCP_ASK_WIDGET_TYPES",
  "mobile widget whitelist constant",
);
assertIncludes(
  interventionTypes,
  `export const MCP_ASK_TOOL_NAME = "${expectedToolName}"`,
  "mobile MCP_ASK_TOOL_NAME constant",
);
assertIncludes(
  schema,
  `MCP_ASK_SCHEMA_VERSION = "${expectedAskVersion}"`,
  "mobile schema version",
);
assertIncludes(
  schema,
  `INTERACTION_UI_SCHEMA_VERSION = "${expectedUiVersion}"`,
  "mobile UI schema version",
);
assertIncludes(
  schema,
  "const toolName = (record as any).toolName || MCP_ASK_TOOL_NAME",
  "mobile default MCP Ask tool name",
);
assertIncludes(
  schema,
  "toolName !== MCP_ASK_TOOL_NAME",
  "mobile tool-name guard",
);
assertIncludes(
  schema,
  'typeof (record as any).sessionId !== "string"',
  "sessionId validation",
);
assertIncludes(
  schema,
  "Math.floor((record as any).revision)",
  "positive integer revision validation",
);
assertIncludes(interventionTypes, '"radio-with-custom"', "radio-with-custom widget in whitelist");
assertIncludes(interventionTypes, '"file"', "file widget in whitelist");
assertIncludes(interventionTypes, '"number"', "number widget in whitelist");
assertIncludes(schema, "MCP_ASK_WIDGET_TYPES", "widget whitelist constant");
assertIncludes(schema, "getJsonSchemaPrimaryType", "json schema primary type helper");
assertIncludes(schema, "getInteractionSteps", "wizard steps helper");
assertIncludes(
  schema,
  "extractMcpAskStructuredInputFromResult",
  "MCP structuredContent input extractor",
);
assertIncludes(schema, "resolveSchemaVersion", "schemaVersion inference");

const scopedFiles = [
  "types/intervention.uts",
  "utils/mcpAskSchema.uts",
  "utils/interventionAdapter.uts",
  "utils/mcpAskResumeMessage.uts",
  "utils/mockInterventionData.uts",
  "subpackages/utils/historyMessageAdapter.uts",
  "components/agent-intervention/mcp-ask-question-card/mcp-ask-question-card.uvue",
  "subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts",
  "subpackages/pages/chat-conversation-component/chat-conversation-component.uvue",
];

for (const file of scopedFiles) {
  const source = read(file);
  // 仅支持 nuwax_ask_question，禁止回退 legacy 工具名 / schema 前缀
  for (const legacy of [
    "nuwaclaw.mcp_ask",
    "nuwaclaw.interaction",
    "nuwax_ask_user",
    "nuwaclaw_ask_user",
  ]) {
    assertNotIncludes(source, legacy, file);
  }
}

const adapter = read("utils/interventionAdapter.uts");
for (const needle of [
  "data?.rawInput",
  "data?.raw_input",
  "ext?.rawInput",
  "ext?.raw_input",
  "result?.input",
  "result?.executeId",
  'subType === "tool_call"',
  'subType === "tool_call_update"',
  'messageType === "tool_call"',
  'eventType === "PROCESSING"',
  "extractMcpAskStructuredInputFromResult(result)",
  "parseMcpAskToolInput(rawInput) !== null",
]) {
  assertIncludes(adapter, needle, "SSE adapter");
}

const history = read("subpackages/utils/historyMessageAdapter.uts");
for (const needle of [
  "hydrateMcpAskInteractionsFromExecutedComponents",
  "createMcpAskInteractionFromToolInput",
  "extractMcpAskStructuredInputFromResult",
  "getMcpAskKey",
  "requestId",
  "revision",
  "resolveMcpAskResumeStatus",
  "applyMcpAskResumeStatusesInMessageList",
]) {
  assertIncludes(history, needle, "history hydration");
}

const chatService = read(
  "subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts",
);
for (const needle of [
  "adaptHistoryMessageList(_messageList)",
  "adaptHistoryMessageList(olderMessages)",
  "applyMcpAskResumeStatusesInMessageList",
  "isMcpAskToolCallEvent(chunkAny)",
  "handleMcpAskEvent(mcpInteraction, currentMessageId)",
]) {
  assertIncludes(chatService, needle, "chat service wiring");
}

const conversation = read(
  "subpackages/pages/chat-conversation-component/chat-conversation-component.uvue",
);
for (const needle of [
  "buildMcpAskResumeMessage(interaction, payload)",
  "service.handleSendMessage({ messageInfo: resumeText }, props.isTempChat)",
  "removeMcpAskInteraction(interaction)",
  "class=\"intervention-dock\"",
  "getActiveInterventionQueue",
  "frontInterventionItem",
  "interventionQueueBadge",
]) {
  assertIncludes(conversation, needle, "conversation response wiring");
}

const mcpAskInterventionState = read(
  "subpackages/pages/chat-conversation-component/utils/mcpAskInterventionState.uts",
);
for (const needle of [
  "getActiveInterventionQueue",
  "getVisibleMcpAskInteractions",
  "removeMcpAskInteractionFromMessageList",
  "updateMcpAskInteractionStatusInMessageList",
  "updateAcpPermissionInteractionStatusInMessageList",
  "(item.revision || 1) === revision",
]) {
  assertIncludes(mcpAskInterventionState, needle, "mcp ask state helpers");
}

const reconcileAcp = read("utils/reconcileAcpPermissionStatus.uts");
for (const needle of [
  "reconcileAcpPermissionStatusesInMessageList",
  "isIdempotentAcpPermissionResolveError",
  "reconcileMessageAcpPermissionStatuses",
]) {
  assertIncludes(reconcileAcp, needle, "acp reconcile helpers");
}

const resume = read("utils/mcpAskResumeMessage.uts");
for (const needle of [
  "我已填写「${title}」，表单内容如下：",
  "我取消了「${title}」。",
  "我跳过了「${title}」。",
  "「${title}」已超时，没有收到表单答案。",
  'field.widget === "radio-with-custom"',
  'field.widget === "file"',
  "field.enumValues",
  "field.enumLabels",
  "resolveMcpAskResumeStatus",
  "stripMcpAskResumeDisplayArtifacts",
  "nuwax-mcp-ask-request-id:",
  "textContainsMcpAskRequestIdMarker",
  "appendMcpAskRequestIdMarker",
]) {
  assertIncludes(resume, needle, "resume message");
}

const card = read("components/agent-intervention/mcp-ask-question-card/mcp-ask-question-card.uvue");
for (const needle of [
  "visibleFields",
  "isWizard",
  "handleNext",
  "handleSkip",
  "validateFields",
  "radio-with-custom",
  "field.widget === 'number'",
  "onNumberInput",
  "integerNumberSuffix",
  "field.otherValue",
  "field.otherField",
  "field.multiple",
  "singleFileOnly",
  'answeredBy: { kind: "mobile" }',
]) {
  assertIncludes(card, needle, "MCP Ask card");
}

const mocks = read("utils/mockInterventionData.uts");
for (const needle of [
  "schemaVersion: MCP_ASK_SCHEMA_VERSION",
  "version: INTERACTION_UI_SCHEMA_VERSION",
  "toolName: MCP_ASK_TOOL_NAME",
  "mockMcpAskWizard",
  "allowSkip",
  "radio-with-custom",
]) {
  assertIncludes(mocks, needle, "mock fixtures");
}

console.log("MCP Ask mobile contract verification passed.");
console.log(
  `Contract: ${expectedToolName} / ${expectedAskVersion} / ${expectedUiVersion}`,
);
