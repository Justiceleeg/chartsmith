package llm

import (
	"strings"
	"testing"

	types "github.com/replicatedhq/chartsmith/pkg/llm/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParser_ParsePlan(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected HelmResponse
	}{
		{
			name: "parses wordpress plan",
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
			expected: HelmResponse{
				Title: "WordPress Helm Chart Implementation Plan",
				Actions: map[string]types.ActionPlan{
					"Chart.yaml": {
						Type:   "file",
						Action: "update",
					},
					"templates/wordpress-deployment.yaml": {
						Type:   "file",
						Action: "create",
					},
				},
				Artifacts: []types.Artifact{},
			},
		},
		{
			name:  "handles empty input",
			input: "",
			expected: HelmResponse{
				Title:     "",
				Actions:   map[string]types.ActionPlan{},
				Artifacts: []types.Artifact{},
			},
		},
		{
			name:  "handles input with no plan tags",
			input: "This is just plain text without any XML tags",
			expected: HelmResponse{
				Title:     "",
				Actions:   map[string]types.ActionPlan{},
				Artifacts: []types.Artifact{},
			},
		},
		{
			name: "parses delete action",
			input: `<chartsmithArtifactPlan title="Cleanup Plan">
<chartsmithActionPlan type="file" action="delete" path="templates/old-deployment.yaml">
</chartsmithActionPlan>`,
			expected: HelmResponse{
				Title: "Cleanup Plan",
				Actions: map[string]types.ActionPlan{
					"templates/old-deployment.yaml": {
						Type:   "file",
						Action: "delete",
					},
				},
				Artifacts: []types.Artifact{},
			},
		},
		{
			name: "strips leading slash from path",
			input: `<chartsmithArtifactPlan title="Test">
<chartsmithActionPlan type="file" action="create" path="/Chart.yaml">
</chartsmithActionPlan>`,
			expected: HelmResponse{
				Title: "Test",
				Actions: map[string]types.ActionPlan{
					"Chart.yaml": {
						Type:   "file",
						Action: "create",
					},
				},
				Artifacts: []types.Artifact{},
			},
		},
		{
			name: "handles multiple plans with same structure",
			input: `<chartsmithArtifactPlan title="Multi-file Plan">
<chartsmithActionPlan type="file" action="create" path="values.yaml"></chartsmithActionPlan>
<chartsmithActionPlan type="file" action="create" path="Chart.yaml"></chartsmithActionPlan>
<chartsmithActionPlan type="file" action="update" path="templates/deployment.yaml"></chartsmithActionPlan>
<chartsmithActionPlan type="file" action="delete" path="templates/legacy.yaml"></chartsmithActionPlan>`,
			expected: HelmResponse{
				Title: "Multi-file Plan",
				Actions: map[string]types.ActionPlan{
					"values.yaml":               {Type: "file", Action: "create"},
					"Chart.yaml":                {Type: "file", Action: "create"},
					"templates/deployment.yaml": {Type: "file", Action: "update"},
					"templates/legacy.yaml":     {Type: "file", Action: "delete"},
				},
				Artifacts: []types.Artifact{},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := NewParser()
			p.ParsePlan(tt.input)
			result := p.GetResult()

			assert.Equal(t, tt.expected.Title, result.Title, "titles should match")
			require.Equal(t, len(tt.expected.Actions), len(result.Actions), "should have same number of actions")

			for path, expectedAction := range tt.expected.Actions {
				actualAction, exists := result.Actions[path]
				assert.True(t, exists, "action for path %s should exist", path)
				assert.Equal(t, expectedAction, actualAction, "action for path %s should match", path)
			}
		})
	}
}

func TestParser_ParseArtifacts(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected []types.Artifact
	}{
		{
			name: "parses complete Chart.yaml with path",
			input: `<chartsmithArtifact path="Chart.yaml">
apiVersion: v2
name: wordpress
description: A Helm chart for WordPress
version: 1.0.0
</chartsmithArtifact>`,
			expected: []types.Artifact{
				{
					Path:    "Chart.yaml",
					Content: "apiVersion: v2\nname: wordpress\ndescription: A Helm chart for WordPress\nversion: 1.0.0",
				},
			},
		},
		{
			name: "parses partial artifact with path",
			input: `<chartsmithArtifact path="Chart.yaml">
apiVersion: v2
name: wordpress
description: A Helm chart`,
			expected: []types.Artifact{
				{
					Path:    "Chart.yaml",
					Content: "apiVersion: v2\nname: wordpress\ndescription: A Helm chart",
				},
			},
		},
		{
			name: "handles multiple artifacts with different paths",
			input: `<chartsmithArtifact path="Chart.yaml">
apiVersion: v2
name: chart1
</chartsmithArtifact>
<chartsmithArtifact path="values.yaml">
replicaCount: 1
image:
  tag: latest`,
			expected: []types.Artifact{
				{
					Path:    "Chart.yaml",
					Content: "apiVersion: v2\nname: chart1",
				},
				{
					Path:    "values.yaml",
					Content: "replicaCount: 1\nimage:\n  tag: latest",
				},
			},
		},
		{
			name: "handles streaming chunks with path",
			input: `<chartsmithArtifact path="Chart.yaml">
apiVersion: v2
name: wordpr`,
			expected: []types.Artifact{
				{
					Path:    "Chart.yaml",
					Content: "apiVersion: v2\nname: wordpr",
				},
			},
		},
		{
			name:     "handles empty input",
			input:    "",
			expected: []types.Artifact{},
		},
		{
			name:     "handles input without artifacts",
			input:    "This is just plain text",
			expected: []types.Artifact{},
		},
		{
			name:     "ignores artifact without path attribute",
			input:    `<chartsmithArtifact>content without path</chartsmithArtifact>`,
			expected: []types.Artifact{},
		},
		{
			name: "parses nested template path",
			input: `<chartsmithArtifact path="templates/deployment.yaml">
apiVersion: apps/v1
kind: Deployment
</chartsmithArtifact>`,
			expected: []types.Artifact{
				{
					Path:    "templates/deployment.yaml",
					Content: "apiVersion: apps/v1\nkind: Deployment",
				},
			},
		},
		{
			name: "handles special characters in content",
			input: `<chartsmithArtifact path="templates/configmap.yaml">
data:
  config.json: |
    {"key": "value", "nested": {"a": 1}}
</chartsmithArtifact>`,
			expected: []types.Artifact{
				{
					Path:    "templates/configmap.yaml",
					Content: "data:\n  config.json: |\n    {\"key\": \"value\", \"nested\": {\"a\": 1}}",
				},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := NewParser()
			p.ParseArtifacts(tt.input)
			result := p.GetResult()

			assert.Equal(t, len(tt.expected), len(result.Artifacts), "should have same number of artifacts")
			for i, expectedArtifact := range tt.expected {
				assert.Equal(t, expectedArtifact.Path, result.Artifacts[i].Path, "paths should match")
				assert.Equal(t, strings.TrimSpace(expectedArtifact.Content), strings.TrimSpace(result.Artifacts[i].Content), "content should match")
			}
		})
	}
}
