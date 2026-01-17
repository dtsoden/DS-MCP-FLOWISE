# DS-MCP-FLOWISE

MCP (Model Context Protocol) server that gives AI assistants (Claude, GPT, etc.) deep knowledge of [Flowise](https://flowiseai.com/) nodes so they can help you design and build chatflows and agentflows.

## What This Does

When connected to Claude Code (or other MCP clients), this server lets the AI:
- Know all 311 Flowise nodes and their configurations
- Understand how nodes connect together
- Design complete flows based on your requirements
- Output valid JSON you can import into Flowise

## Quick Start

### 1. Add to Claude Code

Add this to your Claude Code MCP configuration (`claude_desktop_config.json` or via settings):

```json
{
  "mcpServers": {
    "flowise": {
      "command": "npx",
      "args": ["-y", "ds-mcp-flowise"]
    }
  }
}
```

That's it. No cloning, no building. The `npx` command downloads and runs it automatically.

### 2. Start a Conversation

Open Claude Code and describe what you want to build:

> "Build me a RAG chatbot that uses Pinecone for vector storage and OpenAI for the LLM"

### 3. Get Your Flow

Claude will use the MCP tools to:
- Find the right nodes (ChatOpenAI, Pinecone, embeddings, etc.)
- Check their schemas and required inputs
- Design the complete flow
- Output the JSON with all nodes and edges

### 4. Import into Flowise

1. Open Flowise
2. Create a new Chatflow or Agentflow
3. Click the menu (⋮) → **Load Chatflow**
4. Paste the JSON Claude gave you
5. Configure credentials (API keys) for each node
6. Save and test

## Alternative Installation Methods

### Global Install (npm)

```bash
npm install -g ds-mcp-flowise
```

Then in your MCP config:
```json
{
  "mcpServers": {
    "flowise": {
      "command": "ds-mcp-flowise"
    }
  }
}
```

### Build from Source

```bash
git clone https://github.com/dtsoden/DS-MCP-FLOWISE.git
cd DS-MCP-FLOWISE
npm install
npm run build
```

Then in your MCP config:
```json
{
  "mcpServers": {
    "flowise": {
      "command": "node",
      "args": ["/path/to/DS-MCP-FLOWISE/dist/index.js"]
    }
  }
}
```

## Available Tools

### Node Discovery

| Tool | Description |
|------|-------------|
| `list_categories` | List all 26 node categories with counts |
| `list_nodes` | List nodes, optionally filtered by category |
| `get_node_schema` | Get detailed schema for a node including all inputs |
| `search_nodes` | Search nodes by keyword |
| `find_compatible_nodes` | Find nodes that can connect to a given node |

### Template Library

| Tool | Description |
|------|-------------|
| `list_templates` | List 64 marketplace templates by type |
| `get_template` | Get complete template with nodes and edges |

### Flow Building

| Tool | Description |
|------|-------------|
| `validate_flow` | Validate a flow's nodes and connections |
| `generate_flow_skeleton` | Generate a starting flow for common use cases |

## Example Prompts

Once connected, try asking Claude:

- "What vector stores does Flowise support?"
- "Show me how to build a simple chatbot with memory"
- "Create a RAG flow using Pinecone and Claude"
- "What nodes can connect to a ConversationChain?"
- "Build me an agent that can search the web and query a database"

## What's Included

- **311 Flowise nodes** with full schemas
- **1,915 input parameters** documented
- **26 node categories** (Chat Models, Vector Stores, Tools, etc.)
- **64 marketplace templates** as examples
- **SQLite database** for fast queries

## Updating the Node Database

To update with the latest Flowise nodes:

```bash
git clone https://github.com/dtsoden/DS-MCP-FLOWISE.git
cd DS-MCP-FLOWISE
npm install

# This clones Flowise and extracts all node definitions
npm run extract

# This rebuilds the SQLite database
npm run prepare-db

npm run build
```

## Credits

- [Flowise](https://github.com/FlowiseAI/Flowise) - The no-code LLM orchestration platform
- Inspired by [n8n-mcp](https://github.com/czlonkowski/n8n-mcp) architecture

## License

MIT
