/**
 * Extract node definitions from Flowise source code - V2
 * Uses proper bracket matching for nested structures
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
  step?: number;  // step value for number inputs
  default?: any;
  optional?: boolean;
  additionalParams?: boolean;
  loadMethod?: string;
  loadConfig?: boolean;
  acceptVariable?: boolean;
  acceptNodeOutputAsVariable?: boolean;
  refresh?: boolean;
  freeSolo?: boolean;
  generateInstruction?: boolean;
  generateDocStoreDescription?: boolean;
  hideCodeExecute?: boolean;
  show?: Record<string, any>;
  hide?: Record<string, any>;
  options?: Array<{ label: string; name: string; description?: string }>;
  array?: ParsedInput[]; // Nested inputs for array type
  credentialNames?: string[];
}

function parseInputObject(objContent: string): ParsedInput | null {
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

  const loadConfig = extractBooleanValue(objContent, 'loadConfig');
  if (loadConfig !== null) input.loadConfig = loadConfig;

  const acceptVariable = extractBooleanValue(objContent, 'acceptVariable');
  if (acceptVariable !== null) input.acceptVariable = acceptVariable;

  const acceptNodeOutput = extractBooleanValue(objContent, 'acceptNodeOutputAsVariable');
  if (acceptNodeOutput !== null) input.acceptNodeOutputAsVariable = acceptNodeOutput;

  const refresh = extractBooleanValue(objContent, 'refresh');
  if (refresh !== null) input.refresh = refresh;

  const freeSolo = extractBooleanValue(objContent, 'freeSolo');
  if (freeSolo !== null) input.freeSolo = freeSolo;

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

  // Nested array inputs (for type: 'array') - parse BEFORE options
  // This is important because we need to know if this is an array-type input
  // before extracting options (array inputs don't have their own options -
  // their options belong to nested inputs)
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
    // These properties only make sense for leaf inputs, not array containers
    delete input.rows;
    delete input.placeholder;
    delete input.generateInstruction;
    delete input.generateDocStoreDescription;
    delete input.hideCodeExecute;
  }

  // Options array - only for non-array types
  // For array-type inputs, options belong to the nested inputs, not the parent
  const optionsMatch = objContent.match(/options\s*:\s*\[/);
  if (optionsMatch && input.type !== 'array') {
    const optionsResult = extractArrayContent(objContent, optionsMatch.index!);
    if (optionsResult) {
      const optionObjects = splitArrayIntoObjects(optionsResult.content);
      input.options = optionObjects.map(opt => ({
        label: extractStringValue(opt, 'label') || '',
        name: extractStringValue(opt, 'name') || '',
        description: extractStringValue(opt, 'description') || undefined
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
  color?: string;
  hideInput?: boolean;
  hideOutput?: boolean;
  hint?: string;
  documentation?: string;
  baseClasses: string[];
  filePath: string;
  inputs: ParsedInput[];
  credential?: {
    label: string;
    name: string;
    type: string;
    credentialNames?: string[];
  };
}

function parseNodeFile(filePath: string): ParsedNode | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Check if this is a node class
    if (!content.includes('implements INode')) {
      return null;
    }

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
      inputs: []
    };

    // Agentflow properties
    const color = extractStringValue(content, 'this.color');
    if (color) node.color = color;

    if (content.includes('this.hideInput = true')) node.hideInput = true;
    if (content.includes('this.hideOutput = true')) node.hideOutput = true;

    const hint = extractStringValue(content, 'this.hint');
    if (hint) node.hint = hint;

    const documentation = extractStringValue(content, 'this.documentation');
    if (documentation) node.documentation = documentation;

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
          .map(obj => parseInputObject(obj))
          .filter((i): i is ParsedInput => i !== null);
      }
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
    INSERT INTO nodes (name, label, version, type, icon, category, description, color, hide_input, hide_output, hint, documentation, base_classes, file_path, is_agentflow)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    node.name,
    node.label,
    node.version,
    node.type,
    node.icon,
    node.category,
    node.description,
    node.color || null,
    node.hideInput ? 1 : 0,
    node.hideOutput ? 1 : 0,
    node.hint || null,
    node.documentation || null,
    JSON.stringify(node.baseClasses),
    node.filePath,
    isAgentflow
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

  // Insert output
  db.run(`
    INSERT INTO node_outputs (node_name, output_name, output_label, output_type)
    VALUES (?, ?, ?, ?)
  `, [
    node.name,
    node.name,
    node.label,
    isAgentflow ? null : node.baseClasses.join('|')
  ]);

  // Insert inputs (with nested array support)
  function insertInputs(inputs: ParsedInput[], parentId: number | null, sortStart: number): void {
    let sortOrder = sortStart;

    for (const input of inputs) {
      db.run(`
        INSERT INTO node_inputs (
          node_name, parent_id, input_name, input_label, input_type,
          description, placeholder, rows, step, default_value, is_optional, is_additional_params,
          load_method, load_config, accept_variable, accept_node_output,
          refresh, free_solo, generate_instruction, generate_doc_store_desc, hide_code_execute,
          show_condition, hide_condition, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        node.name,
        parentId,
        input.name,
        input.label,
        input.type,
        input.description || null,
        input.placeholder || null,
        input.rows || null,
        input.step !== undefined ? input.step : null,
        input.default !== undefined ? String(input.default) : null,
        input.optional ? 1 : 0,
        input.additionalParams ? 1 : 0,
        input.loadMethod || null,
        input.loadConfig ? 1 : 0,
        input.acceptVariable ? 1 : 0,
        input.acceptNodeOutputAsVariable ? 1 : 0,
        input.refresh ? 1 : 0,
        input.freeSolo ? 1 : 0,
        input.generateInstruction ? 1 : 0,
        input.generateDocStoreDescription ? 1 : 0,
        input.hideCodeExecute ? 1 : 0,
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
            INSERT INTO input_options (input_id, option_label, option_name, option_description, sort_order)
            VALUES (?, ?, ?, ?, ?)
          `, [inputId, opt.label, opt.name, opt.description || null, optSort++]);
        }
      }

      // Insert nested array inputs
      if (input.array && input.array.length > 0) {
        insertInputs(input.array, inputId, 0);
      }
    }
  }

  insertInputs(node.inputs, null, 0);
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  console.log('DS-MCP-FLOWISE Node Extraction V2\n');
  console.log('Using bracket-matching parser for nested structures\n');

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
      (SELECT COUNT(*) FROM nodes WHERE is_agentflow = 1) as agentflow_nodes
  `)[0].values[0];

  console.log('\nDatabase stats:');
  console.log(`  Nodes: ${stats[0]}`);
  console.log(`  Top-level inputs: ${stats[1]}`);
  console.log(`  Nested inputs: ${stats[2]}`);
  console.log(`  Input options: ${stats[3]}`);
  console.log(`  Agentflow nodes: ${stats[4]}`);

  console.log(`\nDatabase saved to: ${DB_PATH}`);

  db.close();
}

main().catch(console.error);
