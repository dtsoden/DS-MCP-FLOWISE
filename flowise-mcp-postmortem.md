# Flowise MCP Server - AI Error Post-Mortem

## Overview

This document describes a failure that occurred when Claude Desktop attempted to create a Flowise chatflow using the iX-Suite Builder MCP server. The resulting chatflow was corrupted and caused the Flowise UI to crash with JavaScript errors.

This analysis is intended to help improve the MCP server instructions to prevent similar failures by AI assistants in the future.

---

## The Error

When attempting to load the created chatflow, the Flowise UI displayed a blank screen with the following console error:

```
TypeError: j.options is not iterable
    at Qn (DocStoreInputHandler-CuREaikQ.js:209:27672)
```

This error indicates that Flowise expected an `options` array to iterate over, but received `null`, `undefined`, or a non-iterable value.

---

## What Claude Desktop Did (Step by Step)

### Step 1: Read the Usage Guide
Claude correctly called `get_usage_guide` first, which returned comprehensive instructions including warnings about not modifying node structures.

### Step 2: Found a Template
Claude called `list_templates` and `get_template("Tool Agent")` to get a working reference flow.

### Step 3: Retrieved Node Schemas
Claude called `get_node_schema` for each required node:
- `chatOpenAI`
- `googleCalendarTool`
- `requestsGet`
- `retrieverTool`
- `faiss`
- `openAIEmbeddings`
- `bufferMemory`
- `toolAgent`

### Step 4: Built the Flow (WHERE ERRORS OCCURRED)
Despite having the correct schemas and templates, Claude made the following mistakes when constructing the final node objects:

---

## Specific Mistakes Made

### Mistake 1: Missing `id` Fields on `inputParams`

**What Claude did (INCORRECT):**
```json
"inputParams": [
  {
    "name": "modelName",
    "type": "asyncOptions",
    "label": "Model Name",
    "default": "gpt-4o-mini"
  }
]
```

**What the template shows (CORRECT):**
```json
"inputParams": [
  {
    "name": "modelName",
    "type": "asyncOptions",
    "label": "Model Name",
    "default": "gpt-4o-mini",
    "loadMethod": "listModels",
    "id": "chatOpenAI_0-input-modelName-asyncOptions"
  }
]
```

**The Problem:** Every `inputParam` object MUST include an `id` field. Flowise uses these IDs internally for rendering and state management. The format is: `{nodeId}-input-{paramName}-{paramType}`

---

### Mistake 2: Malformed `options` and `multiOptions` Fields

For the Google Calendar node, Claude attempted to set values for `multiOptions` fields:

**What Claude did (INCORRECT):**
```json
"inputs": {
  "eventActions": ["listEvents", "createEvent", "getEvent", "quickAddEvent"],
  "calendarActions": ["listCalendars"],
  "freebusyActions": ["queryFreebusy"],
  "calendarType": "event"
}
```

But the corresponding `inputParams` did not include the `options` arrays:

```json
"inputParams": [
  {
    "name": "eventActions",
    "type": "multiOptions",
    "label": "Event Actions"
    // MISSING: "options" array
    // MISSING: "id" field
  }
]
```

**The Problem:** When a field has `type: "options"` or `type: "multiOptions"`, Flowise iterates over the `options` array to render the dropdown/multi-select UI. If `options` is missing or malformed, the iteration fails with `TypeError: j.options is not iterable`.

**What it should have been (CORRECT):**
```json
"inputParams": [
  {
    "name": "eventActions",
    "type": "multiOptions",
    "label": "Event Actions",
    "id": "googleCalendarTool_0-input-eventActions-multiOptions",
    "options": [
      {"label": "List Events", "name": "listEvents"},
      {"label": "Create Event", "name": "createEvent"},
      {"label": "Get Event", "name": "getEvent"},
      {"label": "Update Event", "name": "updateEvent"},
      {"label": "Delete Event", "name": "deleteEvent"},
      {"label": "Quick Add Event", "name": "quickAddEvent"}
    ]
  }
]
```

---

### Mistake 3: "Simplifying" Node Structures

The usage guide explicitly states:

> "NEVER modify, simplify, reorganize, or omit ANY part of a node structure from get_node_schema"

However, Claude took the detailed output from `get_node_schema` and attempted to create a "minimal" or "clean" version of the nodes, removing fields that appeared optional or unnecessary. This violated the core rule of the MCP server.

---

### Mistake 4: Not Using Template Structures Verbatim

The templates returned by `get_template` contain fully working node definitions. Claude should have:
1. Copied the node structure exactly from a template
2. Only modified the `inputs` values and `id` fields

Instead, Claude attempted to construct nodes from scratch using the schema as a "guide" rather than as a literal template.

---

## The Fix That Worked

The second attempt succeeded by:

1. Copying node structures more closely from the working template
2. Including proper `id` fields on all `inputParams` and `inputAnchors`
3. Leaving complex fields like `multiOptions` empty (so users can configure via UI)
4. Not attempting to populate the Google Calendar options programmatically

---

## Recommendations for MCP Server Instructions

Add the following rules to the usage guide or as a separate validation layer:

### Rule 1: Mandatory `id` Fields

```markdown
## MANDATORY: inputParams ID Fields

Every object in the `inputParams` array MUST include an `id` field.

Format: `{nodeId}-input-{paramName}-{paramType}`

Example for node `chatOpenAI_0`:
- `chatOpenAI_0-input-modelName-asyncOptions`
- `chatOpenAI_0-input-temperature-number`
- `chatOpenAI_0-input-credential-credential`

Similarly, every `inputAnchors` object must have an `id`:
- `chatOpenAI_0-input-cache-BaseCache`

And every `outputAnchors` object must have an `id`:
- `chatOpenAI_0-output-chatOpenAI-ChatOpenAI|BaseChatModel|BaseLanguageModel|Runnable`
```

### Rule 2: Options Fields Must Include Options Array

```markdown
## MANDATORY: Options Arrays for Dropdown Fields

If an `inputParam` has `type: "options"` or `type: "multiOptions"`, the `options` 
array MUST be included in that inputParam object.

WRONG - Will crash Flowise:
{
  "name": "calendarType",
  "type": "options",
  "label": "Type"
}

CORRECT:
{
  "name": "calendarType",
  "type": "options",
  "label": "Type",
  "id": "googleCalendarTool_0-input-calendarType-options",
  "options": [
    {"label": "Event", "name": "event"},
    {"label": "Calendar", "name": "calendar"},
    {"label": "Freebusy", "name": "freebusy"}
  ]
}

If you don't have the options array, leave the field out of inputs entirely 
and let users configure via the Flowise UI.
```

### Rule 3: Copy, Don't Construct

```markdown
## MANDATORY: Copy Template Structures Exactly

When building nodes:

1. FIRST: Get a working template via `get_template` that uses similar nodes
2. COPY the entire node object structure from the template
3. ONLY MODIFY:
   - The `id` fields (update to your new node IDs)
   - The `inputs` object values (your actual configuration)
   - References in `inputs` like `{{otherNode.data.instance}}`

DO NOT:
- Remove fields that seem "unnecessary"
- Simplify the structure
- Omit inputParams, inputAnchors, or outputAnchors
- Construct nodes from scratch based on get_node_schema
```

### Rule 4: When In Doubt, Leave Empty

```markdown
## RECOMMENDED: Leave Complex Fields Empty

For these field types, it is safer to leave them empty/unconfigured and let 
users set them in the Flowise UI:

- `multiOptions` fields (like Google Calendar actions)
- `credential` fields (always require UI configuration anyway)
- `asyncOptions` fields with `loadMethod` (values loaded dynamically)
- `code` fields (complex JavaScript/TypeScript)
- `json` fields (complex objects)

Example - Safe approach for Google Calendar:
{
  "inputs": {}  // Leave empty, user configures in UI
}

This prevents malformed data from corrupting the chatflow.
```

### Rule 5: Validate Before Create

```markdown
## MANDATORY: Always Validate First

ALWAYS call `validate_flow` before `flowise_create_chatflow`.

However, note that `validate_flow` may not catch all UI rendering issues 
(like missing options arrays). It primarily validates:
- Node existence
- Edge connections
- Basic structure

It does NOT validate:
- inputParams completeness
- options array presence
- id field format correctness

Therefore, validation passing does not guarantee the flow will render correctly.
```

---

## Suggested MCP Server Enhancements

### Enhancement 1: Add inputParams Validation

The `validate_flow` function should check that:
- Every `inputParams` object has an `id` field
- Every `inputParams` with `type: "options"` or `type: "multiOptions"` has an `options` array
- All `id` fields follow the correct format

### Enhancement 2: Provide Complete Node Templates

Instead of just returning the schema from `get_node_schema`, consider returning a complete, ready-to-use node template with all fields populated correctly. The AI would only need to:
- Update the node ID
- Update the `inputs` values

### Enhancement 3: Add a "Safe Mode" for Complex Nodes

For nodes with complex fields like Google Calendar, provide a "minimal safe" version that omits the problematic multiOptions fields entirely, allowing users to configure them in the UI.

### Enhancement 4: Stricter Error Messages

When `flowise_create_chatflow` receives malformed data, provide specific error messages like:
- "Node googleCalendarTool_0: inputParam 'eventActions' has type 'multiOptions' but no 'options' array"
- "Node chatOpenAI_0: inputParam 'modelName' is missing required 'id' field"

---

## Summary

The root cause of this failure was Claude Desktop not copying node structures exactly as specified, despite having access to both the usage guide (which warned against this) and working templates (which showed the correct format).

The specific technical issue was missing `id` fields on `inputParams` and missing `options` arrays on `multiOptions` type fields, which caused Flowise to crash when attempting to render the node configuration UI.

The solution is to:
1. Strengthen the MCP server instructions with explicit rules about these requirements
2. Add validation for these specific issues in the `validate_flow` function
3. Consider providing complete node templates rather than just schemas
