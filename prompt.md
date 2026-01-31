# Use Case to Flowise Flow Builder

## Context
I have a CSV file at [FILE_PATH] containing use cases that need to be implemented as Flowise flows.

## CSV Column Reference (for understanding the data)
- **Index**: Row number
- **Agent or Use Case**: Type indicator ("Use Case", "Agent", or "Solution")
- **Name**: Short title of the solution
- **Description**: What the solution does
- **Applicable Industries**: Target sectors (BFSI, Retail, etc.)
- **Department**: Business function (Finance, Legal, etc.)
- **Scope**: Business process area
- **Categorization (L1/L2)**: Type of AI application
- **AI Capabilities**: Technical capabilities needed (key for flow type decision)
- **KPIs Impacted**: Metrics the solution affects

## Flow Type Decision Rules
Determine CHATFLOW vs AGENTFLOW based on:

| Criteria | → AGENTFLOW | → CHATFLOW |
|----------|-------------|------------|
| "Agent or Use Case" column | "Agent" or "Solution" | "Use Case" |
| AI Capabilities include | "Conversational AI", "Process Automation", "Pattern Recognition" | "Content Generation", "Text Generation", "Search and Retrieval" only |
| Complexity | Multi-step reasoning, tool usage, dynamic decisions | Simple Q&A, document generation, single-task |
| Categorization L1 | "Analysis", "Employee Efficiency" with automation | "Content Generation" |

## Task Instructions
For each row in the CSV:

1. **Analyze** the use case using the decision rules above
2. **Classify** as AGENTFLOW or CHATFLOW
3. **Design** the flow architecture:
   - For AGENTFLOW: Use `startAgentflow` → `agentAgentflow` (with tools/knowledge as needed)
   - For CHATFLOW: Use appropriate chain (conversationChain, llmChain, etc.) with chat model
4. **Build** using the MCP server:
   - Call `get_node_schema` for each needed node
   - Configure the system message based on Description + Department context
   - Connect nodes with proper edges
   - Call `flowise_create_chatflow` with type AGENTFLOW or CHATFLOW

## Output Format
For each use case, provide:
```
### [Index]. [Name]
- **Type**: AGENTFLOW | CHATFLOW
- **Reasoning**: [Why this type was chosen based on AI Capabilities and use case type]
- **Architecture**: [Node flow diagram]
- **System Prompt**: [Configured prompt for the agent/chain]
- **Flow URL**: [After creation]
```

## MCP Tools to Use
1. `get_node_schema` - Get complete node templates
2. `list_nodes` - Find nodes by category
3. `find_compatible_nodes` - Verify edge connections
4. `validate_flow` - Check before creating
5. `flowise_create_chatflow` - Deploy the flow

## Example Application

**Row 5: Finance Q&A agent**
- AI Capabilities: "Conversational AI, Monitoring and Alerting, Process Automation, Search and Retrieval"
- Agent or Use Case: "Agent"
- → **AGENTFLOW** (Conversational AI + Agent type + Process Automation)
- Architecture: Start → Agent (with knowledge stores for finance docs)

---

## Quick Reference Card

| AI Capability | Flow Type |
|---------------|-----------|
| Conversational AI | AGENTFLOW |
| Process Automation | AGENTFLOW |
| Pattern Recognition | AGENTFLOW |
| Content Generation | CHATFLOW |
| Text Generation | CHATFLOW |
| Search and Retrieval | Either (depends on other factors) |
| Optimization | AGENTFLOW (if dynamic) |
| Text Analysis | CHATFLOW |
