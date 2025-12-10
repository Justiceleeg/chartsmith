package helmutils

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/replicatedhq/chartsmith/pkg/workspace/types"
)

// contains checks if a string contains a substring
func contains(s, substr string) bool {
	return strings.Contains(s, substr)
}

// fileExists checks if a file exists
func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func PublishChartExec(files []types.File, workspaceID string, chartName string) error {
	fakeKubeconfig := `apiVersion: v1
kind: Config
clusters:
- cluster:
    server: https://kubernetes.default
  name: default
`

	tempDir, err := os.MkdirTemp("", "chartsmith")
	if err != nil {
		return fmt.Errorf("failed to create temp directory: %w", err)
	}
	defer os.RemoveAll(tempDir)

	for _, file := range files {
		filePath := filepath.Join(tempDir, file.FilePath)
		if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
			return fmt.Errorf("failed to create directory: %w", err)
		}

		// Write file content
		if err := os.WriteFile(filePath, []byte(file.Content), 0644); err != nil {
			return fmt.Errorf("failed to write file %s: %w", file.FilePath, err)
		}
	}

	err = runHelmPublish(tempDir, workspaceID, chartName, fakeKubeconfig)
	if err != nil {
		return fmt.Errorf("failed to run helm publish: %w", err)
	}

	return nil
}

func runHelmPublish(dir string, workspaceID string, chartName string, kubeconfig string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	// Print start message with key details
	fmt.Printf("Starting helm publish:\n")
	fmt.Printf("  Working directory: %s\n", dir)
	fmt.Printf("  Workspace ID: %s\n", workspaceID)
	fmt.Printf("  Chart name: %s\n", chartName)

	remote := "oci://ttl.sh"
	fmt.Printf("  Remote URL: %s\n", remote)

	// List directory contents for debugging
	lsCmd := exec.Command("ls", "-la", dir)
	lsOutput, _ := lsCmd.CombinedOutput()
	fmt.Printf("Directory contents:\n%s\n", string(lsOutput))

	// Log helm version
	versionCmd := exec.CommandContext(ctx, "helm", "version")
	versionOutput, _ := versionCmd.CombinedOutput()
	fmt.Printf("Helm version:\n%s\n", string(versionOutput))

	// Check if Chart.yaml has dependencies and run helm dependency update if needed
	chartYamlPath := filepath.Join(dir, "Chart.yaml")
	if _, err := os.Stat(chartYamlPath); err == nil {
		// Check if there's a charts/ directory or Chart.lock - if dependencies exist
		chartsDir := filepath.Join(dir, "charts")
		chartLock := filepath.Join(dir, "Chart.lock")

		// Read Chart.yaml to check for dependencies
		chartContent, readErr := os.ReadFile(chartYamlPath)
		if readErr == nil && (contains(string(chartContent), "dependencies:")) {
			fmt.Printf("Chart has dependencies, running helm dependency update...\n")

			// Create charts directory if it doesn't exist
			if _, err := os.Stat(chartsDir); os.IsNotExist(err) {
				os.MkdirAll(chartsDir, 0755)
			}

			// Run helm dependency update to download dependencies
			depCmd := exec.CommandContext(ctx, "helm", "dependency", "update", dir)
			depCmd.Env = append(os.Environ(), "KUBECONFIG="+kubeconfig)
			depOutput, depErr := depCmd.CombinedOutput()
			fmt.Printf("Helm dependency update output:\n%s\n", string(depOutput))

			if depErr != nil {
				// If dependency update fails, try to remove the dependencies section
				// This allows charts to be published even if dependencies can't be resolved
				fmt.Printf("Warning: helm dependency update failed, attempting to publish without dependencies\n")

				// Remove Chart.lock if it exists (might be stale)
				if _, err := os.Stat(chartLock); err == nil {
					os.Remove(chartLock)
				}
			}
		}
	}

	// SIMPLIFIED APPROACH: Package the chart first
	fmt.Printf("Packaging chart...\n")
	packageCmd := exec.CommandContext(ctx, "helm", "package", dir, "--destination", os.TempDir())
	packageCmd.Env = append(os.Environ(), "KUBECONFIG="+kubeconfig)
	packageOutput, err := packageCmd.CombinedOutput()
	fmt.Printf("Helm package output:\n%s\n", string(packageOutput))

	if err != nil {
		return fmt.Errorf("failed to package chart: %w\nOutput: %s", err, string(packageOutput))
	}

	// Parse the package output to get the actual filename
	// Output format: "Successfully packaged chart and saved it to: /path/to/chart-version.tgz"
	var chartPackage string
	outputStr := string(packageOutput)
	if idx := strings.Index(outputStr, "saved it to: "); idx != -1 {
		chartPackage = strings.TrimSpace(outputStr[idx+len("saved it to: "):])
		// Remove any trailing newlines
		chartPackage = strings.Split(chartPackage, "\n")[0]
		fmt.Printf("Parsed chart package path: %s\n", chartPackage)
	}

	// Fallback: try to find the package using the chartName parameter
	if chartPackage == "" || !fileExists(chartPackage) {
		packagePattern := filepath.Join(os.TempDir(), fmt.Sprintf("%s-*.tgz", chartName))
		matches, err := filepath.Glob(packagePattern)
		if err != nil {
			return fmt.Errorf("failed to find package: %w", err)
		}

		if len(matches) == 0 {
			// Try wildcard pattern as last resort
			packagePattern = filepath.Join(os.TempDir(), "*.tgz")
			matches, err = filepath.Glob(packagePattern)
			if err != nil {
				return fmt.Errorf("failed to find package with wildcard: %w", err)
			}
			if len(matches) == 0 {
				return fmt.Errorf("no chart package found in %s", os.TempDir())
			}
			// Find the most recently modified .tgz file
			var newestFile string
			var newestTime int64
			for _, match := range matches {
				info, err := os.Stat(match)
				if err == nil && info.ModTime().Unix() > newestTime {
					newestTime = info.ModTime().Unix()
					newestFile = match
				}
			}
			chartPackage = newestFile
		} else {
			chartPackage = matches[0]
		}
	}

	fmt.Printf("Using chart package: %s\n", chartPackage)

	// Tag the chart with the workspace ID to make it uniquely identifiable
	chartTag := fmt.Sprintf("chartsmith-%s", workspaceID)
	fmt.Printf("Using chart tag: %s\n", chartTag)

	// DIRECT PUSH: Use a single, reliable approach with helm push
	fmt.Printf("Pushing chart to ttl.sh...\n")

	// Try direct push to the root of ttl.sh
	pushCmd := exec.CommandContext(ctx, "helm", "push", chartPackage, remote)
	pushCmd.Env = append(os.Environ(), "KUBECONFIG="+kubeconfig)
	pushOutput, pushErr := pushCmd.CombinedOutput()
	if pushErr != nil {
		return fmt.Errorf("failed to push chart: %w\nOutput: %s", pushErr, string(pushOutput))
	}

	// Log output regardless of success/failure
	fmt.Printf("Helm push output:\n%s\n", string(pushOutput))

	fmt.Printf("Helm push completed successfully\n")
	return nil
}
