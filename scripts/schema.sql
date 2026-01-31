-- DS-MCP-FLOWISE Comprehensive Database Schema
-- Designed to capture 100% of Flowise node structure
-- Updated to match ALL fields from Interface.ts

-- Drop existing tables
DROP TABLE IF EXISTS input_options;
DROP TABLE IF EXISTS node_inputs;
DROP TABLE IF EXISTS node_outputs;
DROP TABLE IF EXISTS node_credentials;
DROP TABLE IF EXISTS nodes;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS templates;

-- =============================================================================
-- NODES TABLE - Core node definitions (INodeProperties interface)
-- =============================================================================
CREATE TABLE nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,              -- e.g., "agentAgentflow"
    label TEXT NOT NULL,                    -- e.g., "Agent"
    version REAL NOT NULL,                  -- e.g., 3.2
    type TEXT NOT NULL,                     -- e.g., "Agent" (PascalCase)
    icon TEXT,                              -- icon path/name
    category TEXT NOT NULL,                 -- e.g., "Agent Flows"
    description TEXT,                       -- node description
    base_classes TEXT NOT NULL,             -- JSON array: ["Agent"]
    file_path TEXT,                         -- path to .js/.ts file
    is_agentflow INTEGER DEFAULT 0,         -- boolean: is this an agentflow node

    -- Display properties
    color TEXT,                             -- hex color e.g., "#4DD0E1"
    hide_input INTEGER DEFAULT 0,           -- boolean: hide input anchor
    hide_output INTEGER DEFAULT 0,          -- boolean: hide output anchor
    hint TEXT,                              -- tooltip hint text
    documentation TEXT,                     -- documentation URL

    -- Metadata (NEW fields from INodeProperties)
    tags TEXT,                              -- JSON array: ["LlamaIndex"]
    badge TEXT,                             -- e.g., "DEPRECATING"
    deprecate_message TEXT,                 -- deprecation message
    author TEXT,                            -- author name
    warning TEXT                            -- node-level warning message
);

CREATE INDEX idx_nodes_category ON nodes(category);
CREATE INDEX idx_nodes_name ON nodes(name);
CREATE INDEX idx_nodes_is_agentflow ON nodes(is_agentflow);

-- =============================================================================
-- NODE_CREDENTIALS TABLE - Credential definitions (one per node max)
-- =============================================================================
CREATE TABLE node_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_name TEXT NOT NULL,                -- FK to nodes.name
    label TEXT NOT NULL,                    -- e.g., "Connect Credential"
    name TEXT NOT NULL,                     -- e.g., "credential"
    type TEXT NOT NULL,                     -- usually "credential"
    credential_names TEXT,                  -- JSON array of credential type names
    FOREIGN KEY (node_name) REFERENCES nodes(name) ON DELETE CASCADE
);

CREATE INDEX idx_node_credentials_node ON node_credentials(node_name);

-- =============================================================================
-- NODE_INPUTS TABLE - Input/parameter definitions (INodeParams interface)
-- Supports nesting via parent_id for array and tabs types
-- =============================================================================
CREATE TABLE node_inputs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_name TEXT NOT NULL,                -- FK to nodes.name
    parent_id INTEGER,                      -- FK to self for nested inputs (NULL = top-level)

    -- Basic identification
    input_name TEXT NOT NULL,               -- e.g., "agentModel"
    input_label TEXT NOT NULL,              -- e.g., "Model"
    input_type TEXT NOT NULL,               -- string|number|boolean|options|multiOptions|asyncOptions|array|code|json|file|credential|tabs|datagrid

    -- Description and display
    description TEXT,                       -- help text
    placeholder TEXT,                       -- placeholder text for input fields
    rows INTEGER,                           -- number of rows for textarea
    warning TEXT,                           -- input-level warning message (NEW)

    -- Defaults and requirements
    default_value TEXT,                     -- default value (stored as text, parse based on type)
    is_optional INTEGER DEFAULT 0,          -- boolean: is this field optional
    is_additional_params INTEGER DEFAULT 0, -- boolean: show in additional params section
    is_hidden INTEGER DEFAULT 0,            -- boolean: hide this input (NEW)

    -- Async loading
    load_method TEXT,                       -- method name for async loading e.g., "listModels"
    load_config INTEGER DEFAULT 0,          -- boolean: load config for async
    load_previous_nodes INTEGER DEFAULT 0,  -- boolean: load previous nodes (NEW)

    -- Variable support
    accept_variable INTEGER DEFAULT 0,      -- boolean: can accept variables
    accept_node_output INTEGER DEFAULT 0,   -- boolean: can accept node output as variable

    -- UI behavior
    refresh INTEGER DEFAULT 0,              -- boolean: refresh on dependency change
    free_solo INTEGER DEFAULT 0,            -- boolean: allow custom values
    is_list INTEGER DEFAULT 0,              -- boolean: is this a list/array input (NEW)

    -- Number input specifics
    step REAL,                              -- step value for number inputs (e.g., 0.1)

    -- File input specifics (NEW)
    file_type TEXT,                         -- file type filter e.g., ".csv", ".yaml", "*"

    -- Code input specifics
    code_example TEXT,                      -- example code for code inputs (NEW)
    hide_code_execute INTEGER DEFAULT 0,    -- boolean: hide code execute button

    -- Special generators
    generate_instruction INTEGER DEFAULT 0, -- boolean: show generate instruction button
    generate_doc_store_desc INTEGER DEFAULT 0, -- boolean: show generate doc store description

    -- Hint (can be a simple string or JSON object with label/value)
    hint TEXT,                              -- JSON: {"label": "How to use", "value": "..."} (NEW)

    -- Tabs support (NEW)
    tab_identifier TEXT,                    -- tab identifier for tabs type

    -- Datagrid support (NEW)
    datagrid TEXT,                          -- JSON: array of column definitions for datagrid type

    -- Conditional display (JSON objects)
    show_condition TEXT,                    -- JSON: {"fieldName": "value"} or {"fieldName": ["val1", "val2"]}
    hide_condition TEXT,                    -- JSON: {"fieldName": "value"}

    -- Ordering
    sort_order INTEGER DEFAULT 0,           -- order within parent

    FOREIGN KEY (node_name) REFERENCES nodes(name) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES node_inputs(id) ON DELETE CASCADE
);

CREATE INDEX idx_node_inputs_node ON node_inputs(node_name);
CREATE INDEX idx_node_inputs_parent ON node_inputs(parent_id);
CREATE INDEX idx_node_inputs_type ON node_inputs(input_type);

-- =============================================================================
-- INPUT_OPTIONS TABLE - Options for dropdown/multiOptions inputs (INodeOptionsValue)
-- =============================================================================
CREATE TABLE input_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    input_id INTEGER NOT NULL,              -- FK to node_inputs.id
    option_label TEXT NOT NULL,             -- display label
    option_name TEXT NOT NULL,              -- value/name
    option_description TEXT,                -- optional description
    image_src TEXT,                         -- optional image source for option icon (NEW)
    sort_order INTEGER DEFAULT 0,           -- order in dropdown
    FOREIGN KEY (input_id) REFERENCES node_inputs(id) ON DELETE CASCADE
);

CREATE INDEX idx_input_options_input ON input_options(input_id);

-- =============================================================================
-- NODE_OUTPUTS TABLE - Output anchor definitions (INodeOutputsValue interface)
-- =============================================================================
CREATE TABLE node_outputs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_name TEXT NOT NULL,                -- FK to nodes.name
    output_name TEXT NOT NULL,              -- e.g., "llmChain"
    output_label TEXT NOT NULL,             -- e.g., "LLM Chain"
    output_type TEXT,                       -- type chain for chatflow, NULL for agentflow (legacy)
    base_classes TEXT,                      -- JSON array: output-specific baseClasses (NEW)
    description TEXT,                       -- output description (NEW)
    is_hidden INTEGER DEFAULT 0,            -- boolean: hide this output (NEW)
    is_anchor INTEGER DEFAULT 0,            -- boolean: is this an anchor output (NEW)
    sort_order INTEGER DEFAULT 0,           -- order of outputs
    FOREIGN KEY (node_name) REFERENCES nodes(name) ON DELETE CASCADE
);

CREATE INDEX idx_node_outputs_node ON node_outputs(node_name);

-- =============================================================================
-- CATEGORIES TABLE - Node categories with counts
-- =============================================================================
CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    node_count INTEGER DEFAULT 0
);

-- =============================================================================
-- TEMPLATES TABLE - Marketplace templates
-- =============================================================================
CREATE TABLE templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL,                     -- chatflow|agentflow|agentflowv2|tool
    usecases TEXT,                          -- JSON array
    nodes TEXT NOT NULL,                    -- JSON: full node array
    edges TEXT NOT NULL                     -- JSON: full edge array
);

CREATE INDEX idx_templates_type ON templates(type);

-- =============================================================================
-- VIEWS - Useful query views
-- =============================================================================

-- View: Complete input definition with options count
CREATE VIEW v_input_details AS
SELECT
    ni.*,
    n.category as node_category,
    n.is_agentflow,
    (SELECT COUNT(*) FROM input_options WHERE input_id = ni.id) as options_count,
    (SELECT COUNT(*) FROM node_inputs WHERE parent_id = ni.id) as nested_count
FROM node_inputs ni
JOIN nodes n ON ni.node_name = n.name;

-- View: Nodes with input/output counts
CREATE VIEW v_node_summary AS
SELECT
    n.*,
    (SELECT COUNT(*) FROM node_inputs WHERE node_name = n.name AND parent_id IS NULL) as input_count,
    (SELECT COUNT(*) FROM node_outputs WHERE node_name = n.name) as output_count,
    (SELECT COUNT(*) FROM node_credentials WHERE node_name = n.name) as has_credential
FROM nodes n;
