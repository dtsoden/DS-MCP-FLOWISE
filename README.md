# DS-MCP-FLOWISE

MCP (Model Context Protocol) server that gives AI assistants (Claude, GPT, etc.) deep knowledge of [Flowise](https://flowiseai.com/) nodes so they can help you design, build, and deploy chatflows and agentflows.

## What This Does

When connected to Claude Code (or other MCP clients), this server lets the AI:
- Know all 311 Flowise nodes and their configurations
- Understand how nodes connect together
- Design complete flows based on your requirements
- Output valid JSON you can import into Flowise
- **Deploy flows directly to your Flowise instance** (optional API integration)

## Quick Start

### 1. Add to Claude Code

Add this to your Claude Code MCP configuration (`claude_desktop_config.json` or via settings):

**Windows:**
```json
{
  "mcpServers": {
    "flowise": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "ds-mcp-flowise"]
    }
  }
}
```

**Mac / Linux:**
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

Open Claude Code and **explicitly tell it to use the flowise tools**:

> "**Use the flowise tools** to build me a RAG chatbot that uses Pinecone for vector storage and OpenAI for the LLM. Give me the JSON to import into Flowise."

**Important:** Without mentioning "flowise tools" or "flowise MCP", Claude may try to build a chat app from scratch instead of generating a Flowise chatflow.

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

## Flowise API Integration (Optional)

Instead of manually importing JSON, you can connect directly to your Flowise instance to create, update, and manage chatflows via the API.

### Setup

1. Create a `.env` file in the project root (or in your working directory):

```bash
FLOWISE_API_URL=https://your-flowise-instance.com
FLOWISE_API_KEY=your-api-key-here
```

2. Get your API key from Flowise:
   - Open your Flowise instance
   - Go to **Settings** → **API Keys**
   - Create a new API key or copy an existing one

3. The MCP server will automatically load credentials from `.env` when it starts.

### Usage

Once configured, you can ask Claude:

- "Test the connection to my Flowise instance"
- "List all my chatflows"
- "Create a new chatflow with this design and deploy it"
- "Update the existing chatflow with these changes"

> **Note:** The Flowise API currently only supports **chatflows**. Agentflows must be created through the Flowise UI by importing the generated JSON.

### Security Notes

- Never commit your `.env` file to version control
- The `.env` file is already in `.gitignore`
- API keys should be kept private and rotated periodically

## Alternative Installation Methods

### Global Install (npm)

```bash
npm install -g ds-mcp-flowise
```

Then in your MCP config:

**Windows:**
```json
{
  "mcpServers": {
    "flowise": {
      "command": "cmd",
      "args": ["/c", "ds-mcp-flowise"]
    }
  }
}
```

**Mac / Linux:**
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

**Windows:**
```json
{
  "mcpServers": {
    "flowise": {
      "command": "node",
      "args": ["C:\\path\\to\\DS-MCP-FLOWISE\\dist\\index.js"]
    }
  }
}
```

**Mac / Linux:**
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

### Flowise API (requires .env configuration)

| Tool | Description |
|------|-------------|
| `flowise_test_connection` | Test connection to your Flowise instance |
| `flowise_list_chatflows` | List all chatflows in your instance |
| `flowise_get_chatflow` | Get details of a specific chatflow |
| `flowise_create_chatflow` | Create and deploy a new chatflow |
| `flowise_update_chatflow` | Update an existing chatflow |
| `flowise_delete_chatflow` | Delete a chatflow |

> **Note:** The Flowise API currently only supports **chatflows**. Agentflows must be created through the Flowise UI by importing the generated JSON.

## Example Prompts

**Important:** You must explicitly tell Claude to use the flowise MCP tools, otherwise it may try to build something from scratch instead of using Flowise nodes.

Once connected, try asking Claude:

- "**Use the flowise tools** to search for Ollama nodes and build me a chatflow JSON"
- "**Using the flowise MCP**, what vector stores does Flowise support?"
- "**Use flowise tools** to build a simple chatbot with memory and give me the JSON to import"
- "**With the flowise MCP**, create a RAG flow using Pinecone and OpenAI embeddings"
- "**Use the flowise search** to find nodes that can connect to a ConversationChain"
- "**Using flowise tools**, build me an agent that can search the web and query a database"

The key is to include phrases like:
- "use the flowise tools"
- "using the flowise MCP"
- "with the flowise MCP"
- "use flowise search"

**Pro tip for proper edge connections:** Ask Claude to look at a template first to understand the edge format:

> "Use flowise tools to get a template for a simple chatbot, then use that as a reference to build me a chatflow with Ollama"

Templates contain properly formatted edges with `sourceHandle`, `targetHandle`, and `type: "buttonedge"` that Flowise requires.

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

---
*Auto-published to npm via GitHub Actions*
