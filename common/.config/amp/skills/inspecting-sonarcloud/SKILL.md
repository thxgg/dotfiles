---
name: inspecting-sonarcloud
description: Inspects CODE Hospitality SonarCloud projects, quality gates, issues, security hotspots, coverage, duplications, metrics, branches, and pull requests. Use for SonarCloud code quality and security analysis.
mcpServers:
  sonarcloud:
    url: https://api.sonarcloud.io/mcp
    headers:
      Authorization: "Bearer ${SONARQUBE_TOKEN}"
      SONARQUBE_ORG: "${SONARQUBE_ORG}"
    includeTools:
      - get_component_measures
      - get_duplications
      - get_file_coverage_details
      - get_project_quality_gate_status
      - list_branches
      - list_pull_requests
      - list_quality_gates
      - search_dependency_risks
      - search_duplicated_files
      - search_files_by_coverage
      - search_metrics
      - search_my_sonarqube_projects
      - search_security_hotspots
      - search_sonar_issues_in_projects
      - show_rule
      - show_security_hotspot
---

# Inspecting SonarCloud

Use the bundled `sonarcloud` MCP server to inspect code quality and security data. Prefer the current branch or pull-request analysis when available, and use the default branch only when no more specific analysis context exists.

Treat SonarCloud as read-only. Report quality-gate failures, issues, security hotspots, dependency risks, coverage gaps, and duplications with the affected project, branch or pull request, rule, severity, and file location when available.
