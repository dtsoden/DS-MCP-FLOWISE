# DS-MCP-FLOWISE

MCP (Model Context Protocol) server for building and managing [Flowise](https://flowiseai.com/) chatflows and agentflows. Provides AI assistants (Claude, GPT, etc.) with comprehensive knowledge of Flowise nodes and tools for workflow creation.

## Features

- **Complete Node Database**: All 390+ Flowise nodes with full schemas, inputs, and descriptions
- **Template Library**: 50+ marketplace templates as working examples
- **Intelligent Search**: Full-text search across nodes and templates
- **Flow Validation**: Verify flows before deploying
- **Compatibility Finder**: Discover which nodes can connect together
- **Flow Skeletons**: Generate starting points for common use cases

## Installation

### Quick Start with Claude Code

```bash
# Clone the repository
git clone https://github.com/dtsoden/DS-MCP-FLOWISE.git
cd DS-MCP-FLOWISE

# Install dependencies
npm install

# Build the database (extracts from Flowise source)
npm run extract
npm run prepare-db

# Build the server
npm run build
```

### Add to Claude Code

Add to your Claude Code MCP configuration:

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

### Add to Claude Desktop

Add to `claude_desktop_config.json`:

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

## Tools

### Node Discovery

| Tool | Description |
|------|-------------|
| `list_categories` | List all node categories with counts |
| `list_nodes` | List nodes, optionally filtered by category |
| `get_node_schema` | Get detailed schema for a node including all inputs |
| `search_nodes` | Full-text search across nodes |
| `find_compatible_nodes` | Find nodes that can connect to a given node |

### Template Library

| Tool | Description |
|------|-------------|
| `list_templates` | List marketplace templates by type |
| `get_template` | Get complete template with nodes and edges |

### Flow Building

| Tool | Description |
|------|-------------|
| `validate_flow` | Validate a flow's nodes and connections |
| `generate_flow_skeleton` | Generate a starting flow for common use cases |

## Example Usage

### Discover Available Nodes

```
Use list_categories to see all node types

Use list_nodes with category="Chat Models" to see chat models

Use search_nodes with query="vector database" to find vector stores
```

### Build a RAG Chatbot

```
1. Use get_template with name="Conversational Retrieval QA Chain" for an example
2. Use get_node_schema for each node you want to use
3. Use find_compatible_nodes to see what connects where
4. Use validate_flow to check your flow before deploying
```

### Generate a Flow Skeleton

```
Use generate_flow_skeleton with use_case="rag_chatbot"

Supported use cases:
- simple_chatbot
- rag_chatbot
- conversational_agent
- document_qa
- api_agent
- multi_agent
```

## Resources

The server also exposes resources for bulk access:

- `flowise://categories` - All categories
- `flowise://nodes` - All nodes
- `flowise://templates` - All templates

## Database Schema

The SQLite database contains:

- **nodes** - All Flowise node definitions
- **node_inputs** - Input parameters for each node
- **categories** - Node categories with counts
- **templates** - Marketplace templates
- **nodes_fts** - Full-text search index for nodes
- **templates_fts** - Full-text search index for templates

## Development

```bash
# Run in development mode
npm run dev

# Extract nodes from Flowise source
npm run extract

# Prepare SQLite database
npm run prepare-db

# Build for production
npm run build
```

## How It Works

1. **Extraction**: Parses Flowise source code to extract all node definitions
2. **Database**: Stores nodes, inputs, and templates in SQLite for fast queries
3. **MCP Server**: Exposes tools and resources via Model Context Protocol
4. **AI Integration**: Claude/GPT can query nodes, search, and validate flows

## Credits

- [Flowise](https://github.com/FlowiseAI/Flowise) - The amazing no-code LLM orchestration platform
- Inspired by [n8n-mcp](https://github.com/czlonkowski/n8n-mcp) architecture

## License

MIT
