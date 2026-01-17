#!/usr/bin/env node
/**
 * DS-MCP-FLOWISE
 *
 * MCP server for building and managing Flowise chatflows and agentflows.
 * Provides AI assistants with comprehensive knowledge of Flowise nodes
 * and tools for workflow creation.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import initSqlJs, { Database } from 'sql.js';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Find database path
function findDatabasePath(): string {
  const possiblePaths = [
    path.join(__dirname, '..', 'data', 'flowise.db'),
    path.join(__dirname, '..', '..', 'data', 'flowise.db'),
    path.join(process.cwd(), 'data', 'flowise.db'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  throw new Error('Database not found. Run "npm run extract && npm run prepare-db" first.');
}

// Global database instance
let db: Database;

// Helper function to execute a query and return results
function query(sql: string, params: any[] = []): any[] {
  const stmt = db.prepare(sql);
  if (params.length > 0) {
    stmt.bind(params);
  }

  const results: any[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    results.push(row);
  }
  stmt.free();
  return results;
}

// Helper to get a single row
function queryOne(sql: string, params: any[] = []): any | null {
  const results = query(sql, params);
  return results.length > 0 ? results[0] : null;
}

// Create MCP server
const server = new Server(
  {
    name: 'ds-mcp-flowise',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
  }
);

// === TOOL DEFINITIONS ===

const TOOLS = [
  {
    name: 'list_categories',
    description: 'List all available Flowise node categories with node counts',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'list_nodes',
    description: 'List Flowise nodes, optionally filtered by category. Use this to discover available nodes for building flows.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          description: 'Filter by category (e.g., "Chat Models", "Vector Stores", "Tools")',
        },
        search: {
          type: 'string',
          description: 'Search nodes by name, label, or description',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_node_schema',
    description: 'Get detailed schema for a specific Flowise node including all inputs, their types, and options. Essential for correctly configuring nodes in a flow.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'The node name (e.g., "chatOpenAI", "pinecone", "conversationChain")',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'search_nodes',
    description: 'Search across all nodes to find relevant components for a task',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query (e.g., "vector database", "openai", "memory")',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default: 10)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_templates',
    description: 'List available marketplace templates (pre-built flows). Use these as examples and starting points.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        type: {
          type: 'string',
          enum: ['chatflow', 'agentflow', 'agentflowv2', 'tool'],
          description: 'Filter by template type',
        },
        search: {
          type: 'string',
          description: 'Search templates by name or description',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_template',
    description: 'Get a complete marketplace template with all nodes and edges. Use this to understand flow patterns.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Template name (e.g., "Conversational Retrieval QA Chain", "Simple RAG")',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'find_compatible_nodes',
    description: 'Find nodes that can connect to a given node based on base classes. Use this to discover what can plug into a specific node.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        node_name: {
          type: 'string',
          description: 'The node name to find compatible connections for',
        },
        direction: {
          type: 'string',
          enum: ['inputs', 'outputs'],
          description: 'Find nodes that can connect as inputs or outputs (default: inputs)',
        },
      },
      required: ['node_name'],
    },
  },
  {
    name: 'validate_flow',
    description: 'Validate a proposed flow structure. Checks that all nodes exist and connections are valid.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        nodes: {
          type: 'array',
          description: 'Array of node objects with id, type/name, and data',
          items: {
            type: 'object',
          },
        },
        edges: {
          type: 'array',
          description: 'Array of edge objects with source and target',
          items: {
            type: 'object',
          },
        },
      },
      required: ['nodes', 'edges'],
    },
  },
  {
    name: 'generate_flow_skeleton',
    description: 'Generate a basic flow skeleton for a given use case. Returns a starting point that can be customized.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        use_case: {
          type: 'string',
          enum: [
            'simple_chatbot',
            'rag_chatbot',
            'conversational_agent',
            'document_qa',
            'api_agent',
            'multi_agent',
          ],
          description: 'The type of flow to generate',
        },
        chat_model: {
          type: 'string',
          description: 'Preferred chat model (e.g., "chatOpenAI", "chatAnthropic")',
        },
      },
      required: ['use_case'],
    },
  },
];

// === TOOL IMPLEMENTATIONS ===

function listCategories(): string {
  const categories = query(`
    SELECT name, node_count
    FROM categories
    ORDER BY name
  `);

  return JSON.stringify(categories, null, 2);
}

function listNodes(category?: string, search?: string): string {
  let sql = 'SELECT name, label, category, description, type FROM nodes';
  const params: any[] = [];
  const conditions: string[] = [];

  if (category) {
    conditions.push('category = ?');
    params.push(category);
  }

  if (search) {
    conditions.push('(name LIKE ? OR label LIKE ? OR description LIKE ?)');
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY category, label';

  const nodes = query(sql, params);
  return JSON.stringify(nodes, null, 2);
}

function getNodeSchema(name: string): string {
  const node = queryOne(`SELECT * FROM nodes WHERE name = ?`, [name]);

  if (!node) {
    return JSON.stringify({ error: `Node "${name}" not found` });
  }

  const inputs = query(`
    SELECT input_name, input_label, input_type, description, optional, default_value, options, additional_params
    FROM node_inputs
    WHERE node_name = ?
    ORDER BY additional_params, input_label
  `, [name]);

  // Parse JSON fields
  const schema = {
    ...node,
    base_classes: JSON.parse(node.base_classes || '[]'),
    credential: node.credential ? JSON.parse(node.credential) : null,
    inputs: inputs.map((i: any) => ({
      name: i.input_name,
      label: i.input_label,
      type: i.input_type,
      description: i.description,
      optional: Boolean(i.optional),
      default: i.default_value,
      options: i.options ? JSON.parse(i.options) : null,
      additionalParams: Boolean(i.additional_params),
    })),
  };

  return JSON.stringify(schema, null, 2);
}

function searchNodes(searchQuery: string, limit: number = 10): string {
  const searchTerm = `%${searchQuery}%`;
  const results = query(`
    SELECT name, label, category, description
    FROM nodes
    WHERE name LIKE ? OR label LIKE ? OR description LIKE ? OR category LIKE ?
    LIMIT ?
  `, [searchTerm, searchTerm, searchTerm, searchTerm, limit]);

  return JSON.stringify(results, null, 2);
}

function listTemplates(type?: string, search?: string): string {
  let sql = 'SELECT name, description, type, usecases FROM templates';
  const params: any[] = [];
  const conditions: string[] = [];

  if (type) {
    conditions.push('type = ?');
    params.push(type);
  }

  if (search) {
    conditions.push('(name LIKE ? OR description LIKE ?)');
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY type, name';

  const templates = query(sql, params);

  return JSON.stringify(templates.map((t: any) => ({
    ...t,
    usecases: t.usecases ? JSON.parse(t.usecases) : [],
  })), null, 2);
}

function getTemplate(name: string): string {
  const template = queryOne(`SELECT * FROM templates WHERE name = ?`, [name]);

  if (!template) {
    return JSON.stringify({ error: `Template "${name}" not found` });
  }

  return JSON.stringify({
    ...template,
    usecases: template.usecases ? JSON.parse(template.usecases) : [],
    nodes: JSON.parse(template.nodes),
    edges: JSON.parse(template.edges),
  }, null, 2);
}

function findCompatibleNodes(nodeName: string, direction: string = 'inputs'): string {
  const node = queryOne(`SELECT base_classes FROM nodes WHERE name = ?`, [nodeName]);

  if (!node) {
    return JSON.stringify({ error: `Node "${nodeName}" not found` });
  }

  const baseClasses = JSON.parse(node.base_classes || '[]') as string[];

  if (direction === 'inputs') {
    // Find nodes whose outputs (base_classes) match this node's input types
    const inputs = query(`SELECT input_type FROM node_inputs WHERE node_name = ?`, [nodeName]);
    const inputTypes = inputs.map((i: any) => i.input_type);

    // Find nodes that have these types in their base_classes
    const allNodes = query(`SELECT name, label, category, base_classes FROM nodes`);

    const compatible = allNodes.filter((n: any) => {
      const nodeBaseClasses = JSON.parse(n.base_classes || '[]') as string[];
      return nodeBaseClasses.some(bc => inputTypes.includes(bc));
    }).map((n: any) => ({
      name: n.name,
      label: n.label,
      category: n.category,
    }));

    return JSON.stringify({ compatible_inputs: compatible }, null, 2);
  } else {
    // Find nodes that accept this node's output types
    const allInputs = query(`
      SELECT DISTINCT n.name, n.label, n.category, ni.input_type
      FROM nodes n
      JOIN node_inputs ni ON n.name = ni.node_name
    `);

    const compatible = allInputs.filter((i: any) =>
      baseClasses.includes(i.input_type)
    ).map((i: any) => ({
      name: i.name,
      label: i.label,
      category: i.category,
    }));

    // Deduplicate
    const unique = Array.from(new Map(compatible.map((c: any) => [c.name, c])).values());

    return JSON.stringify({ compatible_outputs: unique }, null, 2);
  }
}

function validateFlow(nodes: any[], edges: any[]): string {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check all nodes exist
  const nodeNames = new Set<string>();
  for (const node of nodes) {
    const nodeName = node.data?.name || node.type || node.name;
    if (!nodeName) {
      errors.push(`Node ${node.id} has no name/type specified`);
      continue;
    }

    const exists = queryOne(`SELECT 1 FROM nodes WHERE name = ?`, [nodeName]);
    if (!exists) {
      errors.push(`Node type "${nodeName}" does not exist`);
    }
    nodeNames.add(node.id);
  }

  // Check all edges reference valid nodes
  for (const edge of edges) {
    if (!nodeNames.has(edge.source)) {
      errors.push(`Edge references non-existent source node: ${edge.source}`);
    }
    if (!nodeNames.has(edge.target)) {
      errors.push(`Edge references non-existent target node: ${edge.target}`);
    }
  }

  return JSON.stringify({
    valid: errors.length === 0,
    errors,
    warnings,
  }, null, 2);
}

function generateFlowSkeleton(useCase: string, chatModel?: string): string {
  const model = chatModel || 'chatOpenAI';

  const skeletons: Record<string, any> = {
    simple_chatbot: {
      description: 'A basic chatbot with memory',
      nodes: [
        { id: 'chatModel_0', type: model, position: { x: 100, y: 200 } },
        { id: 'memory_0', type: 'bufferMemory', position: { x: 100, y: 400 } },
        { id: 'chain_0', type: 'conversationChain', position: { x: 400, y: 300 } },
      ],
      edges: [
        { source: 'chatModel_0', target: 'chain_0' },
        { source: 'memory_0', target: 'chain_0' },
      ],
    },
    rag_chatbot: {
      description: 'Retrieval Augmented Generation chatbot',
      nodes: [
        { id: 'chatModel_0', type: model, position: { x: 100, y: 100 } },
        { id: 'embeddings_0', type: 'openAIEmbeddings', position: { x: 100, y: 300 } },
        { id: 'vectorStore_0', type: 'pinecone', position: { x: 400, y: 300 } },
        { id: 'retriever_0', type: 'vectorStoreRetriever', position: { x: 700, y: 300 } },
        { id: 'memory_0', type: 'bufferMemory', position: { x: 400, y: 500 } },
        { id: 'chain_0', type: 'conversationalRetrievalQAChain', position: { x: 1000, y: 300 } },
      ],
      edges: [
        { source: 'chatModel_0', target: 'chain_0' },
        { source: 'embeddings_0', target: 'vectorStore_0' },
        { source: 'vectorStore_0', target: 'retriever_0' },
        { source: 'retriever_0', target: 'chain_0' },
        { source: 'memory_0', target: 'chain_0' },
      ],
    },
    conversational_agent: {
      description: 'Agent with tools and memory',
      nodes: [
        { id: 'chatModel_0', type: model, position: { x: 100, y: 200 } },
        { id: 'memory_0', type: 'bufferMemory', position: { x: 100, y: 400 } },
        { id: 'tool_0', type: 'calculator', position: { x: 400, y: 100 } },
        { id: 'tool_1', type: 'searchApi', position: { x: 400, y: 300 } },
        { id: 'agent_0', type: 'conversationalAgent', position: { x: 700, y: 200 } },
      ],
      edges: [
        { source: 'chatModel_0', target: 'agent_0' },
        { source: 'memory_0', target: 'agent_0' },
        { source: 'tool_0', target: 'agent_0' },
        { source: 'tool_1', target: 'agent_0' },
      ],
    },
    document_qa: {
      description: 'Document question answering',
      nodes: [
        { id: 'chatModel_0', type: model, position: { x: 100, y: 100 } },
        { id: 'embeddings_0', type: 'openAIEmbeddings', position: { x: 100, y: 300 } },
        { id: 'docLoader_0', type: 'pdfFile', position: { x: 400, y: 100 } },
        { id: 'textSplitter_0', type: 'recursiveCharacterTextSplitter', position: { x: 700, y: 100 } },
        { id: 'vectorStore_0', type: 'memoryVectorStore', position: { x: 400, y: 300 } },
        { id: 'chain_0', type: 'retrievalQAChain', position: { x: 700, y: 300 } },
      ],
      edges: [
        { source: 'chatModel_0', target: 'chain_0' },
        { source: 'embeddings_0', target: 'vectorStore_0' },
        { source: 'docLoader_0', target: 'textSplitter_0' },
        { source: 'textSplitter_0', target: 'vectorStore_0' },
        { source: 'vectorStore_0', target: 'chain_0' },
      ],
    },
    api_agent: {
      description: 'Agent that can call APIs',
      nodes: [
        { id: 'chatModel_0', type: model, position: { x: 100, y: 200 } },
        { id: 'tool_0', type: 'customTool', position: { x: 400, y: 100 } },
        { id: 'tool_1', type: 'requestsGet', position: { x: 400, y: 300 } },
        { id: 'agent_0', type: 'openAIFunctionAgent', position: { x: 700, y: 200 } },
      ],
      edges: [
        { source: 'chatModel_0', target: 'agent_0' },
        { source: 'tool_0', target: 'agent_0' },
        { source: 'tool_1', target: 'agent_0' },
      ],
    },
    multi_agent: {
      description: 'Multiple agents working together',
      nodes: [
        { id: 'chatModel_0', type: model, position: { x: 100, y: 200 } },
        { id: 'supervisor_0', type: 'supervisor', position: { x: 400, y: 200 } },
        { id: 'worker_0', type: 'worker', position: { x: 700, y: 100 } },
        { id: 'worker_1', type: 'worker', position: { x: 700, y: 300 } },
      ],
      edges: [
        { source: 'chatModel_0', target: 'supervisor_0' },
        { source: 'supervisor_0', target: 'worker_0' },
        { source: 'supervisor_0', target: 'worker_1' },
      ],
    },
  };

  const skeleton = skeletons[useCase];
  if (!skeleton) {
    return JSON.stringify({ error: `Unknown use case: ${useCase}` });
  }

  return JSON.stringify(skeleton, null, 2);
}

// === REQUEST HANDLERS ===

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: string;

    switch (name) {
      case 'list_categories':
        result = listCategories();
        break;
      case 'list_nodes':
        result = listNodes(args?.category as string, args?.search as string);
        break;
      case 'get_node_schema':
        result = getNodeSchema(args?.name as string);
        break;
      case 'search_nodes':
        result = searchNodes(args?.query as string, args?.limit as number);
        break;
      case 'list_templates':
        result = listTemplates(args?.type as string, args?.search as string);
        break;
      case 'get_template':
        result = getTemplate(args?.name as string);
        break;
      case 'find_compatible_nodes':
        result = findCompatibleNodes(args?.node_name as string, args?.direction as string);
        break;
      case 'validate_flow':
        result = validateFlow(args?.nodes as any[], args?.edges as any[]);
        break;
      case 'generate_flow_skeleton':
        result = generateFlowSkeleton(args?.use_case as string, args?.chat_model as string);
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [{ type: 'text', text: result }],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }],
      isError: true,
    };
  }
});

// === RESOURCES ===

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: 'flowise://categories',
      mimeType: 'application/json',
      name: 'All Categories',
      description: 'List of all Flowise node categories',
    },
    {
      uri: 'flowise://nodes',
      mimeType: 'application/json',
      name: 'All Nodes',
      description: 'Complete list of Flowise nodes',
    },
    {
      uri: 'flowise://templates',
      mimeType: 'application/json',
      name: 'All Templates',
      description: 'All marketplace templates',
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  let content: string;

  switch (uri) {
    case 'flowise://categories':
      content = listCategories();
      break;
    case 'flowise://nodes':
      content = listNodes();
      break;
    case 'flowise://templates':
      content = listTemplates();
      break;
    default:
      throw new Error(`Unknown resource: ${uri}`);
  }

  return {
    contents: [{ uri, mimeType: 'application/json', text: content }],
  };
});

// === PROMPTS ===

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: 'build_chatflow',
      description: 'Guide for building a Flowise chatflow',
      arguments: [
        {
          name: 'description',
          description: 'What the chatflow should do',
          required: true,
        },
      ],
    },
    {
      name: 'build_agentflow',
      description: 'Guide for building a Flowise agent flow',
      arguments: [
        {
          name: 'description',
          description: 'What the agent should do',
          required: true,
        },
      ],
    },
  ],
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'build_chatflow') {
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Help me build a Flowise chatflow that: ${args?.description}

First, use list_categories to see available node types.
Then, use search_nodes or list_nodes to find relevant components.
Use get_node_schema to understand how to configure each node.
Check list_templates for similar examples.
Finally, use validate_flow to verify the flow is valid.`,
          },
        },
      ],
    };
  }

  if (name === 'build_agentflow') {
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Help me build a Flowise agent flow that: ${args?.description}

Agent flows use nodes from the "Agent Flows" category.
Use list_nodes with category="Agent Flows" to see available nodes.
Use list_templates with type="agentflowv2" for examples.
Key nodes include: startAgentflow, agentAgentflow, llmAgentflow, toolAgentflow, conditionAgentflow.
Use get_node_schema to understand each node's configuration.`,
          },
        },
      ],
    };
  }

  throw new Error(`Unknown prompt: ${name}`);
});

// === START SERVER ===

async function main() {
  // Initialize database
  const SQL = await initSqlJs();
  const dbPath = findDatabasePath();
  const dbBuffer = fs.readFileSync(dbPath);
  db = new SQL.Database(dbBuffer);

  console.error('DS-MCP-FLOWISE server started');
  console.error(`Database loaded from: ${dbPath}`);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
