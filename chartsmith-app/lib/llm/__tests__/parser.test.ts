/**
 * Parser tests, ported from pkg/llm/parser_test.go
 */

import { Parser } from '../parser';
import type { ActionPlan, Artifact } from '../types';

describe('Parser', () => {
  describe('parsePlan', () => {
    interface TestCase {
      name: string;
      input: string;
      expected: {
        title: string;
        actions: Record<string, ActionPlan>;
        artifacts: Artifact[];
      };
    }

    const tests: TestCase[] = [
      {
        name: 'parses wordpress plan',
        input: `<chartsmithArtifactPlan id="wordpress-chart-implementation" title="WordPress Helm Chart Implementation Plan">

<chartsmithActionPlan type="file" action="update" path="Chart.yaml">
- Update chart metadata for WordPress
- Add MariaDB dependency
- Set appropriate versions
</chartsmithActionPlan>

<chartsmithActionPlan type="file" action="create" path="templates/wordpress-deployment.yaml">
- Create WordPress deployment template
- Include security contexts
- Add volume mounts
- Configure health checks
</chartsmithActionPlan>`,
        expected: {
          title: 'WordPress Helm Chart Implementation Plan',
          actions: {
            'Chart.yaml': {
              type: 'file',
              action: 'update',
            },
            'templates/wordpress-deployment.yaml': {
              type: 'file',
              action: 'create',
            },
          },
          artifacts: [],
        },
      },
      {
        name: 'handles empty input',
        input: '',
        expected: {
          title: '',
          actions: {},
          artifacts: [],
        },
      },
      {
        name: 'handles input with no plan tags',
        input: 'This is just plain text without any XML tags',
        expected: {
          title: '',
          actions: {},
          artifacts: [],
        },
      },
      {
        name: 'parses delete action',
        input: `<chartsmithArtifactPlan title="Cleanup Plan">
<chartsmithActionPlan type="file" action="delete" path="templates/old-deployment.yaml">
</chartsmithActionPlan>`,
        expected: {
          title: 'Cleanup Plan',
          actions: {
            'templates/old-deployment.yaml': {
              type: 'file',
              action: 'delete',
            },
          },
          artifacts: [],
        },
      },
      {
        name: 'strips leading slash from path',
        input: `<chartsmithArtifactPlan title="Test">
<chartsmithActionPlan type="file" action="create" path="/Chart.yaml">
</chartsmithActionPlan>`,
        expected: {
          title: 'Test',
          actions: {
            'Chart.yaml': {
              type: 'file',
              action: 'create',
            },
          },
          artifacts: [],
        },
      },
      {
        name: 'handles multiple plans with same structure',
        input: `<chartsmithArtifactPlan title="Multi-file Plan">
<chartsmithActionPlan type="file" action="create" path="values.yaml"></chartsmithActionPlan>
<chartsmithActionPlan type="file" action="create" path="Chart.yaml"></chartsmithActionPlan>
<chartsmithActionPlan type="file" action="update" path="templates/deployment.yaml"></chartsmithActionPlan>
<chartsmithActionPlan type="file" action="delete" path="templates/legacy.yaml"></chartsmithActionPlan>`,
        expected: {
          title: 'Multi-file Plan',
          actions: {
            'values.yaml': { type: 'file', action: 'create' },
            'Chart.yaml': { type: 'file', action: 'create' },
            'templates/deployment.yaml': { type: 'file', action: 'update' },
            'templates/legacy.yaml': { type: 'file', action: 'delete' },
          },
          artifacts: [],
        },
      },
    ];

    test.each(tests)('$name', ({ input, expected }) => {
      const p = new Parser();
      p.parsePlan(input);
      const result = p.getResult();

      expect(result.title).toBe(expected.title);
      expect(Object.keys(result.actions).length).toBe(Object.keys(expected.actions).length);

      for (const [path, expectedAction] of Object.entries(expected.actions)) {
        expect(result.actions[path]).toBeDefined();
        expect(result.actions[path]).toEqual(expectedAction);
      }
    });
  });

  describe('parseArtifacts', () => {
    interface TestCase {
      name: string;
      input: string;
      expected: Artifact[];
    }

    const tests: TestCase[] = [
      {
        name: 'parses complete Chart.yaml with path',
        input: `<chartsmithArtifact path="Chart.yaml">
apiVersion: v2
name: wordpress
description: A Helm chart for WordPress
version: 1.0.0
</chartsmithArtifact>`,
        expected: [
          {
            path: 'Chart.yaml',
            content: 'apiVersion: v2\nname: wordpress\ndescription: A Helm chart for WordPress\nversion: 1.0.0',
          },
        ],
      },
      {
        name: 'parses partial artifact with path',
        input: `<chartsmithArtifact path="Chart.yaml">
apiVersion: v2
name: wordpress
description: A Helm chart`,
        expected: [
          {
            path: 'Chart.yaml',
            content: 'apiVersion: v2\nname: wordpress\ndescription: A Helm chart',
          },
        ],
      },
      {
        name: 'handles multiple artifacts with different paths',
        input: `<chartsmithArtifact path="Chart.yaml">
apiVersion: v2
name: chart1
</chartsmithArtifact>
<chartsmithArtifact path="values.yaml">
replicaCount: 1
image:
  tag: latest`,
        expected: [
          {
            path: 'Chart.yaml',
            content: 'apiVersion: v2\nname: chart1',
          },
          {
            path: 'values.yaml',
            content: 'replicaCount: 1\nimage:\n  tag: latest',
          },
        ],
      },
      {
        name: 'handles streaming chunks with path',
        input: `<chartsmithArtifact path="Chart.yaml">
apiVersion: v2
name: wordpr`,
        expected: [
          {
            path: 'Chart.yaml',
            content: 'apiVersion: v2\nname: wordpr',
          },
        ],
      },
      {
        name: 'handles empty input',
        input: '',
        expected: [],
      },
      {
        name: 'handles input without artifacts',
        input: 'This is just plain text',
        expected: [],
      },
      {
        name: 'ignores artifact without path attribute',
        input: `<chartsmithArtifact>content without path</chartsmithArtifact>`,
        expected: [],
      },
      {
        name: 'parses nested template path',
        input: `<chartsmithArtifact path="templates/deployment.yaml">
apiVersion: apps/v1
kind: Deployment
</chartsmithArtifact>`,
        expected: [
          {
            path: 'templates/deployment.yaml',
            content: 'apiVersion: apps/v1\nkind: Deployment',
          },
        ],
      },
      {
        name: 'handles special characters in content',
        input: `<chartsmithArtifact path="templates/configmap.yaml">
data:
  config.json: |
    {"key": "value", "nested": {"a": 1}}
</chartsmithArtifact>`,
        expected: [
          {
            path: 'templates/configmap.yaml',
            content: 'data:\n  config.json: |\n    {"key": "value", "nested": {"a": 1}}',
          },
        ],
      },
    ];

    test.each(tests)('$name', ({ input, expected }) => {
      const p = new Parser();
      p.parseArtifacts(input);
      const result = p.getResult();

      expect(result.artifacts.length).toBe(expected.length);
      for (let i = 0; i < expected.length; i++) {
        expect(result.artifacts[i].path).toBe(expected[i].path);
        expect(result.artifacts[i].content.trim()).toBe(expected[i].content.trim());
      }
    });
  });

  describe('reset', () => {
    it('clears all state', () => {
      const p = new Parser();
      p.parsePlan(`<chartsmithArtifactPlan title="Test">
<chartsmithActionPlan type="file" action="create" path="test.yaml">
</chartsmithActionPlan>`);

      expect(p.getResult().title).toBe('Test');
      expect(Object.keys(p.getResult().actions).length).toBe(1);

      p.reset();

      expect(p.getResult().title).toBe('');
      expect(Object.keys(p.getResult().actions).length).toBe(0);
      expect(p.getResult().artifacts.length).toBe(0);
    });
  });
});
