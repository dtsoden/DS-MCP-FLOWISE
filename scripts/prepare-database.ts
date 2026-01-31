/**
 * Prepare SQLite database from extracted node data
 * Using sql.js for cross-platform compatibility (no native compilation needed)
 */

import initSqlJs, { Database } from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';

const DATA_PATH = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_PATH, 'flowise.db');

interface NodeInput {
  label: string;
  name: string;
  type: string;
  description?: string;
  optional?: boolean;
  default?: any;
  options?: Array<{ label: string; name: string; description?: string }>;
  additionalParams?: boolean;
  // Agentflow-specific input properties
  show?: Record<string, any>;
  hide?: Record<string, any>;
  acceptVariable?: boolean;
  acceptNodeOutputAsVariable?: boolean;
  loadConfig?: boolean;
  refresh?: boolean;
  freeSolo?: boolean;
  array?: NodeInput[];
}

interface ExtractedNode {
  name: string;
  label: string;
  version: number;
  type: string;
  icon: string;
  category: string;
  description: string;
  baseClasses: string[];
  credential?: any;
  inputs: NodeInput[];
  filePath: string;
  // Agentflow-specific node properties
  color?: string;
  hideInput?: boolean;
  hideOutput?: boolean;
  hint?: string;
  tags?: string[];
}

interface MarketplaceTemplate {
  name: string;
  description: string;
  type: string;
  nodes: any[];
  edges: any[];
  usecases?: string[];
}

async function createDatabase(): Promise<Database> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  // Create tables
  db.run(`
    -- Nodes table
    CREATE TABLE nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      version REAL NOT NULL,
      type TEXT NOT NULL,
      icon TEXT,
      category TEXT NOT NULL,
      description TEXT,
      base_classes TEXT,
      credential TEXT,
      file_path TEXT,
      -- Agentflow-specific columns
      color TEXT,
      hide_input INTEGER DEFAULT 0,
      hide_output INTEGER DEFAULT 0,
      hint TEXT,
      tags TEXT
    );

    -- Node inputs table
    CREATE TABLE node_inputs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_name TEXT NOT NULL,
      input_name TEXT NOT NULL,
      input_label TEXT NOT NULL,
      input_type TEXT NOT NULL,
      description TEXT,
      optional INTEGER DEFAULT 0,
      default_value TEXT,
      options TEXT,
      additional_params INTEGER DEFAULT 0,
      -- Agentflow-specific input columns
      show_condition TEXT,
      hide_condition TEXT,
      accept_variable INTEGER DEFAULT 0,
      accept_node_output INTEGER DEFAULT 0,
      load_config INTEGER DEFAULT 0,
      refresh INTEGER DEFAULT 0,
      free_solo INTEGER DEFAULT 0,
      FOREIGN KEY (node_name) REFERENCES nodes(name)
    );

    -- Categories table
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      node_count INTEGER DEFAULT 0
    );

    -- Templates table
    CREATE TABLE templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL,
      usecases TEXT,
      nodes TEXT NOT NULL,
      edges TEXT NOT NULL
    );

    -- Indexes
    CREATE INDEX idx_nodes_category ON nodes(category);
    CREATE INDEX idx_nodes_type ON nodes(type);
    CREATE INDEX idx_node_inputs_node ON node_inputs(node_name);
    CREATE INDEX idx_templates_type ON templates(type);
  `);

  return db;
}

function populateDatabase(db: Database) {
  // Load extracted data
  const nodesData: ExtractedNode[] = JSON.parse(
    fs.readFileSync(path.join(DATA_PATH, 'nodes.json'), 'utf-8')
  );

  const templatesData: MarketplaceTemplate[] = JSON.parse(
    fs.readFileSync(path.join(DATA_PATH, 'templates.json'), 'utf-8')
  );

  console.log(`Loading ${nodesData.length} nodes...`);

  const categories = new Set<string>();

  // Insert nodes
  for (const node of nodesData) {
    categories.add(node.category);

    db.run(
      `INSERT INTO nodes (name, label, version, type, icon, category, description, base_classes, credential, file_path, color, hide_input, hide_output, hint, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        node.name,
        node.label,
        node.version,
        node.type,
        node.icon,
        node.category,
        node.description,
        JSON.stringify(node.baseClasses),
        node.credential ? JSON.stringify(node.credential) : null,
        node.filePath,
        node.color || null,
        node.hideInput ? 1 : 0,
        node.hideOutput ? 1 : 0,
        node.hint || null,
        node.tags ? JSON.stringify(node.tags) : null
      ]
    );

    // Insert inputs
    for (const input of node.inputs) {
      db.run(
        `INSERT INTO node_inputs (node_name, input_name, input_label, input_type, description, optional, default_value, options, additional_params, show_condition, hide_condition, accept_variable, accept_node_output, load_config, refresh, free_solo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          node.name,
          input.name,
          input.label,
          input.type,
          input.description || null,
          input.optional ? 1 : 0,
          input.default !== undefined ? String(input.default) : null,
          input.options ? JSON.stringify(input.options) : null,
          input.additionalParams ? 1 : 0,
          input.show ? JSON.stringify(input.show) : null,
          input.hide ? JSON.stringify(input.hide) : null,
          input.acceptVariable ? 1 : 0,
          input.acceptNodeOutputAsVariable ? 1 : 0,
          input.loadConfig ? 1 : 0,
          input.refresh ? 1 : 0,
          input.freeSolo ? 1 : 0
        ]
      );
    }
  }

  // Insert and update categories
  for (const category of categories) {
    db.run(`INSERT OR IGNORE INTO categories (name) VALUES (?)`, [category]);
    db.run(
      `UPDATE categories SET node_count = (SELECT COUNT(*) FROM nodes WHERE category = ?) WHERE name = ?`,
      [category, category]
    );
  }

  // Insert templates
  console.log(`Loading ${templatesData.length} templates...`);

  for (const template of templatesData) {
    db.run(
      `INSERT INTO templates (name, description, type, usecases, nodes, edges)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        template.name,
        template.description,
        template.type,
        template.usecases ? JSON.stringify(template.usecases) : null,
        JSON.stringify(template.nodes),
        JSON.stringify(template.edges)
      ]
    );
  }

  // Get stats
  const nodeCount = db.exec('SELECT COUNT(*) as count FROM nodes')[0].values[0][0];
  const inputCount = db.exec('SELECT COUNT(*) as count FROM node_inputs')[0].values[0][0];
  const categoryCount = db.exec('SELECT COUNT(*) as count FROM categories')[0].values[0][0];
  const templateCount = db.exec('SELECT COUNT(*) as count FROM templates')[0].values[0][0];

  console.log('\nDatabase prepared successfully!');
  console.log(`  Nodes: ${nodeCount}`);
  console.log(`  Inputs: ${inputCount}`);
  console.log(`  Categories: ${categoryCount}`);
  console.log(`  Templates: ${templateCount}`);
}

async function main() {
  // Check if extracted data exists
  if (!fs.existsSync(path.join(DATA_PATH, 'nodes.json'))) {
    console.error('Error: Extracted node data not found. Run "npm run extract" first.');
    process.exit(1);
  }

  console.log('Preparing SQLite database...\n');

  const db = await createDatabase();

  try {
    populateDatabase(db);

    // Save database to file
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
    console.log(`\nDatabase saved to: ${DB_PATH}`);
  } finally {
    db.close();
  }
}

main().catch(console.error);
