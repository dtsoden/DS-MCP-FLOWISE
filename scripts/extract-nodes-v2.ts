/**
 * Extract node definitions from Flowise source code - V2
 * Uses proper bracket matching for nested structures
 * Updated to capture ALL fields from INodeProperties, INodeParams, INodeOutputsValue, INodeOptionsValue
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import initSqlJs from 'sql.js';
import type { Database } from 'sql.js';

const FLOWISE_SOURCE = path.join(process.cwd(), 'flowise-source');
const NODES_PATH = path.join(FLOWISE_SOURCE, 'packages', 'components', 'nodes');
const MARKETPLACE_PATH = path.join(FLOWISE_SOURCE, 'packages', 'server', 'marketplaces');
const DB_PATH = path.join(process.cwd(), 'data', 'flowise.db');

// ============================================================================
// COMMENT STRIPPING
// ============================================================================

/**
 * Strip block comments from content while preserving string literals
 * This prevents parsing options/inputs that are commented out
 */
function stripBlockComments(content: string): string {
  let result = '';
  let i = 0;

  while (i < content.length) {
    // Check for string literals - preserve them as-is
    if (content[i] === '"' || content[i] === "'" || content[i] === '`') {
      const quote = content[i];
      result += content[i];
      i++;
      while (i < content.length && content[i] !== quote) {
        if (content[i] === '\\') {
          result += content[i];
          i++;
        }
        if (i < content.length) {
          result += content[i];
          i++;
        }
      }
      if (i < content.length) {
        result += content[i];
        i++;
      }
    }
    // Check for block comment start
    else if (content[i] === '/' && content[i + 1] === '*') {
      // Skip until we find */
      i += 2;
      while (i < content.length - 1 && !(content[i] === '*' && content[i + 1] === '/')) {
        i++;
      }
      i += 2; // Skip the closing */
    }
    // Check for single-line comment
    else if (content[i] === '/' && content[i + 1] === '/') {
      // Skip until end of line
      while (i < content.length && content[i] !== '\n') {
        i++;
      }
    }
    else {
      result += content[i];
      i++;
    }
  }

  return result;
}

// ============================================================================
// BRACKET MATCHING UTILITIES
// ============================================================================

/**
 * Find matching closing bracket, handling nested brackets
 */
function findMatchingBracket(content: string, startPos: number, openChar: string, closeChar: string): number {
  let depth = 1;
  let pos = startPos;

  while (pos < content.length && depth > 0) {
    const char = content[pos];

    // Skip string literals
    if (char === "'" || char === '"' || char === '`') {
      const quote = char;
      pos++;
      while (pos < content.length && content[pos] !== quote) {
        if (content[pos] === '\\') pos++; // Skip escaped chars
        pos++;
      }
    } else if (char === openChar) {
      depth++;
    } else if (char === closeChar) {
      depth--;
    }
    pos++;
  }

  return depth === 0 ? pos - 1 : -1;
}

/**
 * Extract array content between [ and ]
 */
function extractArrayContent(content: string, startPos: number): { content: string; endPos: number } | null {
  const openPos = content.indexOf('[', startPos);
  if (openPos === -1) return null;

  const closePos = findMatchingBracket(content, openPos + 1, '[', ']');
  if (closePos === -1) return null;

  return {
    content: content.substring(openPos + 1, closePos),
    endPos: closePos
  };
}

/**
 * Extract object content between { and }
 */
function extractObjectContent(content: string, startPos: number): { content: string; endPos: number } | null {
  const openPos = content.indexOf('{', startPos);
  if (openPos === -1) return null;

  const closePos = findMatchingBracket(content, openPos + 1, '{', '}');
  if (closePos === -1) return null;

  return {
    content: content.substring(openPos + 1, closePos),
    endPos: closePos
  };
}

/**
 * Split array into top-level objects (handles nested structures)
 */
function splitArrayIntoObjects(arrayContent: string): string[] {
  const objects: string[] = [];
  let pos = 0;

  while (pos < arrayContent.length) {
    // Find next object start
    const objStart = arrayContent.indexOf('{', pos);
    if (objStart === -1) break;

    const closePos = findMatchingBracket(arrayContent, objStart + 1, '{', '}');
    if (closePos === -1) break;

    objects.push(arrayContent.substring(objStart, closePos + 1));
    pos = closePos + 1;
  }

  return objects;
}

// ============================================================================
// VALUE EXTRACTION UTILITIES
// ============================================================================

function extractStringValue(content: string, propertyName: string): string | null {
  // Match: propertyName: 'value' or propertyName: "value" or propertyName: `value`
  const pattern = new RegExp(`(?:this\\.)?${propertyName}\\s*[:=]\\s*['"\`]([^'"\`]+)['"\`]`);
  const match = content.match(pattern);
  return match ? match[1] : null;
}

function extractBooleanValue(content: string, propertyName: string): boolean | null {
  const pattern = new RegExp(`(?:this\\.)?${propertyName}\\s*[:=]\\s*(true|false)`);
  const match = content.match(pattern);
  return match ? match[1] === 'true' : null;
}

function extractNumberValue(content: string, propertyName: string): number | null {
  const pattern = new RegExp(`(?:this\\.)?${propertyName}\\s*[:=]\\s*([\\d.]+)`);
  const match = content.match(pattern);
  return match ? parseFloat(match[1]) : null;
}

/**
 * Extract codeExample which might be a string literal or a variable reference
 * If it's a variable reference, resolve it from the file content
 */
function extractCodeExample(objContent: string, fileContent: string): string | null {
  // First try string literal
  const stringValue = extractStringValue(objContent, 'codeExample');
  if (stringValue) return stringValue;

  // Check if it's a variable reference (codeExample: variableName)
  const varRefPattern = /codeExample\s*:\s*([a-zA-Z_][a-zA-Z0-9_]*)/;
  const varMatch = objContent.match(varRefPattern);
  if (!varMatch) return null;

  const varName = varMatch[1];

  // Find the const/let declaration in the file
  // Handle template literals which can span multiple lines
  const templatePattern = new RegExp(`const\\s+${varName}\\s*=\\s*\`([\\s\\S]*?)\``, 'm');
  const templateMatch = fileContent.match(templatePattern);
  if (templateMatch) return templateMatch[1];

  // Handle regular string literals
  const stringPattern = new RegExp(`const\\s+${varName}\\s*=\\s*['"]([^'"]+)['"]`);
  const strMatch = fileContent.match(stringPattern);
  if (strMatch) return strMatch[1];

  return null;
}

function extractShowHideCondition(content: string, propertyName: string): Record<string, any> | null {
  // Match: show: { ... } or hide: { ... }
  const pattern = new RegExp(`${propertyName}\\s*:\\s*\\{`);
  const match = content.match(pattern);
  if (!match) return null;

  const startPos = match.index! + match[0].length - 1;
  const result = extractObjectContent(content, startPos);
  if (!result) return null;

  // Parse the object content
  const obj: Record<string, any> = {};
  const propPattern = /['"`]?(\w+(?:\[\$index\]\.\w+)?)['"`]?\s*:\s*(['"`]([^'"`]+)['"`]|\[([^\]]+)\]|(true|false))/g;
  let propMatch;

  while ((propMatch = propPattern.exec(result.content)) !== null) {
    const key = propMatch[1];
    if (propMatch[3]) {
      // String value
      obj[key] = propMatch[3];
    } else if (propMatch[4]) {
      // Array value
      const items = propMatch[4].match(/['"`]([^'"`]+)['"`]/g);
      obj[key] = items ? items.map(s => s.replace(/['"`]/g, '')) : [];
    } else if (propMatch[5]) {
      // Boolean value
      obj[key] = propMatch[5] === 'true';
    }
  }

  return Object.keys(obj).length > 0 ? obj : null;
}

/**
 * Extract hint object or string
 */
function extractHint(content: string): any | null {
  // Check for hint object: hint: { label: '...', value: '...' }
  const objMatch = content.match(/\bhint\s*:\s*\{/);
  if (objMatch) {
    const result = extractObjectContent(content, objMatch.index!);
    if (result) {
      const label = extractStringValue(result.content, 'label');
      const value = extractStringValue(result.content, 'value');
      if (label || value) {
        return { label, value };
      }
    }
  }
  return null;
}

/**
 * Extract datagrid array
 */
function extractDatagrid(content: string): any[] | null {
  const datagridMatch = content.match(/\bdatagrid\s*:\s*\[/);
  if (datagridMatch) {
    const result = extractArrayContent(content, datagridMatch.index!);
    if (result) {
      // Return the raw content for storage as JSON
      return splitArrayIntoObjects(result.content).map(obj => {
        const parsed: any = {};
        parsed.field = extractStringValue(obj, 'field');
        parsed.headerName = extractStringValue(obj, 'headerName');
        parsed.type = extractStringValue(obj, 'type');
        parsed.flex = extractNumberValue(obj, 'flex');
        parsed.editable = extractBooleanValue(obj, 'editable');
        const loadMethod = extractStringValue(obj, 'loadMethod');
        if (loadMethod) parsed.loadMethod = loadMethod;
        return parsed;
      });
    }
  }
  return null;
}

// ============================================================================
// INPUT PARSING
// ============================================================================

interface ParsedInput {
  label: string;
  name: string;
  type: string;
  description?: string;
  placeholder?: string;
  rows?: number;
  step?: number;
  warning?: string;
  default?: any;
  optional?: boolean;
  additionalParams?: boolean;
  hidden?: boolean;
  loadMethod?: string;
  loadConfig?: boolean;
  loadPreviousNodes?: boolean;
  acceptVariable?: boolean;
  acceptNodeOutputAsVariable?: boolean;
  refresh?: boolean;
  freeSolo?: boolean;
  list?: boolean;
  fileType?: string;
  codeExample?: string;
  hideCodeExecute?: boolean;
  generateInstruction?: boolean;
  generateDocStoreDescription?: boolean;
  hint?: any;
  tabIdentifier?: string;
  datagrid?: any[];
  show?: Record<string, any>;
  hide?: Record<string, any>;
  options?: Array<{ label: string; name: string; description?: string; imageSrc?: string }>;
  array?: ParsedInput[];
  tabs?: ParsedInput[];
  credentialNames?: string[];
}

function parseInputObject(objContent: string, fileContent?: string): ParsedInput | null {
  const input: ParsedInput = {
    label: '',
    name: '',
    type: ''
  };

  // Required fields
  input.label = extractStringValue(objContent, 'label') || '';
  input.name = extractStringValue(objContent, 'name') || '';
  input.type = extractStringValue(objContent, 'type') || '';

  if (!input.name || !input.type) return null;

  // Optional string fields
  const desc = extractStringValue(objContent, 'description');
  if (desc) input.description = desc;

  const placeholder = extractStringValue(objContent, 'placeholder');
  if (placeholder) input.placeholder = placeholder;

  const loadMethod = extractStringValue(objContent, 'loadMethod');
  if (loadMethod) input.loadMethod = loadMethod;

  const warning = extractStringValue(objContent, 'warning');
  if (warning) input.warning = warning;

  const fileType = extractStringValue(objContent, 'fileType');
  if (fileType) input.fileType = fileType;

  // codeExample can be a string literal or a variable reference
  const codeExample = fileContent
    ? extractCodeExample(objContent, fileContent)
    : extractStringValue(objContent, 'codeExample');
  if (codeExample) input.codeExample = codeExample;

  const tabIdentifier = extractStringValue(objContent, 'tabIdentifier');
  if (tabIdentifier) input.tabIdentifier = tabIdentifier;

  // Number fields
  const rows = extractNumberValue(objContent, 'rows');
  if (rows) input.rows = rows;

  const step = extractNumberValue(objContent, 'step');
  if (step !== null) input.step = step;

  // Boolean fields
  const optional = extractBooleanValue(objContent, 'optional');
  if (optional !== null) input.optional = optional;

  const additionalParams = extractBooleanValue(objContent, 'additionalParams');
  if (additionalParams !== null) input.additionalParams = additionalParams;

  const hidden = extractBooleanValue(objContent, 'hidden');
  if (hidden !== null) input.hidden = hidden;

  const loadConfig = extractBooleanValue(objContent, 'loadConfig');
  if (loadConfig !== null) input.loadConfig = loadConfig;

  const loadPreviousNodes = extractBooleanValue(objContent, 'loadPreviousNodes');
  if (loadPreviousNodes !== null) input.loadPreviousNodes = loadPreviousNodes;

  const acceptVariable = extractBooleanValue(objContent, 'acceptVariable');
  if (acceptVariable !== null) input.acceptVariable = acceptVariable;

  const acceptNodeOutput = extractBooleanValue(objContent, 'acceptNodeOutputAsVariable');
  if (acceptNodeOutput !== null) input.acceptNodeOutputAsVariable = acceptNodeOutput;

  const refresh = extractBooleanValue(objContent, 'refresh');
  if (refresh !== null) input.refresh = refresh;

  const freeSolo = extractBooleanValue(objContent, 'freeSolo');
  if (freeSolo !== null) input.freeSolo = freeSolo;

  const list = extractBooleanValue(objContent, 'list');
  if (list !== null) input.list = list;

  const generateInstruction = extractBooleanValue(objContent, 'generateInstruction');
  if (generateInstruction !== null) input.generateInstruction = generateInstruction;

  const generateDocStore = extractBooleanValue(objContent, 'generateDocStoreDescription');
  if (generateDocStore !== null) input.generateDocStoreDescription = generateDocStore;

  const hideCodeExecute = extractBooleanValue(objContent, 'hideCodeExecute');
  if (hideCodeExecute !== null) input.hideCodeExecute = hideCodeExecute;

  // Default value (can be string, number, or boolean)
  const defaultStr = extractStringValue(objContent, 'default');
  const defaultBool = extractBooleanValue(objContent, 'default');
  const defaultNum = extractNumberValue(objContent, 'default');

  if (defaultBool !== null) input.default = defaultBool;
  else if (defaultStr) input.default = defaultStr;
  else if (defaultNum !== null) input.default = defaultNum;

  // Show/hide conditions
  const show = extractShowHideCondition(objContent, 'show');
  if (show) input.show = show;

  const hide = extractShowHideCondition(objContent, 'hide');
  if (hide) input.hide = hide;

  // Hint (can be object with label/value)
  const hint = extractHint(objContent);
  if (hint) input.hint = hint;

  // Datagrid (for datagrid type inputs)
  if (input.type === 'datagrid') {
    const datagrid = extractDatagrid(objContent);
    if (datagrid) input.datagrid = datagrid;
  }

  // Tabs (for tabs type inputs)
  const tabsMatch = objContent.match(/\btabs\s*:\s*\[/);
  if (tabsMatch && input.type === 'tabs') {
    const tabsResult = extractArrayContent(objContent, tabsMatch.index!);
    if (tabsResult) {
      const tabObjects = splitArrayIntoObjects(tabsResult.content);
      input.tabs = tabObjects
        .map(obj => parseInputObject(obj))
        .filter((i): i is ParsedInput => i !== null);
    }
  }

  // Nested array inputs (for type: 'array')
  const arrayMatch = objContent.match(/\barray\s*:\s*\[/);
  if (arrayMatch && input.type === 'array') {
    const arrayResult = extractArrayContent(objContent, arrayMatch.index!);
    if (arrayResult) {
      const nestedObjects = splitArrayIntoObjects(arrayResult.content);
      input.array = nestedObjects
        .map(obj => parseInputObject(obj))
        .filter((i): i is ParsedInput => i !== null);
    }

    // For array-type inputs, clear properties that were incorrectly extracted
    // from nested children (since regex matches anywhere in the content)
    delete input.rows;
    delete input.placeholder;
    delete input.generateInstruction;
    delete input.generateDocStoreDescription;
    delete input.hideCodeExecute;
  }

  // Options array - only for non-array and non-tabs types
  const optionsMatch = objContent.match(/options\s*:\s*\[/);
  if (optionsMatch && input.type !== 'array' && input.type !== 'tabs') {
    const optionsResult = extractArrayContent(objContent, optionsMatch.index!);
    if (optionsResult) {
      const optionObjects = splitArrayIntoObjects(optionsResult.content);
      input.options = optionObjects.map(opt => ({
        label: extractStringValue(opt, 'label') || '',
        name: extractStringValue(opt, 'name') || '',
        description: extractStringValue(opt, 'description') || undefined,
        imageSrc: extractStringValue(opt, 'imageSrc') || undefined
      })).filter(o => o.label && o.name);
    }
  }

  // Credential names
  const credMatch = objContent.match(/credentialNames\s*:\s*\[/);
  if (credMatch) {
    const credResult = extractArrayContent(objContent, credMatch.index!);
    if (credResult) {
      const names = credResult.content.match(/['"`]([^'"`]+)['"`]/g);
      if (names) {
        input.credentialNames = names.map(n => n.replace(/['"`]/g, ''));
      }
    }
  }

  return input;
}

// ============================================================================
// OUTPUT PARSING
// ============================================================================

interface ParsedOutput {
  name: string;
  label: string;
  baseClasses?: string[];
  description?: string;
  hidden?: boolean;
  isAnchor?: boolean;
}

function parseOutputObject(objContent: string): ParsedOutput | null {
  const output: ParsedOutput = {
    name: extractStringValue(objContent, 'name') || '',
    label: extractStringValue(objContent, 'label') || ''
  };

  if (!output.name || !output.label) return null;

  const description = extractStringValue(objContent, 'description');
  if (description) output.description = description;

  const hidden = extractBooleanValue(objContent, 'hidden');
  if (hidden !== null) output.hidden = hidden;

  const isAnchor = extractBooleanValue(objContent, 'isAnchor');
  if (isAnchor !== null) output.isAnchor = isAnchor;

  // Base classes for this specific output
  const baseClassMatch = objContent.match(/baseClasses\s*:\s*\[/);
  if (baseClassMatch) {
    const result = extractArrayContent(objContent, baseClassMatch.index!);
    if (result) {
      // Handle this.type references and string literals
      const classes: string[] = [];
      if (result.content.includes('this.type')) {
        // Will be resolved at node level
        classes.push('__THIS_TYPE__');
      }
      const strMatches = result.content.match(/['"`]([^'"`]+)['"`]/g);
      if (strMatches) {
        classes.push(...strMatches.map(s => s.replace(/['"`]/g, '')));
      }
      // Check for ...getBaseClasses(...) pattern
      if (result.content.includes('getBaseClasses')) {
        classes.push('__GET_BASE_CLASSES__');
      }
      if (classes.length > 0) {
        output.baseClasses = classes;
      }
    }
  }

  return output;
}

// ============================================================================
// NODE PARSING
// ============================================================================

interface ParsedNode {
  name: string;
  label: string;
  version: number;
  type: string;
  icon: string;
  category: string;
  description: string;
  baseClasses: string[];
  filePath: string;
  // Display properties
  color?: string;
  hideInput?: boolean;
  hideOutput?: boolean;
  hint?: string;
  documentation?: string;
  // Metadata (NEW)
  tags?: string[];
  badge?: string;
  deprecateMessage?: string;
  author?: string;
  warning?: string;
  // Relations
  inputs: ParsedInput[];
  outputs: ParsedOutput[];
  credential?: {
    label: string;
    name: string;
    type: string;
    credentialNames?: string[];
  };
}

function parseNodeFile(filePath: string): ParsedNode | null {
  try {
    const rawContent = fs.readFileSync(filePath, 'utf-8');

    // Check if this is a node class
    if (!rawContent.includes('implements INode')) {
      return null;
    }

    // Strip block comments to prevent parsing commented-out options/inputs
    const content = stripBlockComments(rawContent);

    // Extract basic properties
    const name = extractStringValue(content, 'this.name');
    const label = extractStringValue(content, 'this.label');

    if (!name || !label) return null;

    const node: ParsedNode = {
      name,
      label,
      version: extractNumberValue(content, 'this.version') || 1,
      type: extractStringValue(content, 'this.type') || name,
      icon: extractStringValue(content, 'this.icon') || '',
      category: extractStringValue(content, 'this.category') || 'Unknown',
      description: extractStringValue(content, 'this.description') || '',
      baseClasses: [],
      filePath: path.relative(process.cwd(), filePath),
      inputs: [],
      outputs: []
    };

    // Display properties
    const color = extractStringValue(content, 'this.color');
    if (color) node.color = color;

    if (content.includes('this.hideInput = true')) node.hideInput = true;
    if (content.includes('this.hideOutput = true')) node.hideOutput = true;

    const hint = extractStringValue(content, 'this.hint');
    if (hint) node.hint = hint;

    const documentation = extractStringValue(content, 'this.documentation');
    if (documentation) node.documentation = documentation;

    // Metadata (NEW fields)
    const badge = extractStringValue(content, 'this.badge');
    if (badge) node.badge = badge;

    const deprecateMessage = extractStringValue(content, 'this.deprecateMessage');
    if (deprecateMessage) node.deprecateMessage = deprecateMessage;

    const author = extractStringValue(content, 'this.author');
    if (author) node.author = author;

    const warning = extractStringValue(content, 'this.warning');
    if (warning) node.warning = warning;

    // Tags array
    const tagsMatch = content.match(/this\.tags\s*=\s*\[/);
    if (tagsMatch) {
      const result = extractArrayContent(content, tagsMatch.index!);
      if (result) {
        const tagMatches = result.content.match(/['"`]([^'"`]+)['"`]/g);
        if (tagMatches) {
          node.tags = tagMatches.map(s => s.replace(/['"`]/g, ''));
        }
      }
    }

    // Base classes
    const baseClassMatch = content.match(/this\.baseClasses\s*=\s*\[/);
    if (baseClassMatch) {
      const result = extractArrayContent(content, baseClassMatch.index!);
      if (result) {
        if (result.content.includes('this.type')) {
          node.baseClasses.push(node.type);
        }
        const strMatches = result.content.match(/['"`]([^'"`]+)['"`]/g);
        if (strMatches) {
          node.baseClasses.push(...strMatches.map(s => s.replace(/['"`]/g, '')));
        }
      }
    }
    if (node.baseClasses.length === 0) {
      node.baseClasses = [node.type];
    }

    // Parse inputs
    const inputsMatch = content.match(/this\.inputs\s*=\s*\[/);
    if (inputsMatch) {
      const result = extractArrayContent(content, inputsMatch.index!);
      if (result) {
        const inputObjects = splitArrayIntoObjects(result.content);
        node.inputs = inputObjects
          .map(obj => parseInputObject(obj, content))
          .filter((i): i is ParsedInput => i !== null);
      }
    }

    // Parse outputs (NEW - proper output parsing)
    const outputsMatch = content.match(/this\.outputs\s*=\s*\[/);
    if (outputsMatch) {
      const result = extractArrayContent(content, outputsMatch.index!);
      if (result) {
        const outputObjects = splitArrayIntoObjects(result.content);
        node.outputs = outputObjects
          .map(obj => {
            const parsed = parseOutputObject(obj);
            if (parsed && parsed.baseClasses) {
              // Resolve __THIS_TYPE__ placeholder
              parsed.baseClasses = parsed.baseClasses.map(c =>
                c === '__THIS_TYPE__' ? node.type : c
              ).filter(c => c !== '__GET_BASE_CLASSES__');
              // Add baseClasses from getBaseClasses if referenced
              if (parsed.baseClasses.includes('__GET_BASE_CLASSES__')) {
                parsed.baseClasses = parsed.baseClasses.filter(c => c !== '__GET_BASE_CLASSES__');
              }
            }
            return parsed;
          })
          .filter((o): o is ParsedOutput => o !== null);
      }
    }

    // If no outputs defined, create default output
    if (node.outputs.length === 0) {
      node.outputs.push({
        name: node.name,
        label: node.label,
        baseClasses: node.baseClasses
      });
    }

    // Parse credential
    const credMatch = content.match(/this\.credential\s*=\s*\{/);
    if (credMatch) {
      const result = extractObjectContent(content, credMatch.index!);
      if (result) {
        node.credential = {
          label: extractStringValue(result.content, 'label') || 'Connect Credential',
          name: extractStringValue(result.content, 'name') || 'credential',
          type: extractStringValue(result.content, 'type') || 'credential'
        };

        const credNames = result.content.match(/credentialNames\s*:\s*\[/);
        if (credNames) {
          const namesResult = extractArrayContent(result.content, credNames.index!);
          if (namesResult) {
            const names = namesResult.content.match(/['"`]([^'"`]+)['"`]/g);
            if (names) {
              node.credential.credentialNames = names.map(n => n.replace(/['"`]/g, ''));
            }
          }
        }
      }
    }

    return node;
  } catch (error) {
    console.error(`Error parsing ${filePath}:`, error);
    return null;
  }
}

// ============================================================================
// DATABASE POPULATION
// ============================================================================

async function createDatabase(): Promise<Database> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  const schema = fs.readFileSync(path.join(process.cwd(), 'scripts', 'schema.sql'), 'utf-8');
  db.run(schema);

  return db;
}

function insertNode(db: Database, node: ParsedNode): void {
  const isAgentflow = node.category === 'Agent Flows' ? 1 : 0;

  db.run(`
    INSERT INTO nodes (
      name, label, version, type, icon, category, description, base_classes, file_path, is_agentflow,
      color, hide_input, hide_output, hint, documentation,
      tags, badge, deprecate_message, author, warning
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    node.name,
    node.label,
    node.version,
    node.type,
    node.icon,
    node.category,
    node.description,
    JSON.stringify(node.baseClasses),
    node.filePath,
    isAgentflow,
    node.color || null,
    node.hideInput ? 1 : 0,
    node.hideOutput ? 1 : 0,
    node.hint || null,
    node.documentation || null,
    node.tags ? JSON.stringify(node.tags) : null,
    node.badge || null,
    node.deprecateMessage || null,
    node.author || null,
    node.warning || null
  ]);

  // Insert credential
  if (node.credential) {
    db.run(`
      INSERT INTO node_credentials (node_name, label, name, type, credential_names)
      VALUES (?, ?, ?, ?, ?)
    `, [
      node.name,
      node.credential.label,
      node.credential.name,
      node.credential.type,
      node.credential.credentialNames ? JSON.stringify(node.credential.credentialNames) : null
    ]);
  }

  // Insert outputs (NEW - proper output handling)
  let outputSort = 0;
  for (const output of node.outputs) {
    db.run(`
      INSERT INTO node_outputs (node_name, output_name, output_label, output_type, base_classes, description, is_hidden, is_anchor, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      node.name,
      output.name,
      output.label,
      isAgentflow ? null : (output.baseClasses ? output.baseClasses.join('|') : node.baseClasses.join('|')),
      output.baseClasses ? JSON.stringify(output.baseClasses) : JSON.stringify(node.baseClasses),
      output.description || null,
      output.hidden ? 1 : 0,
      output.isAnchor ? 1 : 0,
      outputSort++
    ]);
  }

  // Insert inputs (with nested array and tabs support)
  function insertInputs(inputs: ParsedInput[], parentId: number | null, sortStart: number): void {
    let sortOrder = sortStart;

    for (const input of inputs) {
      db.run(`
        INSERT INTO node_inputs (
          node_name, parent_id, input_name, input_label, input_type,
          description, placeholder, rows, warning, default_value, is_optional, is_additional_params, is_hidden,
          load_method, load_config, load_previous_nodes, accept_variable, accept_node_output,
          refresh, free_solo, is_list, step, file_type, code_example, hide_code_execute,
          generate_instruction, generate_doc_store_desc, hint, tab_identifier, datagrid,
          show_condition, hide_condition, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        node.name,
        parentId,
        input.name,
        input.label,
        input.type,
        input.description || null,
        input.placeholder || null,
        input.rows || null,
        input.warning || null,
        input.default !== undefined ? String(input.default) : null,
        input.optional ? 1 : 0,
        input.additionalParams ? 1 : 0,
        input.hidden ? 1 : 0,
        input.loadMethod || null,
        input.loadConfig ? 1 : 0,
        input.loadPreviousNodes ? 1 : 0,
        input.acceptVariable ? 1 : 0,
        input.acceptNodeOutputAsVariable ? 1 : 0,
        input.refresh ? 1 : 0,
        input.freeSolo ? 1 : 0,
        input.list ? 1 : 0,
        input.step !== undefined ? input.step : null,
        input.fileType || null,
        input.codeExample || null,
        input.hideCodeExecute ? 1 : 0,
        input.generateInstruction ? 1 : 0,
        input.generateDocStoreDescription ? 1 : 0,
        input.hint ? JSON.stringify(input.hint) : null,
        input.tabIdentifier || null,
        input.datagrid ? JSON.stringify(input.datagrid) : null,
        input.show ? JSON.stringify(input.show) : null,
        input.hide ? JSON.stringify(input.hide) : null,
        sortOrder++
      ]);

      // Get the ID of the inserted input
      const result = db.exec('SELECT last_insert_rowid() as id');
      const inputId = result[0].values[0][0] as number;

      // Insert options
      if (input.options && input.options.length > 0) {
        let optSort = 0;
        for (const opt of input.options) {
          db.run(`
            INSERT INTO input_options (input_id, option_label, option_name, option_description, image_src, sort_order)
            VALUES (?, ?, ?, ?, ?, ?)
          `, [inputId, opt.label, opt.name, opt.description || null, opt.imageSrc || null, optSort++]);
        }
      }

      // Insert nested array inputs
      if (input.array && input.array.length > 0) {
        insertInputs(input.array, inputId, 0);
      }

      // Insert nested tabs inputs (NEW)
      if (input.tabs && input.tabs.length > 0) {
        insertInputs(input.tabs, inputId, 0);
      }
    }
  }

  insertInputs(node.inputs, null, 0);
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  console.log('DS-MCP-FLOWISE Node Extraction V2 (Complete)\n');
  console.log('Capturing ALL fields from INodeProperties, INodeParams, INodeOutputsValue\n');

  // Find all node files
  const nodeFiles = await glob('**/*.ts', { cwd: NODES_PATH, absolute: true });
  console.log(`Found ${nodeFiles.length} TypeScript files to scan`);

  // Parse nodes
  const nodes: ParsedNode[] = [];
  const categories = new Set<string>();

  for (const file of nodeFiles) {
    const node = parseNodeFile(file);
    if (node) {
      nodes.push(node);
      categories.add(node.category);
      process.stdout.write(`\rExtracted: ${nodes.length} nodes`);
    }
  }

  console.log(`\n\nExtracted ${nodes.length} nodes across ${categories.size} categories`);

  // Create database
  console.log('\nCreating database...');
  const db = await createDatabase();

  // Insert nodes
  console.log('Inserting nodes...');
  for (const node of nodes) {
    try {
      insertNode(db, node);
    } catch (error) {
      console.error(`\nError inserting ${node.name}:`, error);
    }
  }

  // Update category counts
  for (const category of categories) {
    db.run(`INSERT INTO categories (name) VALUES (?)`, [category]);
    db.run(`UPDATE categories SET node_count = (SELECT COUNT(*) FROM nodes WHERE category = ?) WHERE name = ?`, [category, category]);
  }

  // Save database
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);

  // Print stats
  const stats = db.exec(`
    SELECT
      (SELECT COUNT(*) FROM nodes) as nodes,
      (SELECT COUNT(*) FROM node_inputs WHERE parent_id IS NULL) as top_inputs,
      (SELECT COUNT(*) FROM node_inputs WHERE parent_id IS NOT NULL) as nested_inputs,
      (SELECT COUNT(*) FROM input_options) as options,
      (SELECT COUNT(*) FROM node_outputs) as outputs,
      (SELECT COUNT(*) FROM nodes WHERE is_agentflow = 1) as agentflow_nodes,
      (SELECT COUNT(*) FROM nodes WHERE badge IS NOT NULL) as nodes_with_badge,
      (SELECT COUNT(*) FROM nodes WHERE tags IS NOT NULL) as nodes_with_tags,
      (SELECT COUNT(*) FROM node_inputs WHERE is_list = 1) as list_inputs,
      (SELECT COUNT(*) FROM node_inputs WHERE file_type IS NOT NULL) as file_inputs
  `)[0].values[0];

  console.log('\nDatabase stats:');
  console.log(`  Nodes: ${stats[0]}`);
  console.log(`  Top-level inputs: ${stats[1]}`);
  console.log(`  Nested inputs: ${stats[2]}`);
  console.log(`  Input options: ${stats[3]}`);
  console.log(`  Outputs: ${stats[4]}`);
  console.log(`  Agentflow nodes: ${stats[5]}`);
  console.log(`  Nodes with badge: ${stats[6]}`);
  console.log(`  Nodes with tags: ${stats[7]}`);
  console.log(`  List inputs: ${stats[8]}`);
  console.log(`  File inputs: ${stats[9]}`);

  console.log(`\nDatabase saved to: ${DB_PATH}`);

  db.close();
}

main().catch(console.error);
