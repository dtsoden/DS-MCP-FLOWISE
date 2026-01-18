/**
 * Extract node definitions from Flowise source code
 * Parses TypeScript files to extract node schemas without requiring runtime execution
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

interface NodeInput {
  label: string;
  name: string;
  type: string;
  description?: string;
  optional?: boolean;
  default?: any;
  options?: Array<{ label: string; name: string; description?: string }>;
  additionalParams?: boolean;
  rows?: number;
  placeholder?: string;
  loadMethod?: string;
  credentialNames?: string[];
}

interface NodeCredential {
  label: string;
  name: string;
  type: string;
  credentialNames?: string[];
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
  credential?: NodeCredential;
  inputs: NodeInput[];
  outputs?: any[];
  filePath: string;
}

interface MarketplaceTemplate {
  name: string;
  description: string;
  type: 'chatflow' | 'agentflow' | 'agentflowv2' | 'tool';
  nodes: any[];
  edges: any[];
  usecases?: string[];
}

// Extract string value from assignment like: this.label = 'ChatOpenAI'
function extractStringValue(content: string, propertyName: string): string | null {
  // Match both single and double quotes, and template literals
  const patterns = [
    new RegExp(`this\\.${propertyName}\\s*=\\s*['"\`]([^'"\`]+)['"\`]`),
    new RegExp(`this\\.${propertyName}\\s*=\\s*['"\`]([^'"\`]+)['"\`]`),
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Extract number value
function extractNumberValue(content: string, propertyName: string): number | null {
  const pattern = new RegExp(`this\\.${propertyName}\\s*=\\s*([\\d.]+)`);
  const match = content.match(pattern);
  if (match) return parseFloat(match[1]);
  return null;
}

// Extract array value (for baseClasses)
function extractBaseClasses(content: string): string[] {
  // Try to find baseClasses assignment
  const patterns = [
    /this\.baseClasses\s*=\s*\[([^\]]+)\]/s,
    /this\.baseClasses\s*=\s*\[this\.type[^\]]*\]/s,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      // Extract string literals from the array
      const arrayContent = match[1] || match[0];
      const strings: string[] = [];
      const stringMatches = arrayContent.matchAll(/['"`]([^'"`]+)['"`]/g);
      for (const m of stringMatches) {
        strings.push(m[1]);
      }
      // If this.type is referenced, we'll add it later
      if (arrayContent.includes('this.type')) {
        strings.unshift('__TYPE__'); // Placeholder
      }
      return strings;
    }
  }
  return [];
}

// Extract inputs array - this is complex due to nested objects
function extractInputs(content: string): NodeInput[] {
  const inputs: NodeInput[] = [];

  // Find the inputs array assignment
  const inputsMatch = content.match(/this\.inputs\s*=\s*\[([\s\S]*?)\n\s{8}\]/);
  if (!inputsMatch) return inputs;

  const inputsContent = inputsMatch[1];

  // Split by objects - look for { patterns
  const objectPattern = /\{\s*\n([\s\S]*?)\n\s{12}\}/g;
  let match;

  while ((match = objectPattern.exec(inputsContent)) !== null) {
    const objContent = match[1];
    const input: NodeInput = {
      label: '',
      name: '',
      type: ''
    };

    // Extract properties
    const labelMatch = objContent.match(/label:\s*['"`]([^'"`]+)['"`]/);
    const nameMatch = objContent.match(/name:\s*['"`]([^'"`]+)['"`]/);
    const typeMatch = objContent.match(/type:\s*['"`]([^'"`]+)['"`]/);
    const descMatch = objContent.match(/description:\s*['"`]([^'"`]+)['"`]/);
    const optionalMatch = objContent.match(/optional:\s*(true|false)/);
    const defaultMatch = objContent.match(/default:\s*(['"`]([^'"`]+)['"`]|[\d.]+|true|false)/);
    const additionalMatch = objContent.match(/additionalParams:\s*(true|false)/);
    const rowsMatch = objContent.match(/rows:\s*(\d+)/);
    const placeholderMatch = objContent.match(/placeholder:\s*['"`]([^'"`]+)['"`]/);
    const loadMethodMatch = objContent.match(/loadMethod:\s*['"`]([^'"`]+)['"`]/);

    if (labelMatch) input.label = labelMatch[1];
    if (nameMatch) input.name = nameMatch[1];
    if (typeMatch) input.type = typeMatch[1];
    if (descMatch) input.description = descMatch[1];
    if (optionalMatch) input.optional = optionalMatch[1] === 'true';
    if (defaultMatch) {
      const val = defaultMatch[2] || defaultMatch[1];
      if (val === 'true') input.default = true;
      else if (val === 'false') input.default = false;
      else if (!isNaN(Number(val))) input.default = Number(val);
      else input.default = val.replace(/['"`]/g, '');
    }
    if (additionalMatch) input.additionalParams = additionalMatch[1] === 'true';
    if (rowsMatch) input.rows = parseInt(rowsMatch[1]);
    if (placeholderMatch) input.placeholder = placeholderMatch[1];
    if (loadMethodMatch) input.loadMethod = loadMethodMatch[1];

    // Extract options if present
    const optionsMatch = objContent.match(/options:\s*\[([\s\S]*?)\]/);
    if (optionsMatch) {
      input.options = [];
      const optPattern = /\{\s*label:\s*['"`]([^'"`]+)['"`],\s*name:\s*['"`]([^'"`]+)['"`]/g;
      let optMatch;
      while ((optMatch = optPattern.exec(optionsMatch[1])) !== null) {
        input.options.push({ label: optMatch[1], name: optMatch[2] });
      }
    }

    if (input.name && input.type) {
      inputs.push(input);
    }
  }

  return inputs;
}

// Extract credential object
function extractCredential(content: string): NodeCredential | null {
  const credMatch = content.match(/this\.credential\s*=\s*\{([\s\S]*?)\n\s{8}\}/);
  if (!credMatch) return null;

  const credContent = credMatch[1];
  const labelMatch = credContent.match(/label:\s*['"`]([^'"`]+)['"`]/);
  const nameMatch = credContent.match(/name:\s*['"`]([^'"`]+)['"`]/);
  const typeMatch = credContent.match(/type:\s*['"`]([^'"`]+)['"`]/);
  const credNamesMatch = credContent.match(/credentialNames:\s*\[([^\]]+)\]/);

  if (!labelMatch || !nameMatch) return null;

  const credential: NodeCredential = {
    label: labelMatch[1],
    name: nameMatch[1],
    type: typeMatch?.[1] || 'credential'
  };

  if (credNamesMatch) {
    credential.credentialNames = [];
    const namesPattern = /['"`]([^'"`]+)['"`]/g;
    let m;
    while ((m = namesPattern.exec(credNamesMatch[1])) !== null) {
      credential.credentialNames.push(m[1]);
    }
  }

  return credential;
}

// Parse a single node file
function parseNodeFile(filePath: string): ExtractedNode | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Check if this is a node class
    if (!content.includes('implements INode')) {
      return null;
    }

    const name = extractStringValue(content, 'name');
    const label = extractStringValue(content, 'label');
    const version = extractNumberValue(content, 'version');
    const type = extractStringValue(content, 'type');
    const icon = extractStringValue(content, 'icon');
    const category = extractStringValue(content, 'category');
    const description = extractStringValue(content, 'description');

    if (!name || !label) {
      return null;
    }

    let baseClasses = extractBaseClasses(content);
    // Replace __TYPE__ placeholder with actual type
    if (type) {
      baseClasses = baseClasses.map(bc => bc === '__TYPE__' ? type : bc);
    }

    const inputs = extractInputs(content);
    const credential = extractCredential(content);

    return {
      name,
      label,
      version: version || 1,
      type: type || name,
      icon: icon || '',
      category: category || 'Unknown',
      description: description || '',
      baseClasses,
      credential: credential || undefined,
      inputs,
      filePath: path.relative(process.cwd(), filePath)
    };
  } catch (error) {
    console.error(`Error parsing ${filePath}:`, error);
    return null;
  }
}

// Parse marketplace templates
function parseMarketplaceTemplates(marketplacePath: string): MarketplaceTemplate[] {
  const templates: MarketplaceTemplate[] = [];

  const folders = [
    { path: 'chatflows', type: 'chatflow' as const },
    { path: 'agentflows', type: 'agentflow' as const },
    { path: 'agentflowsv2', type: 'agentflowv2' as const },
    { path: 'tools', type: 'tool' as const },
  ];

  for (const folder of folders) {
    const folderPath = path.join(marketplacePath, folder.path);
    if (!fs.existsSync(folderPath)) continue;

    const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.json'));

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(folderPath, file), 'utf-8');
        const data = JSON.parse(content);

        templates.push({
          name: file.replace('.json', ''),
          description: data.description || '',
          type: folder.type,
          nodes: data.nodes || [],
          edges: data.edges || [],
          usecases: data.usecases || []
        });
      } catch (error) {
        console.error(`Error parsing template ${file}:`, error);
      }
    }
  }

  return templates;
}

// Extract baseClasses mapping from marketplace templates
function extractBaseClassesFromTemplates(templates: MarketplaceTemplate[]): Map<string, string[]> {
  const baseClassesMap = new Map<string, string[]>();

  for (const template of templates) {
    for (const node of template.nodes) {
      const nodeName = node.data?.name;
      const baseClasses = node.data?.baseClasses;

      if (nodeName && baseClasses && Array.isArray(baseClasses) && baseClasses.length > 0) {
        // Keep the longest baseClasses array for each node (most complete inheritance chain)
        const existing = baseClassesMap.get(nodeName);
        if (!existing || baseClasses.length > existing.length) {
          baseClassesMap.set(nodeName, baseClasses);
        }
      }
    }
  }

  return baseClassesMap;
}

// Enrich nodes with baseClasses from templates
function enrichNodesWithBaseClasses(nodes: ExtractedNode[], baseClassesMap: Map<string, string[]>): void {
  let enrichedCount = 0;

  for (const node of nodes) {
    const templateBaseClasses = baseClassesMap.get(node.name);
    if (templateBaseClasses && templateBaseClasses.length > node.baseClasses.length) {
      node.baseClasses = templateBaseClasses;
      enrichedCount++;
    }
  }

  console.log(`Enriched ${enrichedCount} nodes with baseClasses from templates`);
}

async function main() {
  const flowiseSourcePath = path.join(process.cwd(), 'flowise-source');
  const nodesPath = path.join(flowiseSourcePath, 'packages', 'components', 'nodes');
  const marketplacePath = path.join(flowiseSourcePath, 'packages', 'server', 'marketplaces');
  const outputPath = path.join(process.cwd(), 'data');

  console.log('Extracting Flowise node definitions...\n');

  // Find all TypeScript node files
  const nodeFiles = await glob('**/*.ts', { cwd: nodesPath, absolute: true });
  console.log(`Found ${nodeFiles.length} TypeScript files`);

  const nodes: ExtractedNode[] = [];
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
  console.log('Categories:', Array.from(categories).sort().join(', '));

  // Parse marketplace templates
  console.log('\nExtracting marketplace templates...');
  const templates = parseMarketplaceTemplates(marketplacePath);
  console.log(`Extracted ${templates.length} templates`);

  // Extract baseClasses from templates and enrich nodes
  console.log('\nEnriching nodes with baseClasses from templates...');
  const baseClassesMap = extractBaseClassesFromTemplates(templates);
  console.log(`Found baseClasses for ${baseClassesMap.size} node types in templates`);
  enrichNodesWithBaseClasses(nodes, baseClassesMap);

  // Ensure output directory exists
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
  }

  // Write extracted data
  fs.writeFileSync(
    path.join(outputPath, 'nodes.json'),
    JSON.stringify(nodes, null, 2)
  );

  fs.writeFileSync(
    path.join(outputPath, 'templates.json'),
    JSON.stringify(templates, null, 2)
  );

  // Write baseClasses mapping for reference
  const baseClassesObj: Record<string, string[]> = {};
  baseClassesMap.forEach((value, key) => {
    baseClassesObj[key] = value;
  });
  fs.writeFileSync(
    path.join(outputPath, 'baseClasses.json'),
    JSON.stringify(baseClassesObj, null, 2)
  );

  // Write summary
  const summary = {
    extractedAt: new Date().toISOString(),
    totalNodes: nodes.length,
    categories: Array.from(categories).sort(),
    totalTemplates: templates.length,
    templatesByType: {
      chatflow: templates.filter(t => t.type === 'chatflow').length,
      agentflow: templates.filter(t => t.type === 'agentflow').length,
      agentflowv2: templates.filter(t => t.type === 'agentflowv2').length,
      tool: templates.filter(t => t.type === 'tool').length,
    },
    baseClassesMappingCount: baseClassesMap.size
  };

  fs.writeFileSync(
    path.join(outputPath, 'summary.json'),
    JSON.stringify(summary, null, 2)
  );

  console.log('\nExtraction complete!');
  console.log(`Output written to: ${outputPath}`);
}

main().catch(console.error);
