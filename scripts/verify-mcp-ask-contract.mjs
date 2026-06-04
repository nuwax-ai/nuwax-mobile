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
  `toolName !== "${expectedToolName}"`,
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
assertIncludes(
  schema,
  'explicitWidget === "radio-with-custom"',
  "radio-with-custom widget",
);
assertIncludes(schema, 'explicitWidget === "file"', "file widget");
assertIncludes(schema, 'return "checkboxes"', "checkbox widget inference");
assertIncludes(schema, 'return "textarea"', "textarea widget inference");
assertIncludes(schema, "getInteractionSteps", "wizard steps helper");

const scopedFiles = [
  "types/intervention.uts",
  "utils/mcpAskSchema.uts",
  "utils/interventionAdapter.uts",
  "utils/mcpAskResumeMessage.uts",
  "utils/mockInterventionData.uts",
  "subpackages/utils/historyMessageAdapter.uts",
  "components/mcp-ask-card/mcp-ask-card.uvue",
  "subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts",
  "subpackages/pages/chat-conversation-component/chat-conversation-component.uvue",
];

for (const file of scopedFiles) {
  const source = read(file);
  assertNotIncludes(source, "nuwaclaw.mcp_ask", file);
  assertNotIncludes(source, "nuwaclaw.interaction", file);
  assertNotIncludes(source, "nuwax_ask_user", file);
  assertNotIncludes(source, "nuwaclaw_ask_user", file);
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
  "parseMcpAskToolInput(rawInput) !== null",
]) {
  assertIncludes(adapter, needle, "SSE adapter");
}

const history = read("subpackages/utils/historyMessageAdapter.uts");
for (const needle of [
  "hydrateMcpAskInteractionsFromExecutedComponents",
  "createMcpAskInteractionFromToolInput",
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
  "(item.revision || 1) === revision",
]) {
  assertIncludes(conversation, needle, "conversation response wiring");
}

const resume = read("utils/mcpAskResumeMessage.uts");
for (const needle of [
  "我已填写「${title}」，表单内容如下：",
  "我取消了「${title}」。",
  "我跳过了「${title}」。",
  "「${title}」已超时，没有收到表单答案。",
  'field.widget === "radio-with-custom"',
  "field.enumValues",
  "field.enumLabels",
  "resolveMcpAskResumeStatus",
]) {
  assertIncludes(resume, needle, "resume message");
}

const card = read("components/mcp-ask-card/mcp-ask-card.uvue");
for (const needle of [
  "visibleFields",
  "isWizard",
  "handleNext",
  "handleSkip",
  "validateFields",
  "radio-with-custom",
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
  `schemaVersion: "${expectedAskVersion}"`,
  `version: "${expectedUiVersion}"`,
  `toolName: "${expectedToolName}"`,
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
