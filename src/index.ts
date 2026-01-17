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

// Load .env file if it exists
function loadEnv() {
  const envPaths = [
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '..', '..', '.env'),
  ];

  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf-8');
      for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, ...valueParts] = trimmed.split('=');
          const value = valueParts.join('=');
          if (key && value) {
            process.env[key.trim()] = value.trim();
          }
        }
      }
      break;
    }
  }
}

loadEnv();

// Flowise API configuration
const FLOWISE_API_URL = process.env.FLOWISE_API_URL || '';
const FLOWISE_API_KEY = process.env.FLOWISE_API_KEY || '';

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

// Load nodes data for edge generation
let nodesData: any[] = [];

function loadNodesData() {
  const possiblePaths = [
    path.join(__dirname, '..', 'data', 'nodes.json'),
    path.join(__dirname, '..', '..', 'data', 'nodes.json'),
    path.join(process.cwd(), 'data', 'nodes.json'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      nodesData = JSON.parse(fs.readFileSync(p, 'utf-8'));
      return;
    }
  }
}

// Get node info from loaded data
function getNodeInfo(nodeName: string): any | null {
  return nodesData.find(n => n.name === nodeName || n.name.toLowerCase() === nodeName.toLowerCase());
}

// Create a proper Flowise edge with all required fields
function createFlowiseEdge(
  sourceNodeId: string,
  sourceNodeType: string,
  targetNodeId: string,
  targetNodeType: string,
  targetInputName: string
): any {
  const sourceNode = getNodeInfo(sourceNodeType);
  const targetNode = getNodeInfo(targetNodeType);

  if (!sourceNode || !targetNode) {
    // Fallback to simple edge if node info not found
    return {
      source: sourceNodeId,
      target: targetNodeId,
      type: 'buttonedge',
      id: `${sourceNodeId}-${targetNodeId}`,
      data: { label: '' }
    };
  }

  // Get source output info (baseClasses)
  const sourceBaseClasses = sourceNode.baseClasses || [sourceNode.name];
  const sourceHandle = `${sourceNodeId}-output-${sourceNodeType}-${sourceBaseClasses.join('|')}`;

  // Get target input info
  const targetInput = targetNode.inputs?.find((i: any) => i.name === targetInputName);
  const targetType = targetInput?.type || sourceBaseClasses[0];
  const targetHandle = `${targetNodeId}-input-${targetInputName}-${targetType}`;

  const edgeId = `${sourceHandle}-${targetHandle}`;

  return {
    source: sourceNodeId,
    sourceHandle,
    target: targetNodeId,
    targetHandle,
    type: 'buttonedge',
    id: edgeId,
    data: { label: '' }
  };
}

// Create a proper Flowise node with all required fields
function createFlowiseNode(
  id: string,
  nodeType: string,
  position: { x: number; y: number },
  inputValues: Record<string, any> = {}
): any {
  const nodeInfo = getNodeInfo(nodeType);

  if (!nodeInfo) {
    // Fallback to basic node
    return {
      id,
      position,
      type: 'customNode',
      data: {
        id,
        label: nodeType,
        name: nodeType,
        type: nodeType,
        inputs: inputValues,
        outputs: {}
      }
    };
  }

  // Build the data object with proper structure
  const data: any = {
    id,
    label: nodeInfo.label || nodeType,
    name: nodeInfo.name,
    type: nodeInfo.name,
    baseClasses: nodeInfo.baseClasses || [],
    category: nodeInfo.category || '',
    description: nodeInfo.description || '',
    inputs: {},
    outputs: {},
    inputParams: nodeInfo.inputs || [],
    inputAnchors: [],
    outputAnchors: []
  };

  // Set input values
  for (const input of (nodeInfo.inputs || [])) {
    if (inputValues[input.name] !== undefined) {
      data.inputs[input.name] = inputValues[input.name];
    } else if (input.default !== undefined) {
      data.inputs[input.name] = input.default;
    } else {
      data.inputs[input.name] = '';
    }
  }

  return {
    id,
    position,
    type: 'customNode',
    data
  };
}

// === FLOWISE API HELPERS ===

async function flowiseApiRequest(
  endpoint: string,
  method: string = 'GET',
  body?: any
): Promise<any> {
  if (!FLOWISE_API_URL) {
    throw new Error('FLOWISE_API_URL not configured. Set it in .env file.');
  }

  const url = `${FLOWISE_API_URL.replace(/\/$/, '')}/api/v1${endpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (FLOWISE_API_KEY) {
    headers['Authorization'] = `Bearer ${FLOWISE_API_KEY}`;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Flowise API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

// Create MCP server
const server = new Server(
  {
    name: 'ds-mcp-flowise',
    version: '1.1.0',
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
  // Node discovery tools
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

  // Flowise API tools
  {
    name: 'flowise_list_chatflows',
    description: 'List all chatflows in the connected Flowise instance. Requires FLOWISE_API_URL and FLOWISE_API_KEY to be configured.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'flowise_get_chatflow',
    description: 'Get details of a specific chatflow by ID from the connected Flowise instance.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'The chatflow ID',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'flowise_create_chatflow',
    description: 'Create a new chatflow in the connected Flowise instance. This pushes your designed flow directly to Flowise.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Name for the chatflow',
        },
        nodes: {
          type: 'array',
          description: 'Array of node objects',
          items: { type: 'object' },
        },
        edges: {
          type: 'array',
          description: 'Array of edge objects',
          items: { type: 'object' },
        },
        deployed: {
          type: 'boolean',
          description: 'Whether to deploy immediately (default: false)',
        },
      },
      required: ['name', 'nodes', 'edges'],
    },
  },
  {
    name: 'flowise_update_chatflow',
    description: 'Update an existing chatflow in the connected Flowise instance.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'The chatflow ID to update',
        },
        name: {
          type: 'string',
          description: 'New name for the chatflow (optional)',
        },
        nodes: {
          type: 'array',
          description: 'Updated array of node objects',
          items: { type: 'object' },
        },
        edges: {
          type: 'array',
          description: 'Updated array of edge objects',
          items: { type: 'object' },
        },
        deployed: {
          type: 'boolean',
          description: 'Whether the chatflow should be deployed',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'flowise_delete_chatflow',
    description: 'Delete a chatflow from the connected Flowise instance. Use with caution!',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'The chatflow ID to delete',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'flowise_test_connection',
    description: 'Test the connection to the configured Flowise instance. Use this to verify your API URL and key are correct.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
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
    const inputs = query(`SELECT input_type FROM node_inputs WHERE node_name = ?`, [nodeName]);
    const inputTypes = inputs.map((i: any) => i.input_type);

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

    const unique = Array.from(new Map(compatible.map((c: any) => [c.name, c])).values());

    return JSON.stringify({ compatible_outputs: unique }, null, 2);
  }
}

function validateFlow(nodes: any[], edges: any[]): string {
  const errors: string[] = [];
  const warnings: string[] = [];

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

  // Define skeleton blueprints with connection info (sourceId, sourceType, targetId, targetType, targetInputName)
  const blueprints: Record<string, {
    description: string;
    nodes: Array<{ id: string; type: string; position: { x: number; y: number }; inputs?: Record<string, any> }>;
    connections: Array<{ sourceId: string; sourceType: string; targetId: string; targetType: string; targetInput: string }>;
  }> = {
    simple_chatbot: {
      description: 'A basic chatbot with memory',
      nodes: [
        { id: 'chatModel_0', type: model, position: { x: 100, y: 200 } },
        { id: 'memory_0', type: 'bufferMemory', position: { x: 100, y: 400 } },
        { id: 'chain_0', type: 'conversationChain', position: { x: 400, y: 300 } },
      ],
      connections: [
        { sourceId: 'chatModel_0', sourceType: model, targetId: 'chain_0', targetType: 'conversationChain', targetInput: 'model' },
        { sourceId: 'memory_0', sourceType: 'bufferMemory', targetId: 'chain_0', targetType: 'conversationChain', targetInput: 'memory' },
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
      connections: [
        { sourceId: 'chatModel_0', sourceType: model, targetId: 'chain_0', targetType: 'conversationalRetrievalQAChain', targetInput: 'model' },
        { sourceId: 'embeddings_0', sourceType: 'openAIEmbeddings', targetId: 'vectorStore_0', targetType: 'pinecone', targetInput: 'embeddings' },
        { sourceId: 'vectorStore_0', sourceType: 'pinecone', targetId: 'retriever_0', targetType: 'vectorStoreRetriever', targetInput: 'vectorStore' },
        { sourceId: 'retriever_0', sourceType: 'vectorStoreRetriever', targetId: 'chain_0', targetType: 'conversationalRetrievalQAChain', targetInput: 'vectorStoreRetriever' },
        { sourceId: 'memory_0', sourceType: 'bufferMemory', targetId: 'chain_0', targetType: 'conversationalRetrievalQAChain', targetInput: 'memory' },
      ],
    },
    conversational_agent: {
      description: 'Agent with tools and memory',
      nodes: [
        { id: 'chatModel_0', type: model, position: { x: 100, y: 200 } },
        { id: 'memory_0', type: 'bufferMemory', position: { x: 100, y: 400 } },
        { id: 'tool_0', type: 'calculator', position: { x: 400, y: 100 } },
        { id: 'tool_1', type: 'serpAPI', position: { x: 400, y: 300 } },
        { id: 'agent_0', type: 'conversationalAgent', position: { x: 700, y: 200 } },
      ],
      connections: [
        { sourceId: 'chatModel_0', sourceType: model, targetId: 'agent_0', targetType: 'conversationalAgent', targetInput: 'model' },
        { sourceId: 'memory_0', sourceType: 'bufferMemory', targetId: 'agent_0', targetType: 'conversationalAgent', targetInput: 'memory' },
        { sourceId: 'tool_0', sourceType: 'calculator', targetId: 'agent_0', targetType: 'conversationalAgent', targetInput: 'tools' },
        { sourceId: 'tool_1', sourceType: 'serpAPI', targetId: 'agent_0', targetType: 'conversationalAgent', targetInput: 'tools' },
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
      connections: [
        { sourceId: 'chatModel_0', sourceType: model, targetId: 'chain_0', targetType: 'retrievalQAChain', targetInput: 'model' },
        { sourceId: 'embeddings_0', sourceType: 'openAIEmbeddings', targetId: 'vectorStore_0', targetType: 'memoryVectorStore', targetInput: 'embeddings' },
        { sourceId: 'docLoader_0', sourceType: 'pdfFile', targetId: 'textSplitter_0', targetType: 'recursiveCharacterTextSplitter', targetInput: 'document' },
        { sourceId: 'textSplitter_0', sourceType: 'recursiveCharacterTextSplitter', targetId: 'vectorStore_0', targetType: 'memoryVectorStore', targetInput: 'document' },
        { sourceId: 'vectorStore_0', sourceType: 'memoryVectorStore', targetId: 'chain_0', targetType: 'retrievalQAChain', targetInput: 'vectorStoreRetriever' },
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
      connections: [
        { sourceId: 'chatModel_0', sourceType: model, targetId: 'agent_0', targetType: 'openAIFunctionAgent', targetInput: 'model' },
        { sourceId: 'tool_0', sourceType: 'customTool', targetId: 'agent_0', targetType: 'openAIFunctionAgent', targetInput: 'tools' },
        { sourceId: 'tool_1', sourceType: 'requestsGet', targetId: 'agent_0', targetType: 'openAIFunctionAgent', targetInput: 'tools' },
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
      connections: [
        { sourceId: 'chatModel_0', sourceType: model, targetId: 'supervisor_0', targetType: 'supervisor', targetInput: 'model' },
        { sourceId: 'supervisor_0', sourceType: 'supervisor', targetId: 'worker_0', targetType: 'worker', targetInput: 'supervisor' },
        { sourceId: 'supervisor_0', sourceType: 'supervisor', targetId: 'worker_1', targetType: 'worker', targetInput: 'supervisor' },
      ],
    },
  };

  const blueprint = blueprints[useCase];
  if (!blueprint) {
    return JSON.stringify({ error: `Unknown use case: ${useCase}. Available: ${Object.keys(blueprints).join(', ')}` });
  }

  // Generate proper Flowise nodes
  const nodes = blueprint.nodes.map(n => createFlowiseNode(n.id, n.type, n.position, n.inputs || {}));

  // Generate proper Flowise edges with full handle info
  const edges = blueprint.connections.map(c =>
    createFlowiseEdge(c.sourceId, c.sourceType, c.targetId, c.targetType, c.targetInput)
  );

  return JSON.stringify({
    description: blueprint.description,
    nodes,
    edges,
  }, null, 2);
}

// === FLOWISE API IMPLEMENTATIONS ===

async function flowiseTestConnection(): Promise<string> {
  if (!FLOWISE_API_URL) {
    return JSON.stringify({
      connected: false,
      error: 'FLOWISE_API_URL not configured. Create a .env file with FLOWISE_API_URL and FLOWISE_API_KEY.',
    });
  }

  try {
    const chatflows = await flowiseApiRequest('/chatflows');
    return JSON.stringify({
      connected: true,
      url: FLOWISE_API_URL,
      chatflows_count: Array.isArray(chatflows) ? chatflows.length : 0,
    }, null, 2);
  } catch (error) {
    return JSON.stringify({
      connected: false,
      url: FLOWISE_API_URL,
      error: String(error),
    }, null, 2);
  }
}

async function flowiseListChatflows(): Promise<string> {
  const chatflows = await flowiseApiRequest('/chatflows');

  // Return summary info for each chatflow
  const summary = chatflows.map((cf: any) => ({
    id: cf.id,
    name: cf.name,
    deployed: cf.deployed,
    createdDate: cf.createdDate,
    updatedDate: cf.updatedDate,
  }));

  return JSON.stringify(summary, null, 2);
}

async function flowiseGetChatflow(id: string): Promise<string> {
  const chatflow = await flowiseApiRequest(`/chatflows/${id}`);
  return JSON.stringify(chatflow, null, 2);
}

async function flowiseCreateChatflow(
  name: string,
  nodes: any[],
  edges: any[],
  deployed: boolean = false
): Promise<string> {
  const flowData = {
    name,
    flowData: JSON.stringify({ nodes, edges }),
    deployed,
  };

  const result = await flowiseApiRequest('/chatflows', 'POST', flowData);
  return JSON.stringify({
    success: true,
    id: result.id,
    name: result.name,
    message: `Chatflow "${name}" created successfully!`,
    url: `${FLOWISE_API_URL}/chatflows/${result.id}`,
  }, null, 2);
}

async function flowiseUpdateChatflow(
  id: string,
  name?: string,
  nodes?: any[],
  edges?: any[],
  deployed?: boolean
): Promise<string> {
  const updateData: any = {};

  if (name) updateData.name = name;
  if (nodes && edges) {
    updateData.flowData = JSON.stringify({ nodes, edges });
  }
  if (deployed !== undefined) updateData.deployed = deployed;

  const result = await flowiseApiRequest(`/chatflows/${id}`, 'PUT', updateData);
  return JSON.stringify({
    success: true,
    id: result.id,
    name: result.name,
    message: `Chatflow updated successfully!`,
  }, null, 2);
}

async function flowiseDeleteChatflow(id: string): Promise<string> {
  await flowiseApiRequest(`/chatflows/${id}`, 'DELETE');
  return JSON.stringify({
    success: true,
    message: `Chatflow ${id} deleted successfully!`,
  }, null, 2);
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
      // Node discovery tools
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

      // Flowise API tools
      case 'flowise_test_connection':
        result = await flowiseTestConnection();
        break;
      case 'flowise_list_chatflows':
        result = await flowiseListChatflows();
        break;
      case 'flowise_get_chatflow':
        result = await flowiseGetChatflow(args?.id as string);
        break;
      case 'flowise_create_chatflow':
        result = await flowiseCreateChatflow(
          args?.name as string,
          args?.nodes as any[],
          args?.edges as any[],
          args?.deployed as boolean
        );
        break;
      case 'flowise_update_chatflow':
        result = await flowiseUpdateChatflow(
          args?.id as string,
          args?.name as string,
          args?.nodes as any[],
          args?.edges as any[],
          args?.deployed as boolean
        );
        break;
      case 'flowise_delete_chatflow':
        result = await flowiseDeleteChatflow(args?.id as string);
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
Use validate_flow to verify the flow is valid.
Finally, use flowise_create_chatflow to push it directly to Flowise!`,
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
Use get_node_schema to understand each node's configuration.
Finally, use flowise_create_chatflow to push it directly to Flowise!`,
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

  // Load nodes data for edge generation
  loadNodesData();

  console.error('DS-MCP-FLOWISE server started');
  console.error(`Database loaded from: ${dbPath}`);
  console.error(`Nodes data loaded: ${nodesData.length} nodes`);

  if (FLOWISE_API_URL) {
    console.error(`Flowise API configured: ${FLOWISE_API_URL}`);
  } else {
    console.error('Flowise API not configured (set FLOWISE_API_URL in .env for direct flow creation)');
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
